/**
 * Desktop entry point (Bun). `bun run src/serve.ts` — package.json's `start`
 * and `dev` scripts, and every launcher (`Hearth.bat`, `start.ps1`,
 * `start.sh`) point here now, not at `src/index.ts`.
 *
 * `index.ts` exports the complete, runnable Hono app with every route; all
 * this file adds is the two things only Bun can do: serve `public/` and
 * `data/uploads/` straight off disk, and hand the whole thing to `Bun.serve`.
 * The mobile build's `mobile/server/serve.mobile.ts` is the Node equivalent.
 */
import { serveStatic } from "hono/bun";
import { app, ensureStarterCharacter, markPublic } from "./index";
import { provideListener, stopHosting } from "./hosting";

// A brand-new library gets its one character here, where the database is
// certainly ready — never from index.ts's body; see ensureStarterCharacter().
ensureStarterCharacter();

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

app.use("/uploads/*", serveStatic({ root: process.env.DATA_DIR ?? "./data" }));
app.use("/*", serveStatic({ root: "./public" }));

const port = Number(process.env.PORT ?? 7870);
// Loopback by default. There is no login on Hearth, so binding to every
// interface would put your chats and API keys on the local network.
// Set HOST=0.0.0.0 deliberately if you want to reach it from another device.
const hostname = process.env.HOST ?? "127.0.0.1";

console.log(`\n  Hearth is lit.  http://localhost:${port}`);
if (hostname !== "127.0.0.1") {
  console.log(`  Listening on ${hostname} — anyone on this network can reach it.`);
}
console.log("");

// 255 is Bun's ceiling for idleTimeout, and a long reasoning reply can still
// out-wait it. The generation route sends a keep-alive comment frame every 15
// seconds so the socket never actually goes idle mid-answer.
/**
 * The front door gets a socket of its own.
 *
 * A tunnel connects to localhost, so everything it forwards arrives *from
 * loopback* — and loopback is what "this is the owner sitting at their own
 * machine" was built on. Point cloudflared at the ordinary port and the whole
 * library is handed to anyone with the address. That is not hypothetical: it
 * is what happened the first time this was tried for real.
 *
 * So the tunnel is given a second listener, on its own port, and every request
 * arriving there is marked public before it reaches the gate. It is a fact
 * about which socket the bytes came in on rather than a guess from a header,
 * which is what makes it hold.
 *
 * Loopback-bound, because it is only ever meant to be reached through the
 * tunnel — nothing on the network should be able to knock on it directly.
 */
const publicPort = Number(process.env.PUBLIC_PORT ?? port + 1);
const publicServe = (p: number, hostname: string) =>
  Bun.serve({
    port: p,
    hostname,
    idleTimeout: 255,
    fetch(req, server) {
      markPublic(req);
      return app.fetch(req, server);
    },
  });

/*
 * The tunnel's own door, always here and always loopback: cloudflared connects
 * from this machine, and nothing on the network should be able to knock on it
 * directly.
 */
publicServe(publicPort, "127.0.0.1");

/*
 * And a second one, on the network, for hosting without a tunnel — the same
 * door a phone opens. Started only when asked, on a port of its own so it
 * cannot collide with the tunnel's.
 */
provideListener((p, hostname) => {
  // One past the tunnel's, so the two doors never fight over a socket.
  const server = publicServe(p + 1, hostname);
  // Bun types the port as possibly absent; the number we asked for is the
  // one it bound, so fall back to that rather than to nothing.
  return { close: () => server.stop(true), port: server.port ?? p + 1 };
});
for (const sig of ["exit", "SIGINT", "SIGTERM"] as const) process.on(sig, stopHosting);

export default { port, hostname, fetch: app.fetch, idleTimeout: 255 };
