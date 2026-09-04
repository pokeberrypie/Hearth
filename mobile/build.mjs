#!/usr/bin/env node
/**
 * Bundles the server for Android. One file (`main.js`), plus the sql.js WASM
 * binary and a copy of `public/`, staged at `mobile/dist/nodejs-project` —
 * exactly nodejs-mobile's expected asset folder shape, ready to be copied
 * into the Android project's assets by `mobile/android`'s Gradle build (see
 * `mobile/README.md`).
 *
 * `bun run src/serve.ts` (desktop) and this bundle both start from the exact
 * same `src/index.ts`. The only intervention here is redirecting index.ts's
 * `from "./db"` to `mobile/server/db.mobile.ts` instead of the Bun original —
 * everything else in the server is unmodified source, bundled as-is.
 */
import { build } from "esbuild";
import { cpSync, copyFileSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(here, "dist", "nodejs-project");

rmSync(join(here, "dist"), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** Redirects `./db` to the mobile implementation, only as seen from index.ts. */
const dbRedirect = {
  name: "hearth-mobile-db",
  setup(b) {
    b.onResolve({ filter: /^\.\/db$/ }, (args) => {
      const importer = args.importer.replace(/\\/g, "/");
      if (importer.endsWith("src/index.ts")) {
        return { path: join(here, "server", "db.mobile.ts") };
      }
      return undefined;
    });
  },
};

await build({
  entryPoints: [join(here, "server", "serve.mobile.ts")],
  outfile: join(outDir, "main.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  // Not a real dependency — nodejs-mobile injects it at runtime. See
  // serve.mobile.ts for why it is `require`d behind a try/catch.
  external: ["rn-bridge"],
  plugins: [dbRedirect],
  // See server/prelude.js — pins the working directory before any module is
  // evaluated, and makes a JS startup failure readable on the phone.
  banner: { js: readFileSync(join(here, "server", "prelude.js"), "utf8") },
  logLevel: "info",
  sourcemap: true,
});

const wasm = join(root, "mobile", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
if (!existsSync(wasm)) throw new Error(`sql.js WASM binary not found at ${wasm} — run npm install in mobile/ first.`);
copyFileSync(wasm, join(outDir, "sql-wasm.wasm"));

cpSync(join(root, "public"), join(outDir, "public"), { recursive: true });

// `main.js` is a CommonJS bundle. Without this, Node (and possibly
// nodejs-mobile's own loader) would infer module type from whatever
// package.json happens to be nearest on disk — on this machine that is
// mobile/package.json, which says "type": "module" for build.mjs's own sake,
// and would make main.js fail before its first line. This one settles it
// unambiguously, and doubles as the entry nodejs-mobile's `nodejs.start`
// looks for when not given an explicit script name.
writeFileSync(join(outDir, "package.json"), JSON.stringify({
  name: "hearth-mobile-server", private: true, main: "main.js",
}, null, 2));

console.log(`\nBundled to ${outDir}`);
