/**
 * What a `with { type: "file" }` import is.
 *
 * `bun build --compile` uses these to carry the frontend inside the executable
 * (see scripts/build-desktop.ts, which generates the module that does it). At
 * runtime each import is a path Bun.file() can read — on disk in a checkout,
 * inside the binary once built — but tsc has no idea what a stylesheet or a
 * font is, and without this it reports every one as a missing module.
 */
declare module "*.css" {
  const path: string;
  export default path;
}
declare module "*.woff2" {
  const path: string;
  export default path;
}
declare module "*.svg" {
  const path: string;
  export default path;
}
declare module "*.png" {
  const path: string;
  export default path;
}
/*
 * The frontend's scripts, imported as files to be carried rather than as
 * modules to be called into.
 *
 * This used to name app.js specifically, which meant the day a second script
 * appeared under public/ the build generated an import tsc had never been told
 * about. Any .js reaching this compiler is a file being carried — everything
 * in src/ is TypeScript.
 */
declare module "*.js" {
  const path: string;
  export default path;
}
