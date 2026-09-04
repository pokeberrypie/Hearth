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
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const here = dirname(process.execPath);
process.chdir(here);

const dataDir = process.env.DATA_DIR ||
  join(process.env.LOCALAPPDATA ?? process.env.HOME ?? here, "Hearth", "data");
process.env.DATA_DIR = dataDir;
mkdirSync(dataDir, { recursive: true });

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
      Bun.spawn(["cmd", "/c", "start", "", url], { stdio: ["ignore", "ignore", "ignore"] }).unref();
    } else if (process.platform === "darwin") {
      Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] }).unref();
    } else {
      Bun.spawn(["xdg-open", url], { stdio: ["ignore", "ignore", "ignore"] }).unref();
    }
  } catch {
    // Not being able to open a browser is not a reason to refuse to serve.
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
const alive = await fetch(`${url}/api/settings`, { signal: AbortSignal.timeout(700) })
  .then((r) => r.ok)
  .catch(() => false);

if (alive) {
  openBrowser();
  process.exit(0);
}

const { serveStatic } = await import("hono/bun");
const { app, ensureStarterCharacter } = await import("./index");
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
Bun.serve({ port, hostname, fetch: app.fetch, idleTimeout: 255 });

console.log(`\n  Hearth is lit.  ${url}\n  Data: ${dataDir}\n`);
openBrowser();
