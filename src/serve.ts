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
import { app, ensureStarterCharacter } from "./index";

// A brand-new library gets its one character here, where the database is
// certainly ready — never from index.ts's body; see ensureStarterCharacter().
ensureStarterCharacter();

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
export default { port, hostname, fetch: app.fetch, idleTimeout: 255 };
