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
const pack = Bun.spawnSync([iscc, "installer\\hearth.iss"], { stdout: "pipe", stderr: "pipe" });
if (pack.exitCode !== 0) {
  console.error(pack.stdout.toString());
  console.error(pack.stderr.toString());
  process.exit(1);
}

const out = "dist/HearthSetup.exe";
const size = (await stat(out)).size;
console.log(`${NL}  ${out}  —  ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  That is the download. Everything else is built from it.${NL}`);
