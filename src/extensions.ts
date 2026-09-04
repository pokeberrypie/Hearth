/**
 * Extensions: other people's code, running inside Hearth.
 *
 * An extension is one record with two optional halves. The `client` half runs
 * in the page and can draw things, react to messages and add buttons. The
 * `server` half runs beside the prompt pipeline and can rewrite what is sent
 * and what comes back. Either half may be empty; most extensions want one.
 *
 * Stored rather than dropped in a folder, for the same reason lorebooks and
 * regex scripts are: the phone has no comfortable filesystem, and everything
 * else you can add to Hearth is already managed the same way.
 *
 * ## On safety, plainly
 *
 * An extension's server half runs in this process with this process's powers.
 * There is no sandbox and this file does not pretend to be one — `node:vm` is
 * not a security boundary either, and saying otherwise would be worse than
 * saying nothing. Hearth is a local-first, single-user program, and installing
 * an extension is exactly as much of a decision as running any other program
 * on your own machine. The UI says so where extensions are added.
 *
 * What this file *does* guarantee is that a broken extension cannot take the
 * app down with it: every call is wrapped, a throwing hook is skipped and
 * reported, and a hook that returns nonsense leaves the value it was given
 * untouched.
 */

export type Extension = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  /** Runs in the page. */
  client: string;
  /** Runs in the server, around the prompt. */
  server: string;
};

/** The hooks a server half may register for. */
export type ServerHook = "prompt:before" | "reply:after";

export const SERVER_HOOKS: ServerHook[] = ["prompt:before", "reply:after"];

/** What `prompt:before` is handed, and may change in place or return. */
export type PromptPayload = {
  system: string;
  messages: { role: string; content: string }[];
};

const str = (v: unknown, fallback = "") =>
  typeof v === "string" ? v : v == null ? fallback : String(v);

let seq = 0;
const nextId = () => `x${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Accepts a stored row, an imported file, or something half-written. */
export function normaliseExtension(raw: any): Extension {
  const name = str(raw?.name).trim();
  return {
    id: str(raw?.id).trim() || nextId(),
    name: name || "Untitled extension",
    version: str(raw?.version).trim() || "0.0.0",
    description: str(raw?.description).trim(),
    // Absent means on: an extension you have just added is one you want.
    enabled: raw?.enabled === undefined ? true : !!raw.enabled,
    client: str(raw?.client),
    server: str(raw?.server),
  };
}

/** True when there is any point running this half at all. */
export const hasServer = (e: Extension) => e.enabled && e.server.trim().length > 0;
export const hasClient = (e: Extension) => e.enabled && e.client.trim().length > 0;

export type HookFn = (payload: any) => unknown;

/**
 * Compiles one extension's server half and collects what it registers.
 *
 * The source is run once, with a `hearth` object to register against, and the
 * handlers it leaves behind are returned. A source that throws while
 * registering yields no handlers rather than an exception — an extension that
 * cannot even load is simply an extension that does nothing.
 */
export function collectServerHooks(
  ext: Extension,
  onError: (where: string, err: unknown) => void = () => {},
): Map<ServerHook, HookFn[]> {
  const hooks = new Map<ServerHook, HookFn[]>();
  const api = {
    on(hook: string, fn: HookFn) {
      if (!SERVER_HOOKS.includes(hook as ServerHook)) {
        onError(`${ext.name}: unknown hook "${hook}"`, null);
        return;
      }
      if (typeof fn !== "function") return;
      const list = hooks.get(hook as ServerHook) ?? [];
      list.push(fn);
      hooks.set(hook as ServerHook, list);
    },
    /** Extensions keep their own notes; the host does not interpret them. */
    log: (...args: unknown[]) => console.log(`[${ext.name}]`, ...args),
  };

  try {
    // Function rather than eval so the source cannot see this scope's
    // variables, and so a syntax error is caught here rather than at a
    // surprising moment later.
    const load = new Function("hearth", `"use strict";\n${ext.server}`);
    load(api);
  } catch (err) {
    onError(`${ext.name} failed to load`, err);
    return new Map();
  }
  return hooks;
}

/**
 * Runs one hook across every enabled extension, in order.
 *
 * Each handler may change the payload in place, return a replacement, or
 * return nothing. Returning nothing is the common case and means "I looked".
 * A handler that throws is skipped: one extension's bad day is not a reason
 * for a reply to fail, and the alternative — a chat that cannot generate until
 * you work out which extension to turn off — is much worse than a missing
 * effect.
 */
export function runServerHook<T>(
  extensions: Extension[],
  hook: ServerHook,
  payload: T,
  onError: (where: string, err: unknown) => void = () => {},
): T {
  let current = payload;
  for (const ext of extensions) {
    if (!hasServer(ext)) continue;
    const hooks = collectServerHooks(ext, onError);
    for (const fn of hooks.get(hook) ?? []) {
      try {
        const out = fn(current);
        // Only a value of the same shape replaces; anything else is ignored,
        // so a handler ending in an accidental expression cannot blank a
        // prompt.
        if (out !== undefined && out !== null && typeof out === typeof current) {
          current = out as T;
        }
      } catch (err) {
        onError(`${ext.name} threw in ${hook}`, err);
      }
    }
  }
  return current;
}
