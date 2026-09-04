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
/* The frontend's own script, imported as a file to be carried rather than as
   a module to be called into. */
declare module "*/app.js" {
  const path: string;
  export default path;
}
