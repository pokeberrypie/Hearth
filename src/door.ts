/**
 * The door: making this machine reachable from somewhere else.
 *
 * Two houses on the internet cannot find each other on their own. Hearth is
 * not going to pretend otherwise, and it is certainly not going to run a relay
 * — that would mean somebody else's server in the middle of your chats, which
 * is the opposite of what this program is for. What it can do is drive the
 * tunnel you already have, so that opening the door is a button rather than a
 * terminal and a copied URL.
 *
 * `cloudflared tunnel --url` is the one it knows: no account, no config, no
 * port forwarding, and it prints a public https address on stderr within a few
 * seconds. That address is the thing to send.
 *
 * Deliberately narrow. It does not take a command from the client, it does not
 * take arguments, and it will not start anything but the one binary it went
 * looking for. A route that runs what it is told is a route that runs what
 * anybody who reaches it tells it, and this program's whole security story is
 * that nothing outside the gate can reach anything.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/*
 * Loaded when the door is opened, never at boot.
 *
 * src/index.ts is bundled whole into the Android app, so a top-level import
 * here becomes a require() that runs the moment the phone's server starts. A
 * phone cannot host a tunnel and is never going to call this — but a missing
 * or restricted module would take the entire server down on the way up, which
 * is a great deal to risk for a feature that platform does not have.
 */
type ChildProcess = { killed?: boolean; kill(): void;
  stdout?: { on(e: string, f: (b: unknown) => void): void };
  stderr?: { on(e: string, f: (b: unknown) => void): void };
  on(e: string, f: () => void): void };

/** Where somebody's own install of it lives, per platform. */
const CANDIDATES = [
  "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
  "C:\\Program Files\\cloudflared\\cloudflared.exe",
  "/usr/local/bin/cloudflared",
  "/usr/bin/cloudflared",
  "/opt/homebrew/bin/cloudflared",
];

/**
 * The copy the installer put beside Hearth.
 *
 * Looked at first, and it is the one almost everybody will use: playing with
 * somebody in another country should not begin with "now go and install a
 * Cloudflare tool", which is the point at which most people stop. Somebody who
 * has their own newer copy on PATH still gets theirs if ours is absent, and a
 * checkout with no vendored binary falls through to exactly the old behaviour.
 *
 * `process.execPath` is the compiled Hearth.exe in a built app and the Bun
 * binary in a checkout — in the second case the file simply is not there and
 * this costs one failed stat.
 */
function besideUs(): string | null {
  try {
    const name = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    const p = join(dirname(process.execPath), name);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

export function findCloudflared(): string | null {
  const ours = besideUs();
  if (ours) return ours;
  for (const p of CANDIDATES) if (existsSync(p)) return p;
  // On PATH under whatever name the platform uses. `spawn` will find it.
  return process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
}

export type DoorState = {
  running: boolean;
  url: string;
  /** Anything the tunnel said that we could not turn into an address. */
  trouble: string;
};

let child: ChildProcess | null = null;
let url = "";
let trouble = "";
let waiters: ((s: DoorState) => void)[] = [];

export function doorState(): DoorState {
  return { running: !!child && !child.killed, url, trouble };
}

function settle() {
  const s = doorState();
  for (const w of waiters.splice(0)) w(s);
}

/**
 * The address, out of the noise.
 *
 * cloudflared writes its banner to stderr in a box drawn with box characters,
 * so this looks for the URL rather than for a line — the layout of that banner
 * is not a contract and has changed before.
 */
const TRYCF = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export async function openDoor(port: number): Promise<DoorState> {
  if (child && !child.killed) return doorState();
  url = "";
  trouble = "";

  const bin = findCloudflared();
  if (!bin) {
    trouble = "cloudflared is not installed.";
    return doorState();
  }

  try {
    const { spawn } = await import("node:child_process");
    child = spawn(bin, ["tunnel", "--url", `http://localhost:${port}`], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }) as unknown as ChildProcess;
  } catch {
    child = null;
    trouble = "cloudflared is not installed.";
    return doorState();
  }

  const read = (buf: unknown) => {
    const text = String(buf);
    const found = TRYCF.exec(text);
    if (found && !url) { url = found[0]; settle(); }
  };
  child.stdout?.on("data", read);
  child.stderr?.on("data", read);

  child.on("exit", () => {
    // Only a surprise if we had not been told to shut it.
    if (!url) trouble = trouble || "The tunnel stopped before it gave an address.";
    child = null;
    url = "";
    settle();
  });
  child.on("error", () => {
    child = null;
    trouble = "cloudflared could not be started.";
    settle();
  });

  // A quick tunnel is usually up in two or three seconds; ten is patience.
  return await new Promise<DoorState>((resolve) => {
    const timer = setTimeout(() => {
      if (!url) trouble = trouble || "The tunnel did not give an address in time.";
      resolve(doorState());
    }, 10_000);
    waiters.push((s) => { clearTimeout(timer); resolve(s); });
  });
}

export function closeDoor(): DoorState {
  const c = child;
  child = null;
  url = "";
  trouble = "";
  try { c?.kill(); } catch {}
  return doorState();
}

// A tunnel is a thing this process is holding open. If the process goes, it
// goes too, rather than being left running with nothing behind it.
for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { try { child?.kill(); } catch {} });
}
