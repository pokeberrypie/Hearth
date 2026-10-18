/**
 * Sending less over the wire.
 *
 * At home none of this matters: the page and the server are on one machine.
 * Through a tunnel it is most of what a guest waits for. A table's page is a
 * megabyte of script and style before a single message, every byte of it went
 * out uncompressed, and nothing carried a validator — so a browser that
 * already had the page could not ask "is this still the one I have?" and
 * downloaded all of it again on every visit and every reconnect, up through
 * the host's home upload and a free tunnel. A guest waited minutes for a page
 * that should take seconds.
 *
 * Two things, both standard:
 *
 *   - Text goes gzipped to anyone who says they accept it. Script, style,
 *     markup and JSON shrink four or five times over.
 *   - Everything that is a file gets an ETag. A browser that already has it
 *     sends the tag back and gets an empty "not modified" instead of the file.
 *     Fonts, which never change within a build, may also simply be kept.
 *
 * What it never touches: event streams, which must reach the guest as each
 * line is written and would be held back by compression, and anything large
 * or binary that is already as small as it gets (a backup zip). It wraps the
 * whole server's fetch rather than sitting in the router, so it applies to
 * every route without every route having to remember it.
 */

const SHRINKS = /^(text\/(html|css|plain|javascript)|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/i;
const TAGGED = /^(text\/|application\/(javascript|json)|image\/|font\/|application\/font|application\/vnd\.ms-fontobject)/i;
/** Read whole to compress or tag; past this a response is streamed as it is. */
const LIMIT = 24 * 1024 * 1024;

type Fetch = (req: Request, server?: any) => Response | Promise<Response>;

export function withLean(fetch: Fetch): Fetch {
  return async (req, server) => {
    const res = await fetch(req, server);
    try {
      return await lean(req, res);
    } catch {
      return res;
    }
  };
}

async function lean(req: Request, res: Response): Promise<Response> {
  // Not `!res.body`: a response made from a file — which is how the installed
  // app serves every page and script — reports no body until it is read, and
  // checking it here quietly skipped everything the installed app sends.
  if (req.method !== "GET" || res.status !== 200) return res;
  const type = res.headers.get("content-type") ?? "";
  if (/event-stream/i.test(type) || !TAGGED.test(type)) return res;
  if (res.headers.has("content-encoding")) return res;
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > LIMIT) return res;

  const bytes = new Uint8Array(await res.arrayBuffer());
  const headers = new Headers(res.headers);
  headers.delete("content-length");

  const tag = `W/"${Bun.hash(bytes).toString(36)}"`;
  headers.set("etag", tag);
  headers.append("vary", "accept-encoding");
  const path = new URL(req.url).pathname;
  // A font in a build is that build's font for good; everything else is asked
  // about each time, which with the tag above costs a header, not the file.
  if (path.startsWith("/fonts/")) headers.set("cache-control", "public, max-age=31536000, immutable");
  else if (!headers.has("cache-control")) headers.set("cache-control", "no-cache");

  const asked = req.headers.get("if-none-match");
  if (asked && asked.split(/\s*,\s*/).includes(tag)) {
    return new Response(null, { status: 304, headers });
  }

  const accepts = /\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "");
  if (accepts && SHRINKS.test(type) && bytes.length > 1024) {
    const packed = Bun.gzipSync(bytes, { level: 6 });
    headers.set("content-encoding", "gzip");
    headers.set("content-length", String(packed.length));
    return new Response(packed, { status: 200, headers });
  }
  headers.set("content-length", String(bytes.length));
  return new Response(bytes, { status: 200, headers });
}
