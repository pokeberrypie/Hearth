/**
 * Installing an extension from a repository.
 *
 * You paste a GitHub URL, Hearth fetches that repository as a zip, reads its
 * manifest, and keeps the code. Nothing is left on disk in a folder you have
 * to manage: the extension becomes a row like any other, which is what lets
 * the phone install one at all.
 *
 * Everything in this file is deliberately pure — turning a URL into candidate
 * download addresses, reading a manifest, picking files out of an archive —
 * so all of it is testable without reaching the network. The fetching itself
 * lives in the route, which is the only part that needs to.
 *
 * ## What you are agreeing to
 *
 * Installing an extension runs somebody else's code with Hearth's own powers.
 * There is no sandbox; see src/extensions.ts. This file will not fetch from
 * anywhere it was not asked to, will not follow a manifest that points outside
 * its own archive, and refuses an archive large enough to be something other
 * than an extension — but none of that makes a repository trustworthy. That
 * part is the reader's judgement, and the UI says so.
 */

import { normaliseExtension, type Extension } from "./extensions";

/** As much as we need to know about a repository address. */
export type RepoRef = {
  owner: string;
  repo: string;
  /** Named explicitly in the URL, if it was. */
  ref?: string;
};

/**
 * Reads a GitHub URL in the forms people actually paste.
 *
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/branch
 *   git@github.com:owner/repo.git
 *   owner/repo
 */
export function parseRepo(input: string): RepoRef | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const ssh = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  const bare = raw.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/);
  if (bare) return { owner: bare[1], repo: bare[2] };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Only GitHub for now. Refusing the rest is better than half-supporting a
  // host whose archive URLs are shaped differently.
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  // .../tree/<ref> and .../archive/refs/heads/<ref>
  const treeAt = parts.indexOf("tree");
  const ref = treeAt !== -1 ? parts.slice(treeAt + 1).join("/") || undefined : undefined;
  return ref ? { owner, repo, ref } : { owner, repo };
}

/**
 * Where to try downloading from, in order.
 *
 * A named ref is tried alone, because asking for a branch and silently getting
 * a different one is worse than failing. Without one, the two names a default
 * branch actually has are tried in turn.
 */
export function archiveUrls(ref: RepoRef): string[] {
  const base = `https://codeload.github.com/${ref.owner}/${ref.repo}/zip/refs/heads`;
  if (ref.ref) return [`${base}/${ref.ref}`];
  return [`${base}/main`, `${base}/master`];
}

/** A file pulled out of the archive. */
export type RepoFile = { path: string; text: string };

/**
 * Strips the single top-level directory GitHub wraps an archive in, so paths
 * read the way they do in the repository.
 */
export function stripRoot(files: RepoFile[]): RepoFile[] {
  if (!files.length) return files;
  const first = files[0].path.split("/")[0];
  const shared = files.every((f) => f.path.startsWith(first + "/"));
  return shared ? files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) })) : files;
}

export type Manifest = {
  name: string;
  version: string;
  description: string;
  /** Path within the repository, or empty. */
  client: string;
  server: string;
};

/**
 * Reads Hearth's manifest, accepting SillyTavern's field names too.
 *
 * A SillyTavern extension will not *run* here — it is written against that
 * program's internals — but its manifest names the same things, and reading it
 * means a repo shaped that way arrives with its name and entry point filled in
 * rather than as an untitled blank.
 */
export function readManifest(json: unknown): Manifest | null {
  if (!json || typeof json !== "object") return null;
  const m = json as Record<string, unknown>;
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = m[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const name = str("name", "display_name", "displayName");
  if (!name) return null;
  return {
    name,
    version: str("version") || "0.0.0",
    description: str("description", "summary"),
    client: str("client", "js", "main"),
    server: str("server"),
  };
}

/** Manifests are looked for by these names, in this order. */
export const MANIFEST_NAMES = ["hearth.json", "manifest.json", "package.json"];

/**
 * Turns an archive's files into something installable.
 *
 * Returns a reason rather than throwing, because every one of these is a thing
 * to tell the reader plainly: which file was missing, or what the manifest
 * pointed at that was not there.
 */
export function buildFromRepo(
  files: RepoFile[],
  source: string,
): { ok: true; extension: Extension } | { ok: false; reason: string } {
  const flat = stripRoot(files);
  const at = (path: string) => flat.find((f) => f.path.toLowerCase() === path.toLowerCase());

  let manifest: Manifest | null = null;
  for (const name of MANIFEST_NAMES) {
    const file = at(name);
    if (!file) continue;
    try {
      manifest = readManifest(JSON.parse(file.text));
    } catch {
      return { ok: false, reason: `${name} is not valid JSON.` };
    }
    if (manifest) break;
  }
  if (!manifest) {
    return { ok: false, reason: "No manifest with a name in it — expected hearth.json or manifest.json." };
  }

  const pick = (rel: string) => {
    if (!rel) return "";
    // A manifest naming something outside its own archive is either a mistake
    // or an attempt; either way it is not followed.
    if (rel.includes("..") || rel.startsWith("/")) return "";
    return at(rel)?.text ?? "";
  };

  const client = pick(manifest.client);
  const server = pick(manifest.server);

  if (manifest.client && !client) {
    return { ok: false, reason: `The manifest points at ${manifest.client}, which is not in the repository.` };
  }
  if (manifest.server && !server) {
    return { ok: false, reason: `The manifest points at ${manifest.server}, which is not in the repository.` };
  }
  if (!client && !server) {
    return { ok: false, reason: "The manifest names no code to run." };
  }

  return {
    ok: true,
    extension: normaliseExtension({
      name: manifest.name,
      version: manifest.version,
      description: manifest.description || source,
      client,
      server,
    }),
  };
}
