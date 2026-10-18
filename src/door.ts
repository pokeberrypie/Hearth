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
  possible: boolean;
  /** For a relay: the device on this network the tunnel leads to. */
  to?: string;
};

/**
 * Whether a door can be opened here at all. Inside the Android app there is no
 * cloudflared to start and no way to install one, so offering the button
 * there only ever produced a failure telling you to install it.
 */
export const doorPossible = () => process.platform !== "android";

/**
 * The address, out of the noise.
 *
 * cloudflared writes its banner to stderr in a box drawn with box characters,
 * so this looks for the URL rather than for a line — the layout of that banner
 * is not a contract and has changed before.
 */
const TRYCF = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * One tunnel, held open by this process. There are two: the door to this
 * machine, and the relay — a door this machine holds open on behalf of
 * another device on the same network that cannot run cloudflared itself,
 * which is to say a phone. They are separate so that opening one for the
 * phone never changes the address this machine's own tables are sent out on.
 */
function tunnel() {
  let child: ChildProcess | null = null;
  let url = "";
  let trouble = "";
  let to = "";
  const waiters: ((s: DoorState) => void)[] = [];

  const state = (): DoorState =>
    ({ running: !!child && !child.killed, url, trouble, possible: doorPossible(), ...(to ? { to } : {}) });
  const settle = () => { const s = state(); for (const w of waiters.splice(0)) w(s); };

  async function open(target: string, label = ""): Promise<DoorState> {
    if (child && !child.killed) return state();
    url = "";
    trouble = "";
    to = label;

    const bin = findCloudflared();
    if (!bin) {
      trouble = "cloudflared is not installed.";
      return state();
    }

    try {
      const { spawn } = await import("node:child_process");
      child = spawn(bin, ["tunnel", "--url", target], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }) as unknown as ChildProcess;
    } catch {
      child = null;
      trouble = "cloudflared is not installed.";
      return state();
    }

    const read = (buf: unknown) => {
      const found = TRYCF.exec(String(buf));
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
        resolve(state());
      }, 10_000);
      waiters.push((s) => { clearTimeout(timer); resolve(s); });
    });
  }

  function close(): DoorState {
    const c = child;
    child = null;
    url = "";
    trouble = "";
    to = "";
    try { c?.kill(); } catch {}
    return state();
  }

  /** For when something checked before opening found a reason not to. */
  function refuse(why: string, label = ""): DoorState {
    trouble = why;
    to = label;
    return state();
  }

  // A tunnel is a thing this process is holding open. If the process goes, it
  // goes too, rather than being left running with nothing behind it.
  for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => { try { child?.kill(); } catch {} });
  }

  return { open, close, state, refuse };
}

const door = tunnel();
const relay = tunnel();

export const doorState = door.state;
export const openDoor = (port: number) => door.open(`http://localhost:${port}`);
export const closeDoor = door.close;

/*
 * The relay: a door for a phone.
 *
 * Deliberately narrow, like the door. It leads only to an address on this
 * network — a home or VPN range, never the internet at large — and only
 * after that address has answered as a Hearth guest entrance. Without those
 * two checks this would be a button that publishes anything on the LAN, a
 * router's admin page included, to anybody who learns the link.
 */

/** "192.168.1.23:7871", or with http:// in front, into its parts — or null. */
export function parseRelayTarget(raw: string): { host: string; port: number } | null {
  const text = String(raw ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  const m = text.match(/^([a-z0-9.-]+):(\d{1,5})$/i);
  if (!m) return null;
  const port = Number(m[2]);
  if (!(port > 0 && port < 65536)) return null;
  return { host: m[1].toLowerCase(), port };
}

/** A home network, a link-local address, or a VPN's — the places a phone sits beside you. */
export function isNearby(host: string): boolean {
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (v4.slice(1).some((x) => Number(x) > 255)) return false;
    return a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127);   // Tailscale and other carrier-grade VPN ranges
  }
  // Names a home network or a tailnet gives devices.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(local|lan|home\.arpa|ts\.net)$/.test(host);
}

/**
 * Whether what is at that address is a Hearth's guest entrance: the page is
 * Hearth's, and the library behind it is shut to somebody with no key. The
 * second half matters as much as the first — a Hearth whose own front door
 * is open would hand the whole library to anyone with the tunnel's link.
 */
export async function looksLikeGuestDoor(host: string, port: number): Promise<string | null> {
  const base = `http://${host}:${port}`;
  const get = async (path: string) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try { return await fetch(base + path, { signal: ctl.signal, redirect: "manual" }); }
    finally { clearTimeout(timer); }
  };
  let page: Response;
  try { page = await get("/"); } catch {
    return `Nothing answered at ${host}:${port}. Is "Answer the network directly" on there, and is this computer on the same Wi-Fi?`;
  }
  const html = await page.text().catch(() => "");
  if (!page.ok || !/<title>[^<]*Hearth/i.test(html)) return `${host}:${port} is not a Hearth.`;
  let lib: Response;
  try { lib = await get("/api/settings"); } catch { return `${host}:${port} stopped answering.`; }
  if (lib.status !== 401 && lib.status !== 403) {
    return `${host}:${port} is a Hearth with its library open to anybody. Use its guest address — the one Together shows under "Answer the network directly".`;
  }
  return null;
}

export const relayState = relay.state;
export const closeRelay = relay.close;

export async function openRelay(raw: string): Promise<DoorState> {
  if (!doorPossible()) return relay.refuse("A phone cannot open a door for another device.");
  const t = parseRelayTarget(raw);
  if (!t) return relay.refuse("Give the address as it is shown there, like 192.168.1.23:7871.");
  const label = `${t.host}:${t.port}`;
  if (!isNearby(t.host)) {
    return relay.refuse("Only a device on this network or your VPN — an address like 192.168.x.x, 10.x.x.x or Tailscale's 100.x.x.x.", label);
  }
  const why = await looksLikeGuestDoor(t.host, t.port);
  if (why) return relay.refuse(why, label);
  return relay.open(`http://${t.host}:${t.port}`, label);
}
