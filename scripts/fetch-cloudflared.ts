/**
 * Fetches the tunnel binary the installer ships.
 *
 *   bun run scripts/fetch-cloudflared.ts     ->  vendor/cloudflared.exe
 *
 * ## Why this is bundled at all
 *
 * Playing with somebody in another country is the one thing Hearth cannot do
 * on its own: two houses on the internet cannot find each other, and this
 * program will not run a relay, because that would put somebody else's server
 * in the middle of your chats. `cloudflared tunnel --url` solves it with no
 * account and no port forwarding.
 *
 * Before this, the answer was "go and install cloudflared first", which is the
 * step at which most people stop. So it travels with the installer, and opening
 * the door is a button.
 *
 * ## Pinned, and checked
 *
 * A specific version with a specific hash, verified after download. This is an
 * executable that ships inside somebody's installer: taking whatever the latest
 * release happens to be on the day of the build, unverified, would mean the
 * contents of that installer depend on a URL nobody looked at. If Cloudflare's
 * release moves, the hash fails and the build stops, which is the correct
 * outcome — somebody bumps the pin deliberately.
 *
 * ## Licence
 *
 * cloudflared is Apache 2.0, which permits redistribution and requires the
 * licence travel with it. So the licence is fetched too, and installed beside
 * the binary.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const NL = String.fromCharCode(10);

/** Bump both together, from https://github.com/cloudflare/cloudflared/releases */
const VERSION = "2026.8.3";
const SHA256 = "83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae";

const BIN_URL =
  `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-windows-amd64.exe`;
const LICENSE_URL =
  "https://raw.githubusercontent.com/cloudflare/cloudflared/master/LICENSE";

const OUT = "vendor";
const BIN = join(OUT, "cloudflared.exe");
const LICENSE = join(OUT, "CLOUDFLARED-LICENSE.txt");

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

await mkdir(OUT, { recursive: true });

// Already here and already right: downloading 70MB again on every installer
// build is a slow way to get the same file.
const have = Bun.file(BIN);
if (await have.exists()) {
  const bytes = new Uint8Array(await have.arrayBuffer());
  if (sha256(bytes) === SHA256) {
    console.log(`  cloudflared ${VERSION} is already vendored and verified.`);
    process.exit(0);
  }
  console.log("  The vendored cloudflared does not match the pin — fetching again.");
}

console.log(`  Fetching cloudflared ${VERSION} ...`);
const res = await fetch(BIN_URL);
if (!res.ok) {
  console.error(`${NL}  Could not download it: ${res.status} ${res.statusText}`);
  console.error(`  ${BIN_URL}${NL}`);
  process.exit(1);
}
const bytes = new Uint8Array(await res.arrayBuffer());

const got = sha256(bytes);
if (got !== SHA256) {
  console.error(`${NL}  That is not the file this build expects.`);
  console.error(`    expected  ${SHA256}`);
  console.error(`    got       ${got}`);
  console.error(`  Nothing has been written. If Cloudflare has moved the release,`);
  console.error(`  update VERSION and SHA256 in this script together.${NL}`);
  process.exit(1);
}

await writeFile(BIN, bytes);

const lic = await fetch(LICENSE_URL);
if (!lic.ok) {
  console.error(`${NL}  Got the binary but not its licence, and it does not ship without one.`);
  console.error(`  ${LICENSE_URL}${NL}`);
  process.exit(1);
}
await writeFile(LICENSE,
  `cloudflared ${VERSION}${NL}` +
  `https://github.com/cloudflare/cloudflared${NL}` +
  `Bundled with Hearth so that hosting a game does not begin with an install.${NL}` +
  `Unmodified, and used under the licence below.${NL}${NL}` +
  (await lic.text()));

console.log(`  vendor/cloudflared.exe  —  ${(bytes.length / 1024 / 1024).toFixed(1)} MB, hash verified`);
