/*
 * Story World: what has happened in this chat, when, how everyone is, who
 * feels what about whom, and the groups in it.
 *
 * The server keeps all of it — src/chronicle.ts and src/steward.ts — and this
 * file only shows it and passes on what a person asks for: a line under the
 * chat's title, a window over the chat with four pages, and the settings that
 * go with it in Connection and Behavior. Loaded after app.js and leaning on
 * its helpers ($, api, esc, toast, fail, S, GUEST), the way every other page
 * script here does.
 *
 * Nothing in here works anything out. A date, a score, a status is whatever
 * the server says it is; this file never adds a day or moves a bond itself,
 * so there is one account of the world and not two that drift apart.
 */

const W = {
  /** The last chronicle state for the open chat, as /chats/:id/chronicle gave it. */
  state: null,
  /** Which page of the window is showing. */
  tab: "time",
  /** The host looking at what the players see. */
  asPlayers: false,
  /** The charge set, read once when the faction editor first opens. */
  charges: null,
};

const txt = (s) => esc(String(s ?? ""));

// ---- the line under the title ---------------------------------------------

/**
 * One line: today's date, and how many things are waiting for you. Quiet,
 * italic, part of the title rather than a bar of its own. Hidden in a chat
 * that has no date and nothing recorded — there is nothing to say yet, and a
 * line that says "Day 1" over every new chat is noise.
 */
async function paintWorldLine() {
  const line = $("#worldLine");
  if (!line) return;
  if (GUEST.on) return paintGuestWorldLine();
  if (!S.chatId || !worldOn()) {
    line.hidden = true;
    const q = $("#scenePrompt");
    if (q) q.hidden = true;
    if (!worldOn() && $("#worldDialog")?.open) $("#worldDialog").close();
    return;
  }
  const id = S.chatId;
  const s = await api(`/chats/${id}/chronicle`).catch(() => null);
  if (!s || s.error || S.chatId !== id) return;
  W.state = s;
  paintScenePrompt(s);
  const dated = s.calendar?.kind !== "undated" || s.entries.some((e) => e.kind === "time" || e.kind === "set");
  // Questions about the plan are asked by the writing line, not counted here.
  const waiting = (s.proposals ?? []).filter((p) => p.kind !== "scene" && p.kind !== "threat").length;
  // Always there in a chat: it is the way into Story World, and a chat with
  // nothing recorded yet is exactly the one somebody needs to find it from.
  line.hidden = false;
  $("#worldDate").textContent = dated ? s.now.text : "Story World";
  const note = $("#worldNote");
  note.hidden = !waiting;
  note.textContent = waiting ? String(waiting) : "";
  note.title = waiting ? `${waiting} waiting for you` : "";
  fitWorldLine();
  if (!$("#worldDialog")?.open) return;
  paintWorld();
}


/**
 * One line, always: a date too long for the bar has its type brought down
 * until it fits, rather than running off the edges or being cut short.
 */
function fitWorldLine() {
  const line = $("#worldLine");
  if (!line || line.hidden) return;
  line.style.fontSize = "";
  let size = parseFloat(getComputedStyle(line).fontSize) || 12;
  while (line.scrollWidth > line.clientWidth + 1 && size > 8) {
    size -= 0.5;
    line.style.fontSize = size + "px";
  }
}
addEventListener("resize", fitWorldLine);

/**
 * The plan's question, by the writing line: "this scene seems over — move
 * on?" or "the story seems to be at that scene — jump there?". A small card
 * just above the composer, where the eye already is between replies; it goes
 * the moment it is answered, and asks again only when the Steward next has
 * reason to.
 */
function paintScenePrompt(s) {
  const q = GUEST.on ? null : (s?.proposals ?? []).find((p) => (p.kind === "scene" || p.kind === "threat" || p.kind === "conflict") && !p.sealed);
  let box = $("#scenePrompt");
  if (!q) { if (box) box.hidden = true; return; }
  if (!box) {
    box = document.createElement("div");
    box.id = "scenePrompt";
    box.className = "sceneprompt";
    box.setAttribute("role", "status");
    $("#composer").before(box);
  }
  let d = {};
  try { d = q.data ? JSON.parse(q.data) : {}; } catch {}
  const threat = q.kind === "threat";
  const conflict = q.kind === "conflict";
  const text = conflict
    ? `Something that happened offstage means ${q.title ? `<b>${txt(q.title)}</b>` : "a scene ahead in your plan"} may not be able to happen as written. Your plan has not been changed.`
    : threat
    ? `Something is stirring against <b>${txt(d.player || "you")}</b>. Let it come into the story?`
    : d.to
    ? `The story seems to be at <b>${txt(d.toTitle || "a later scene")}</b>. Jump there?`
    : `<b>${txt(q.title)}</b> seems to be over.${d.next ? ` Move on to <b>${txt(d.next)}</b>?` : " Close it?"}`;
  box.innerHTML = `<span class="spstar" aria-hidden="true">✦</span>
    <div class="sptext">${text}${q.evidence ? `<div class="spwhy">“${txt(q.evidence)}”</div>` : ""}</div>
    <div class="spbtns">${conflict
      ? `<button type="button" class="solid" data-yes>I'll adapt it</button>
      <button type="button" class="linkish" data-no>Keep it as written</button>`
      : `<button type="button" class="solid" data-yes>Yes</button>
      <button type="button" class="linkish" data-no>Not yet</button>
      ${threat ? "" : `<button type="button" class="linkish" data-pick-scene>Pick the scene…</button>`}`}</div>`;
  box.hidden = false;
  box.querySelector("[data-yes]").onclick = async () => {
    box.hidden = true;
    await act(`/chronicle/${q.id}/accept`);
    // Adapting it: straight to the book, on the shelf.
    if (conflict && typeof openApoc === "function") {
      const tale = await api(`/chats/${S.chatId}/apocrypha`).catch(() => null);
      if (tale?.book) { openApoc(tale.book); return; }
    }
    if (typeof refreshTaleNav === "function") refreshTaleNav();
    toast(conflict ? "Noted. What happened is in the Living World ledger, if you want to see it." : threat ? "It will come in the next reply." : d.to ? `Now in: ${d.toTitle || "the later scene"}` : d.next ? `Now: ${d.next}` : "That was the last scene.");
  };
  box.querySelector("[data-no]").onclick = async () => { box.hidden = true; await act(`/chronicle/${q.id}/undo`); };
  // The guess is wrong: say where the story really is. Choosing answers the question.
  box.querySelector("[data-pick-scene]")?.addEventListener("click", () => { if (typeof openScenePicker === "function") openScenePicker(); });
}

/** A guest's line comes from the table's own state, and moves with the live feed. */
function paintGuestWorldLine(summary) {
  const line = $("#worldLine");
  const w = summary ?? GUEST.state?.world;
  if (!line || !w) return;
  line.hidden = !w.today;
  $("#worldDate").textContent = w.today;
  // Under a title there is room for the date and nothing more; the latest
  // event is in the window, a tap away.
  $("#worldNote").hidden = true;
  line.title = w.latest ? `Latest: ${w.latest}` : "";
  fitWorldLine();
}

// ---- the window -------------------------------------------------------------

const TABS = [
  { id: "time", label: "Timeline",
    icon: '<path d="M12 3v18"/><circle cx="12" cy="7" r="2"/><circle cx="12" cy="17" r="2"/><path d="M14 12h6M4 12h6"/>' },
  { id: "bonds", label: "Bonds",
    icon: '<circle cx="12" cy="12" r="3"/><circle cx="4.5" cy="6" r="2"/><circle cx="19.5" cy="6" r="2"/><circle cx="12" cy="21" r="1.6"/><path d="M6.2 7.2l3.4 2.9M17.8 7.2l-3.4 2.9M12 15v4.4"/>' },
  { id: "threads", label: "Threads",
    icon: '<path d="M4 6c4 0 4 4 8 4s4-4 8-4"/><path d="M4 13c4 0 4 4 8 4s4-4 8-4"/><path d="M20 6v2M4 17v3"/>' },
  { id: "factions", label: "Factions",
    icon: '<path d="M5 4h14v7c0 5-3.5 8-7 9.5C8.5 19 5 16 5 11z"/><path d="M12 8v8M8.5 11.5h7"/>' },
  // The author's only: what the people offstage are up to. Sealed until asked.
  { id: "offstage", label: "Offstage", hostOnly: true,
    icon: '<path d="M4 5c3 1.5 13 1.5 16 0v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9z"/><path d="M8 10.5c.8-.7 1.7-.7 2.4 0M13.6 10.5c.8-.7 1.7-.7 2.4 0M9 15c1.8 1.2 4.2 1.2 6 0"/>' },
];

function worldDialog() {
  let d = $("#worldDialog");
  if (d) return d;
  d = document.createElement("dialog");
  d.id = "worldDialog";
  d.className = "worlddialog";
  d.setAttribute("aria-labelledby", "worldHeading");
  d.innerHTML = `
    <div class="wdhead">
      <div class="wdflourish" aria-hidden="true">✧</div>
      <h2 id="worldHeading">Story World</h2>
      <button class="ico" id="wdClose" title="Close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="wddate">
      <svg class="wdmoon" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="13"/><path id="wdMoonLit" d=""/></svg>
      <div><div class="wdday" id="wdDay"></div><div class="wdcal" id="wdCal"></div></div>
    </div>
    <div class="wdviewing" id="wdViewing" hidden></div>
    <div class="wdtabs" role="tablist" aria-label="Story World">
      ${TABS.map((t) => `<button type="button" role="tab" class="wdtab" data-tab="${t.id}" aria-label="${t.label}"${t.hostOnly ? " data-hostonly" : ""}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg><span>${t.label}</span></button>`).join("")}
    </div>
    <div class="wdwaiting" id="wdWaiting" hidden></div>
    <div class="wdbody" id="wdBody"></div>`;
  document.body.appendChild(d);
  $("#wdClose").onclick = () => d.close();
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  for (const b of d.querySelectorAll(".wdtab")) {
    b.onclick = () => { W.tab = b.dataset.tab; paintWorld(); };
  }
  return d;
}

async function openWorld() {
  const d = worldDialog();
  if (!d.open) d.showModal();
  W.asPlayers = false;
  if (GUEST.on) {
    W.state = await api("/table/world").catch(() => null);
  } else {
    await paintWorldLine();
  }
  paintWorld();
}

/**
 * What the window shows depends on who is looking. The owner of a chat reads
 * everything. A shared chat's host reads a secret as sealed — there, and
 * revealable, but not read — and can switch to exactly what the players see.
 * A guest reads only what the table may.
 */
function viewer() {
  if (GUEST.on) return "guest";
  return W.asPlayers ? "players" : "host";
}

function paintWorld() {
  const d = worldDialog();
  const s = W.state;
  if (!s) { $("#wdBody").innerHTML = `<p class="hint">Story World could not be read.</p>`; return; }
  const who = viewer();
  const shared = who !== "guest" && !!W.state?.shared;

  $("#wdDay").textContent = s.now?.text ?? "";
  $("#wdCal").textContent = typeof s.calendar === "string" ? s.calendar : s.calendar?.name ?? "";
  paintMoon(s);

  const viewing = $("#wdViewing");
  viewing.hidden = who === "guest" || !shared;
  viewing.innerHTML = who === "players"
    ? `You are seeing what the players see. <button type="button" class="linkish" id="wdAsHost">Back to everything</button>`
    : `<button type="button" class="linkish" id="wdAsPlayers">See it as the players do</button>`;
  $("#wdAsPlayers")?.addEventListener("click", async () => {
    W.asPlayers = true;
    W.players = await api(`/chats/${S.chatId}/chronicle?as=players`).catch(() => null);
    paintWorld();
  });
  $("#wdAsHost")?.addEventListener("click", () => { W.asPlayers = false; paintWorld(); });

  if (who !== "host" && W.tab === "offstage") W.tab = "time";
  for (const b of d.querySelectorAll(".wdtab")) {
    b.hidden = b.hasAttribute("data-hostonly") && who !== "host";
    const on = b.dataset.tab === W.tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }

  paintWaiting(who === "host" && W.tab === "time" ? (s.proposals ?? []).filter((p) => p.kind !== "scene" && p.kind !== "threat") : []);
  const view = who === "players" ? W.players : s;
  const body = $("#wdBody");
  if (W.tab === "time") body.innerHTML = timelineHtml(view, who);
  else if (W.tab === "bonds") body.innerHTML = bondsHtml(view);
  else if (W.tab === "threads") body.innerHTML = threadsHtml(view, who);
  else if (W.tab === "offstage") { paintOffstage(); return; }
  else body.innerHTML = factionsHtml(view, who);
  wireBody(who);
}

/** The moon over the date, from the calendar's own phase when it has one. */
function paintMoon(s) {
  const lit = $("#wdMoonLit");
  const cal = typeof s.calendar === "object" ? s.calendar : null;
  const moon = cal?.moon;
  if (!lit) return;
  if (!moon || !(moon.cycle > 0)) { lit.setAttribute("d", ""); return; }
  const phase = (((s.now.day - moon.offset) % moon.cycle) + moon.cycle) % moon.cycle / moon.cycle;
  // The lit part as two arcs: the limb, and a terminator whose bulge is the phase.
  const k = Math.cos(phase * 2 * Math.PI) * 13;
  const waxing = phase < 0.5;
  lit.setAttribute("d", `M17 4 A13 13 0 0 ${waxing ? 1 : 0} 17 30 A${Math.abs(k).toFixed(1)} 13 0 0 ${(k > 0) === waxing ? 0 : 1} 17 4 Z`);
}

function paintWaiting(list) {
  const box = $("#wdWaiting");
  box.hidden = !list.length;
  if (!list.length) return;
  box.innerHTML = `<div class="wdkicker">Waiting for you</div>` + list.map((p) => {
    const what = p.sealed ? "Something sealed"
      : p.kind === "faction" ? `A new faction: <b>${txt(p.title)}</b>${p.body ? ` — ${txt(p.body)}` : ""}`
      : p.kind === "time" ? `Time passing: <b>${txt(p.title)}</b>`
      : p.kind === "scene" ? `Move to the next scene? <b>${txt(p.title)}</b> seems to have reached its end.`
      : txt(p.title);
    const why = p.evidence ? `<div class="wdwhy">“${txt(p.evidence)}”</div>` : "";
    return `<div class="wdprop"><div>${what}${why}</div>
      <div class="wdpropbtns">
        <button type="button" class="ghost" data-accept="${p.id}">Yes</button>
        <button type="button" class="linkish" data-dismiss="${p.id}">No</button>
      </div></div>`;
  }).join("");
  for (const b of box.querySelectorAll("[data-accept]")) {
    b.onclick = async () => {
      await act(`/chronicle/${b.dataset.accept}/accept`);
      // A scene moved on: the tray's scene buttons and Chat settings follow.
      if (typeof refreshTaleNav === "function") refreshTaleNav();
    };
  }
  for (const b of box.querySelectorAll("[data-dismiss]")) b.onclick = () => act(`/chronicle/${b.dataset.dismiss}/undo`);
}

/** Something asked of the server that answers with the whole chronicle state. */
async function act(path, init = { method: "POST" }) {
  const r = await api(path, init).catch((e) => ({ error: e?.message ?? "That did not work." }));
  if (!r || r.error) return fail(r?.error ?? "That did not work.");
  W.state = r;
  await paintWorldLine();
  paintWorld();
  return r;
}

const post = (path, body) => act(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---- the timeline ----------------------------------------------------------

function timelineHtml(s, who) {
  if (!s) return "";
  const host = who === "host";
  const rows = (s.entries ?? s.events ?? []).filter((e) => e.sealed || e.kind === "event" || e.kind === "time" || e.kind === "set" || e.title);
  const items = rows.map((e) => {
    if (e.sealed) {
      return `<li class="wdsealed"><span class="wddot"></span><span>A sealed entry</span>
        ${host ? `<button type="button" class="linkish" data-reveal="${e.id}">Reveal to the table</button>` : ""}</li>`;
    }
    if (e.kind === "time") {
      return `<li class="wdpassed"><span>Time passes${e.title ? ` · ${txt(e.title)}` : ""}</span>${host ? undoBtn(e) : ""}</li>`;
    }
    if (e.kind === "set") return `<li class="wdpassed"><span>The date is set</span>${host ? undoBtn(e) : ""}</li>`;
    if (e.kind !== undefined && e.kind !== "event") return "";
    const when = e.when ?? "";
    return `<li class="wdevent"><span class="wddot"></span>
      <div class="wdev"><div class="wdevtitle">${txt(e.title)}</div>
        ${e.body ? `<div class="wdevbody">${txt(e.body)}</div>` : ""}
        ${when ? `<div class="wdwhen">${txt(when)}</div>` : ""}
        ${host ? `<div class="wdsrc">${sourceWord(e)}${e.visibility === "hidden" ? " · hidden" : ""}</div>` : ""}</div>
      ${host ? `<span class="wdrowbtns">${hideBtn(e)}${undoBtn(e)}</span>` : ""}</li>`;
  }).join("");
  const empty = !items ? `<p class="hint">Nothing has been recorded yet. The Steward writes things down as the story goes, or you can.</p>` : "";
  if (!host) return `<ol class="wdline">${items}</ol>${empty}`;
  // How the Steward is doing: why the date is or is not moving, said plainly, with a way to make it read now.
  const st = s.steward;
  const health = !st ? "" : !st.on
    ? `<div class="wdhealth off">The Steward is off, so the date and how everyone is change only when you change them. Turn it on in Story World settings → The Chronicle.</div>`
    : `<div class="wdhealth${st.last?.problem ? " bad" : ""}">${st.last?.problem
        ? `The Steward's last reading failed, so nothing new was written down: <i>${txt(st.last.problem)}</i>. Check its provider and model in Story World settings.`
        : st.unread ? `${st.unread} message${st.unread === 1 ? "" : "s"} since the Steward last read${st.next ? `; it reads again after ${st.next} more` : ""}.`
        : "The Steward is up to date."}
        ${st.unread ? `<button type="button" class="linkish" id="wdReadNow">Read now</button>` : ""}</div>`;
  return `${health}<ol class="wdline">${items}</ol>${empty}
    <div class="wdtools">
      <div class="wdrow"><span class="hint">Let time pass</span>
        <button type="button" class="wdround" data-pass="1 day">+1</button>
        <button type="button" class="wdround" data-pass="7 days">+7</button>
        <input type="text" id="wdPassText" placeholder="three days, until dawn" aria-label="How much time passes">
        <button type="button" class="ghost" id="wdPassGo">Pass</button></div>
      <div class="wdrow"><input type="text" id="wdEventText" placeholder="Something that happened" aria-label="Something that happened">
        <button type="button" class="ghost" id="wdEventGo">Record</button></div>
      <details class="wdmore"><summary>Calendar and records</summary>
        <label>Calendar <select id="wdCalendar"><option value="undated">Undated</option><option value="modern">Modern</option><option value="moons">The Reckoning of Moons</option><option value="custom">A calendar of my own…</option></select></label>
        <div class="wdrow"><button type="button" class="ghost" id="wdCalExport">Export this calendar</button>
          <label class="filebtn">Import a calendar<input type="file" id="wdCalImport" accept=".json" hidden></label></div>
        <div class="wdrow" id="wdSetDate"></div>
        <div class="wdrow"><button type="button" class="ghost" id="wdHistory">Build from this chat's history</button></div>
        <p class="hint">Reads the whole chat from the start and writes down what it finds. On a long chat that is many calls to the Steward's model.</p>
        <details class="wdlog" id="wdLogBox"><summary>What the Steward has done here</summary><div id="wdLog"></div></details>
      </details>
    </div>`;
}

const sourceWord = (e) => ({ steward: "the Steward", narrator: "the narrator", scene: "a scene played", user: "you" })[e.source] ?? "";
const undoBtn = (e) => `<button type="button" class="wdx" data-undo="${e.id}" title="Take this back" aria-label="Take this back"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
const hideBtn = (e) => (W.state?.shared
  ? e.visibility === "hidden"
    ? `<button type="button" class="linkish" data-reveal="${e.id}">Reveal</button>`
    : `<button type="button" class="linkish" data-hide="${e.id}">Hide</button>`
  : "");

// ---- bonds -----------------------------------------------------------------

function bondsHtml(s) {
  const bonds = s?.bonds ?? [];
  if (!bonds.length) return `<p class="hint">No bonds yet. They are recorded as the story shows people warming to or cooling on each other — one way round, so how he feels about her is its own line.</p>`;
  const me = s.seenFrom || S.personaName;
  const mine = bonds.filter((b) => b.from === me || b.to === me);
  return (mine.length ? constellation(me, mine) : "") +
    `<ul class="wdbonds">${bonds.map((b) => `<li>
      <div class="wdbondhead"><span>${txt(b.from)} <span class="wdarrow">→</span> ${txt(b.to)}</span><b>${b.score}</b></div>
      <div class="wdbar"><span style="width:${Math.max(3, b.score)}%" class="${b.score < 25 ? "cold" : ""}"></span></div>
      ${b.label ? `<div class="wdlabel">${txt(b.label)}</div>` : ""}
      ${b.memory ? `<div class="wdwhy">“${txt(b.memory)}”</div>` : ""}</li>`).join("")}</ul>`;
}

/** Up to five of the people closest to — or furthest from — you, around you. */
function constellation(me, bonds) {
  const others = new Map();
  for (const b of bonds) {
    const other = b.from === me ? b.to : b.from;
    const was = others.get(other);
    const score = b.from === me ? b.score : (was?.score ?? b.score);
    others.set(other, { name: other, score, label: was?.label || b.label });
  }
  const five = [...others.values()].sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50)).slice(0, 5);
  const R = 38;
  const nodes = five.map((o, i) => {
    const a = (-90 + i * (360 / five.length)) * Math.PI / 180;
    return { ...o, x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a) };
  });
  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return `<div class="wdstars" aria-label="Your closest bonds">
    <svg viewBox="0 0 100 100" aria-hidden="true">${nodes.map((n) =>
      `<line x1="50" y1="50" x2="${n.x}" y2="${n.y}" class="${n.score < 25 ? "cold" : ""}" stroke-width="${0.4 + n.score / 60}"/>`).join("")}</svg>
    <span class="wdstar me" style="left:50%;top:50%">${txt(initials(me))}</span>
    ${nodes.map((n) => `<span class="wdstar" style="left:${n.x}%;top:${n.y}%" title="${txt(n.name)} — ${n.score}">${txt(initials(n.name))}<em>${txt(n.name.split(" ")[0])} ${n.score}</em></span>`).join("")}
  </div>`;
}

// ---- threads ---------------------------------------------------------------

/**
 * The story threads a preset keeps, from the latest reply that has them. Read
 * from the transcript on screen, the same blocks app.js folds into a message.
 */
const THREAD_ICON = (open) => `<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M15 0c0 8-9 9-9 17s9 9 9 15"/>${open
  ? '<path d="M15 32l-4 6M15 32l0 7M15 32l4 6"/>' : '<circle cx="15" cy="34" r="3.6"/>'}</svg>`;

/** The latest <threads> block a preset wrote into the chat, as rows, or none. */
function presetThreads() {
  for (const m of [...$("#thread").querySelectorAll(".msg")].reverse()) {
    const block = (m.dataset.raw ?? "").match(/<threads\b[^>]*>([\s\S]*?)<\/threads\s*>/i);
    if (!block) continue;
    return block[1].replace(/<summary>[\s\S]*?<\/summary>/i, "").split("\n")
      .map((l) => l.trim().replace(/^[-*]\s*/, "")).filter((l) => l && !/^<\/?\w/.test(l))
      .map((l) => {
        const m2 = l.match(/^\[([^\]]+)\]\s*(.*)$/);
        return { title: m2 ? m2[2] : l, state: m2 ? m2[1] : "", open: !/resolv|closed|done|settled|tied/i.test(m2?.[1] ?? "") };
      });
  }
  return [];
}

/**
 * Loose ends: Hearth's own, which the Steward opens and settles as the story
 * goes and a person can add, settle or reopen; and, under them, whatever a
 * preset keeps in its replies, read as it wrote it.
 */
function threadsHtml(s, who) {
  const host = who === "host";
  const mine = s?.threads ?? [];
  const rows = mine.map((t) => `<li class="${t.open ? "open" : "tied"}">${THREAD_ICON(t.open)}
      <div><div class="wdthread">${txt(t.title)}</div><div class="wdwhen">${t.open ? "open" : "settled"}${!t.open && t.notes?.length ? ` — ${txt(t.notes.at(-1).text)}` : ""}</div></div>
      ${host ? `<button type="button" class="linkish" data-thread="${txt(t.key)}" data-open="${t.open ? "0" : "1"}">${t.open ? "Settle" : "Reopen"}</button>` : ""}
    </li>`).join("");
  const add = host ? `<div class="wdrow wdaddthread">
      <input type="text" id="wdThreadText" placeholder="Something left hanging" aria-label="A new thread">
      <button type="button" class="ghost" id="wdThreadGo">Add</button></div>` : "";
  const preset = GUEST.on ? [] : presetThreads();
  const fromPreset = preset.length ? `<div class="wdkicker">From your preset</div><ul class="wdthreads">${preset.map((t) =>
    `<li class="${t.open ? "open" : "tied"}">${THREAD_ICON(t.open)}<div><div class="wdthread">${txt(t.title)}</div>${t.state ? `<div class="wdwhen">${txt(t.state)}</div>` : ""}</div></li>`).join("")}</ul>` : "";
  const empty = !mine.length
    ? `<p class="hint">No threads yet. The Steward opens one when the story leaves something hanging — a promise, a secret, a letter not answered — and settles it when the story does${host ? ", or you can add one" : ""}.</p>`
    : "";
  return `${empty}${mine.length ? `<ul class="wdthreads">${rows}</ul>` : ""}${add}${fromPreset}`;
}

// ---- offstage -----------------------------------------------------------------

/**
 * The Living World's ledger: who wants what, what they did, and what reached
 * the narrator. Sealed by default — the point of an offstage is that you find
 * out by playing — but goals can be given and a day run without unsealing it.
 * Unsealing lasts until the window closes or you seal it again.
 */
async function paintOffstage() {
  const body = $("#wdBody");
  body.innerHTML = `<p class="hint">Reading the ledger…</p>`;
  const l = await api(`/chats/${S.chatId}/offstage`).catch(() => null);
  if (!l || l.error) { body.innerHTML = `<p class="hint">The ledger could not be read.</p>`; return; }
  const level = $("#offstage_level")?.value ?? "off";
  const active = l.goals.filter((g) => g.status === "active");
  const off = level === "off"
    ? `<p class="hint">The Living World is off, so nobody acts on their own. Turn it on in Story World → Living World; until then, a day can still be run by hand.</p>` : "";
  const people = l.people.map((p) => `<option value="${txt(p)}">`).join("");
  const addGoal = `<div class="wdkicker">Give someone a goal</div>
    <div class="wdoffadd">
      <input id="wdGoalWho" list="wdGoalPeople" placeholder="Who — Cersei Lannister" autocomplete="off">
      <datalist id="wdGoalPeople">${people}</datalist>
      <input id="wdGoalWhat" placeholder="What they want — stop the Hightower wedding">
      <input id="wdGoalWhy" placeholder="Why it matters to them (optional)">
      <button type="button" class="ghost" id="wdGoalAdd">Add the goal</button>
    </div>`;
  // How careful each person with a goal is: not a secret, so it is here whether the ledger is sealed or not.
  const MANNER = { careless: "Careless", ordinary: "Ordinary", careful: "Careful", masterful: "Masterful" };
  const schemers = [...new Set(active.map((g) => g.who))];
  const manner = schemers.length ? `<div class="wdkicker">How careful they are</div>
    <p class="hint">How often what they do leaves a trace someone could find. A master spy and a first-time thief are not alike.</p>
    <ul class="wdledger">${schemers.map((w) => `<li class="wdrow"><span>${txt(w)}</span>
      <select data-manner="${txt(w)}">${Object.entries(MANNER).map(([k, v]) => `<option value="${k}"${(l.discretion?.[w] ?? "ordinary") === k ? " selected" : ""}>${v}</option>`).join("")}</select></li>`).join("")}</ul>` : "";
  // The recap it takes as how things stand: not a secret, so shown sealed or not.
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  // Its last runs: when, and what came of each — or why nothing did. Kept across restarts; no spoilers in it.
  const KIND = { day: "A new day", midday: "A long day", manual: "Run by hand", death: "After a death", "manual stir": "Stirred by hand", stir: "Stirred" };
  const runs = (l.runs ?? []).map((r) => `<li><span class="wdwhen">${ago(r.created_at)} · ${txt(KIND[r.kind] ?? r.kind)}</span>
      <div>${r.problem ? `<span class="wdbad">Failed: ${txt(r.problem)}</span>`
        : [r.acted ? `${r.acted} ${r.acted === 1 ? "person" : "people"} took a turn` : "", r.goals ? `${r.goals} new goal${r.goals === 1 ? "" : "s"}` : "", r.note ? txt(r.note) : ""].filter(Boolean).join(" · ") || "Nobody moved."}</div></li>`).join("");
  const run = `<button type="button" class="solid wide" id="wdRunDay">Run a day offstage</button>
    <div class="wdoffadd wdstir">
      <input id="wdStirWhat" placeholder="What just happened? — King Robert is dead (optional)" autocomplete="off">
      <button type="button" class="ghost" id="wdStir">Stir the world</button>
    </div>
    <p class="hint">Something big happened? Stirring reads the story and gives the people it touches — at court, in the city, wherever the news reaches — something new to want. A death the Steward reads does this by itself.</p>
    <details class="wdlatest"${runs && (l.runs[0]?.problem || !l.runs.slice(0, 3).some((r) => r.acted || r.goals)) ? " open" : ""}><summary>Its last runs</summary>
      ${runs ? `<ul class="wdledger">${runs}</ul>` : `<p class="hint">It has not run in this chat yet.</p>`}</details>
    <details class="wdlatest"><summary>The recap it reads as now</summary>
      ${l.recap ? `<p><b>${txt(l.recap.name)}</b> <span class="wdwhen">${l.recap.at ? ago(l.recap.at) : "undated"}</span></p>
      <p class="wdwhen">${txt(l.recap.text)}${l.recap.text.length >= 400 ? "…" : ""}</p>` : `<p class="hint">No recap in this chat's lorebooks.</p>`}
      <p class="hint">Only the newest recap is read as how things stand; older ones are where the story stood once. Other lorebook entries come in when the scene names them. Mark which entries are recaps in the lorebook.</p></details>`;
  if (!W.ledgerOpen) {
    const did = l.actions.filter((a) => a.outcome !== "dropped" && a.outcome !== "routine").length;
    body.innerHTML = `${off}
      <div class="wdsealedledger">
        <div class="wdseal" aria-hidden="true">✦</div>
        <p><b>The ledger is sealed.</b> ${active.length ? `${active.length} goal${active.length === 1 ? "" : "s"} in play` : "Nobody has a goal yet"}${did ? `, and ${did} thing${did === 1 ? "" : "s"} done offstage` : ""}.</p>
        <p class="hint">What people plan and do when nobody is watching stays here. The story only learns what becomes true and what could be noticed — and you find the rest by playing.</p>
        <button type="button" class="linkish" id="wdUnseal">Unseal the ledger (spoilers)</button>
      </div>
      ${run}${addGoal}${manner}`;
  } else {
    const OUT = { succeeded: "it worked", failed: "it failed", routine: "an ordinary day", threat: "held as a scene", dropped: "not allowed" };
    // Active first; then what has ended, with what became of it and when it will be put away.
    const STATUS = { active: "active", achieved: "came to pass", abandoned: "given up", died: "ended with them" };
    const ordered = [...l.goals.filter((g) => g.status === "active"), ...l.goals.filter((g) => g.status !== "active")];
    const goals = ordered.map((g) => `<li class="${g.status}"><div><b>${txt(g.who)}</b> — ${txt(g.goal)}${g.why ? `<div class="wdwhen">${txt(g.why)}</div>` : ""}
        ${g.how ? `<div class="wdwhen">How: ${txt(g.how)}</div>` : ""}
        <div class="wdwhen">${txt(STATUS[g.status] ?? g.status)}${g.source === "offstage" ? " · their own idea" : ""}${g.leaves !== null && g.leaves !== undefined
          ? ` · ${g.status === "achieved" ? "into the lorebook" : "cleared"} ${g.leaves ? `in ${g.leaves} day${g.leaves === 1 ? "" : "s"}` : "soon"}` : ""}</div></div>
        <div class="wdgoaltools">${g.status === "active" ? `<button type="button" class="linkish" data-goaldone="${g.id}">Done</button>
          <button type="button" class="linkish" data-giveup="${g.id}">Give up</button>` : ""}
          <button type="button" class="linkish" data-goalrm="${g.id}">Remove</button></div></li>`).join("");
    const ended = l.goals.filter((g) => g.status !== "active").length;
    // The quiet days are one line, not a list: a world mostly living its life should read that way,
    // and a row of identical "an ordinary day"s buried the days anything happened.
    const quiet = l.actions.filter((a) => a.outcome === "routine");
    const quietLine = quiet.length ? `<li class="wdact quiet"><span class="wdwhen">Ordinary days</span>
        <div>${[...new Set(quiet.map((a) => a.who))].map(txt).join(", ")} went about their lives${quiet.length > 1 ? ` <span class="wdwhen">· ${quiet.length} quiet turns</span>` : ""}.</div></li>` : "";
    const acts = l.actions.filter((a) => a.outcome !== "routine").map((a) => `<li class="wdact">
        <div class="wdacthead"><span class="wdwhen">${txt(a.when)} · <b>${txt(a.who)}</b></span><span class="wdoutcome ${a.outcome}">${OUT[a.outcome] ?? ""}</span></div>
        <div class="wdactwhat">${txt(a.what)}</div>
        <div class="wdwhen">${a.roll ? `rolled ${a.roll} against ${a.dc}` : ""}${a.trace_roll ? (a.traced ? ` · left a trace (${a.trace_roll} under ${a.trace_dc})` : " · left no trace") : ""}</div>
        ${a.traced && a.clue ? `<div class="wdwhen">The trace: ${txt(a.clue)}</div>` : ""}
        ${a.plan?.length ? a.plan.map((p) => `<div class="wdwhen">Your plan — ${txt(p.relation)} “${txt(p.title)}”${p.how ? `: ${txt(p.how)}` : ""}</div>`).join("") : ""}
        ${a.why ? `<div class="wdwhy">“${txt(a.why)}”</div>` : ""}
        ${a.considered?.length ? `<details><summary>What they weighed</summary><ul>${a.considered.map((c) => `<li>${txt(c.option)}${c.stakes ? ` — <i>${txt(c.stakes)}</i>` : ""}</li>`).join("")}</ul>${a.want ? `<p class="hint">Wanted: ${txt(a.want)}${a.fear ? `; afraid of: ${txt(a.fear)}` : ""}</p>` : ""}</details>` : ""}
        ${a.lore?.length ? `<div class="wdwhen">Drew on the lorebook: ${txt(a.lore.join(", "))}</div>` : ""}
        ${a.notes?.length ? `<div class="wdwhen">Held back: ${txt(a.notes.join("; "))}</div>` : ""}</li>`).join("") + quietLine;
    const MOVE = { open: "began", advance: "moved on", complicate: "grew harder", settle: "settled" };
    const threads = (l.threads ?? []).map((t) => `<li><div><b>${txt(t.title)}</b></div>
        <div class="wdwhen">${t.hidden ? "out of sight — the story does not know of it" : "a thread the story has"} · ${t.open ? "open" : "settled"}</div>
        ${t.notes.length ? `<ul>${t.notes.map((n) => `<li><span class="wdwhen">${txt(n.when)}${n.by ? ` · ${txt(n.by)}` : ""} · ${MOVE[n.move] ?? txt(n.move)}</span> ${txt(n.text)}</li>`).join("")}</ul>` : ""}</li>`).join("");
    const HOW = { saw: "saw", found: "found", told: "was told" };
    const whispers = (l.whispers ?? []).map((k) => `<li><div><b>${txt(k.holder)}</b> ${HOW[k.source] ?? ""}${k.from ? ` by ${txt(k.from)}` : ""}: “${txt(k.version)}”</div>
        <div class="wdwhen">${k.distortion ? `${k.distortion}% garbled` : "as it was"}${k.blames ? ` · blames ${txt(k.blames)}` : ""} · ${k.by.includes(k.holder) ? "it is about them" : k.spreads ? "will pass it on" : "keeps it to themselves"}</div></li>`).join("");
    const told = [...l.told.facts.map((f) => `<li>True now: ${txt(f.text)}</li>`), ...l.told.hooks.map((h) => `<li>Could be noticed: ${txt(h.text)}</li>`)].join("");
    body.innerHTML = `${off}
      <div class="wdrow wdledgerbar"><span class="wdkicker">The ledger</span><button type="button" class="linkish" id="wdReseal">Seal it again</button></div>
      ${run}
      <div class="wdrow"><span class="wdkicker">Goals</span>${ended ? `<button type="button" class="linkish" id="wdClearGoals">Clear ${ended} ended</button>` : ""}</div>
      ${goals ? `<ul class="wdledger">${goals}</ul>` : `<p class="hint">None yet.</p>`}
      ${addGoal}${manner}
      ${threads ? `<div class="wdkicker">Threads, behind the scenes</div><ul class="wdledger">${threads}</ul>` : ""}
      ${whispers ? `<div class="wdkicker">Who knows what</div><ul class="wdledger">${whispers}</ul>` : ""}
      <div class="wdkicker">What the story has been told</div>${told ? `<ul class="wdledger">${told}</ul>` : `<p class="hint">Nothing yet.</p>`}
      ${l.problem ? `<div class="wdhealth bad">The Offstage's last run failed, so nobody moved: <i>${txt(l.problem)}</i> If this keeps happening, try a different model under Story World settings → Living World → ⚙ The Offstage's model.</div>` : ""}
      <div class="wdkicker">What they did</div>${acts ? `<ul class="wdledger">${acts}</ul>` : `<p class="hint">Nothing yet.</p>`}`;
  }
  $("#wdUnseal")?.addEventListener("click", () => { W.ledgerOpen = true; paintOffstage(); });
  for (const sel of body.querySelectorAll("[data-manner]")) {
    sel.onchange = () => api(`/chats/${S.chatId}/offstage/trait`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ who: sel.dataset.manner, discretion: sel.value }) }).catch(() => toast("That could not be saved."));
  }
  $("#wdReseal")?.addEventListener("click", () => { W.ledgerOpen = false; paintOffstage(); });
  const goalCall = (url, init) => api(url, init).catch(() => ({ error: "That could not be saved." })).then((r) => { if (r?.error) toast(r.error); paintOffstage(); });
  for (const b of body.querySelectorAll("[data-goaldone]")) {
    b.onclick = () => goalCall(`/chats/${S.chatId}/offstage/goal/${b.dataset.goaldone}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "achieved" }) });
  }
  for (const b of body.querySelectorAll("[data-goalrm]")) {
    b.onclick = () => goalCall(`/chats/${S.chatId}/offstage/goal/${b.dataset.goalrm}`, { method: "DELETE" });
  }
  $("#wdClearGoals")?.addEventListener("click", () => goalCall(`/chats/${S.chatId}/offstage/goals/clear`, { method: "POST" }));
  for (const b of body.querySelectorAll("[data-giveup]")) {
    b.onclick = async () => { await api(`/chats/${S.chatId}/offstage/goal/${b.dataset.giveup}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "abandoned" }) }); paintOffstage(); };
  }
  $("#wdGoalAdd").onclick = async () => {
    const who = $("#wdGoalWho").value.trim(), goal = $("#wdGoalWhat").value.trim();
    if (!who || !goal) return toast("A goal needs someone, and what they want.");
    const r = await api(`/chats/${S.chatId}/offstage/goal`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ who, goal, why: $("#wdGoalWhy").value.trim() }) });
    if (r?.error) return toast(r.error);
    toast(`${who} has a goal now.`);
    paintOffstage();
  };
  $("#wdStir").onclick = async () => {
    const b = $("#wdStir");
    b.disabled = true;
    b.textContent = "The news spreads…";
    const r = await api(`/chats/${S.chatId}/offstage/stir`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ what: $("#wdStirWhat").value.trim() }) }).catch(() => ({ error: "That did not work." }));
    if (r?.error) toast(r.error);
    else toast(r.goals ? `${r.goals} ${r.goals === 1 ? "person has" : "people have"} something new to want.` : r.note || "Nobody's wants changed.");
    paintOffstage();
  };
  $("#wdRunDay").onclick = async () => {
    const b = $("#wdRunDay");
    b.disabled = true;
    b.textContent = "The day goes by offstage…";
    const r = await api(`/chats/${S.chatId}/offstage/run`, { method: "POST" }).catch(() => ({ error: "That did not work." }));
    // Said without spoiling: how many did something, not what.
    if (r?.error) toast(r.error);
    else if (r.note) toast(r.note);
    else toast(r.acted || r.threats ? `${r.acted + r.threats} ${r.acted + r.threats === 1 ? "person" : "people"} did something offstage.`
      : "A quiet day: nobody did anything out of the ordinary.");
    await paintWorldLine();
    paintOffstage();
  };
}

// ---- factions ----------------------------------------------------------------

function factionsHtml(s, who) {
  const list = s?.factions ?? [];
  const host = who === "host";
  const shields = list.map((f) => `<button type="button" class="wdfaction" data-faction="${f.key}">
      ${GUEST.on ? `<span class="wdnoarms" aria-hidden="true">⚑</span>`
        : `<img src="/api/chats/${S.chatId}/factions/${f.key}/arms.svg" alt="" loading="lazy">`}
      <span>${txt(f.name)}</span></button>`).join("");
  const add = host ? `<button type="button" class="ghost" id="wdNewFaction">A new faction</button>` : "";
  if (!list.length) return `<p class="hint">No factions yet. The Steward suggests them when the story names a house, a guild or an order, and you say yes — or you can make one.</p>${add}`;
  return `<div class="wdshields">${shields}</div><div id="wdFactionDetail"></div>${add}`;
}

function factionDetail(key, who) {
  const s = who === "players" ? W.players : W.state;
  const f = s?.factions?.find((x) => x.key === key);
  const box = $("#wdFactionDetail");
  if (!f || !box) return;
  const table = document.body.dataset.mode === "tabletop";
  box.innerHTML = `<div class="wdfdetail">
    <h3>${txt(f.name)}</h3>
    ${f.description ? `<p>${txt(f.description)}</p>` : ""}
    ${f.members?.length ? `<p class="wdwhen">${f.members.map(txt).join(" · ")}</p>` : ""}
    ${table ? `<p class="wdstanding ${f.standing < 0 ? "down" : "up"}">The party's standing: <b>${f.standing > 0 ? "+" : ""}${f.standing}</b></p>` : ""}
    ${who === "host" ? `<div class="wdrow"><button type="button" class="ghost" data-edit="${f.key}">Edit</button>
      ${table ? `<button type="button" class="wdround" data-stand="${f.key}" data-amount="10" aria-label="Standing up">+</button>
      <button type="button" class="wdround" data-stand="${f.key}" data-amount="-10" aria-label="Standing down">−</button>` : ""}</div>` : ""}
  </div>`;
  box.querySelector("[data-edit]")?.addEventListener("click", () => factionEditor(f));
  for (const b of box.querySelectorAll("[data-stand]")) {
    b.onclick = () => post(`/chats/${S.chatId}/chronicle`, { kind: "standing", key: b.dataset.stand, amount: Number(b.dataset.amount) });
  }
}

const TINCTURES = [["or", "Gold"], ["argent", "Silver"], ["gules", "Red"], ["azure", "Blue"], ["vert", "Green"], ["sable", "Black"], ["purpure", "Purple"]];
const SPLITS = [["none", "Plain"], ["per_pale", "Split down the middle"], ["per_fess", "Split across"], ["per_bend", "Split on the diagonal"], ["quarterly", "Quartered"]];
const BANDS = [["", "No band"], ["chief", "A band across the top"], ["fess", "A band across the middle"], ["pale", "A band down the middle"], ["bend", "A diagonal band"], ["chevron", "A chevron"], ["cross", "A cross"], ["saltire", "A saltire"], ["bordure", "A border"]];

async function factionEditor(f) {
  W.charges ??= await fetch("/charges/manifest.json").then((r) => r.json()).then((m) => m.assets).catch(() => []);
  const own = await api("/charges/own").catch(() => null);
  W.own = own?.charges ?? [];
  W.guide = own?.guide?.text ?? "";
  const arms = f?.arms ?? {};
  const opts = (list, val) => list.map(([v, l]) => `<option value="${v}"${v === val ? " selected" : ""}>${l}</option>`).join("");
  const box = $("#wdFactionDetail") ?? $("#wdBody");
  const charge = arms.charge?.type ?? "";
  box.innerHTML = `<form class="wdfedit" id="wdFEdit">
    <label>Name <input name="name" required maxlength="80" value="${txt(f?.name ?? "")}"></label>
    <label>What they are <input name="description" maxlength="200" value="${txt(f?.description ?? "")}"></label>
    <label>Members <input name="members" placeholder="Separated by commas" value="${txt((f?.members ?? []).join(", "))}"></label>
    <fieldset><legend>Arms</legend>
      <label>Field <select name="split">${opts(SPLITS, arms.field?.split ?? "none")}</select></label>
      <div class="wdrow"><label>Colour <select name="c1">${opts(TINCTURES, arms.field?.colours?.[0] ?? "azure")}</select></label>
        <label>Second colour <select name="c2">${opts(TINCTURES, arms.field?.colours?.[1] ?? "or")}</select></label></div>
      <div class="wdrow"><label>Band <select name="band">${opts(BANDS, arms.band?.type ?? "")}</select></label>
        <label>Band colour <select name="bandc">${opts(TINCTURES, arms.band?.colour ?? "argent")}</select></label></div>
      <div class="wdrow"><label>Emblem colour <select name="chargec">${opts(TINCTURES, arms.charge?.colour ?? "or")}</select></label>
        <label>How many <select name="count">${opts([["1", "One"], ["2", "Two"], ["3", "Three"]], String(arms.charge?.count ?? 1))}</select></label></div>
      <input type="hidden" name="charge" value="${txt(charge)}">
      <div class="wdcharges" role="listbox" aria-label="Emblem">
        <button type="button" role="option" class="wdcharge none${charge ? "" : " on"}" data-charge="" aria-label="No emblem" aria-selected="${!charge}">—</button>
        ${W.own.map((c) => `<button type="button" role="option" class="wdcharge own${c.id === charge ? " on" : ""}" data-charge="${c.id}"
          title="${txt(c.name)} (yours)" aria-label="${txt(c.name)}, your own" aria-selected="${c.id === charge}"
          style="--charge:url('${encodeURI(c.url)}')"></button>`).join("")}
        ${W.charges.map((c) => `<button type="button" role="option" class="wdcharge${c.id === charge ? " on" : ""}" data-charge="${c.id}"
          title="${txt(c.name)}" aria-label="${txt(c.name)}" aria-selected="${c.id === charge}"
          style="--charge:url('/charges/${c.svg}')"></button>`).join("")}
      </div>
      <div class="wdownrow">
        <label class="filebtn">Upload your own emblem<input type="file" id="wdOwnFile" accept="image/png" hidden></label>
        <button type="button" class="linkish danger" id="wdOwnGone" ${W.own.some((c) => c.id === charge) ? "" : "hidden"}>Remove this one of yours</button>
      </div>
      <p class="hint">${txt(W.guide)}</p>
      <p class="hint">Gold and silver go on colours, colours on gold and silver — a shield that breaks that is corrected, unless the rule is switched off in Behavior.</p>
    </fieldset>
    <div class="wdrow"><button type="submit" class="solid">Save</button>
      ${f?.key ? `<button type="button" class="linkish danger" id="wdFGone">Retire this faction</button>` : ""}
      <button type="button" class="linkish" id="wdFCancel">Cancel</button></div>
  </form>`;
  const form = $("#wdFEdit");
  for (const b of form.querySelectorAll(".wdcharge")) {
    b.onclick = () => {
      form.charge.value = b.dataset.charge;
      for (const x of form.querySelectorAll(".wdcharge")) { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b ? "true" : "false"); }
      $("#wdOwnGone").hidden = !b.classList.contains("own");
    };
  }
  // What has been typed so far survives the editor being drawn again.
  const keep = () => {
    const v = Object.fromEntries(new FormData(form));
    return { ...f, name: v.name, description: v.description,
      members: String(v.members).split(",").map((m) => m.trim()).filter(Boolean),
      arms: { field: { split: v.split, colours: [v.c1, v.c2] }, band: v.band ? { type: v.band, colour: v.bandc } : null,
        charge: v.charge ? { type: v.charge, colour: v.chargec, count: Number(v.count) } : null } };
  };
  $("#wdOwnFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/charges/own", { method: "POST", body: fd }).then((x) => x.json()).catch(() => ({ error: "The upload did not go through." }));
    if (r.error) return toast(r.error);
    const next = keep();
    next.arms.charge = { type: r.id, colour: next.arms.charge?.colour ?? "or", count: next.arms.charge?.count ?? 1 };
    factionEditor(next);
  };
  $("#wdOwnGone").onclick = async () => {
    const id = form.charge.value;
    if (!confirm("Remove this emblem of yours? Any faction wearing it is left with a plain shield.")) return;
    const r = await api(`/charges/own/${id}`, { method: "DELETE" });
    if (r?.error) return toast(r.error);
    const next = keep();
    next.arms.charge = null;
    factionEditor(next);
  };
  $("#wdFCancel").onclick = () => paintWorld();
  $("#wdFGone")?.addEventListener("click", () => post(`/chats/${S.chatId}/chronicle`, { kind: "faction", key: f.key, gone: true }));
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    post(`/chats/${S.chatId}/chronicle`, {
      kind: "faction", key: f?.key, name: v.name, description: v.description,
      members: String(v.members).split(",").map((m) => m.trim()).filter(Boolean),
      arms: {
        field: { split: v.split, colours: v.split === "none" ? [v.c1] : [v.c1, v.c2] },
        band: v.band ? { type: v.band, colour: v.bandc } : null,
        charge: v.charge ? { type: v.charge, colour: v.chargec, count: Number(v.count) } : null,
      },
    });
  };
}

// ---- wiring the page's buttons -------------------------------------------------

function wireBody(who) {
  const body = $("#wdBody");
  for (const b of body.querySelectorAll("[data-undo]")) b.onclick = () => act(`/chronicle/${b.dataset.undo}/undo`);
  for (const b of body.querySelectorAll("[data-reveal]")) b.onclick = () => act(`/chronicle/${b.dataset.reveal}/reveal`);
  for (const b of body.querySelectorAll("[data-hide]")) b.onclick = () => act(`/chronicle/${b.dataset.hide}/hide`);
  for (const b of body.querySelectorAll("[data-pass]")) b.onclick = () => post(`/chats/${S.chatId}/chronicle`, { kind: "time", text: b.dataset.pass });
  for (const b of body.querySelectorAll("[data-faction]")) b.onclick = () => factionDetail(b.dataset.faction, who);
  $("#wdNewFaction")?.addEventListener("click", () => factionEditor(null));
  for (const b of body.querySelectorAll("[data-thread]")) {
    b.onclick = () => post(`/chats/${S.chatId}/chronicle`, { kind: "thread", key: b.dataset.thread, open: b.dataset.open === "1" });
  }
  const addThread = () => {
    const t = $("#wdThreadText")?.value.trim();
    if (t) post(`/chats/${S.chatId}/chronicle`, { kind: "thread", name: t });
  };
  $("#wdThreadGo")?.addEventListener("click", addThread);
  $("#wdThreadText")?.addEventListener("keydown", (e) => { if (e.key === "Enter") addThread(); });

  $("#wdPassGo")?.addEventListener("click", () => {
    const t = $("#wdPassText").value.trim();
    if (t) post(`/chats/${S.chatId}/chronicle`, { kind: "time", text: t });
  });
  $("#wdEventGo")?.addEventListener("click", () => {
    const t = $("#wdEventText").value.trim();
    if (t) post(`/chats/${S.chatId}/chronicle`, { kind: "event", title: t });
  });

  const cal = $("#wdCalendar");
  if (cal) {
    const current = W.state?.calendar;
    cal.value = current?.id === "modern" || current?.id === "moons" || current?.kind === "undated" ? (current.kind === "undated" ? "undated" : current.id) : "custom";
    cal.onchange = () => {
      if (cal.value === "custom") return $("#wdCalImport").click();
      act(`/chats/${S.chatId}/calendar`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cal.value }) });
    };
    paintSetDate();
  }
  $("#wdCalImport")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    let j;
    try { j = JSON.parse(await file.text()); } catch { return fail("That file is not a calendar."); }
    if (j?.hearth !== "calendar") return fail("That file is not a Hearth calendar.");
    act(`/chats/${S.chatId}/calendar`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ calendar: j }) });
  });
  $("#wdCalExport")?.addEventListener("click", () => {
    const c = W.state?.calendar;
    if (!c) return;
    const blob = new Blob([JSON.stringify({ hearth: "calendar", v: 1, ...c }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(c.name || "calendar").replace(/[^\w -]+/g, "")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#wdHistory")?.addEventListener("click", async () => {
    if (!confirm("Read this whole chat from the start and write down what happened? On a long chat this is many calls to the Steward's model.")) return;
    const b = $("#wdHistory");
    b.disabled = true;
    b.textContent = "Reading the chat…";
    const r = await post(`/chats/${S.chatId}/steward/history`, {});
    b.disabled = false;
    b.textContent = "Build from this chat's history";
    if (r && !r.error) toast(`Read in ${r.runs} stretch${r.runs === 1 ? "" : "es"}: ${r.kept} kept${r.failed ? `, ${r.failed} could not be read` : ""}.`);
  });
  $("#wdReadNow")?.addEventListener("click", async () => {
    const b = $("#wdReadNow");
    b.disabled = true;
    b.textContent = "Reading…";
    const r = await post(`/chats/${S.chatId}/steward/now`, {});
    if (r?.read?.problem) toast(`It could not read: ${r.read.problem}`);
    else if (r?.read) toast(`Read: ${r.read.kept} written down${r.read.proposed ? `, ${r.read.proposed} waiting for you` : ""}.`);
    else if (r?.note) toast(r.note);
  });
  $("#wdLogBox")?.addEventListener("toggle", async (e) => {
    if (!e.target.open) return;
    const runs = await api(`/chats/${S.chatId}/steward`).catch(() => []);
    $("#wdLog").innerHTML = runs.length ? runs.map((r) => `<div class="wdrun">
      <div><b>${r.kept}</b> kept${r.proposed ? `, <b>${r.proposed}</b> waiting` : ""}${r.dropped.length ? `, ${r.dropped.length} thrown out` : ""}
        <span class="wdwhen"> · ${new Date(r.created_at).toLocaleString()} · ${txt(r.model)}</span></div>
      ${r.problem ? `<div class="wdwhy">${txt(r.problem)}</div>` : ""}
      ${r.dropped.map((d) => `<div class="wddrop">${txt(d.why)}: <code>${txt(d.line)}</code></div>`).join("")}
    </div>`).join("") : `<p class="hint">The Steward has not read this chat yet.</p>`;
  });
}

/** Setting the date, in the chat's own calendar: day, month and year, or just the day for an undated story. */
function paintSetDate() {
  const box = $("#wdSetDate");
  const cal = W.state?.calendar;
  if (!box || !cal) return;
  if (cal.kind === "undated") {
    box.innerHTML = `<label>It is day <input type="number" min="1" id="wdDayN" value="${(W.state.now.day ?? 0) + 1}"></label>
      <button type="button" class="ghost" id="wdSetGo">Set</button>`;
    $("#wdSetGo").onclick = () => post(`/chats/${S.chatId}/chronicle`, { kind: "set", day: Number($("#wdDayN").value) - 1, minute: W.state.now.minute });
    return;
  }
  box.innerHTML = `<label>Day <input type="number" min="1" id="wdD" value="1"></label>
    <label>Month <select id="wdM">${cal.months.map((m, i) => `<option value="${i}">${txt(m.name)}</option>`).join("")}</select></label>
    <label>Year <input type="number" id="wdY" value="${cal.firstYear ?? 1}"></label>
    <button type="button" class="ghost" id="wdSetGo">Set the date</button>`;
  $("#wdSetGo").onclick = () => post(`/chats/${S.chatId}/chronicle`, {
    kind: "set", date: { year: Number($("#wdY").value), month: Number($("#wdM").value), day: Number($("#wdD").value) },
  });
}

// ---- settings: everything Story World, in its own panel -------------------------

/**
 * One panel for all of it — Story World, the Steward, the Living World, the
 * Apocrypha, arms — with one switch at the top that turns the lot off, for
 * plain story chats with nothing kept and nothing extra in the prompt. Saved
 * the way the rest of Hearth's settings are: to /settings, shortly after a change.
 */
const WORLD_KEYS = ["story_world", "steward_provider", "steward_model", "steward_on", "steward_every", "steward_ask_days", "tracker_source",
  "heraldry_contrast", "heraldry_style", "apocrypha_blind", "offstage_level", "offstage_protection", "offstage_per_day",
  "offstage_provider", "offstage_model", "gossip_level", "gossip_distortion", "gossip_misinfo", "gossip_decay",
  "offstage_threat_ask", "show_trackers", "tracker_keep", "goal_archive"];
const WORLD_CHECKS = new Set(["story_world", "steward_on", "heraldry_contrast", "apocrypha_blind", "gossip_misinfo",
  "offstage_threat_ask", "show_trackers", "goal_archive"]);

/** Whether Story World is on at all; until the settings are read, it is. */
const worldOn = () => W.enabled !== false;

/*
 * The panel's pieces. Every control keeps the id of the setting it is, so
 * saving is the same whatever it looks like: a row of pills is a <select>
 * underneath, a switch is a checkbox, a slider is a range.
 */
const SW_ICON = {
  world: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><path d="M14.6 9.4 13 13l-3.6 1.6L11 11z"/>',
  chronicle: '<path d="M6 3.5h9l3 3V20.5H6z"/><path d="M15 3.5v3h3"/><path d="M9 10h6M9 13.5h6M9 17h4"/>',
  living: '<circle cx="8" cy="9" r="2.6"/><circle cx="16" cy="9" r="2.6"/><path d="M3.5 19c.6-3 2.4-4.6 4.5-4.6s3.9 1.6 4.5 4.6M11.5 19c.6-3 2.4-4.6 4.5-4.6s3.9 1.6 4.5 4.6"/>',
  whispers: '<path d="M4 6.5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="M19 9.5h1a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-.5v2.5l-3-2.5"/>',
  apocrypha: '<path d="M4 5.5c2.8-1 5.4-1 8 .8 2.6-1.8 5.2-1.8 8-.8V19c-2.8-1-5.4-1-8 .8-2.6-1.8-5.2-1.8-8-.8z"/><path d="M12 6.3v13.5"/>',
  arms: '<path d="M12 3.5 19.5 6v6c0 4.4-3.2 7.6-7.5 9-4.3-1.4-7.5-4.6-7.5-9V6z"/><path d="M12 8.5v8M8.5 12h7"/>',
};
const swIcon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SW_ICON[k]}</svg>`;
const swSwitch = (id, title, hint = "") => `<label class="swswitch"><span class="swtext"><b>${title}</b>${hint ? `<small>${hint}</small>` : ""}</span>
  <input type="checkbox" id="${id}" role="switch"><span class="swknob" aria-hidden="true"></span></label>`;
const swSlider = (id, title, min, max, step = 1) => `<label class="swslider"><span class="swtext"><b>${title}</b><em id="v_${id}"></em></span>
  <input type="range" id="${id}" min="${min}" max="${max}" step="${step}"></label>`;
/** A short choice as a row of pills, each with the sentence that says what it means under the row. */
const swPills = (id, title, options) => `<div class="swfield"><span class="swtext"><b>${title}</b></span>
  <div class="swpills" role="radiogroup" data-for="${id}">${options.map(([v, label]) => `<button type="button" role="radio" data-v="${v}">${label}</button>`).join("")}</div>
  <select id="${id}" hidden>${options.map(([v, label]) => `<option value="${v}">${label}</option>`).join("")}</select>
  <small class="swsays" data-says="${id}">${options.map(([v, , says]) => `<span data-v="${v}">${says ?? ""}</span>`).join("")}</small></div>`;
const swCard = (key, title, sub, body, open = false) => `<details class="swcard" data-card="${key}"${open ? " open" : ""}>
  <summary><span class="swbadge">${swIcon(key)}</span><span class="swhead"><b>${title}</b><small>${sub}</small></span>
    <span class="swchip" data-chip="${key}"></span></summary>
  <div class="swbody">${body}</div></details>`;

/** What each card says about itself while shut: the one thing worth knowing at a glance. */
function paintWorldChips() {
  const v = (id) => $("#" + id);
  if (!v("story_world")) return;
  const label = (id) => v(id)?.selectedOptions?.[0]?.textContent ?? "";
  const chip = (k, text) => { const c = document.querySelector(`[data-chip="${k}"]`); if (c) c.textContent = text; };
  chip("chronicle", v("steward_on").checked ? `Every ${v("steward_every").value}` : "By hand");
  chip("living", label("offstage_level"));
  chip("whispers", label("gossip_level"));
  chip("apocrypha", v("apocrypha_blind").checked ? "Blind" : "Open book");
  chip("arms", label("heraldry_style"));
  const on = v("story_world").checked;
  $("#swState").textContent = on ? "Story World is on" : "Story World is off";
  document.querySelector(".swhero")?.classList.toggle("off", !on);
  $("#swSummary").textContent = !on ? "Off — plain story chats, nothing kept, nothing extra sent."
    : [v("steward_on").checked ? `the Steward reads every ${v("steward_every").value}` : "records kept by hand",
       v("offstage_level").value === "off" ? "the world waits for you" : `the world moves (${label("offstage_level").toLowerCase()})`,
       v("gossip_level").value === "off" ? "no gossip" : `${label("gossip_level").toLowerCase()} gossip`].join(" · ");
  for (const box of document.querySelectorAll("#worldSettings .swpills")) {
    const sel = v(box.dataset.for);
    for (const b of box.children) b.setAttribute("aria-checked", String(b.dataset.v === sel.value));
    for (const say of document.querySelectorAll(`[data-says="${box.dataset.for}"] span`)) say.hidden = say.dataset.v !== sel.value;
  }
}

async function paintWorldSettings() {
  if (GUEST.on) return;
  const s = await api("/settings").catch(() => null);
  if (!s) return;
  W.enabled = s.story_world !== "0";
  const box = $("#worldSettings");
  if (box && !$("#story_world")) {
    const providers = (none) => `<option value="">${none}</option>` +
      Object.entries(s.providers ?? {}).map(([id, m]) => `<option value="${id}">${txt(m.label)}</option>`).join("");
    const model = (who, fallback) => `<details class="swmore"><summary>${who}'s model</summary>
      <label class="swplain">Provider <select id="${who === "The Steward" ? "steward" : "offstage"}_provider">${providers(fallback)}</select></label>
      <label class="swplain">Model <input id="${who === "The Steward" ? "steward" : "offstage"}_model" type="text" autocomplete="off" spellcheck="false" placeholder="${fallback}"></label>
      <small class="swsays">${who === "The Steward" ? "Something cheaper than the storyteller is fine — it only takes notes." : "It makes decisions, so a little more thought pays off here."} Uses the key saved for that provider in Connection.</small></details>`;
    box.innerHTML = `
      <div class="swhero">
        <span class="swbadge big">${swIcon("world")}</span>
        <span class="swhead"><b id="swState">Story World is on</b><small id="swSummary"></small></span>
        <label class="swswitch bare" title="Story World on or off"><input type="checkbox" id="story_world" role="switch"><span class="swknob" aria-hidden="true"></span></label>
      </div>
      <div id="worldParts">
      ${swCard("chronicle", "The Chronicle", "The date, what happened, how everyone is", `
        ${swSwitch("steward_on", "The Steward keeps the records", "A quiet second model reads the story and writes down what it shows — checked against the story's own words.")}
        ${swSlider("steward_every", "Reads again after", 2, 40)}
        <label class="swplain">When a lot of time passes at once
          <select id="steward_ask_days"><option value="0">Always ask me first</option><option value="1">Ask above a day</option>
            <option value="3">Ask above three days</option><option value="7">Ask above a week</option>
            <option value="30">Ask above a month</option><option value="-1">Never ask</option></select></label>
        ${swPills("tracker_source", "Who tracks how everyone is", [
          ["hearth", "Hearth", "Hearth's own tracker, kept by the Steward and shown on the portraits."],
          ["preset", "My preset", "Your preset's sheets instead; Hearth keeps none of its own."]])}
        ${swSwitch("show_trackers", "Show tracker sheets in replies", "The @Status and &lt;status&gt; blocks a preset has the model write. Off, replies read as just the scene.")}
        ${swSlider("tracker_keep", "Sheets sent to the model", 1, 31)}
        <small class="swsays">Older sheets leave what is sent, so the model is not told how everyone was ten replies ago. The chat keeps them.</small>
        ${model("The Steward", "The same as the story")}`, true)}
      ${swCard("living", "Living World", "People act on their own, offstage", `
        ${swPills("offstage_level", "How alive", [
          ["off", "Still", "Nobody acts unless you run a day by hand."],
          ["balanced", "Balanced", "Someone offstage does something now and then — each new day, and in long scenes."],
          ["dynamic", "Dynamic", "Up to three people a turn: a busier, less predictable world."]])}
        ${swPills("offstage_protection", "Protecting your character", [
          ["sheltered", "Sheltered", "Only their name and standing can be harmed offstage."],
          ["fair", "Fair", "Anything — but harm to body or freedom always comes as a scene you can play."],
          ["grim", "Grim", "Injury can happen offstage; death and maiming are still always scenes."]])}
        ${swSlider("offstage_per_day", "Most things done offstage in a day", 1, 6)}
        ${swSwitch("offstage_threat_ask", "Ask me before danger comes in", "Off, a threat simply arrives in the next reply.")}
        ${swSwitch("goal_archive", "Put finished goals away", "Three days after a goal ends: one that came to pass becomes a lorebook entry in this chat's book — which the narrator can then read — and the rest are cleared from the ledger.")}
        ${model("The Offstage", "The same as the Steward")}`)}
      ${swCard("whispers", "Whispers &amp; Rumours", "Who saw what, and who told whom", `
        ${swPills("gossip_level", "How much people talk", [
          ["off", "Off", "What someone knows stays with them."],
          ["natural", "Natural", "Gossip happens now and then, along friendships."],
          ["court", "Court", "Information is currency; it travels fast."],
          ["chaotic", "Chaotic", "Everyone talks, and much of it is wrong."]])}
        ${swSlider("gossip_distortion", "Changes in the telling", 0, 50, 5)}
        ${swSwitch("gossip_misinfo", "Rumours can blame the wrong person", "Never the one who did it, and never your character.")}
        ${swSlider("gossip_decay", "Stops going around after", 2, 30)}`)}
      ${swCard("apocrypha", "Apocrypha", "The stories you plan", `
        ${swSwitch("apocrypha_blind", "Play blind", "A chat shows only the scenes already reached. The shelf still opens the whole book, for writing it.")}`)}
      ${swCard("arms", "Arms", "Coats of arms for houses and factions", `
        ${swSwitch("heraldry_contrast", "Keep shields readable", "The rule of tincture: no colour on colour.")}
        ${swPills("heraldry_style", "Draw arms as", [
          ["auto", "Auto", "Shields, or badges in a modern story."], ["shield", "Shields", "Always shields."], ["badge", "Badges", "Always badges."]])}`)}
      </div>`;
    // A row of pills sets the <select> it stands for, and tells it, so saving sees a change.
    for (const pills of box.querySelectorAll(".swpills")) {
      pills.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]");
        if (!b) return;
        const sel = $("#" + pills.dataset.for);
        sel.value = b.dataset.v;
        sel.dispatchEvent(new Event("change"));
      });
    }
    // Which cards are open is remembered, on this device only.
    let opened = {};
    try { opened = JSON.parse(localStorage.getItem("hearth.swcards") || "{}"); } catch {}
    for (const card of box.querySelectorAll(".swcard")) {
      if (card.dataset.card in opened) card.open = !!opened[card.dataset.card];
      card.addEventListener("toggle", () => {
        opened[card.dataset.card] = card.open;
        try { localStorage.setItem("hearth.swcards", JSON.stringify(opened)); } catch {}
      });
    }
  }
  const set = (id, v) => { const el = $("#" + id); if (!el) return; if (el.type === "checkbox") el.checked = v === "1"; else el.value = v ?? ""; };
  for (const k of WORLD_KEYS) set(k, s[k]);
  const every = () => {
    const n = Number($("#steward_every").value);
    $("#v_steward_every").textContent = `${n} messages`;
    $("#v_offstage_per_day").textContent = String(Number($("#offstage_per_day").value || 2));
    $("#v_gossip_distortion").textContent = `${Number($("#gossip_distortion").value || 0)}% a telling`;
    $("#v_gossip_decay").textContent = `${Number($("#gossip_decay").value || 10)} days`;
    const keep = Number($("#tracker_keep").value || 4);
    $("#v_tracker_keep").textContent = keep > 30 ? "all of them" : `the last ${keep} message${keep === 1 ? "" : "s"}`;
  };
  const parts = () => { const p = $("#worldParts"); p.classList.toggle("notinuse", !$("#story_world").checked); p.inert = !$("#story_world").checked; };
  every();
  parts();
  paintWorldChips();
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Only what was changed. Saving every key on any change wrote each default down as if it were a
      // choice, so a better default later never reached a library that had once touched this panel.
      const patch = {};
      for (const k of WORLD_KEYS) {
        const v = WORLD_CHECKS.has(k) ? ($("#" + k).checked ? "1" : "0") : $("#" + k).value.trim();
        if (v !== String(s[k] ?? "")) { patch[k] = v; s[k] = v; }
      }
      if (Object.keys(patch).length) api("/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    }, 400);
  };
  for (const k of WORLD_KEYS) {
    const el = $("#" + k);
    if (!el || el.dataset.wired) continue;
    el.dataset.wired = "1";
    el.addEventListener(el.tagName === "INPUT" && el.type !== "checkbox" ? "input" : "change", () => {
      every();
      paintWorldChips();
      if (k === "apocrypha_blind" && typeof drawTaleScenes === "function") drawTaleScenes();
      if (k === "story_world") { W.enabled = el.checked; parts(); paintWorldLine(); }
      // Redraw the open chat, so the sheets go or come back at once.
      if (k === "show_trackers") { showTrackers = el.checked; if (S.chatId && typeof openChat === "function") openChat(S.chatId); }
      save();
    });
  }
}

// ---- how someone is now, from their portrait ------------------------------

const STATUS_LABELS = { physical: "Body", mental: "Mind", clothes: "Wearing", location: "Where", inventory: "Carrying" };

/**
 * The last `<status>` block a preset's tracker wrote, at or before this
 * message — the preset keeps its own records in the prose, and when it is the
 * one keeping track, Hearth only reads them back. The lines are shown as the
 * preset wrote them; there is no telling what shape another preset's are.
 */
function presetStatus(msg) {
  const all = [...document.querySelectorAll("#thread .msg")];
  for (let i = all.indexOf(msg); i >= 0; i--) {
    const found = [...(all[i].dataset.raw ?? "").matchAll(/<status>([\s\S]*?)<\/status>/gi)].pop();
    if (found) return found[1].trim().split(/\n+/).map((l) => l.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Tapping a portrait in a message: how that person is now, opened in the
 * message itself, under the picture — tap again to fold it away. Hearth's
 * own record first; where it has nothing on them yet, the preset's tracker,
 * so a chat that has only ever had the preset's is not met with a blank.
 * The cast row above the chat stays for choosing who speaks next. The
 * full-size picture is a link inside the panel, never the same tap.
 */
async function openStatus(msg, button) {
  const open = msg.querySelector(".inlaystatus");
  if (open) { open.remove(); return; }
  // With Story World off there is no status to show: the portrait is just the picture again.
  if (!worldOn()) {
    const face = button.querySelector(".medallion");
    const url = face && !face.classList.contains("blank") ? (face.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/) ?? [])[1] : "";
    if (url) { $("#faceImage").src = url; $("#faceName").textContent = msg.querySelector(".platename")?.textContent ?? ""; $("#faceDialog").showModal(); }
    return;
  }
  const name = msg.querySelector(".platename")?.textContent ?? "";
  const face = button.querySelector(".medallion");
  const url = face && !face.classList.contains("blank")
    ? (face.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/) ?? [])[1] ?? "" : "";
  let rows = "";
  let preset = !GUEST.on && $("#tracker_source")?.value === "preset";
  if (!preset) {
    if (!W.state) {
      W.state = GUEST.on ? await api("/table/world").catch(() => null)
        : S.chatId ? await api(`/chats/${S.chatId}/chronicle`).catch(() => null) : null;
    }
    const mine = W.state?.status?.[name] ?? {};
    rows = Object.keys(STATUS_LABELS).filter((f) => mine[f]).map((f) => {
      const v = typeof mine[f] === "string" ? mine[f] : mine[f].value;
      return `<li><span class="stlabel">${STATUS_LABELS[f]}</span><span>${txt(v)}</span></li>`;
    }).join("");
  }
  if (!rows && !GUEST.on) {
    const lines = presetStatus(msg);
    if (lines.length) { preset = true; rows = lines.map((l) => `<li>${txt(l)}</li>`).join(""); }
  }

  const panel = document.createElement("div");
  panel.className = "inlaystatus";
  panel.innerHTML = `<div class="stnow">now:</div>
    ${rows ? `<ul class="stlist${preset ? " preset" : ""}">${rows}</ul>`
      : `<p class="hint">Nothing noted about ${txt(name)} yet.</p>`}
    ${url ? `<button type="button" class="linkish stpicture">See the full picture</button>` : ""}`;
  panel.querySelector(".stpicture")?.addEventListener("click", (e) => {
    e.stopPropagation();
    $("#faceImage").src = url;
    $("#faceName").textContent = name;
    $("#faceDialog").showModal();
  });
  // Where the tap was: under the name, ahead of the text — below the face in
  // Hearthside, beside it in Banner — and scrolled into view, since a panel at
  // the foot of a long message is one nobody sees open.
  (msg.querySelector(".plate > .think") ?? msg.querySelector(".plate > .body")).before(panel);
  panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

$("#worldLine")?.addEventListener("click", openWorld);
paintWorldSettings();
