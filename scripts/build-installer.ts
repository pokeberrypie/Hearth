/**
 * Builds the distributable installer.
 *
 *   bun run scripts/build-installer.ts     ->  dist/HearthSetup.exe
 *
 * One file to give anybody: a wizard with the hearth for an icon, a page to
 * choose where it goes, shortcuts, and an uninstaller Settings > Apps knows
 * about. The application is inside it — there is nothing to unzip and nothing
 * to keep beside it.
 *
 * Runs the desktop build first, since the setup is only a wrapper around
 * whatever Hearth.exe currently is, and shipping a stale one is the obvious
 * way for this to go wrong quietly.
 */
import { stat } from "node:fs/promises";

const NL = String.fromCharCode(10);

const desktop = Bun.spawnSync(["bun", "run", "scripts/build-desktop.ts"],
  { stdout: "inherit", stderr: "inherit" });
if (desktop.exitCode !== 0) process.exit(1);

/*
 * The tunnel binary rides along, so that playing with somebody far away does
 * not start with "first install cloudflared" — the step at which most people
 * give up. Pinned and hash-checked in that script; a failure there stops the
 * build rather than quietly shipping an installer without it.
 */
const tunnel = Bun.spawnSync(["bun", "run", "scripts/fetch-cloudflared.ts"],
  { stdout: "inherit", stderr: "inherit" });
if (tunnel.exitCode !== 0) process.exit(1);

/*
 * Inno Setup installs per-user by default on this machine, so it is not on
 * PATH and not in Program Files. Look where winget puts it before giving up,
 * and say plainly how to get it rather than failing with a "not found".
 */
const candidates = [
  `${process.env.LOCALAPPDATA}\\Programs\\Inno Setup 6\\ISCC.exe`,
  "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
  "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
];

let iscc = "";
for (const c of candidates) {
  if (await Bun.file(c).exists()) { iscc = c; break; }
}
if (!iscc) {
  console.error(`${NL}  Inno Setup is not installed — it is what builds the wizard.`);
  console.error(`  winget install --id JRSoftware.InnoSetup${NL}`);
  process.exit(1);
}

console.log(`${NL}  Packaging the installer ...`);
// The version comes from package.json, which is the only place it is written.
const version = JSON.parse(await Bun.file("package.json").text()).version;
const pack = Bun.spawnSync([iscc, `/DAppVersion=${version}`, "installer\\hearth.iss"],
  { stdout: "pipe", stderr: "pipe" });
if (pack.exitCode !== 0) {
  console.error(pack.stdout.toString());
  console.error(pack.stderr.toString());
  process.exit(1);
}

const out = "dist/HearthSetup.exe";
const size = (await stat(out)).size;

/*
 * Did the tunnel actually go in?
 *
 * It did not, once, and nothing said so: a stray escape turned `..\vendor\`
 * into `..<VT>endor\` in the .iss, and the `skipifsourcedoesntexist` flag —
 * there so a checkout without the binary could still build — obligingly
 * skipped it. The build printed success and produced an installer that was
 * quietly missing the thing the release notes said it had.
 *
 * The flag is gone, so a bad path is now a hard failure. This is the second
 * belt: the packaged size has to have room for a 50MB binary in it. Cheap, and
 * it checks the artefact rather than the intention.
 */
const tunnelSize = (await stat("vendor/cloudflared.exe")).size;
const floor = 12 * 1024 * 1024;
if (size < floor) {
  console.error(`${NL}  That installer is ${(size / 1024 / 1024).toFixed(1)} MB, which is too`);
  console.error(`  small to have ${(tunnelSize / 1024 / 1024).toFixed(1)} MB of cloudflared inside it.`);
  console.error(`  Check the [Files] paths in installer/hearth.iss.${NL}`);
  process.exit(1);
}
console.log(`${NL}  ${out}  —  ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  That is the download. Everything else is built from it.${NL}`);
