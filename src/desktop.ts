/**
 * The entry point for the installed desktop app — what `Hearth.exe` is.
 *
 * `src/serve.ts` is still the one to run from a checkout; this is the same
 * server with the handful of things an *installed* program has to do that a
 * developer running `bun run start` does not:
 *
 *   - Work from the folder it was installed into, not from wherever the
 *     shortcut happened to be launched from. `serveStatic({ root: "./public" })`
 *     resolves against the working directory, and a shortcut's is not
 *     guaranteed to be anything in particular.
 *   - Keep its data somewhere a user can write to and will still find after an
 *     update, rather than beside the executable.
 *   - Open a browser, since there is no terminal printing a URL to click.
 *
 * The imports below are deliberately dynamic: DATA_DIR is read once, when
 * db.ts is first evaluated, so it has to be set before anything pulls that in.
 * A static import would be hoisted above these lines and the setting would
 * arrive too late to matter.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(process.execPath);
process.chdir(here);

const dataDir = process.env.DATA_DIR ||
  join(process.env.LOCALAPPDATA ?? process.env.HOME ?? here, "Hearth", "data");
process.env.DATA_DIR = dataDir;
mkdirSync(dataDir, { recursive: true });

/*
 * A diary, beside the data, because this program has no window to say
 * anything in. A launch that failed used to fail in perfect silence: the
 * shortcut did nothing, and there was nowhere to look to find out why.
 * hearth.log says what each launch did, and any error that would otherwise
 * have vanished with the process.
 */
const LOG = join(dataDir, "hearth.log");
function note(line: string) {
  try { appendFileSync(LOG, `${new Date().toISOString()}  ${line}\r\n`); } catch {}
}
process.on("uncaughtException", (e) => { note(`crashed: ${e?.stack || e}`); process.exit(1); });
process.on("unhandledRejection", (e: any) => note(`unhandled: ${e?.stack || e}`));
note(`launched ${process.execPath}`);

const port = Number(process.env.PORT ?? 7870);
const hostname = process.env.HOST ?? "127.0.0.1";
const url = `http://localhost:${port}`;

/** Opens the reader's usual browser, without a console window flashing up. */
function openBrowser() {
  // For anyone who would rather keep a tab of their own, and for testing a
  // build without a window appearing on somebody's screen.
  if (process.env.HEARTH_NO_BROWSER) return;
  try {
    if (process.platform === "win32") {
      /*
       * Through the shell's own URL handler rather than `cmd /c start`. A
       * program with no console starting cmd.exe is exactly the shape some
       * antivirus refuses on sight, and when it did, the browser simply never
       * appeared. This is what Windows itself uses for "open this link", it
       * goes to the default browser, and it flashes no window.
       */
      Bun.spawn(["rundll32.exe", "url.dll,FileProtocolHandler", url],
        { stdio: ["ignore", "ignore", "ignore"], windowsHide: true }).unref();
      note(`asked Windows to open ${url}`);
    } else if (process.platform === "darwin") {
      Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] }).unref();
    } else {
      Bun.spawn(["xdg-open", url], { stdio: ["ignore", "ignore", "ignore"] }).unref();
    }
  } catch (e) {
    // Not being able to open a browser is not a reason to refuse to serve.
    note(`could not open a browser: ${e}`);
    if (process.platform === "win32") {
      try { Bun.spawn(["cmd", "/c", "start", "", url], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true }).unref(); } catch {}
    }
  }
}

/*
 * Already running?
 *
 * Double-clicking the shortcut a second time is a completely ordinary thing to
 * do, and binding the port again would fail with an address-in-use crash from
 * an app that has no console to show it in. If something is already answering
 * on the port, take that as Hearth and just bring it up.
 */
// Generous, because a Hearth that has just been launched by the installer,
// or is busy with a long reply, can take more than a moment to answer — and
// guessing wrong here meant trying to take a port that was already taken.
const alive = await fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(4000) })
  .then((r) => r.ok)
  .catch(() => false);

if (alive) {
  note("already running; bringing it up");
  openBrowser();
  // A moment for the handler to be on its way before this process goes.
  await Bun.sleep(500);
  process.exit(0);
}

const { serveStatic } = await import("hono/bun");
const { app, ensureStarterCharacter, markPublic, readAssetsWith } = await import("./index");
const { provideListener, stopHosting } = await import("./hosting");
const { withLean } = await import("./lean");
// Compressed and validated on the way out; see src/lean.ts.
const leanFetch = withLean((req, server) => app.fetch(req, server));
ensureStarterCharacter();

app.use("/uploads/*", serveStatic({ root: dataDir }));

/*
 * The frontend, from whichever copy is real.
 *
 * Installed, there is no public/ folder: every asset was compiled into the
 * executable, so one file is the whole app and there is nothing beside it to
 * lose, move or forget to copy. In a checkout the folder is right there and
 * is what you are editing, so that wins — otherwise the built-in copy would
 * shadow your changes and you would be debugging a stale stylesheet.
 */
const fromDisk = await Bun.file("public/index.html").exists();

if (fromDisk) {
  app.use("/*", serveStatic({ root: "./public" }));
} else {
  const { FILES } = await import("./embedded.generated");
  // The server reads a few of these itself — the faction charges — so it is
  // told where they are too.
  readAssetsWith(async (path) => (FILES[path] ? await Bun.file(FILES[path]).text() : null));
  app.use("/*", async (c, next) => {
    const path = c.req.path === "/" ? "/index.html" : c.req.path;
    const file = FILES[path];
    // Not an asset: hand it back for the API routes to answer.
    if (!file) return next();
    // Bun.file sets the content type from the extension, which matters here —
    // a woff2 served as text/plain is a font the browser quietly refuses.
    return new Response(Bun.file(file));
  });
}

// 255 is Bun's ceiling for idleTimeout, and a long reasoning reply can still
// out-wait it; the generation route sends keep-alive frames so the socket
// never actually goes idle mid-answer.
try {
  Bun.serve({ port, hostname, fetch: leanFetch, idleTimeout: 255 });
} catch (e) {
  /*
   * The port is taken: almost always another Hearth that did not answer in
   * time above. Opening the browser at it is what the person wanted; dying
   * silently, as this used to, is what they got.
   */
  note(`could not take port ${port}: ${e}. Opening the browser at whatever has it.`);
  openBrowser();
  await Bun.sleep(500);
  process.exit(0);
}

/*
 * The guests' entrance, which the installed app never opened.
 *
 * src/serve.ts has always given a tunnel a socket of its own, one port up,
 * where every request is marked public before the gate sees it — so a link
 * through the door reaches the table and never the library. This file was
 * written before that existed and never caught up: the door started
 * cloudflared pointing at a port nothing was listening on, and every guest
 * got Cloudflare's 502. "Answer the network directly" had nothing to start
 * either. Both are the same as serve.ts now.
 */
const publicPort = Number(process.env.PUBLIC_PORT ?? port + 1);
const publicServe = (p: number, host: string) =>
  Bun.serve({
    port: p,
    hostname: host,
    idleTimeout: 255,
    fetch(req, server) {
      markPublic(req);
      return leanFetch(req, server);
    },
  });
try {
  publicServe(publicPort, "127.0.0.1");
  note(`guests' entrance on ${publicPort}`);
} catch (e) {
  note(`could not open the guests' entrance on ${publicPort}: ${e}`);
}
provideListener((p, host) => {
  const server = publicServe(p + 1, host);
  return { close: () => server.stop(true), port: server.port ?? p + 1 };
});
for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) process.on(sig, stopHosting);

note(`serving ${url}, data in ${dataDir}`);
openBrowser();
// Last, and guarded: with no console attached there may be nowhere for this
// to go, and that must never be what stops the browser opening.
try { console.log(`\n  Hearth is lit.  ${url}\n  Data: ${dataDir}\n`); } catch {}
