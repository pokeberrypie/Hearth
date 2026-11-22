/*
 * Music under the story: your own files, a playlist per chat, played from the ♪ in the top bar.
 *
 * One player for the whole app. Opening a chat with a playlist of its own hands that playlist to the player; if music
 * is already playing, it fades across to the new one, and a chat with no playlist leaves whatever is playing alone, so
 * a song is not cut off by looking at another chat. It starts only from a press — a browser will not make a noise
 * before one — and after that it follows you from chat to chat.
 *
 * While ElevenLabs is speaking (a call, or ▶ on a message) the music dips, and comes back when the voice stops.
 */
(() => {
  const el = (id) => document.getElementById(id);
  const PAUSE = `<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>`;
  const VOL_KEY = "hearth.music.volume";
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const keep = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };

  const M = {
    audio: new Audio(),
    tracks: [],          // the library: [{ id, title }]
    queue: [],           // ids, in play order
    at: 0,               // where in the queue
    chat: null,          // the chat whose playlist this is
    playing: false,
    awake: false,        // a press has happened: from here on it may start by itself
    volume: Math.min(1, Math.max(0, Number(read(VOL_KEY, "0.5")) || 0.5)),
    ducked: 0,           // how many voices are speaking over it
    fade: 0,
    errors: 0,
  };
  M.audio.preload = "auto";

  const level = () => M.volume * (M.ducked ? 0.22 : 1);
  function rampTo(target, ms = 600, then) {
    cancelAnimationFrame(M.fade);
    const from = M.audio.volume, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      M.audio.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) M.fade = requestAnimationFrame(step); else then?.();
    };
    M.fade = requestAnimationFrame(step);
  }

  const titleOf = (id) => M.tracks.find((t) => t.id === id)?.title ?? "";
  const current = () => M.queue[M.at] ?? null;
  const shuffled = (ids) => { const a = [...ids]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const playlist = (chat) => {
    let v = chat?.music;
    if (typeof v === "string") { try { v = v ? JSON.parse(v) : null; } catch { v = null; } }
    return { tracks: Array.isArray(v?.tracks) ? v.tracks.filter((id) => M.tracks.some((t) => t.id === id)) : [], shuffle: !!v?.shuffle };
  };

  async function library(again = false) {
    if (M.tracks.length && !again) return M.tracks;
    const r = await api("/music").catch(() => []);
    M.tracks = Array.isArray(r) ? r : [];
    return M.tracks;
  }

  function load(id, start) {
    if (!id) return;
    M.audio.src = `/api/music/${encodeURIComponent(id)}/play`;
    M.audio.volume = start ? 0 : level();
    if (M.playing) M.audio.play().then(() => { M.errors = 0; if (start) rampTo(level(), 900); }).catch(() => {});
    paint();
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: titleOf(id), artist: "Hearth" }); } catch {}
    }
  }

  function play() {
    if (!M.queue.length) { toast("This chat has no music yet. Add some in Chat settings → Music."); return; }
    M.awake = true;
    M.playing = true;
    if (!M.audio.src) load(current(), true);
    else M.audio.play().then(() => rampTo(level(), 400)).catch(() => toast("That track could not be played here."));
    paint();
  }
  function pause() {
    M.playing = false;
    rampTo(0, 300, () => M.audio.pause());
    paint();
  }
  function skip(by) {
    if (!M.queue.length) return;
    M.at = (M.at + by + M.queue.length) % M.queue.length;
    load(current(), false);
  }

  M.audio.addEventListener("ended", () => skip(1));
  M.audio.addEventListener("error", () => {
    // A file gone or unplayable: on to the next, but not round and round a playlist where none will play.
    if (!M.playing || !M.audio.src) return;
    if (++M.errors >= Math.max(2, M.queue.length)) { pause(); toast("None of this chat's music would play."); return; }
    skip(1);
  });

  /** A chat opened: its playlist becomes the queue. Playing already, it crosses over; else it waits for a press. */
  async function follow(chat) {
    if (typeof GUEST !== "undefined" && GUEST.on) return;
    await library();
    const p = playlist(chat);
    M.chat = chat?.id ?? null;
    if (!p.tracks.length) { paint(); return; }
    const order = p.shuffle ? shuffled(p.tracks) : p.tracks;
    const same = order.length === M.queue.length && [...order].sort().join() === [...M.queue].sort().join();
    if (same && M.audio.src) { paint(); return; }   // the same music: carry on where it is
    M.queue = order;
    M.at = 0;
    if (M.playing) rampTo(0, 700, () => load(current(), true));
    else { M.audio.removeAttribute("src"); M.audio.load(); }
    paint();
  }

  /** Voices speaking over it: down while any is, back up after the last. */
  function duck(on) {
    M.ducked = Math.max(0, M.ducked + (on ? 1 : -1));
    if (M.playing) rampTo(level(), on ? 250 : 900);
  }

  // ---- the ♪ and its little panel ------------------------------------------------------------------------------

  function paint() {
    const btn = el("musicBtn");
    if (!btn) return;
    const chatHas = M.chat && M.queue.length;
    btn.hidden = (typeof GUEST !== "undefined" && GUEST.on) || !(chatHas || M.playing);
    btn.classList.toggle("on", M.playing);
    btn.setAttribute("aria-label", M.playing ? `Music: ${titleOf(current())}` : "Music");
    const pop = el("musicPop");
    if (!pop || pop.hidden) return;
    el("musicNow").textContent = titleOf(current()) || "Nothing chosen";
    el("musicPlay").innerHTML = M.playing ? PAUSE : ICON.say;
    el("musicPlay").setAttribute("aria-label", M.playing ? "Pause" : "Play");
    el("musicVol").value = String(Math.round(M.volume * 100));
  }

  function togglePop(open) {
    const pop = el("musicPop");
    pop.hidden = open === undefined ? !pop.hidden : !open;
    paint();
  }

  // ---- Chat settings → Music -------------------------------------------------------------------------------------

  async function paintPicker(chat) {
    const box = el("sceneMusic");
    if (!box || !chat) return;
    await library(true);
    const p = playlist(chat);
    const on = new Set(p.tracks);
    // The playlist's own order first, then the rest of the library by title.
    const rows = [...p.tracks.map((id) => M.tracks.find((t) => t.id === id)), ...M.tracks.filter((t) => !on.has(t.id))].filter(Boolean);
    box.innerHTML = rows.length
      ? rows.map((t) => `<div class="mrow${on.has(t.id) ? " on" : ""}" data-id="${esc(t.id)}">` +
          `<label class="check"><input type="checkbox"${on.has(t.id) ? " checked" : ""}> <span class="mtitle">${esc(t.title)}</span></label>` +
          `<span class="rowtools"><button type="button" data-rename title="Rename" aria-label="Rename ${esc(t.title)}">${ICON.edit}</button>` +
          `<button type="button" data-remove title="Delete from your music" aria-label="Delete ${esc(t.title)}">${ICON.del}</button></span></div>`).join("")
      : `<p class="hint">No music yet. Add some below: it stays in your library for any chat.</p>`;
    el("musicShuffle").checked = p.shuffle;
  }

  async function savePicker() {
    if (!chatMeta) return;
    const tracks = [...el("sceneMusic").querySelectorAll(".mrow")].filter((r) => r.querySelector("input").checked).map((r) => r.dataset.id);
    const r = await api(`/chats/${chatMeta.id}/music`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ tracks, shuffle: el("musicShuffle").checked }) });
    if (r?.error) { toast(r.error); return; }
    chatMeta.music = JSON.stringify(r);
    if (S.chatId === chatMeta.id) await follow(chatMeta);
  }

  function wire() {
    const btn = el("musicBtn");
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", (e) => { e.stopPropagation(); togglePop(); });
    el("musicPlay").addEventListener("click", () => (M.playing ? pause() : play()));
    el("musicPrev").addEventListener("click", () => { M.awake = true; if (!M.playing) play(); skip(-1); });
    el("musicNext").addEventListener("click", () => { M.awake = true; if (!M.playing) play(); skip(1); });
    el("musicVol").addEventListener("input", (e) => {
      M.volume = Number(e.target.value) / 100;
      keep(VOL_KEY, M.volume);
      cancelAnimationFrame(M.fade);
      M.audio.volume = level();
    });
    el("musicEdit").addEventListener("click", () => { togglePop(false); if (typeof openScene === "function") openScene().then(() => el("sceneMusic")?.scrollIntoView({ block: "center" })); });
    // Outside the panel, it closes. Asked of the path the tap took, not of where its target is now: Play redraws its
    // own icon, and the icon tapped is no longer in the panel by the time this runs.
    document.addEventListener("click", (e) => {
      if (el("musicPop").hidden) return;
      const path = e.composedPath();
      if (!path.includes(el("musicPop")) && !path.includes(el("musicBtn"))) togglePop(false);
    });

    const box = el("sceneMusic");
    box.addEventListener("change", (e) => {
      if (!e.target.matches("input[type=checkbox]")) return;
      e.target.closest(".mrow").classList.toggle("on", e.target.checked);
      savePicker();
    });
    box.addEventListener("click", async (e) => {
      const row = e.target.closest(".mrow");
      if (!row) return;
      const id = row.dataset.id;
      const title = M.tracks.find((t) => t.id === id)?.title ?? "";
      if (e.target.closest("[data-rename]")) {
        const v = await askDialog({ title: "Rename", confirmLabel: "Save", value: title });
        if (!v || !v.trim() || v.trim() === title) return;
        const r = await api(`/music/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: v }) });
        if (r?.error) { toast(r.error); return; }
        await paintPicker(chatMeta);
        paint();
      } else if (e.target.closest("[data-remove]")) {
        const yes = await askDialog({ title: `Delete “${title}”?`, text: "It goes from your music and from every chat's playlist. The file is deleted from Hearth.", confirmLabel: "Delete" });
        if (!yes) return;
        if (current() === id) { M.queue = M.queue.filter((x) => x !== id); M.at = 0; M.audio.pause(); M.audio.removeAttribute("src"); if (M.playing && M.queue.length) load(current(), true); else M.playing = false; }
        await api(`/music/${id}`, { method: "DELETE" });
        await paintPicker(chatMeta);
        const fresh = await api(`/chats/${chatMeta.id}`).catch(() => null);
        if (fresh?.chat) { chatMeta.music = fresh.chat.music; await follow(chatMeta); }
      }
    });
    el("musicShuffle").addEventListener("change", savePicker);
    el("musicAdd").addEventListener("click", () => el("musicFiles").click());
    el("musicFiles").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (!files.length) return;
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name);
      el("musicHint").textContent = `Bringing in ${files.length} file${files.length === 1 ? "" : "s"}…`;
      let r;
      try { r = await (await fetch("/api/music", { method: "POST", body: form })).json(); } catch { r = { error: "Could not reach Hearth." }; }
      if (r.error) { el("musicHint").textContent = r.error; return; }
      el("musicHint").textContent = [r.added.length ? `Added ${r.added.map((t) => t.title).join(", ")} to this chat.` : "", r.skipped.length ? `Left out: ${r.skipped.join("; ")}.` : ""].filter(Boolean).join(" ");
      await library(true);
      // New music goes straight into the chat it was added from.
      if (chatMeta && r.added.length) {
        const p = playlist(chatMeta);
        chatMeta.music = JSON.stringify({ tracks: [...p.tracks, ...r.added.map((t) => t.id)], shuffle: p.shuffle });
        await paintPicker(chatMeta);
        await savePicker();
      }
    });
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", play);
        navigator.mediaSession.setActionHandler("pause", pause);
        navigator.mediaSession.setActionHandler("nexttrack", () => skip(1));
        navigator.mediaSession.setActionHandler("previoustrack", () => skip(-1));
      } catch {}
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire); else wire();
  window.hearthMusic = { follow, duck, paintPicker, play, pause, state: () => ({ playing: M.playing, queue: [...M.queue], at: M.at, title: titleOf(current()), volume: M.audio.volume }) };
})();
