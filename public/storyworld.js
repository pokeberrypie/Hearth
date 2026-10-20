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
  if (!S.chatId) { line.hidden = true; return; }
  const id = S.chatId;
  const s = await api(`/chats/${id}/chronicle`).catch(() => null);
  if (!s || s.error || S.chatId !== id) return;
  W.state = s;
  const dated = s.calendar?.kind !== "undated" || s.entries.some((e) => e.kind === "time" || e.kind === "set");
  const waiting = s.proposals?.length ?? 0;
  const anything = dated || s.entries.length || waiting || s.factions?.length || s.bonds?.length;
  line.hidden = !anything;
  if (!anything) return;
  $("#worldDate").textContent = dated ? s.now.text : "Story World";
  const note = $("#worldNote");
  note.hidden = !waiting;
  note.textContent = waiting ? ` · ${waiting} waiting` : "";
  if (!$("#worldDialog")?.open) return;
  paintWorld();
}

/** A guest's line comes from the table's own state, and moves with the live feed. */
function paintGuestWorldLine(summary) {
  const line = $("#worldLine");
  const w = summary ?? GUEST.state?.world;
  if (!line || !w) return;
  line.hidden = !w.today;
  $("#worldDate").textContent = w.today;
  $("#worldNote").hidden = !w.latest;
  $("#worldNote").textContent = w.latest ? ` · ${w.latest}` : "";
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
      ${TABS.map((t) => `<button type="button" role="tab" class="wdtab" data-tab="${t.id}" aria-label="${t.label}">
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

  for (const b of d.querySelectorAll(".wdtab")) {
    const on = b.dataset.tab === W.tab;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  }

  paintWaiting(who === "host" && W.tab === "time" ? s.proposals ?? [] : []);
  const view = who === "players" ? W.players : s;
  const body = $("#wdBody");
  if (W.tab === "time") body.innerHTML = timelineHtml(view, who);
  else if (W.tab === "bonds") body.innerHTML = bondsHtml(view);
  else if (W.tab === "threads") body.innerHTML = threadsHtml();
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
      : txt(p.title);
    const why = p.evidence ? `<div class="wdwhy">“${txt(p.evidence)}”</div>` : "";
    return `<div class="wdprop"><div>${what}${why}</div>
      <div class="wdpropbtns">
        <button type="button" class="ghost" data-accept="${p.id}">Yes</button>
        <button type="button" class="linkish" data-dismiss="${p.id}">No</button>
      </div></div>`;
  }).join("");
  for (const b of box.querySelectorAll("[data-accept]")) b.onclick = () => act(`/chronicle/${b.dataset.accept}/accept`);
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
  return `<ol class="wdline">${items}</ol>${empty}
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
function threadsHtml() {
  const msgs = [...$("#thread").querySelectorAll(".msg")].reverse();
  for (const m of msgs) {
    const raw = m.dataset.raw ?? "";
    const block = raw.match(/<threads\b[^>]*>([\s\S]*?)<\/threads\s*>/i);
    if (!block) continue;
    const rows = block[1].replace(/<summary>[\s\S]*?<\/summary>/i, "").split("\n")
      .map((l) => l.trim().replace(/^[-*]\s*/, "")).filter((l) => l && !/^<\/?\w/.test(l))
      .map((l) => {
        const m2 = l.match(/^\[([^\]]+)\]\s*(.*)$/);
        const state = m2 ? m2[1] : "";
        const open = !/resolv|closed|done|settled|tied/i.test(state);
        return `<li class="${open ? "open" : "tied"}"><svg viewBox="0 0 30 40" aria-hidden="true"><path d="M15 0c0 8-9 9-9 17s9 9 9 15"/>${open
          ? '<path d="M15 32l-4 6M15 32l0 7M15 32l4 6"/>' : '<circle cx="15" cy="34" r="3.6"/>'}</svg>
          <div><div class="wdthread">${txt(m2 ? m2[2] : l)}</div>${state ? `<div class="wdwhen">${txt(state)}</div>` : ""}</div></li>`;
      }).join("");
    return `<ul class="wdthreads">${rows}</ul>`;
  }
  return `<p class="hint">Threads come from presets that keep them in their replies. None of the replies in this chat has any yet.</p>`;
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
        ${W.charges.map((c) => `<button type="button" role="option" class="wdcharge${c.id === charge ? " on" : ""}" data-charge="${c.id}"
          title="${txt(c.name)}" aria-label="${txt(c.name)}" aria-selected="${c.id === charge}"
          style="--charge:url('/charges/${c.svg}')"></button>`).join("")}
      </div>
      <p class="hint">Gold and silver go on colours, colours on gold and silver — a shield that breaks that is corrected, unless the rule is switched off in Behavior.</p>
    </fieldset>
    <div class="wdrow"><button type="submit" class="solid">Save</button>
      ${f ? `<button type="button" class="linkish danger" id="wdFGone">Retire this faction</button>` : ""}
      <button type="button" class="linkish" id="wdFCancel">Cancel</button></div>
  </form>`;
  const form = $("#wdFEdit");
  for (const b of form.querySelectorAll(".wdcharge")) {
    b.onclick = () => {
      form.charge.value = b.dataset.charge;
      for (const x of form.querySelectorAll(".wdcharge")) { x.classList.toggle("on", x === b); x.setAttribute("aria-selected", x === b ? "true" : "false"); }
    };
  }
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

// ---- settings: the Steward, and Story World's behaviour ------------------------

/**
 * Two new sections in panels that already exist, built here rather than in
 * index.html so the whole feature lives in one file. They save the way the
 * rest of Hearth's settings do: straight to /settings, shortly after a change.
 */
async function paintWorldSettings() {
  if (GUEST.on) return;
  const s = await api("/settings").catch(() => null);
  if (!s) return;
  const conn = document.querySelector('[data-panel="connection"]');
  const anchor = [...(conn?.querySelectorAll("h3") ?? [])].find((h) => /Use this library/.test(h.textContent));
  if (conn && anchor && !$("#stewardBox")) {
    const box = document.createElement("div");
    box.id = "stewardBox";
    box.innerHTML = `<h3>The Steward</h3>
      <p class="hint">The quiet second model that keeps Story World's records — what has happened, when, how
        everyone is, who feels what. It can be something cheaper than the one telling the story. Nothing it
        says is kept until it has been checked against the story's own words.</p>
      <label>Provider <select id="steward_provider"><option value="">The same as the story</option>
        ${Object.entries(s.providers ?? {}).map(([id, m]) => `<option value="${id}">${txt(m.label)}</option>`).join("")}</select></label>
      <label>Model <input id="steward_model" type="text" autocomplete="off" spellcheck="false"
        placeholder="The same as the story"></label>
      <p class="hint">Uses the key saved for that provider above.</p>`;
    conn.insertBefore(box, anchor);
  }
  const beh = document.querySelector('[data-panel="behavior"]');
  if (beh && !$("#worldBehaviour")) {
    const box = document.createElement("div");
    box.id = "worldBehaviour";
    box.innerHTML = `<h3>Story World</h3>
      <label class="check"><input type="checkbox" id="steward_on"> Keep Story World's records as the story goes</label>
      <label>Read again after <span class="v" id="v_steward_every"></span>
        <input type="range" id="steward_every" min="2" max="40" step="1"></label>
      <label>When a lot of time passes at once
        <select id="steward_ask_days">
          <option value="0">Always ask me first</option><option value="1">Ask above a day</option>
          <option value="3">Ask above three days</option><option value="7">Ask above a week</option>
          <option value="30">Ask above a month</option><option value="-1">Never ask</option></select></label>
      <label>Who keeps track of how everyone is
        <select id="tracker_source"><option value="hearth">Hearth</option><option value="preset">My preset's trackers</option></select></label>
      <p class="hint">Only one ever does. With your preset's, Hearth's own tracker is neither kept nor sent to the model.</p>
      <h3>Arms</h3>
      <label class="check"><input type="checkbox" id="heraldry_contrast"> Keep shields readable (the rule of tincture)</label>
      <label>Draw arms as
        <select id="heraldry_style"><option value="auto">Shields, or badges in a modern story</option>
          <option value="shield">Always shields</option><option value="badge">Always badges</option></select></label>`;
    beh.appendChild(box);
  }
  const set = (id, v) => { const el = $("#" + id); if (!el) return; if (el.type === "checkbox") el.checked = v === "1"; else el.value = v ?? ""; };
  for (const k of ["steward_provider", "steward_model", "steward_on", "steward_every", "steward_ask_days", "tracker_source", "heraldry_contrast", "heraldry_style"]) set(k, s[k]);
  const every = () => { const n = Number($("#steward_every").value); $("#v_steward_every").textContent = `${n} new messages`; };
  every();
  let timer;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const patch = {};
      for (const k of ["steward_provider", "steward_model", "steward_every", "steward_ask_days", "tracker_source", "heraldry_style"]) patch[k] = $("#" + k).value.trim();
      for (const k of ["steward_on", "heraldry_contrast"]) patch[k] = $("#" + k).checked ? "1" : "0";
      api("/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    }, 400);
  };
  for (const k of ["steward_provider", "steward_model", "steward_on", "steward_every", "steward_ask_days", "tracker_source", "heraldry_contrast", "heraldry_style"]) {
    const el = $("#" + k);
    if (!el) continue;
    el.addEventListener(el.tagName === "INPUT" && el.type !== "checkbox" ? "input" : "change", () => { if (k === "steward_every") every(); save(); });
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

function statusDialog() {
  let d = $("#statusDialog");
  if (d) return d;
  d = document.createElement("dialog");
  d.id = "statusDialog";
  d.className = "statusdialog";
  d.addEventListener("click", (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
    if (e.target.closest("[data-picture]")) {
      const url = d.dataset.picture;
      d.close();
      $("#faceImage").src = url;
      $("#faceName").textContent = d.dataset.name;
      $("#faceDialog").showModal();
    }
  });
  document.body.appendChild(d);
  return d;
}

/**
 * Tapping a portrait in a message: who they are, and how they are now. The
 * cast row above the chat stays for choosing who speaks next, so this never
 * gets in its way. The big picture is one more tap, from here.
 */
async function openStatus(msg, button) {
  const name = msg.querySelector(".platename")?.textContent ?? "";
  const face = button.querySelector(".medallion");
  const url = face && !face.classList.contains("blank")
    ? (face.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/) ?? [])[1] ?? "" : "";
  const d = statusDialog();
  d.dataset.name = name;
  d.dataset.picture = url;
  const preset = !GUEST.on && $("#tracker_source")?.value === "preset";
  let rows = "";
  if (preset) {
    const lines = presetStatus(msg);
    rows = lines.map((l) => `<li>${txt(l)}</li>`).join("");
  } else {
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
  d.innerHTML = `
    <button type="button" class="ico stclose" data-close aria-label="Close">&times;</button>
    <div class="sthead">
      ${url ? `<button type="button" class="stface" data-picture style="background-image:url(&quot;${encodeURI(url)}&quot;)" aria-label="See ${txt(name)}'s picture"></button>`
        : `<span class="stface blank">${txt(name.trim()[0] ?? "?")}</span>`}
      <div><h2>${txt(name)}</h2>${url ? `<button type="button" class="linkish" data-picture>See the picture</button>` : ""}</div>
    </div>
    <div class="stnow">now:</div>
    ${rows ? `<ul class="stlist${preset ? " preset" : ""}">${rows}</ul>`
      : `<p class="hint">${preset ? "Your preset has not written a status for anyone yet." : "Nothing noted about them yet."}</p>`}`;
  if (!d.open) d.showModal();
}

$("#worldLine")?.addEventListener("click", openWorld);
paintWorldSettings();
