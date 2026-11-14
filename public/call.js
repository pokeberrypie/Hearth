/*
 * A call: Hearth, hands free.
 *
 * You speak; a pause ends what you said; ElevenLabs writes it down; it goes as your message, the way the Send button
 * sends one; the reply is read back in its speaker's voice; and Hearth listens again. Until you hang up — or say
 * "end call".
 *
 * Listening is a level, measured: the room is heard for a moment first, so a fan or a fridge is not taken for you,
 * and what is louder than that, for long enough, is speech. While a reply is spoken nothing is recorded, unless
 * speaking over it is switched on (headphones, best), when your voice stops it.
 *
 * Lines are fetched one ahead: the next is on its way while this one plays.
 */
(() => {
  const C = {
    on: false, state: "idle", stream: null, ctx: null, analyser: null, level: 0, floor: 0.01,
    muted: false, audio: null, cutSpeech: null, endUtterance: null, wake: null, status: null, faces: new Map(),
  };
  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
  // What no amount of trying again mends — a key refused, credits gone, no voice: the call ends and says why,
  // rather than listening, sending what you say, and failing again every few seconds for as long as it is left open.
  const FATAL = /did not accept the key|out of credits|Add an ElevenLabs key|Choose a voice|no longer on this ElevenLabs account/i;
  const fail = (why) => { endCall(); toast(why); };
  const el = (id) => document.getElementById(id);
  const say = (text) => { const c = el("callCaption"); if (c) c.textContent = text || ""; };

  // ---- voices, for the settings and for each character ----------------------------------------------------------

  let voiceList = null;
  async function voices(again = false) {
    if (voiceList && !again) return voiceList;
    const r = await api("/voice/voices");
    voiceList = Array.isArray(r?.voices) ? r.voices : [];
    if (r?.error) voiceList.error = r.error;
    return voiceList;
  }

  function fillVoices(select, chosen, blank) {
    if (!select) return;
    const list = voiceList ?? [];
    select.innerHTML = `<option value="">${esc(blank)}</option>` +
      list.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.category && v.category !== "premade" ? ` (${esc(v.category)})` : ""}</option>`).join("");
    // A voice not on the list any more is kept, said as missing, rather than quietly changed.
    if (chosen && !list.some((v) => v.id === chosen)) select.insertAdjacentHTML("beforeend", `<option value="${esc(chosen)}">A voice no longer on the account</option>`);
    select.value = chosen || "";
  }

  async function paintVoiceSettings() {
    const box = el("voiceSet");
    if (!box) return;
    const st = await api("/voice/status");
    C.status = st;
    const key = el("key_elevenlabs");
    if (key && document.activeElement !== key) key.value = st.ready ? "__saved__" : "";
    el("voice_reads").value = st.reads === "all" ? "all" : "speech";
    el("voice_pause").value = String(st.pause ?? 1.2);
    el("voice_pause_v").textContent = `${Number(st.pause ?? 1.2).toFixed(1)} s`;
    el("voice_interrupt").checked = !!st.interrupt;
    const hint = el("voiceHint");
    if (!st.ready) {
      fillVoices(el("voice_default"), "", "Add a key to choose");
      fillVoices(el("voice_narrator"), "", "Add a key to choose");
      hint.textContent = "Calls speak and listen through ElevenLabs. Paste an API key from elevenlabs.io (Profile → API keys).";
      return;
    }
    hint.textContent = "Loading your voices…";
    await voices(true);
    fillVoices(el("voice_default"), st.default, "Choose a voice");
    fillVoices(el("voice_narrator"), st.narrator, "The speaker's own voice");
    hint.textContent = voiceList.error ? voiceList.error
      : `${voiceList.length} voice${voiceList.length === 1 ? "" : "s"} on the account. Give a character its own in its editor.`;
  }

  async function save(patch) {
    await api("/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  }

  function wireSettings() {
    if (!el("voiceSet") || el("voiceSet").dataset.wired) return;
    el("voiceSet").dataset.wired = "1";
    el("key_elevenlabs").addEventListener("change", async (e) => {
      const v = e.target.value.trim();
      if (v === "__saved__") return;
      await save({ key_elevenlabs: v });
      paintVoiceSettings();
    });
    for (const id of ["voice_default", "voice_narrator", "voice_reads"]) {
      el(id).addEventListener("change", (e) => save({ [id]: e.target.value }));
    }
    el("voice_pause").addEventListener("input", (e) => { el("voice_pause_v").textContent = `${Number(e.target.value).toFixed(1)} s`; });
    el("voice_pause").addEventListener("change", (e) => save({ voice_pause: e.target.value }));
    el("voice_interrupt").addEventListener("change", (e) => save({ voice_interrupt: e.target.checked ? "1" : "0" }));
    el("voiceTest").addEventListener("click", async () => {
      const hint = el("voiceHint");
      const voice = el("voice_default").value;
      if (!voice) { hint.textContent = "Choose a voice first."; return; }
      hint.textContent = "Speaking…";
      const r = await speakLine({ text: "The fire is lit, and I am listening. Say something when you are ready.", voice });
      hint.textContent = r.error ?? "";
    });
    // Drawn whenever the Connection tab is opened.
    document.querySelectorAll('[data-tab="connection"]').forEach((b) => b.addEventListener("click", () => setTimeout(paintVoiceSettings, 50)));
  }

  /** The character editor: a voice of its own. */
  async function paintCharacterVoice(character) {
    const select = el("c_voice");
    if (!select) return;
    if (!C.status) C.status = await api("/voice/status");
    el("c_voiceRow").hidden = !C.status.ready;
    if (!C.status.ready) return;
    await voices();
    fillVoices(select, character?.voice ?? "", "The default voice");
  }
  window.hearthCharacterVoice = paintCharacterVoice;

  // ---- hearing ---------------------------------------------------------------------------------------------------

  function levelNow() {
    const a = C.analyser;
    if (!a) return 0;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  function pickType() {
    for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
      if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
    }
    return "";
  }

  /** The room, heard for a moment: what is louder than this is you. */
  async function measureRoom() {
    const samples = [];
    for (let i = 0; i < 8; i++) { samples.push(levelNow()); await sleep(40); }
    samples.sort((a, b) => a - b);
    C.floor = Math.max(0.004, samples[Math.floor(samples.length / 2)]);
  }

  /** One thing said: recorded from when you start until a pause ends it. Null if nothing was said. */
  function listenOnce() {
    return new Promise((resolve) => {
      const type = pickType();
      let rec;
      try { rec = new MediaRecorder(C.stream, type ? { mimeType: type } : undefined); } catch (e) { say("This device cannot record audio here."); resolve(null); return; }
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      const pause = Math.max(0.5, Number(C.status?.pause) || 1.2) * 1000;
      const loud = () => Math.max(0.02, C.floor * 3.2);
      let spoke = 0, loudFor = 0, quietFor = 0, waited = 0, done = false;
      const finish = (keep) => {
        if (done) return;
        done = true;
        clearInterval(tick);
        C.endUtterance = null;
        rec.onstop = () => resolve(keep && chunks.length ? new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }) : null);
        try { rec.stop(); } catch { resolve(null); }
      };
      C.endUtterance = () => finish(!!spoke);
      rec.start(250);
      const tick = setInterval(() => {
        if (!C.on) return finish(false);
        if (C.muted) { loudFor = 0; return; }
        const lv = levelNow();
        C.level = lv;
        if (lv > loud()) { loudFor += 50; quietFor = 0; if (loudFor >= 150 && !spoke) { spoke = Date.now(); setState("hearing"); } }
        else { loudFor = 0; if (spoke) quietFor += 50; else { waited += 50; C.floor = C.floor * 0.98 + lv * 0.02; } }
        if (spoke && quietFor >= pause) return finish(true);
        if (spoke && Date.now() - spoke > 60_000) return finish(true);
        // Nobody spoke for a while: begin again, so a recording never holds minutes of silence.
        if (!spoke && waited > 25_000) return finish(false);
      }, 50);
    });
  }

  async function hear(blob) {
    const form = new FormData();
    const ext = /mp4/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm";
    form.set("file", blob, `speech.${ext}`);
    try {
      const r = await fetch("/api/voice/hear", { method: "POST", body: form });
      return await r.json();
    } catch { return { error: "Could not reach Hearth to hear you." }; }
  }

  // ---- speaking --------------------------------------------------------------------------------------------------

  function fetchLine(line) {
    return fetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(line) })
      .then(async (r) => (r.ok && /audio/.test(r.headers.get("content-type") || "") ? { blob: await r.blob() } : { error: (await r.json().catch(() => ({}))).error || `Hearth answered ${r.status}.` }))
      .catch(() => ({ error: "Could not reach Hearth to speak." }));
  }

  /** One fetched line, played to its end — or until skipped, spoken over, or the call ends. */
  function play(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      C.audio = a;
      let over = false;
      const end = (why) => {
        if (over) return;
        over = true;
        clearInterval(watch);
        C.cutSpeech = null;
        try { a.pause(); } catch {}
        URL.revokeObjectURL(url);
        C.audio = null;
        resolve(why);
      };
      C.cutSpeech = () => end("cut");
      a.onended = () => end("ended");
      a.onerror = () => end("error");
      let over_ = 0;
      const watch = setInterval(() => {
        if (!C.on) return end("cut");
        if (!C.status?.interrupt || C.muted) return;
        // Spoken over: your voice, louder than the room, for long enough, stops the reply.
        if (levelNow() > Math.max(0.05, C.floor * 5)) { over_ += 50; if (over_ >= 350) end("interrupted"); } else over_ = 0;
      }, 50);
      a.play().catch(() => end("error"));
    });
  }

  async function speakLine(line) {
    const got = await fetchLine(line);
    if (got.error) return got;
    await play(got.blob);
    return {};
  }

  /** A reply, said: line by line, the next one fetched while this one plays. */
  async function speak(reply) {
    const r = await api("/voice/lines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: reply.content }) });
    const lines = (r?.lines ?? []).map((l, i, all) => ({ text: l.text, who: l.who, character_id: reply.character_id || chatMeta?.character_id || "", previous: i ? all[i - 1].text : "" }));
    if (!lines.length) return;
    let next = fetchLine(lines[0]);
    for (let i = 0; i < lines.length && C.on; i++) {
      const got = await next;
      next = i + 1 < lines.length ? fetchLine(lines[i + 1]) : null;
      if (got.error) {
        if (FATAL.test(got.error)) { fail(got.error); return; }
        say(got.error); await sleep(1200); return;
      }
      say(lines[i].text);
      const why = await play(got.blob);
      if (why === "cut" || why === "interrupted") return;
    }
  }

  // ---- the call --------------------------------------------------------------------------------------------------

  async function face(characterId) {
    if (!characterId) return { name: S.charName, avatar: S.charAvatar };
    if (!C.faces.has(characterId)) {
      const all = await api("/characters").catch(() => []);
      for (const ch of Array.isArray(all) ? all : all?.characters ?? []) C.faces.set(ch.id, { name: ch.name, avatar: ch.avatar });
    }
    return C.faces.get(characterId) ?? { name: S.charName, avatar: S.charAvatar };
  }

  async function showFace(characterId) {
    const f = await face(characterId);
    el("callName").textContent = f.name || "";
    const img = el("callFace");
    if (f.avatar) { img.src = f.avatar; img.hidden = false; el("callInitial").hidden = true; }
    else { img.hidden = true; el("callInitial").hidden = false; el("callInitial").textContent = (f.name || "?").trim().charAt(0).toUpperCase(); }
  }

  function setState(state) {
    C.state = state;
    const d = el("callDialog");
    if (!d) return;
    d.dataset.state = state;
    const who = el("callName").textContent || "They";
    el("callState").textContent = C.muted && state === "listening" ? "Muted — tap the microphone to speak"
      : { listening: "Listening…", hearing: "Hearing you…", writing: "Writing down what you said…", thinking: `${who} is thinking…`, speaking: `${who} is speaking`, idle: "" }[state] ?? "";
    el("callTalk").setAttribute("aria-label", state === "speaking" ? "Skip" : "Done talking");
    el("callTalk").title = state === "speaking" ? "Skip what is being said" : "Send what you said now";
    el("callTalk").dataset.does = state === "speaking" ? "skip" : "send";
  }

  async function lastReply() {
    const r = await api(`/chats/${S.chatId}`).catch(() => null);
    const msgs = r?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return msgs[i];
    return null;
  }

  function meter() {
    if (!C.on) return;
    const d = el("callDialog");
    const lv = C.state === "speaking" ? 0.25 + Math.random() * 0.25 : Math.min(1, (C.level || levelNow()) / Math.max(0.05, C.floor * 8));
    d?.style.setProperty("--lvl", lv.toFixed(3));
    requestAnimationFrame(meter);
  }

  async function loop() {
    await measureRoom();
    while (C.on) {
      if (S.busy) { setState("thinking"); await sleep(400); continue; }
      setState("listening");
      const blob = await listenOnce();
      if (!C.on) break;
      if (!blob) continue;
      setState("writing");
      const heard = await hear(blob);
      if (!C.on) break;
      if (heard.error) {
        if (FATAL.test(heard.error)) { fail(heard.error); break; }
        say(heard.error); await sleep(1800); continue;
      }
      const text = String(heard.text ?? "").trim();
      if (!text) continue;
      if (/^(end|hang up)( the)? call[.!]?$|^hang up[.!]?$|^goodbye,? hearth[.!]?$/i.test(text)) { endCall(); break; }
      say(`You: ${text}`);
      setState("thinking");
      const before = (await lastReply())?.id ?? null;
      await run("reply", extTransform("send:before", text));
      if (!C.on) break;
      const reply = await lastReply();
      if (!reply || reply.id === before) { say("No reply came — the story may have stopped. Say it again, or check the chat."); continue; }
      await showFace(reply.character_id);
      setState("speaking");
      await speak(reply);
    }
  }

  async function startCall() {
    if (C.on || !S.chatId) return;
    // Guests at a shared table do not call: the voice, the key and the story's turn are all the host's. Known only
    // once the page has asked who it is for, so asked here, not when the script loads.
    if (typeof GUEST !== "undefined" && GUEST.on) { el("callBtn").hidden = true; return; }
    C.status = await api("/voice/status");
    if (!C.status?.ready) {
      toast("Add an ElevenLabs key under Connection → Voice to make a call.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { toast("This browser cannot use a microphone here."); return; }
    // Made in the tap that started the call: a browser only lets sound start from one.
    try { C.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    try {
      C.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      toast(e?.name === "NotAllowedError" ? "Hearth was not allowed the microphone. Allow it, then call again." : "No microphone could be opened.");
      try { C.ctx?.close(); } catch {}
      return;
    }
    const src = C.ctx.createMediaStreamSource(C.stream);
    C.analyser = C.ctx.createAnalyser();
    C.analyser.fftSize = 1024;
    src.connect(C.analyser);
    C.on = true;
    C.muted = false;
    el("callMute").classList.remove("off");
    say("");
    await showFace(chatMeta?.character_id);
    el("callDialog").showModal();
    try { C.wake = await navigator.wakeLock?.request("screen"); } catch {}
    meter();
    loop().catch((e) => { say(`The call stopped: ${e?.message ?? e}`); });
  }

  function endCall() {
    if (!C.on) return;
    C.on = false;
    C.cutSpeech?.();
    C.endUtterance?.();
    for (const t of C.stream?.getTracks?.() ?? []) t.stop();
    C.stream = null;
    try { C.ctx?.close(); } catch {}
    C.ctx = null;
    C.analyser = null;
    try { C.wake?.release(); } catch {}
    C.wake = null;
    setState("idle");
    if (el("callDialog")?.open) el("callDialog").close();
  }

  function wireCall() {
    const btn = el("callBtn");
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", startCall);
    el("callEnd").addEventListener("click", endCall);
    el("callDialog").addEventListener("cancel", (e) => { e.preventDefault(); endCall(); });
    el("callMute").addEventListener("click", () => {
      C.muted = !C.muted;
      for (const t of C.stream?.getAudioTracks?.() ?? []) t.enabled = !C.muted;
      el("callMute").classList.toggle("off", C.muted);
      el("callMute").setAttribute("aria-label", C.muted ? "Unmute" : "Mute");
      setState(C.state);
    });
    el("callTalk").addEventListener("click", () => {
      if (C.state === "speaking") C.cutSpeech?.();
      else C.endUtterance?.();
    });
  }

  function boot() {
    wireSettings();
    wireCall();
    paintVoiceSettings().catch(() => {});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.hearthCall = { start: startCall, end: endCall, state: () => C.state };
})();
