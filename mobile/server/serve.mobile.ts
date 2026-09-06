/**
 * Android entry point (Node, via nodejs-mobile). This is the file that gets
 * bundled and shipped inside the APK as `main.js` — see mobile/build.mjs.
 *
 * Mirrors `src/serve.ts`: mount static file serving, then start listening.
 * The one extra step is `await dbReady` — sql.js's WASM module compiles
 * asynchronously, and nothing may touch a route before it has.
 */
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { relative } from "node:path";

// @hono/node-server's serveStatic resolves `root` against process.cwd() and
// does not accept an absolute path, so the working directory has to be the
// folder this bundle lives in. That is done in server/prelude.js, not here:
// a chdir in this file's body runs *after* the imports below have already
// been evaluated, and those create data/ and data/uploads with relative
// paths at module scope. Doing it here failed with EACCES against Android's
// filesystem root and killed the app before the first line of main().

// `app` resolves to the real src/index.ts unmodified. `./db` inside it
// resolves to db.mobile.ts instead of the Bun original — done by the bundler
// (see mobile/build.mjs's esbuild alias), not by anything in this file or in
// index.ts, so nothing about the desktop build has to know mobile exists.
import { app, ensureStarterCharacter, markPublic } from "../../src/index";
import { provideListener, stopHosting } from "../../src/hosting";
import { dbReady, flush } from "./db.mobile";

const port = Number(process.env.PORT ?? 7870);

// Startup breadcrumbs, installed by server/reporter.js ahead of this bundle.
// Absent when the bundle is run standalone under a plain `node` for testing,
// hence the optional calls.
const diagnostics = globalThis as unknown as {
  __hearthStage?: (stage: string) => void;
  __hearthReport?: (label: string, err: unknown) => void;
};

async function main() {
  await dbReady;
  // Only now is the database real. Seeding any earlier — including from
  // index.ts's body, which runs during the import above — reads a database
  // that has not finished compiling its WASM, and kills the app on launch.
  ensureStarterCharacter();
  diagnostics.__hearthStage?.("DB_READY");

  // The database and the uploads live outside nodejs-project, because that
  // folder is replaced wholesale on every app update — see server/prelude.js,
  // which sets DATA_DIR. serveStatic resolves `root` against the working
  // directory, so this walks back up to it.
  const uploads = (process.env.DATA_DIR ?? "./data").startsWith("/")
    ? relative(process.cwd(), process.env.DATA_DIR!) || "."
    : process.env.DATA_DIR ?? "./data";
  /**
   * The app shell must never be served stale. Neither serveStatic sets a
   * cache-control header, so the browser falls back to heuristic caching and
   * happily keeps yesterday's app.js — which looks exactly like a change that
   * did not take. `no-cache` still allows a 304, so this costs a revalidation
   * against a server on the same machine, not a re-download.
   */
  app.use("/*", async (c, next) => {
    await next();
    if (!c.res.ok) return;
    // Not the uploads (content-addressed, and big), and not the generation
    // stream, whose headers are already set and are not ours to touch.
    if (c.req.path.startsWith("/uploads/")) return;
    if (c.res.headers.get("content-type")?.includes("event-stream")) return;
    c.res.headers.set("cache-control", "no-cache");
  });

  app.use("/uploads/*", serveStatic({ root: uploads }));
  app.use("/*", serveStatic({ root: "./public" }));

  /*
   * Hosting, from a phone.
   *
   * The private listener below stays on loopback: it is what this app's own
   * WebView talks to, and nothing else has any business reaching it. Hosting
   * opens a *second* one on the network, and everything arriving there is
   * marked public before it reaches the gate — which is how a guest is told
   * apart from the owner, and why it has to be a different socket rather than
   * the same one bound wider.
   *
   * A phone cannot run cloudflared; Android will not let an app execute a
   * binary it shipped. It does not need to. Anyone who can already reach the
   * phone can reach the table — everyone on this Wi-Fi, and everyone on the
   * VPN if one is running, from anywhere.
   */
  provideListener((p, hostname) => {
    const server = serve({ fetch: (req: Request) => { markPublic(req); return app.fetch(req); },
                           port: p, hostname });
    return { close: () => server.close(), port: p };
  });
  process.on("SIGTERM", stopHosting);
  process.on("SIGINT", stopHosting);

  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    diagnostics.__hearthStage?.("LISTENING");
    console.log(`Hearth (on-device) listening on http://127.0.0.1:${info.port}`);
    // rn-bridge's channel is how MainActivity finds out the server is actually
    // up before it points the WebView anywhere — see MainActivity.java. Not a
    // real npm dependency: nodejs-mobile injects it as a builtin module only
    // when this runs inside its embedded Node, so it is `require`d behind a
    // try/catch — the same bundle then also runs standalone under a plain
    // local `node` for testing, which is how this file was actually checked.
    try { require("rn-bridge").channel.send("ready:" + info.port); } catch {}
  });
}

// Flush the in-memory database to disk before the process is killed. Android
// can and does kill a backgrounded process without warning; anything not on
// disk by then did not happen.
process.on("SIGTERM", () => { flush(); process.exit(0); });
process.on("SIGINT", () => { flush(); process.exit(0); });
process.on("exit", flush);

try {
  // Sent by nodejs-mobile's system channel on onHostPause/onHostResume (see
  // RNNodeJsMobileModule.java). A flush on pause is the real safety net;
  // SIGTERM/exit above only cover the cases that actually get a signal.
  require("rn-bridge").app.on("pause", (lock: { release: () => void }) => {
    flush();
    lock.release();
  });
} catch {}

main().catch((err) => {
  // console.error alone reaches logcat and nowhere else; this also puts the
  // error where BootstrapActivity can show it on the phone.
  diagnostics.__hearthReport?.("Hearth failed to start", err);
  console.error("Hearth failed to start:", err);
  process.exit(1);
});
