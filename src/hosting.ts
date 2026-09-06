/**
 * Hosting a game from this device, whatever the device is.
 *
 * Desktop already does this by opening a tunnel: a second listener, bound to
 * loopback, that cloudflared connects to and that everything arriving through
 * is marked public before it reaches the gate. A phone cannot run cloudflared
 * — Android will not let an app execute a binary it shipped — so for a long
 * time the answer was "the phone cannot host", which is a strange thing to say
 * about the platform this program was written for.
 *
 * But the tunnel was never the interesting half. The interesting half is the
 * second listener, and a phone can have one of those. Bound to the network
 * rather than to loopback, it is reachable by anyone who can already reach the
 * phone: everybody on the same Wi-Fi, and — if a VPN like Tailscale is running
 * — everybody on that, from anywhere. Hearth does not need to be the thing
 * that crosses the internet. It needs to be reachable by the thing that does.
 *
 * Three rules this file exists to keep:
 *
 *   - It is off. A phone that quietly starts answering the coffee shop's Wi-Fi
 *     because it was switched on once is not something to ship.
 *   - It is a *separate* listener, never a rebinding of the private one. Which
 *     socket a request arrived on is how the gate knows a caller is a guest,
 *     and that has to stay a fact rather than a guess.
 *   - It can be turned off again, now, without restarting anything.
 */

import { networkInterfaces } from "node:os";

/**
 * What a platform hands back when it starts listening — including the port it
 * actually bound.
 *
 * Not the port it was asked for. The desktop shifts by one to stay clear of
 * the tunnel's own socket, and reporting the requested number meant the state
 * said 7871 while the listener answered on 7872 — so a join link built from it
 * pointed at nothing. What a caller needs is where somebody can actually
 * knock, which only the thing that bound the socket knows.
 */
export type Listener = { close(): void | Promise<void>; port: number };
export type StartFn = (port: number, hostname: string) => Listener;

export type HostingState = {
  on: boolean;
  port: number;
  /** Where this device can be reached, best guess first. */
  addresses: string[];
  trouble: string;
};

let start: StartFn | null = null;
let current: Listener | null = null;
let onPort = 0;
let trouble = "";

/**
 * Each runtime knows how to listen and this file does not: Bun.serve on the
 * desktop, @hono/node-server inside the phone. Handing it in keeps this file
 * free of both, so it is the same code on both platforms.
 */
export function provideListener(fn: StartFn): void {
  start = fn;
}

/**
 * The addresses somebody else could actually use.
 *
 * Loopback is dropped because it is not reachable from anywhere else, and
 * link-local is dropped because an address a phone gave itself when DHCP
 * failed is not an invitation anybody can accept. What is left is sorted with
 * VPN ranges first: if Tailscale is up, that is the address that works from
 * another country, and it should not be third in a list under the Wi-Fi one
 * that only works in this building.
 */
export function addresses(): string[] {
  const out: { addr: string; rank: number }[] = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets ?? {})) {
    for (const net of nets[name] ?? []) {
      if (net.family !== "IPv4" && (net as any).family !== 4) continue;
      if (net.internal) continue;
      const a = net.address;
      if (!a || a.startsWith("169.254.")) continue;
      // 100.64/10 is the carrier-grade NAT range Tailscale uses, and the one
      // that reaches this device from outside the building.
      const carrier = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a);
      out.push({ addr: a, rank: carrier ? 0 : 1 });
    }
  }
  out.sort((x, y) => x.rank - y.rank || x.addr.localeCompare(y.addr));
  return [...new Set(out.map((o) => o.addr))];
}

export function hostingState(port = onPort): HostingState {
  return { on: !!current, port: onPort || port, addresses: addresses(), trouble };
}

export function setHosting(on: boolean, port: number): HostingState {
  trouble = "";
  if (!on) {
    const c = current;
    current = null;
    onPort = 0;
    try { c?.close(); } catch {}
    return hostingState(port);
  }
  if (current) return hostingState();
  if (!start) {
    trouble = "This copy of Hearth cannot open a second listener.";
    return hostingState(port);
  }
  try {
    // 0.0.0.0 rather than a chosen interface: a phone moves between Wi-Fi,
    // a hotspot and a VPN, and picking one at boot is picking the wrong one
    // by the evening.
    current = start(port, "0.0.0.0");
    onPort = current.port || port;
  } catch (err: any) {
    current = null;
    onPort = 0;
    trouble = err?.message ?? "Could not start listening.";
  }
  return hostingState(port);
}

/** Shutting the process down should not leave a socket open behind it. */
export function stopHosting(): void {
  const c = current;
  current = null;
  onPort = 0;
  try { c?.close(); } catch {}
}
