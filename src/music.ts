/**
 * Music: your own files, played under the story. Kept with the library (on the phone, on the phone), listed by a
 * title you can change, and served a piece at a time, as a player asks for them: skipping into a track, and the
 * Android WebView playing one at all, both need the server to answer a request for part of a file.
 */
export const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
  wav: "audio/wav", flac: "audio/flac", webm: "audio/webm",
};

/** The kind of audio a file is, by its name; null for anything else. */
export function audioKind(name: string): { ext: string; type: string } | null {
  const ext = String(name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_TYPES[ext] ? { ext, type: AUDIO_TYPES[ext] } : null;
}

/** A title from a file name: "03 - Hightower's High Towers (Full).mp3" → "Hightower's High Towers (Full)". */
export function titleOf(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const t = base.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/^\s*\d{1,3}\s*[-._)]\s*/, "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return (t || "Untitled").slice(0, 120);
}

/** The part of a file asked for, by a Range header; null for the whole of it, "bad" for a range it does not have. */
export function rangeOf(header: string | null | undefined, size: number, most = 4 * 1024 * 1024): { start: number; end: number } | null | "bad" {
  const m = String(header ?? "").match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }      // the last n bytes
  else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start >= size || start > end) return "bad";
  return { start, end: Math.min(end, start + most - 1) };
}

/** A chat's playlist, as stored: which tracks, in what order, and whether shuffled. Anything else is no playlist. */
export function playlistOf(raw: unknown): { tracks: string[]; shuffle: boolean } {
  let v: any = raw;
  if (typeof raw === "string") { try { v = raw ? JSON.parse(raw) : null; } catch { v = null; } }
  const tracks = Array.isArray(v?.tracks) ? [...new Set(v.tracks.filter((t: unknown) => typeof t === "string" && t))].slice(0, 500) as string[] : [];
  return { tracks, shuffle: !!v?.shuffle };
}
