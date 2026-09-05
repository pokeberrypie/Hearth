const $ = (s) => document.querySelector(s);
/**
 * A failed request used to reject silently, which is how the persona importer
 * ended up saying "Reading…" forever. Now every call resolves, and anything
 * that went wrong comes back as { error } for the caller to show.
 */
async function api(path, options) {
  let res;
  try {
    res = await fetch("/api" + path, options);
  } catch (err) {
    console.error("Hearth: request failed", path, err);
    return { error: "Could not reach the server. Is it still running?" };
  }
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    console.error("Hearth: bad response", path, res.status, body.slice(0, 200));
    return { error: `Server replied ${res.status}.` };
  }
}

/** Confirmation is a preference, so route every destructive prompt through here. */
let askBeforeDelete = true;
/**
 * Hearth's own confirm, and its own prompt.
 *
 * The browser's are not usable here. A page that asks a few times in a row has
 * its dialogs suppressed — Opera and Chrome both offer "prevent this page from
 * creating additional dialogs" — and from then on every confirm answers "no"
 * instantly, so every delete silently does nothing until the page is reloaded.
 * On Android it is worse: a WebView cancels confirm() and prompt() outright
 * unless the host app implements onJsConfirm/onJsPrompt, so on the phone they
 * never worked at all, and no bulk delete on the phone ever ran.
 *
 * Both return a promise, so every call site awaits.
 */
function askDialog({ title, text = "", confirmLabel = "Delete", value = null }) {
  const box = $("#askDialog");
  $("#askTitle").textContent = title;
  $("#askText").textContent = text;
  $("#askText").hidden = !text;
  $("#askYes").textContent = confirmLabel;

  const wantsText = value !== null;
  $("#askInputRow").hidden = !wantsText;
  if (wantsText) $("#askInput").value = value;

  return new Promise((resolve) => {
    const done = (answer) => {
      box.removeEventListener("close", onClose);
      $("#askYes").onclick = null;
      $("#askNo").onclick = null;
      $("#askInput").onkeydown = null;
      if (box.open) box.close();
      resolve(answer);
    };
    // Escape, or the backdrop, is a cancel like any other.
    const onClose = () => done(wantsText ? null : false);
    box.addEventListener("close", onClose);
    $("#askYes").onclick = () => done(wantsText ? $("#askInput").value : true);
    $("#askNo").onclick = () => done(wantsText ? null : false);
    if (wantsText) {
      $("#askInput").onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); $("#askYes").click(); }
      };
    }
    box.showModal();
    if (wantsText) { $("#askInput").focus(); $("#askInput").select(); }
  });
}

/** Confirmation is a preference, so route every destructive prompt through here. */
const ask = async (message) =>
  !askBeforeDelete || askDialog({ title: message, text: "This cannot be undone." });

/** Asks for a line of text. Resolves to null when cancelled, like prompt(). */
const askFor = (message, value = "") =>
  askDialog({ title: message, confirmLabel: "Save", value: String(value ?? "") });

/** A short-lived bar offering to put back whatever was just removed. */
let toastTimer = null;
function toast(text, undo) {
  const el = $("#toast");
  $("#toastText").textContent = text;
  $("#toastUndo").hidden = !undo;
  el.hidden = false;
  el.classList.add("in");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 9000 : 3500);

  $("#toastUndo").onclick = async () => {
    hideToast();
    await api("/undo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(undo),
    });
    await Promise.all([refreshCast(), refreshPersonas(), refreshPresets(), refreshChats()]);
    await showSplash();
    refreshBin();
    toast("Put back.");
  };
}
function hideToast() {
  $("#toast").classList.remove("in");
  setTimeout(() => ($("#toast").hidden = true), 200);
}

/** Wraps a delete response so every path offers the same undo. */
function offerUndo(r, noun, n = 1) {
  if (r?.undo) toast(`${n} ${noun}${n > 1 ? "s" : ""} deleted.`, r.undo);
  refreshBin();
}

const S = { chatId: null, charName: "", charAvatar: "", personaAvatar: "", personaName: "You", editing: null, busy: false, abort: null,
  // Which chat is generating right now. Not the same as chatId: you can open
  // another chat while a reply is still coming in, and Stop must still reach
  // the one that is actually running.
  generating: null,
  // Group chats: everyone in the room, and who the next turn is aimed at.
  cast: [], speaker: null };

// ---- prose --------------------------------------------------------------

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Structured tags a model may wrap its answer in. SillyTavern-style prompts ask
 * for these, and a reply full of visible `<true_thoughts>` is the reader seeing
 * the scaffolding instead of the scene. Known tags become real elements; any
 * other tag is stripped and its text kept, so nothing silently disappears.
 */
const TAGGED = /<(true_thoughts|thoughts|threads|thinking)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

/** Straight and curly quotes both \u2014 models are not consistent about it. */
const attr = (attrs, name) =>
  (attrs.match(new RegExp(name + '\\s*=\\s*["\'\u201c\u201d]?([^"\'\u201c\u201d>]+)', "i"))?.[1] ?? "").trim();

/**
 * The inline styling - quotes, bold, italics - over text that has already
 * been escaped. Split out of plain() so the regex-script renderer can style
 * the text *inside* markup a script produced, without escaping that markup.
 * See sanitise().
 */
function styleInline(escaped) {
  return escaped
    .replace(/"([^"\n]+)"/g, '<span class="say">&ldquo;$1&rdquo;</span>')
    .replace(/\u201c([^\u201d\n]+)\u201d/g, '<span class="say">&ldquo;$1&rdquo;</span>')
    .replace(/\*\*\*([^\n]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+?)\*/gm, "$1<em>$2</em>");
}

/**
 * Escapes, drops any leftover tag, and applies the usual dialogue styling.
 *
 * Bold runs before italic: the italic rule cannot match `**like this**` (its
 * body excludes `*`), so without a bold pass first every `**heading**` a
 * preset asks a model for arrives with its asterisks showing.
 */
/**
 * Markup a model may reasonably have meant to be rendered, rather than read.
 * A preset that asks for styled blocks — DEUS EX MACHINA does — gets replies
 * carrying a stylesheet and a few divs, and flattening those to text is how
 * you end up reading somebody's CSS in the middle of a scene.
 */
const LOOKS_LIKE_MARKUP = /<(style|div|span|details|summary|table|tbody|tr|td|font|ul|ol|li|p)\b[^>]*>/i;

function plain(text) {
  return styleInline(esc(
    String(text ?? "")
      // A style or script block is not prose. Dropping only the tags left the
      // whole stylesheet on screen as if the model had written an essay in CSS.
      .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\/?[a-z_][\w-]*(\s[^>]*)?>/gi, ""),
  ));
}

/** Prose, unless it is markup, in which case render it rather than read it. */
function segment(text) {
  return verbs(dice(LOOKS_LIKE_MARKUP.test(text) ? sanitise(text) : plain(text)));
}

/**
 * A scene the narrator moved everyone to, and a person it decided exists.
 *
 * The narrator writes these itself, mid-sentence — nobody types them — and
 * the server has already settled them by the time they arrive here, so
 * [[scene: the mill at night]] is a place that is now recorded and
 * [[npc: Marla]] is somebody with a card. What is left is drawing them as
 * what they are: a chapter rule across the message, and a name worth
 * remembering set apart from the prose around it.
 *
 * Runs over already-escaped text, like dice, so nothing captured here is
 * escaped again — doing it twice is how "Tom & Jerry" becomes "Tom &amp;amp;".
 */
function verbs(html) {
  return html
    .replace(
      /\[\[scene:\s*([^\]\n]{1,160}?)\s*\]\]/gi,
      (_whole, where) =>
        `<span class="scenemark"><span class="scenerule"></span>` +
        `<span class="scenewhere">${where}</span>` +
        `<span class="scenerule"></span></span>`,
    )
    .replace(
      /\[\[npc:\s*([^\]\n]{1,60}?)\s*\]\]/gi,
      (_whole, name) => `<span class="metnpc">${name}</span>`,
    )
    /*
     * The order everyone acts in, once a fight starts.
     *
     * Drawn as the list it is rather than as a sentence, because the one
     * thing anybody wants from initiative is to find their own name in it
     * quickly. The rolls are shown: a fight you cannot see the dice of is a
     * fight the narrator could have made up, which is what the whole bracket
     * protocol exists to stop.
     */
    .replace(
      /\[\[initiative:\s*([^\]\n]{1,400}?)\s*\]\]/gi,
      (_whole, list) => {
        const rows = list.split(/,\s*/).map((entry) => {
          const m = entry.match(/^(.*?)\s+(-?\d+)$/);
          if (!m) return "";
          return `<span class="initrow"><span class="initname">${m[1]}</span>` +
                 `<span class="initroll">${m[2]}</span></span>`;
        }).join("");
        return rows
          ? `<span class="initiative"><span class="inithead">Initiative</span>${rows}</span>`
          : _whole;
      },
    )
    // A hit, or a mending. "down" rather than a number is somebody at zero,
    // which the story decides the rest of.
    .replace(
      /\[\[hp:\s*([^\]\n]{1,60}?)\s+([+-]\d{1,3}),\s*([^\]\n]{1,12}?)\s*\]\]/gi,
      (_whole, who, delta, left) =>
        `<span class="hpchip ${delta.startsWith("+") ? "mend" : "hurt"}` +
        `${left === "down" ? " downed" : ""}">` +
          `<span class="hpwho">${who}</span>` +
          `<span class="hpdelta">${delta.replace("-", "−")}</span>` +
          `<span class="hpleft">${left}</span>` +
        `</span>`,
    )
    // Whose go it is. Quiet, because the tracker at the bottom of the screen
    // is where you actually read this — but present, so a plain-text export
    // still says who was up.
    .replace(
      /\[\[turn:\s*([^\]\n]{1,60}?)\s*\]\]/gi,
      (_whole, who) => `<span class="turnmark">${who}</span>`,
    )
    .replace(
      /\[\[fight over\]\]/gi,
      `<span class="scenemark"><span class="scenerule"></span>` +
        `<span class="scenewhere over">the fight is over</span>` +
        `<span class="scenerule"></span></span>`,
    );
}

/**
 * A resolved roll, drawn as dice rather than left as brackets.
 *
 * The server writes them as [[2d6+3: 4, 5 + 3 = 12]] — notation, the working,
 * the total — and this pulls the total out to be the thing you actually see.
 * Run over already-escaped text, so it only ever matches what the server put
 * there and never introduces markup of its own.
 */
function dice(html) {
  return html.replace(
    /\[\[(\d+d\d+(?:[+-]\d+)?):\s*([^\]]+?)\s*=?\s*(\d+)\]\]/g,
    (_whole, notation, working, total) =>
      `<span class="roll" title="${esc(notation)} — ${esc(working)}">` +
        `<span class="die">${esc(total)}</span>` +
        `<span class="rollwhat">${esc(notation)}</span>` +
      `</span>`,
  ).replace(
    // A single die with no arithmetic: "[[1d20: 17]]".
    /\[\[(\d+d\d+):\s*(\d+)\]\]/g,
    (_whole, notation, total) =>
      `<span class="roll" title="${esc(notation)}">` +
        `<span class="die">${esc(total)}</span>` +
        `<span class="rollwhat">${esc(notation)}</span>` +
      `</span>`,
  );
}

/** A folded list of story threads, one row per bullet, its `[state]` a chip. */
function threadsEl(inner) {
  const head = inner.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] ?? "Story threads";
  const rows = inner
    .replace(/<summary>[\s\S]*?<\/summary>/i, "")
    .split("\n")
    .map((l) => l.trim().replace(/^[-*]\s*/, ""))
    .filter((l) => l && !/^<\/?\w/.test(l))
    .map((l) => {
      const m = l.match(/^\[([^\]]+)\]\s*(.*)$/);
      return m
        ? `<li><span class="tchip ${esc(m[1].toLowerCase().replace(/\W+/g, ""))}">${esc(m[1])}</span>${plain(m[2])}</li>`
        : `<li>${plain(l)}</li>`;
    })
    .join("");
  return `<details class="threads"><summary>${plain(head.replace(/\*\*/g, ""))}</summary><ul>${rows}</ul></details>`;
}

function thoughtEl(attrs, inner) {
  const who = attr(attrs, "character") || attr(attrs, "name");
  return `<aside class="thought">` +
    (who ? `<span class="twho">${esc(who)}</span>` : "") +
    `<span class="ttext">${plain(inner.trim())}</span></aside>`;
}

function prose(text) {
  const src = String(text ?? "");
  let out = "";
  let last = 0;
  let m;
  TAGGED.lastIndex = 0;
  while ((m = TAGGED.exec(src))) {
    out += segment(src.slice(last, m.index));
    out += /threads/i.test(m[1]) ? threadsEl(m[3]) : thoughtEl(m[2], m[3]);
    last = m.index + m[0].length;
  }
  return out + segment(src.slice(last));
}


// ---- regex scripts --------------------------------------------------------

/**
 * SillyTavern regex scripts, display half. The server owns the prompt half in
 * src/regex.ts and never sends the two out of step: this list comes from
 * GET /api/regex, the same rows assembly reads.
 *
 * A display script exists to turn a model's raw block into something readable
 * — DEUS EX MACHINA folds its `<status>` dump into a card — so unlike every
 * other path in this file, its output is markup and has to survive as markup.
 * That is what sanitise() below is for.
 */
let regexScripts = [];

async function refreshRegex() {
  const list = await api("/regex");
  regexScripts = Array.isArray(list) ? list : [];
  renderRegexList();
}

/** Mirrors src/regex.ts compile(): "/pattern/flags", or a bare pattern. */
function compileScript(find) {
  const raw = String(find || "").trim();
  if (!raw) return null;
  const m = raw.match(/^\/([\s\S]*)\/([gimsuy]*)$/);
  try {
    return m ? new RegExp(m[1], m[2]) : new RegExp(raw);
  } catch {
    return null;
  }
}

/** Mirrors src/regex.ts applies(), for the display side only. */
function scriptApplies(s, placement, depth) {
  if (!s.enabled || !s.display) return false;
  if (!Array.isArray(s.placement) || !s.placement.includes(placement)) return false;
  if (s.minDepth !== null && s.minDepth !== undefined && depth < s.minDepth) return false;
  if (s.maxDepth !== null && s.maxDepth !== undefined && depth > s.maxDepth) return false;
  return true;
}

function applyDisplayScripts(text, placement, depth) {
  let out = String(text ?? "");
  for (const s of regexScripts) {
    if (!scriptApplies(s, placement, depth)) continue;
    const re = compileScript(s.find);
    if (!re) continue;
    const trim = Array.isArray(s.trim) ? s.trim : [];
    try {
      out = out.replace(re, (...args) => {
        const groups = args.slice(0, -2).map((g) =>
          typeof g === "string" ? trim.reduce((acc, t) => acc.split(t).join(""), g) : "");
        return String(s.replace ?? "")
          .replace(/\{\{match\}\}/gi, groups[0] ?? "")
          .replace(/\$(\d)/g, (_, d) => groups[Number(d)] ?? "");
      });
    } catch {
      // A pathological pattern is the script's bug, not a reason to lose the
      // message it was pointed at.
    }
  }
  return out;
}

/**
 * What a display script is allowed to produce.
 *
 * Everything else in Hearth escapes model output on principle, and that stays
 * true: this runs only over text a script has actually rewritten, and only
 * these tags and attributes survive. No script, no iframe, no event handler,
 * no javascript: URL — a regex pack is downloaded from the internet like any
 * other, and one that could run code would be a much worse problem than an
 * unstyled status block.
 */
const ALLOWED_TAGS = new Set([
  "div", "span", "p", "br", "hr", "b", "i", "em", "strong", "small", "u", "s",
  "details", "summary", "style", "ul", "ol", "li", "blockquote", "code", "pre",
  "table", "thead", "tbody", "tr", "td", "th", "font", "h1", "h2", "h3", "h4",
]);
const ALLOWED_ATTRS = new Set(["class", "style", "color", "colspan", "rowspan", "open", "title"]);
/** Text inside these is code or CSS; styling it would corrupt it. */
const VERBATIM = new Set(["style", "code", "pre"]);
/** A selector that would reach outside the message it came with. */
const GLOBAL_SELECTOR = /(^|[},])\s*(\*|html|body|:root)(?![\w-])/i;

function sanitise(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;

  /**
   * One node. Dropping a disallowed wrapper promotes its children into the
   * parent, and those promoted children have to be walked too — they were not
   * in the caller's snapshot of the child list, so an earlier version left
   * everything inside an unknown tag unstyled, asterisks and all.
   */
  const visit = (node, verbatim) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (verbatim) return;
      // Style the prose without touching the markup around it.
      const span = doc.createElement("span");
      span.innerHTML = styleInline(esc(node.data));
      node.replaceWith(...span.childNodes);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); return; }

    const tag = node.tagName.toLowerCase();
    /**
     * A stylesheet may dress up the block it arrived with, and must not touch
     * the app around it. A rule aimed at html, body, :root or * would restyle
     * every panel on the page and survive until a reload, so such a sheet is
     * dropped whole rather than picked apart — a preset's own classes, which
     * is all any of them actually use, come through untouched.
     */
    if (tag === "style" && GLOBAL_SELECTOR.test(node.textContent || "")) {
      node.remove();
      return;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      const kids = [...node.childNodes];
      node.replaceWith(...kids);
      for (const k of kids) visit(k, verbatim);
      return;
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (!ALLOWED_ATTRS.has(name) || /^\s*javascript:/i.test(value) ||
          (name === "style" && /expression\s*\(|url\s*\(\s*["']?\s*javascript:/i.test(value))) {
        node.removeAttribute(attr.name);
      }
    }
    const inner = verbatim || VERBATIM.has(tag);
    for (const k of [...node.childNodes]) visit(k, inner);
  };

  for (const k of [...root.childNodes]) visit(k, false);
  return root.innerHTML;
}

/**
 * One message, rendered. Display scripts run first; if any of them changed the
 * text it is treated as markup and sanitised, otherwise the ordinary escaping
 * path applies and nothing about the app's usual behaviour changes.
 */
function renderBody(text, placement, depth) {
  const raw = String(text ?? "");
  if (!regexScripts.length) return prose(raw);
  const scripted = applyDisplayScripts(raw, placement, depth);
  return scripted === raw ? prose(raw) : sanitise(scripted);
}

// ---- thread -------------------------------------------------------------

/**
 * Which member actually said this. In a solo chat it is always S.charName —
 * the character_id lookup and the name fallback both resolve to them anyway.
 * In a group, matching by character_id is exact; the name fallback exists for
 * rows saved before group chats stored one.
 */
function speakerOf(m) {
  if (m.role === "user") return { name: S.personaName, avatar: S.personaAvatar };
  const byId = m.character_id && S.cast.find((c) => c.id === m.character_id);
  const byName = !byId && m.name && S.cast.find((c) => c.name === m.name);
  const found = byId || byName;
  return found ? { name: found.name, avatar: found.avatar } : { name: S.charName, avatar: S.charAvatar };
}

/**
 * Drops a speaker's own name from the front of their line before drawing it.
 *
 * Group prompts label each reply with who said it, models copy the habit, and
 * the label used to be saved and then prefixed again next turn. The server no
 * longer stores it, but transcripts written before that fix still carry it —
 * sometimes several deep — and the plate above the message already says who
 * is talking.
 */
function stripLabel(text, name) {
  const who = (name || "").trim();
  if (!who) return text || "";
  let out = text || "";
  for (;;) {
    const lead = out.replace(/^[\s>*_]+/, "");
    if (lead.slice(0, who.length).toLowerCase() !== who.toLowerCase()) return out;
    const sep = lead.slice(who.length).match(/^\s*:[ \t]*/);
    if (!sep) return out;
    out = lead.slice(who.length + sep[0].length);
  }
}

/**
 * `depth` is how far back from the newest message this one sits, counting the
 * newest as 0. Regex scripts use it — "remove older <status> blocks" is
 * expressed as a depth floor — so it has to be passed in rather than guessed.
 */
function messageEl(m, depth = 0) {
  const el = document.createElement("article");
  el.className = "msg" + (m.role === "user" ? " mine" : "");
  el.dataset.id = m.id ?? "";
  el.dataset.raw = m.content ?? "";
  const { name: who, avatar: face } = speakerOf(m);
  el.innerHTML =
    `<div class="who">${medallion(face, who)}<span class="nametext">${esc(who)}</span></div>` +
    `<div class="plate"><span class="platename">${esc(who)}</span>` +
    `<div class="meta-line">${metaLine(m)}${statsLine(m)}</div>` +
    swipeBar(m) +
    thinkBlock(m) +
    `<div class="body">${renderBody(
        stripLabel(m.content, m.role === "user" ? "" : who),
        m.role === "user" ? 1 : 2,
        depth,
      )}</div>` +
    (m.id ? tools() : "") +
    `</div>`;
  const bar = el.querySelector(".swipes");
  if (bar) capSwipes(bar);
  extNotify("message:render", el, m);
  return el;
}
function metaLine(m) {
  const d = new Date(m.created_at ?? Date.now());
  const stamp = d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
  return esc(stamp);
}

/**
 * How many more takes a reply may have at the table. Mirrors the server's
 * allowance so the button greys out instead of failing when you press it.
 */
let tableSwipes = 3;

/**
 * The forward arrow does two jobs: step to an alternate that already exists,
 * and — at the end of the line — ask for a new one. Only the second is capped,
 * so a game with no swipes left can still look back through the takes it has.
 */
function capSwipes(bar) {
  const next = bar.querySelector('[data-swipe="1"]');
  if (!next) return;
  const count = Number(bar.dataset.count) || 1;
  const spent = count - 1;                       // the first take is not a swipe
  const atEnd = (Number(bar.dataset.i) || 0) >= count - 1;
  const capped = document.body.dataset.mode === "tabletop" && spent >= tableSwipes;
  next.disabled = atEnd && capped;
  next.title = next.disabled
    ? (tableSwipes === 0
        ? "No swipes at this table. What happened, happened."
        : `That is all ${tableSwipes} swipes this table allows.`)
    : "";
}

function swipeBar(m) {
  const n = Math.max(1, (m.swipes ? JSON.parse(m.swipes).length : 1));
  const i = (m.swipe_index ?? 0) + 1;
  return `<div class="swipes" data-count="${n}" data-i="${i - 1}">` +
    `<button data-swipe="-1" ${i <= 1 ? "disabled" : ""} aria-label="Previous alternate">&lsaquo;</button>` +
    `<span class="sn">${i} / ${n}</span>` +
    `<button data-swipe="1" aria-label="Next alternate">&rsaquo;</button></div>`;
}

const ICON = {
  copy: `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>`,
  tick: `<svg viewBox="0 0 24 24"><path d="M5 13l4.5 4.5L19 7"/></svg>`,
  edit: `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 6.5l3 3"/></svg>`,
  up:   `<svg viewBox="0 0 24 24"><path d="M12 19V6"/><path d="M6 12l6-6 6 6"/></svg>`,
  downArrow: `<svg viewBox="0 0 24 24"><path d="M12 5v13"/><path d="M6 12l6 6 6-6"/></svg>`,
  role: `<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M4 12h10"/><path d="M4 17h13"/></svg>`,
  del:  `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>`,
  down: `<svg viewBox="0 0 24 24"><path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  folder: `<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.4h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  up: `<svg viewBox="0 0 24 24"><path d="M12 19V6"/><path d="M6 12l6-6 6 6"/></svg>`,
  branch: `<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M8.2 6h4.3a3 3 0 0 1 3 3"/></svg>`,
};

const tools = () =>
  `<div class="tools">` +
  `<button data-copy title="Copy" aria-label="Copy">${ICON.copy}</button>` +
  `<button data-edit title="Edit" aria-label="Edit">${ICON.edit}</button>` +
  `<button data-branch title="Branch from here" aria-label="Branch from here">${ICON.branch}</button>` +
  `<button data-del title="Remove" aria-label="Remove">${ICON.del}</button></div>`;

function statsLine(m) {
  const bits = [];
  if (m.tokens) bits.push(`${m.tokens} tok`);
  if (m.ms) bits.push(`${(m.ms / 1000).toFixed(1)}s`);
  return bits.length ? ` &middot; ${bits.join(" &middot; ")}` : "";
}

function thinkBlock(m) {
  if (!m.reasoning) return "";
  const secs = m.ms ? ` for ${(m.ms / 1000).toFixed(0)}s` : "";
  return `<details class="think"><summary>Thought${secs}</summary>` +
    `<div class="thinkbody">${esc(m.reasoning)}</div></details>`;
}

/**
 * Keeps the newest text in view — but only while the reader is already there.
 *
 * Every token of a stream used to yank the view back to the bottom, so
 * scrolling up to reread something during a long reply was impossible: the
 * next delta, a fraction of a second later, dragged you straight back down.
 * Scrolling away now means you have taken the wheel, and Hearth leaves it
 * alone until you come back to the bottom yourself. `stick(true)` forces it,
 * for the moments where the bottom is the whole point — opening a chat,
 * sending a turn, showing an error.
 */
const NEAR_BOTTOM = 80;

function atBottom() {
  const s = $("#scroll");
  return s.scrollHeight - s.scrollTop - s.clientHeight <= NEAR_BOTTOM;
}

let following = true;

/**
 * Sets the title in the bar, at whatever size makes it fit.
 *
 * Cinzel is a wide face and the bar gives the title what is left after two
 * button groups and two flourishes, so a long name — "Joffrey Baratheon" — ran
 * past the end and was cut off with an ellipsis. Shrinking the type is the
 * right trade here: the alternatives are truncating a name, wrapping a
 * single-line bar, or dropping the face that makes the bar look like a bar.
 *
 * Steps down until it fits or reaches a floor, then stops. Measured rather
 * than guessed from length, because the same number of letters is a different
 * width in every name.
 */
function setBarTitle(text, { title = "", branched = false } = {}) {
  const el = $("#barTitle");
  // The fit is redone whenever the bar changes width, long after this call, so
  // the name it started from has to be kept somewhere it can be read back.
  el.dataset.full = text;
  el.dataset.note = title;
  el.classList.toggle("branched", branched);
  fitBarTitle();
}

let fitting = false;

function fitBarTitle() {
  const el = $("#barTitle");
  if (!el.dataset.full) return;
  fitting = true;
  try {
    fit(el, el.parentElement, el.dataset.full, el.dataset.note ?? "");
  } finally {
    fitting = false;
  }
}

function fit(el, title, full, note) {
  const fits = () => el.scrollWidth <= el.clientWidth + 1;
  const shrinkTo = (from, to) => {
    for (let size = from; size >= to; size -= 0.05) {
      el.style.fontSize = `${size.toFixed(2)}rem`;
      if (fits()) return true;
    }
    return false;
  };
  // The note is usually the chat's own title, which tends to start with the
  // character's name already; saying it twice helps nobody.
  const done = (shortened) => {
    const parts = shortened && !note.includes(full) ? [full, note] : [note];
    el.title = parts.filter(Boolean).join(" — ");
  };

  el.textContent = full;
  title.classList.remove("tight");
  if (shrinkTo(1.7, 1.2)) return done(false);

  /**
   * Still too long, so the flourishes go.
   *
   * They are worth a good deal of the bar — 84px each on a wide screen, and
   * still 31px on a narrow one — and a name is worth more than an ornament
   * beside it. Only a long name in a narrow window ever reaches this, and only
   * that name loses them: "Hearth" keeps its own.
   */
  title.classList.add("tight");
  if (shrinkTo(1.7, 0.85)) return done(false);

  /**
   * And on the narrowest phones, not even that is enough: the two pairs of
   * buttons take 176px of a 320px bar and they are the width of their own
   * icons, so there is nothing left to take from them. "Joffrey Baratheon"
   * wants 153px at the floor and has 116.
   *
   * So it gives up the surname rather than the letters. "Joffrey" is a better
   * answer than "Joffrey Barath…" — a whole name at a readable size, with the
   * rest still on the tooltip — and it is the one place where the type is
   * allowed to stay large enough to read.
   */
  const first = full.split(/\s+/)[0];
  if (first && first !== full) {
    el.textContent = first;
    // Starting from 1.2 rather than 1.7: this rung is reached on the narrowest
    // bar there is, and a first name set larger than the full one would have
    // been at a slightly wider window reads as a mistake.
    if (shrinkTo(1.2, 0.85)) return done(true);
  }
  done(true);
}

/*
 * The space available changes, and so does the answer.
 *
 * Not only with the window: opening the cast takes three hundred pixels off
 * the bar without the window moving at all, and a resize listener sleeps
 * through that. Watching the bar catches every way its width can change.
 *
 * The bar is watched rather than the title inside it because refitting rewrites
 * that title, and an observer that reacts to its own writes never settles. The
 * bar's own width does not depend on what the name does.
 */
new ResizeObserver(() => {
  if (fitting) return;
  fitBarTitle();
}).observe($(".bar"));

// Cinzel arrives after the first paint, and every width measured before it
// lands was measured in a fallback face that is not the one on screen.
document.fonts?.ready.then(fitBarTitle);

function stick(force = false) {
  const s = $("#scroll");
  if (force) following = true;
  else if (!following) return;
  s.scrollTop = s.scrollHeight;
}

// A wheel or a drag decides who is in charge; coming back to the bottom hands
// it back. Passive, so this never delays a scroll.
/**
 * Marks the scroller while it is moving, and for a moment after.
 *
 * The splash cards lift 2px on hover. Scrolling with a wheel leaves the
 * cursor where it is and slides the cards *underneath* it, so every card that
 * passes beneath the pointer takes its turn lifting and settling — across a
 * grid that reads as the whole page jiggling. The class lets the CSS hold the
 * hover still until the scrolling stops. Clicks keep working throughout;
 * only the lift is suppressed.
 */
let scrollSettle = null;
$("#scroll").addEventListener("scroll", () => {
  following = atBottom();
  const el = $("#scroll");
  if (!scrollSettle) el.classList.add("scrolling");
  clearTimeout(scrollSettle);
  scrollSettle = setTimeout(() => {
    scrollSettle = null;
    el.classList.remove("scrolling");
  }, 140);
}, { passive: true });

const initial = (n) => esc((n || "?").trim()[0] || "?").toUpperCase();

function medallion(avatar, name, cls = "") {
  return avatar
    ? `<span class="medallion ${cls}" style="background-image:url(&quot;${encodeURI(avatar)}&quot;)"></span>`
    : `<span class="medallion blank ${cls}">${initial(name)}</span>`;
}

/**
 * A readable snippet of the last thing said. Strips the asterisks and quote
 * marks so the line reads as prose rather than as markup.
 */
function preview(c, limit = 150) {
  const raw = (c.last_message ?? "").trim();
  if (!raw) return `<em>Nothing said yet</em>`;
  const flat = raw
    .replace(/\s+/g, " ")
    .replace(/[*_`]/g, "")
    .replace(/^["\u201c]|["\u201d]$/g, "");
  const who = c.last_role === "user" ? "You: " : "";
  return `<span class="who-tag">${who}</span>${esc(flat.slice(0, limit))}${flat.length > limit ? "…" : ""}`;
}

const ago = (t) => {
  if (!t) return "not started";
  const d = (Date.now() - t) / 6e4;
  if (d < 1) return "just now";
  if (d < 60) return `${Math.round(d)} min ago`;
  if (d < 1440) return `${Math.round(d / 60)} h ago`;
  return new Date(t).toLocaleDateString();
};

async function showSplash() {
  S.chatId = null;
  // The face strip belongs to whichever chat was open — leaving without
  // clearing it left the last group's cast hanging over the splash page.
  S.cast = [];
  S.speaker = null;
  $("#castBar").hidden = true;
  $("#castBar").innerHTML = "";
  // Whichever room this is. Hardcoding "Hearth" here meant walking into
  // tabletop mode and finding the sign over the door had changed back.
  setBarTitle(MODES[document.body.dataset.mode]?.title ?? "Hearth");
  $("#treeView").hidden = true;
  $("#thread").hidden = false;
  $("#composer").hidden = true;
  $("#chatMenuBtn").hidden = true;
  $("#thread").innerHTML = "";
  $("#splash").hidden = false;
  chatMeta = null;
  applyChatWallpaper();
  applyChatRoom();
  renderLoreList();
  setMsgSelect(false);

  await refreshChats();

  const list = await api("/recent");
  if (!Array.isArray(list)) return;
  const grid = $("#recentGrid");
  $("#empty").hidden = list.length > 0;
  grid.innerHTML = "";
  list.forEach((ch) => {
    const b = document.createElement("button");
    b.className = "portrait";
    b.innerHTML =
      (ch.avatar
        ? `<span class="face" style="background-image:url(&quot;${encodeURI(ch.avatar)}&quot;)"></span>`
        : `<span class="face blank">${initial(ch.name)}</span>`) +
      `<span class="scrim"></span>` +
      `<span class="label"><span class="n">${esc(ch.name)}</span>` +
      `<span class="when">${ago(ch.last_seen)}</span></span>`;
    b.onclick = () => (ch.last_chat ? openChat(ch.last_chat) : startChat(ch.id));
    grid.appendChild(b);
  });
}

async function startChat(character_id) {
  const { id } = await api("/chats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ character_id }),
  });
  openChat(id);
}

async function openChat(id) {
  const { chat, messages, members } = await api("/chats/" + id);
  S.chatId = id;
  S.charName = chat.character_name;
  S.charAvatar = chat.avatar || "";
  // Set from this same response, so the very first render already knows every
  // speaker's face — a separate members fetch would land after the messages
  // were already drawn with the wrong one.
  S.cast = Array.isArray(members) ? members : [];
  S.speaker = null;
  chatMeta = chat;
  applyChatWallpaper();
  applyChatRoom();
  renderLoreList();
  renderRoom();
  $("#chatMenuBtn").hidden = false;
  setMsgSelect(false);
  setBarTitle(chat.character_name, {
    title: chat.parent_title ? `Branched from ${chat.parent_title}` : chat.title ?? "",
    branched: !!chat.parent_chat_id,
  });
  $("#splash").hidden = true;
  $("#treeView").hidden = true;
  $("#thread").hidden = false;
  $("#composer").hidden = false;
  const t = $("#thread");
  t.innerHTML = "";
  messages.forEach((m, i) => t.appendChild(messageEl(m, messages.length - 1 - i)));
  markCutoff();
  refreshWorld();
  if (!$("#guideRow").hidden) syncGuideActions();
  closeDrawer();
  openingQuestions(chat);
  // Opening a chat always lands at the newest message, whatever the previous
  // chat's scroll position was. (Passing stick straight to rAF would hand it
  // a timestamp as `force`, which happens to work and reads like a mistake.)
  requestAnimationFrame(() => stick(true));
}

/**
 * Where this chat should keep its own notes. Asked once, at the top of a chat.
 *
 * The question is asked rather than assumed because the answer is genuinely
 * personal: some people keep one book per story, some keep one enormous book
 * for a whole world, and some do not want a machine writing in their lorebooks
 * at all. Declining is remembered exactly as firmly as accepting — the point of
 * asking once is to only ask once.
 */
/**
 * The things a new chat is asked once, in order, one dialog at a time.
 *
 * Where its notes go, and then — at a table — what the game is about. Both are
 * asked once and both remember a refusal, so this is nearly always nothing at
 * all; opening the twentieth chat of the evening should not be an interview.
 */
async function openingQuestions(chat) {
  /*
   * At a table the game comes first and the bookkeeping second — which is the
   * order anybody would do it in anyway, and it means the notes can be named
   * after the game rather than after the narrator. Three chats with the
   * Gamekeeper otherwise produce three books called "The Gamekeeper — notes".
   */
  if (document.body.dataset.mode === "tabletop" && !chat.campaign_asked) {
    await askAboutCampaign(chat);
    // The chat may have been left while the first question was open.
    if (S.chatId !== chat.id) return;
  }
  if (!chat.auto_lore_asked) await askAboutRecord(chat);
}

async function askAboutRecord(chat) {
  const dlg = $("#loreWelcome");
  const sel = $("#loreExistingSel");
  const name = $("#loreNewName");

  // Named after the game where there is one, since that is what you will be
  // looking for later. The server settles any remaining collision.
  const playing = campaignOf(chatMeta)?.title;
  name.value = `${playing || chat.character_name} — notes`;

  let books = [];
  try { books = await api("/lorebooks"); } catch { books = []; }
  sel.innerHTML = books.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  $("#loreExistingOpt").hidden = !books.length;

  dlg.showModal();

  $("#loreWelcomeGo").onclick = async () => {
    const choice = dlg.querySelector('input[name="loreChoice"]:checked')?.value ?? "none";
    const body =
      choice === "new" ? { name: name.value.trim() || `${chat.character_name} — notes` }
      : choice === "existing" ? { book_id: sel.value }
      : {};
    dlg.close();
    try {
      await api(`/chats/${chat.id}/autolore`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (choice !== "none") toast("This tale will keep its own notes.");
    } catch {
      toast("Could not set that up.");
    }
  };

  // Resolves when the dialog goes away, however it went — answered, or waved
  // off with Escape — so whatever is queued behind it can take the screen.
  return new Promise((resolve) => dlg.addEventListener("close", resolve, { once: true }));
}

/* ---- the tree ---------------------------------------------------------------
 * Where a story forked.
 *
 * A branch keeps its parent's id, so every chat a character has forms a
 * forest. A list of them tells you they exist; the shape tells you what
 * happened — where you kept trying the same moment, which attempt you carried
 * on with, which one you left standing. The shape is the information, so it is
 * drawn rather than listed.
 *
 * Grown upward from a trunk, with the branches tapering as they divide,
 * because that is the one visual convention nobody needs explained.
 */

/** Tidy layout: children spread along x, parents centred over them, depth = y. */
function layoutTree(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map();
  const roots = [];
  for (const n of nodes) {
    const parent = n.parent && byId.has(n.parent) ? n.parent : null;
    if (!parent) { roots.push(n); continue; }
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(n);
  }
  // Oldest first, so a story reads left to right in the order it was lived.
  const childrenOf = (id) => (kids.get(id) ?? []).sort((a, b) => a.created - b.created);
  roots.sort((a, b) => a.created - b.created);

  const placed = new Map();
  let slot = 0;

  const walk = (node, depth) => {
    const children = childrenOf(node.id);
    let x;
    if (!children.length) {
      x = slot++;
    } else {
      const xs = children.map((c) => walk(c, depth + 1));
      x = (xs[0] + xs[xs.length - 1]) / 2;
    }
    placed.set(node.id, { node, x, depth });
    return x;
  };
  // A gap between separate trunks, so two unrelated stories do not look joined.
  for (const r of roots) { walk(r, 0); slot += 1; }

  const links = [];
  for (const [id, p] of placed) {
    const parent = byId.get(p.node.parent);
    if (parent && placed.has(parent.id)) links.push({ from: placed.get(parent.id), to: p });
  }
  return { placed: [...placed.values()], links };
}

/** A branch: a tapering shape rather than a stroke, so it thins as it divides. */
function branchPath(from, to, w0, w1) {
  const dy = from.y - to.y;
  const c0y = from.y - dy * 0.45;
  const c1y = to.y + dy * 0.45;
  const a = w0 / 2, b = w1 / 2;
  return `M${from.x - a} ${from.y}` +
         `C${from.x - a} ${c0y} ${to.x - b} ${c1y} ${to.x - b} ${to.y}` +
         `L${to.x + b} ${to.y}` +
         `C${to.x + b} ${c1y} ${from.x + a} ${c0y} ${from.x + a} ${from.y}Z`;
}

/** Stable per-node jitter, so leaves do not jump about on every redraw. */
function wiggle(id, spread) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * spread;
}

async function showTree() {
  const chats = await api("/chats");
  if (!Array.isArray(chats)) return;
  const mine = chats.filter((c) => c.character_id === chatMeta?.character_id);
  if (!mine.length) return;

  /*
   * One tree per character, not a row of saplings.
   *
   * Only a chat made by branching a message has a parent; one started fresh
   * has none, and treating every parentless chat as its own trunk drew a
   * thicket of unrelated stems — thirteen of them, for a character with
   * fifteen chats. They are all tellings of the same character, so the
   * character is the trunk and every chat grows out of it. A branch still
   * forks off the telling it came from, which is the shape worth seeing.
   */
  const TRUNK = "__character__";
  const nodes = mine.map((c) => ({
    id: c.id,
    parent: c.parent_chat_id ?? TRUNK,
    created: c.created_at ?? 0,
    title: c.title || "Untitled",
    turns: c.turns ?? 0,
    note: c.branch_note ?? "",
  }));
  nodes.push({
    id: TRUNK,
    parent: null,
    created: 0,
    title: chatMeta?.character_name ?? "",
    turns: 0,
    note: "",
    trunk: true,
  });

  const { placed, links } = layoutTree(nodes);
  const depth = Math.max(...placed.map((p) => p.depth)) + 1;

  const COL = 210, ROW = 150, PAD = 40, BASE = 70, LABEL = 112;
  // Room under the root for the trunk to reach the ground, or it is cut off at
  // the bottom edge.
  const H = depth * ROW + PAD * 2 + BASE;
  const groundY = H - PAD;

  /*
   * Sized to what was actually drawn, rather than to the slots it was laid out
   * in. The layout leaves a spare column after every trunk so two unrelated
   * stories do not look joined, and counting that gap into the width left a
   * dead column on the right — which is a tree sitting half a column
   * off-centre. Measuring the placed nodes and shifting them into the middle
   * is right whatever the layout does next.
   */
  const raw = new Map(placed.map((p) => [p.node.id, {
    x: p.x * COL + wiggle(p.node.id, 26),
    y: groundY - BASE - p.depth * ROW,
  }]));
  const xs = [...raw.values()].map((p) => p.x);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  // The labels are centred on their node and stick out either side, so the
  // margin has to clear a label, not a twig.
  const W = (maxX - minX) + (PAD + LABEL) * 2;
  const shift = LABEL + PAD - minX;
  const pos = new Map([...raw].map(([id, p]) => [id, { x: p.x + shift, y: p.y }]));
  const widthAt = (d) => Math.max(3, 17 * Math.pow(0.62, d));

  /*
   * Chats are usually named after the character, so a column of them reads
   * "Jamie Lannister - 2026-08-…" fifteen times with the only distinguishing
   * part cut off the end. The heading already says whose tree this is.
   *
   * The repeated part is found by comparing the titles to each other rather
   * than by matching the character's name: this library has a character called
   * "Jaimie Lannister" whose chats are all titled "Jamie Lannister", and a name
   * match silently does nothing in exactly the case that needed it most.
   */
  const titles = placed.filter((p) => !p.node.trunk).map((p) => p.node.title);
  let shared = "";
  if (titles.length > 1) {
    shared = titles.reduce((a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
      return a.slice(0, i);
    });
    // Only worth removing if it is a real repeated phrase, and never so much
    // that a label becomes empty.
    if (shared.trim().length < 6) shared = "";
  }
  const ownTitle = (title) => {
    const rest = shared ? title.slice(shared.length) : title;
    return rest.replace(/^[\s—–:_-]+/, "").trim() || title;
  };

  const parts = [];

  // The trunk continues below the root, into the ground.
  for (const p of placed.filter((p) => p.depth === 0)) {
    const o = pos.get(p.node.id);
    parts.push(`<path class="bough" d="${branchPath({ x: o.x, y: groundY }, o, widthAt(0) * 1.25, widthAt(0))}"/>`);
  }

  for (const l of links) {
    const a = pos.get(l.from.node.id), b = pos.get(l.to.node.id);
    parts.push(`<path class="bough" d="${branchPath(a, b, widthAt(l.from.depth), widthAt(l.to.depth))}"/>`);
  }

  for (const p of placed) {
    const o = pos.get(p.node.id);
    // The character's own node is where the tree comes out of the ground.
    // Nothing to open and nothing to label — its name is already the heading.
    if (p.node.trunk) continue;
    const here = p.node.id === S.chatId;
    const tilt = wiggle(p.node.id, 40);
    const own = ownTitle(p.node.title);
    const label = own.length > 20 ? own.slice(0, 19) + "…" : own;
    parts.push(
      `<g class="bud${here ? " here" : ""}" data-chat="${p.node.id}" tabindex="0" role="button" ` +
      `aria-label="Open ${esc(p.node.title)}">` +
        `<circle class="hit" cx="${o.x}" cy="${o.y}" r="46"/>` +
        `<g transform="translate(${o.x} ${o.y}) rotate(${tilt})">` +
          `<path class="leaf" d="M0 0c-11-4-19-13-21-25 12 2 21 10 25 21z"/>` +
          `<path class="leaf" d="M0 0c11-4 19-13 21-25-12 2-21 10-25 21z"/>` +
          `<circle class="pip" cx="0" cy="0" r="4.5"/>` +
        `</g>` +
        `<text class="name" x="${o.x}" y="${o.y + 40}">${esc(label)}</text>` +
        `<text class="turns" x="${o.x}" y="${o.y + 58}">${p.node.turns} message${p.node.turns === 1 ? "" : "s"}</text>` +
      `</g>`,
    );
  }

  $("#treeCanvas").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Branches of this story">${parts.join("")}</svg>`;

  const tellings = placed.filter((p) => !p.node.trunk);
  const forks = tellings.filter((p) => p.depth > 1).length;
  $("#treeTitle").textContent = chatMeta?.character_name ?? "The tree";
  $("#treeLine").textContent = forks
    ? `${tellings.length} tellings, ${forks} of them branched from another.`
    : `${tellings.length} telling${tellings.length === 1 ? "" : "s"}, none branched yet. ` +
      `Branch a message and it will fork here.`;

  $("#thread").hidden = true;
  $("#splash").hidden = true;
  $("#composer").hidden = true;
  $("#treeView").hidden = false;

  // Put the chat you are in on screen rather than the top-left corner.
  const mineNow = pos.get(S.chatId);
  if (mineNow) {
    const sc = $("#scroll");
    sc.scrollTop = Math.max(0, mineNow.y - sc.clientHeight * 0.6);
    sc.scrollLeft = Math.max(0, mineNow.x - sc.clientWidth / 2);
  }
}

function hideTree() {
  $("#treeView").hidden = true;
  $("#thread").hidden = false;
  $("#composer").hidden = !S.chatId;
}

$("#treeCanvas").addEventListener("click", (e) => {
  const bud = e.target.closest("[data-chat]");
  if (!bud) return;
  hideTree();
  openChat(bud.dataset.chat);
});
$("#treeCanvas").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const bud = e.target.closest("[data-chat]");
  if (!bud) return;
  e.preventDefault();
  hideTree();
  openChat(bud.dataset.chat);
});

// ---- who is in the room ---------------------------------------------------

/**
 * The face strip above a group chat. Tapping a face hands them the next turn;
 * tapping the one already chosen hands it back to whoever has been quietest.
 * A solo chat has nothing to choose, so the bar stays hidden.
 */
function renderRoom() {
  const bar = $("#castBar");
  bar.innerHTML = "";
  bar.hidden = S.cast.length < 2;
  if (bar.hidden) return;

  S.cast.forEach((m) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "castface" +
      (m.muted ? " muted" : "") +
      (S.speaker === m.id ? " picked" : "");
    b.title = m.muted ? `${m.name} — muted` : `${m.name} speaks next`;
    b.setAttribute("aria-label", b.title);
    b.innerHTML = medallion(m.avatar, m.name) + `<span class="cn">${esc(m.name)}</span>`;
    b.onclick = () => {
      if (m.muted) return;
      S.speaker = S.speaker === m.id ? null : m.id;
      renderRoom();
    };
    bar.appendChild(b);
  });

  const any = document.createElement("span");
  any.className = "casthint";
  any.textContent = S.speaker
    ? S.cast.find((m) => m.id === S.speaker)?.name + " replies next"
    : "quietest replies next";
  bar.appendChild(any);

  // Adding or dropping someone should not require hunting through the menu.
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "castedit";
  edit.title = "Add or remove someone";
  edit.setAttribute("aria-label", "Add or remove someone from this scene");
  edit.innerHTML = ICON.plus;
  edit.onclick = openRoom;
  bar.appendChild(edit);
}

async function loadRoom() {
  const list = await api(`/chats/${S.chatId}/members`);
  S.cast = Array.isArray(list) ? list : [];
  // Keep the chosen speaker across a reload — opening the members dialog must
  // not quietly hand the turn back to whoever happens to be quietest.
  if (!S.cast.some((m) => m.id === S.speaker && !m.muted)) S.speaker = null;
  renderRoom();
}

/** The members dialog: mute, drop, add, and the auto-reply switch. */
async function openRoom() {
  await loadRoom();
  const el = $("#memberList");
  el.innerHTML = "";
  S.cast.forEach((m) => {
    const row = document.createElement("div");
    row.className = "blockrow" + (m.muted ? " off" : "");
    row.innerHTML =
      `<div class="brow">` +
      medallion(m.avatar, m.name) +
      `<span class="b-fixed">${esc(m.name)}</span>` +
      `<span class="btools">` +
        `<label class="switch" title="Let them speak"><input type="checkbox" class="m-on"><span></span></label>` +
        `<button type="button" class="bico danger" data-drop title="Remove from the scene" aria-label="Remove ${esc(m.name)}">&minus;</button>` +
      `</span></div>`;
    const on = row.querySelector(".m-on");
    on.checked = !m.muted;
    on.onchange = async () => {
      await api(`/chats/${S.chatId}/members`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ mute: { id: m.id, on: !on.checked } }),
      });
      openRoom();
    };
    row.querySelector("[data-drop]").onclick = async () => {
      if (S.cast.length < 2) return void toast("A scene needs someone in it.");
      await api(`/chats/${S.chatId}/members`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ remove: m.id }),
      });
      openRoom();
      refreshChats();
    };
    el.appendChild(row);
  });

  const here = new Set(S.cast.map((m) => m.id));
  const all = await api("/characters");
  $("#room_search").value = "";
  wirePicker($("#room_search"), $("#room_results"), (Array.isArray(all) ? all : []).filter((c) => !here.has(c.id)),
    async (id) => {
      await api(`/chats/${S.chatId}/members`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ add: id }),
      });
      openRoom();
      refreshChats();
    });

  const auto = $("#autoReply");
  auto.checked = !!Number(chatMeta?.auto_reply ?? 0);
  auto.onchange = async () => {
    await api(`/chats/${S.chatId}/auto`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: auto.checked }),
    });
    if (chatMeta) chatMeta.auto_reply = auto.checked ? 1 : 0;
  };

  const scenario = $("#roomScenario");
  scenario.value = chatMeta?.scenario ?? "";
  scenario.onchange = async () => {
    await api("/chats/" + S.chatId, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: scenario.value }),
    });
    if (chatMeta) chatMeta.scenario = scenario.value;
  };

  if (!$("#castDialog").open) $("#castDialog").showModal();
}

/* ---- the quill -------------------------------------------------------------
 * A pen scratching as the reply is written.
 *
 * Tuned against a real recording of a quill on parchment rather than by ear,
 * because two guesses had already been wrong in opposite directions. Measured
 * off that reference, in bands, relative to its loudest:
 *
 *     125-250  0.46      1k-2k  0.47      4k-8k   1.00
 *     250-500  0.32      2k-4k  0.62      8k-16k  0.77
 *
 * So a quill is *bright* — its energy lives between four and eight kilohertz.
 * The first attempt fired short bright bursts, which is the right colour at
 * the wrong rate and sounds like typing. The second rolled everything above
 * 3kHz away to fix that, which left a low continuous hiss: quieter on paper,
 * far more annoying in a room, and the reason it still read as loud.
 *
 * The envelope of the reference is 17% near-silent with peaks under three
 * times its mean — continuous friction, varying constantly, with the pen
 * lifting now and then. Not a click, not a flat hiss. That is what this
 * follows, at a fraction of the recording's level, since a recording is
 * mastered to be heard and this only has to be noticed.
 */
const quill = (() => {
  let ctx = null;
  let gain = null;
  let band = null;
  let wobble = 0;
  let lastAt = 0;
  let voicing = false;

  const BASE = 0.016;         // quiet: this sits under the room, not in it
  const QUIET_AFTER = 200;    // ms without new letters before the pen lifts

  const build = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    // Rumble out: everything the reference has below a kilohertz is body, not
    // sound, and on a phone speaker it only muddies.
    const cut = ctx.createBiquadFilter();
    cut.type = "highpass";
    cut.frequency.value = 1100;

    // The scratch itself, sat where the reference peaks.
    band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 5200;
    band.Q.value = 0.45;      // broad: a nib is not a whistle

    // Takes the hiss off the very top without dulling it back to a rumble.
    const top = ctx.createBiquadFilter();
    top.type = "lowpass";
    top.frequency.value = 11000;

    gain = ctx.createGain();
    gain.gain.value = 0;

    src.connect(cut).connect(band).connect(top).connect(gain).connect(ctx.destination);
    src.start();
    return ctx;
  };

  const stir = () => {
    if (!ctx || !voicing) return;
    const t = ctx.currentTime;
    if (performance.now() - lastAt > QUIET_AFTER) {
      voicing = false;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(0, t + 0.14);
      clearInterval(wobble);
      wobble = 0;
      return;
    }
    // Roughly one stroke in six is the pen lifting, which is what the
    // reference's near-silent sixth of a second is.
    const lift = Math.random() < 0.17;
    const level = lift ? BASE * 0.12 : BASE * (0.45 + Math.random() * 0.85);
    gain.gain.linearRampToValueAtTime(level, t + 0.1);
    band.frequency.linearRampToValueAtTime(4200 + Math.random() * 2200, t + 0.1);
  };

  return {
    /** Letters are appearing. Keeps the scratch alive; it lifts on its own. */
    scratch() {
      if (!$("#sound")?.checked) return;
      lastAt = performance.now();
      const c = build();
      if (!c || c.state !== "running") return;
      if (voicing) return;

      voicing = true;
      const t = c.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(BASE, t + 0.05);
      clearInterval(wobble);
      wobble = setInterval(stir, 110);
    },
    /** Called from a click, because a context may not start without a gesture. */
    prime() {
      if (!$("#sound")?.checked) return;
      const c = build();
      if (c?.state === "suspended") c.resume().catch(() => {});
    },
  };
})();

/* ---- the character sheet ---------------------------------------------------
   Shown only in tabletop mode, and only for whoever you are currently playing.
   A sheet nobody is holding is a form; a sheet attached to the persona the
   narrator is talking to is a character. */

let activePersonaId = null;
const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_NAME = { str: "Strength", dex: "Dexterity", con: "Constitution",
                    int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const mod = (n) => Math.floor((n - 10) / 2);
const sgn = (n) => (n < 0 ? `${n}` : `+${n}`);

async function refreshSheet() {
  const section = $("#sheetSection");
  if (!section) return;
  const tabletop = document.body.dataset.mode === "tabletop";
  section.hidden = !tabletop;
  if (!tabletop || !activePersonaId) {
    if (tabletop) {
      $("#sheetBody").innerHTML =
        `<p class="hint">Make a persona and set it active — the sheet belongs to whoever you are playing.</p>`;
    }
    return;
  }

  let sheet = null;
  try { ({ sheet } = await api(`/sheets/${activePersonaId}`)); } catch {}
  $("#sheetBody").innerHTML = sheet ? sheetCard(sheet) : await classChooser();
  wireSheet(sheet);
}

/* ---- the scene, and who is standing in it -----------------------------------
   Everything here was written by the narrator rather than by you: it writes
   [[scene: ...]] and [[npc: ...]] inside its own prose as the story moves, the
   server keeps what it said, and this is where it comes back as furniture. The
   panel is hidden until the game has actually met somebody, so a story that
   has not left the fireside is not given an empty list to look at. */

/* ---- the initiative tracker -------------------------------------------------
   A fight is the one time a chat window needs a heads-up display, so one pulls
   up from the bottom while there is one and goes away when there is not.

   The throw is real and the sorting is real; what is staged is the order of
   events. The server rolls everyone at once and stores them already sorted, so
   the tracker uses the arrival order each combatant carries (see `entered` in
   fight.ts) to put the room back the way it was before anybody rolled — then
   lands the dice one at a time and lets the list sort itself. Nothing invented:
   every number on screen is the number the server rolled. */

let trackKey = "";          // which fight is on screen, so a new one animates
let trackFolded = false;

function renderTrack(fight) {
  const track = $("#initTrack");
  const rows = $("#initRows");
  if (!track) return;

  if (!fight || document.body.dataset.mode !== "tabletop") {
    if (!track.hidden && !track.classList.contains("going")) {
      track.classList.add("going");
      setTimeout(() => { track.hidden = true; track.classList.remove("going"); }, 420);
    }
    trackKey = "";
    return;
  }

  // A different fight, not the same one a message later.
  const key = fight.order.map((c) => `${c.name}:${c.initiative}`).join("|");
  const fresh = key !== trackKey;
  trackKey = key;

  track.hidden = false;
  track.classList.remove("going");
  track.classList.toggle("folded", trackFolded);

  const up = fight.order[fight.turn] ?? null;
  $("#initGripNow").textContent = up ? `${up.name} is up` : "";

  const row = (c, i) => {
    const left = Math.max(0, Math.round((c.hp / c.maxHp) * 100));
    return `<button type="button" class="initwho${c.player ? " you" : ""}` +
      `${c.hp <= 0 ? " out" : ""}${i === fight.turn ? " up" : ""}" data-who="${esc(c.name)}"` +
      ` title="Hand ${esc(c.name)} the turn">` +
      `<span class="initroll2" data-roll="${c.initiative}">${c.initiative}</span>` +
      `<span class="initname2">${esc(c.name)}</span>` +
      `<span class="inithp">${c.hp <= 0 ? "down" : `${c.hp}/${c.maxHp}`}</span>` +
      `<span class="initbar"><span style="width:${left}%"></span></span>` +
      `</button>`;
  };
  // A card per combatant, side by side in the order they act — so the turn
  // order is a thing you read left to right rather than a list you scan.

  if (!fresh) {
    rows.innerHTML = fight.order.map(row).join("");
    wireTrack();
    return;
  }

  /*
   * A new fight: show the room before the dice, then land them.
   *
   * Everyone appears in the order the narrator named them with an empty
   * marker, each rattles and settles on its real roll in turn, and only then
   * does the list sort itself into initiative order.
   */
  const arrival = [...fight.order].sort((a, b) => a.entered - b.entered);
  rows.innerHTML = arrival.map((c, i) => row(c, -1)).join("");
  wireTrack();

  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm) { rows.innerHTML = fight.order.map(row).join(""); wireTrack(); return; }

  const els = [...rows.children];
  els.forEach((el) => {
    el.classList.add("rolling");
    el.querySelector(".initroll2").textContent = "—";
  });

  arrival.forEach((c, i) => {
    setTimeout(() => {
      // The tracker may have moved on to another fight while these were queued.
      if (trackKey !== key || !el(els, i)) return;
      const node = els[i];
      node.classList.remove("rolling");
      node.classList.add("justlanded");
      node.querySelector(".initroll2").textContent = String(c.initiative);
      setTimeout(() => node.classList.remove("justlanded"), 450);
      if (i === arrival.length - 1) setTimeout(() => sortTrack(fight, key), 380);
    }, 260 + i * 230);
  });
}

/** Guards a staggered callback against the list having been rebuilt under it. */
const el = (list, i) => list[i]?.isConnected ? list[i] : null;

/**
 * The sort, animated.
 *
 * FLIP: measure where every row is, reorder the list, measure again, put each
 * row back where it started with a transform and then release it. Animating
 * the positions rather than re-rendering is what makes it read as the table
 * sorting itself out rather than as a list being replaced.
 */
function sortTrack(fight, key) {
  const rows = $("#initRows");
  if (!rows || trackKey !== key) return;

  const before = new Map();
  for (const node of rows.children) {
    const box = node.getBoundingClientRect();
    before.set(node.dataset.who, { x: box.left, y: box.top });
  }

  const order = new Map(fight.order.map((c, i) => [c.name, i]));
  [...rows.children]
    .sort((a, b) => (order.get(a.dataset.who) ?? 0) - (order.get(b.dataset.who) ?? 0))
    .forEach((node) => rows.appendChild(node));

  for (const node of rows.children) {
    const was = before.get(node.dataset.who);
    if (!was) continue;
    const box = node.getBoundingClientRect();
    // Both axes: the cards sit side by side, so a sort mostly moves them
    // sideways — and could move them down a line if the row ever wrapped.
    const dx = was.x - box.left, dy = was.y - box.top;
    if (!dx && !dy) continue;
    node.style.transition = "none";
    node.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /*
   * Then let go — this frame, not the next one.
   *
   * Reading a layout property flushes the styles above, so the browser has
   * already taken the old positions as the starting point and clearing the
   * transform animates from there. The obvious version releases them inside
   * requestAnimationFrame, and that version is broken: rAF is parked while
   * the app is in the background, so a fight that started as you switched
   * away came back with every card frozen in its pre-sort position and
   * `transition: none` still on it. Same trap as the boot screen and the
   * doors, third time in this codebase.
   */
  rows.getBoundingClientRect();
  for (const node of rows.children) {
    node.style.transition = "";
    node.style.transform = "";
  }

  // And the marker arrives once the shuffling has stopped. A timer, for the
  // same reason: throttled in the background, but it does run.
  setTimeout(() => {
    if (trackKey !== key) return;
    const who = fight.order[fight.turn]?.name;
    for (const node of rows.children) node.classList.toggle("up", node.dataset.who === who);
  }, 560);
}

function wireTrack() {
  for (const node of $("#initRows").children) {
    node.onclick = async () => {
      // The narrator moves this nearly always; this is for when a reply
      // covered three combatants and named none of them.
      try {
        const { fight } = await api(`/chats/${S.chatId}/fight/turn`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: node.dataset.who }),
        });
        renderTrack(fight);
        refreshWorld();
      } catch { /* A fight that ended between the render and the tap. */ }
    };
  }
}

$("#initGrip").onclick = () => {
  trackFolded = !trackFolded;
  $("#initTrack").classList.toggle("folded", trackFolded);
  $("#initGrip").setAttribute("aria-expanded", String(!trackFolded));
};

async function refreshWorld() {
  const section = $("#worldSection");
  if (!section) return;
  if (document.body.dataset.mode !== "tabletop" || !S.chatId) {
    section.hidden = true;
    renderTrack(null);
    return;
  }

  let where = "", cast = [], fight = null;
  try {
    const data = await api(`/chats/${S.chatId}/npcs`);
    where = data.location ?? "";
    cast = Array.isArray(data.npcs) ? data.npcs : [];
    fight = data.fight ?? null;
  } catch { section.hidden = true; renderTrack(null); return; }

  // The tracker is driven from the same fetch as the panel, so the two can
  // never disagree about whether a fight is happening.
  renderTrack(fight);

  section.hidden = !where && !cast.length && !fight;
  if (section.hidden) return;

  $("#worldBody").innerHTML =
    /*
     * A fight goes first and loudest. While one is happening it is the only
     * thing in the panel anybody is looking at, and the number that matters
     * is how much of each combatant is left — so a bar, which you read at a
     * glance, rather than a fraction, which you have to do arithmetic on.
     */
    (fight
      ? `<div class="fightbox">
          <div class="fighthead">
            <span>In the fight</span>
            <button class="ico" id="fightOff" title="Call it off"
                    aria-label="Call off the fight">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </div>
          ${fight.order.map((c) => {
            const left = Math.max(0, Math.round((c.hp / c.maxHp) * 100));
            return `<div class="combat${c.player ? " you" : ""}${c.hp <= 0 ? " out" : ""}">
              <span class="cbname">${esc(c.name)}</span>
              <span class="cbhp">${c.hp <= 0 ? "down" : `${c.hp}/${c.maxHp}`}</span>
              <span class="cbbar"><span style="width:${left}%"></span></span>
            </div>`;
          }).join("")}
        </div>`
      : "") +
    (where
      ? `<div class="wherenow"><span class="wheretext">${esc(where)}</span>` +
        `<button class="ico" id="whereEdit" title="Somewhere else" aria-label="Change where everyone is">` +
        `<svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button></div>`
      : "") +
    (cast.length
      ? `<ul class="metlist">${cast.map((n) => `
          <li data-npc="${n.id}">
            <span class="metrow">
              <span class="metname">${esc(n.name)}</span>
              ${n.brief ? `<span class="metbrief">${esc(n.brief)}</span>` : ""}
            </span>
            <button class="ico" data-forget="${n.id}" title="Forget them"
                    aria-label="Forget ${esc(n.name)}">
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
          </li>`).join("")}</ul>`
      : "");

  // Someone the party left three towns ago should stop crowding the prompt.
  // Hidden rather than unmade, like everything else — they may walk back in.
  for (const b of section.querySelectorAll("[data-forget]")) {
    b.onclick = async () => {
      await api(`/npcs/${b.dataset.forget}`, { method: "DELETE" });
      refreshWorld();
    };
  }

  const off = $("#fightOff");
  if (off) off.onclick = async () => {
    if (!(await ask("Call off this fight? Everyone keeps the damage they took."))) return;
    await api(`/chats/${S.chatId}/fight`, { method: "DELETE" });
    refreshWorld();
    refreshSheet();
  };

  const edit = $("#whereEdit");
  if (edit) edit.onclick = () => {
    const line = section.querySelector(".wherenow");
    line.innerHTML = `<input class="whereinput" value="${esc(where)}" maxlength="160">`;
    const box = line.querySelector("input");
    box.focus();
    box.select();
    const save = async () => {
      box.onblur = null;                       // Enter would otherwise save twice.
      await api(`/chats/${S.chatId}/location`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: box.value.trim() }),
      });
      refreshWorld();
    };
    box.onblur = save;
    box.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") { box.onblur = null; refreshWorld(); }
    };
  };
}

/**
 * An ability, drawn as a ring with its modifier on a medallion.
 *
 * The modifier is the number you use and the score is the number you own, so
 * the score sits in the middle and the modifier hangs off it — which is how
 * every paper sheet has done it for fifty years, and why it reads instantly.
 * The whole thing is a button: pressing Dexterity rolls Dexterity.
 */
function abilityRing(sheet, a, big) {
  const score = sheet.abilities[a];
  return `
    <button class="ring${big ? " big" : ""}" data-roll-ability="${a}"
            title="Roll a ${ABIL_NAME[a]} check" aria-label="Roll a ${ABIL_NAME[a]} check">
      <span class="ringname">${ABIL_NAME[a]}</span>
      <span class="ringdisc">
        <span class="ringscore">${score}</span>
      </span>
      <span class="ringmod">${sgn(mod(score))}</span>
    </button>`;
}

/** The condensed sheet, for the sidebar. */
function sheetCard(sheet) {
  const rings = ABIL.map((a) => abilityRing(sheet, a, false)).join("");
  return `
    <div class="charsheet">
      <div class="cshead">
        ${medallion(S.personaAvatar, S.personaName || "You", "csface")}
        <span class="csclass">Level ${sheet.level} ${esc(klassName(sheet.klass))}</span>
        <span class="cshp"><span id="hpNow">${sheet.hp}</span> / ${sheet.maxHp} hp</span>
      </div>
      <div class="csstats">${rings}</div>
      <div class="hprow">
        <button class="ico" data-hp="-1" title="Take a point" aria-label="Take a point">–</button>
        <button class="ico" data-hp="1" title="Heal a point" aria-label="Heal a point">+</button>
        <span class="grow"></span>
        <button class="ico" id="csRoll" title="Roll dice" aria-label="Roll dice">
          <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.3" fill="currentColor" stroke="none"/></svg>
        </button>
        <button class="ico" id="csOpen" title="Open the full sheet" aria-label="Open the full sheet">
          <svg viewBox="0 0 24 24"><path d="M8 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9"/><path d="M14 3h7v7"/><path d="M21 3l-9 9"/></svg>
        </button>
      </div>
      <button class="ghost wide" id="csReroll">Start again with a different character</button>
    </div>`;
}

/** The full sheet, for the dialog. */
function fullSheet(sheet, name) {
  const rings = ABIL.map((a) => abilityRing(sheet, a, true)).join("");
  const skills = sheet.skills.map((k) => `<li>${esc(k)}</li>`).join("");
  const kit = sheet.inventory.map((i) => `<li>${esc(i)}</li>`).join("");
  const pips = Array.from({ length: sheet.maxHp }, (_, i) =>
    `<span class="pip${i < sheet.hp ? " lit" : ""}"></span>`).join("");
  /*
   * The portrait, at the top, the way every paper sheet puts the art.
   *
   * It is the persona's own avatar rather than a separate picture to manage:
   * the sheet is for who you are already playing, and asking somebody to set
   * a second image for the same character would be a chore with no payoff.
   */
  const face = S.personaAvatar
    ? `<span class="fsface" style="background-image:url(&quot;${encodeURI(S.personaAvatar)}&quot;)"></span>`
    : `<span class="fsface blank">${initial(name)}</span>`;

  return `
    <div class="fsportrait">${face}</div>
    <h2 class="fsname">${esc(name)}</h2>
    <div class="fsbanner">
      <span>${esc(klassName(sheet.klass))}</span>
      <span class="fsdot">&#9670;</span>
      <span>Level ${sheet.level}</span>
    </div>

    <div class="fsrings">${rings}</div>

    <section class="fspanel">
      <h3>Health</h3>
      <div class="fshp">
        <span class="fshpnum"><span id="fsHpNow">${sheet.hp}</span> / ${sheet.maxHp}</span>
        <div class="pips">${pips}</div>
      </div>
      <div class="hprow">
        <button class="ico" data-hp="-1" aria-label="Take a point">–</button>
        <button class="ico" data-hp="1" aria-label="Heal a point">+</button>
        <span class="hint">At zero you are down, not gone.</span>
      </div>
    </section>

    <div class="fscols">
      <section class="fspanel">
        <h3>Trained in</h3>
        ${skills ? `<ul class="fslist">${skills}</ul>` : `<p class="hint">Nothing yet.</p>`}
      </section>
      <section class="fspanel">
        <h3>Carrying</h3>
        ${kit ? `<ul class="fslist">${kit}</ul>` : `<p class="hint">Empty-handed.</p>`}
      </section>
    </div>

    <p class="hint fsfoot">Press an ability to roll a check with it. The result goes to the table.</p>`;
}

let CLASS_CACHE = null;
async function classChooser() {
  if (!CLASS_CACHE) {
    try { CLASS_CACHE = await api("/tabletop/classes"); } catch { CLASS_CACHE = []; }
  }
  const cards = CLASS_CACHE.map((k) => `
    <button class="classcard" data-klass="${k.id}">
      <span class="t">${esc(k.name)}</span>
      <span class="s">${esc(k.blurb)}</span>
      <span class="kbits">d${k.hitDie} &middot; ${k.primary.map((p) => p.toUpperCase()).join(" / ")}</span>
    </button>`).join("");
  return `
    <p class="hint">Pick what you are. The two abilities your class leans on get your best scores.</p>
    <div class="classes">${cards}</div>
    <label class="check"><input type="checkbox" id="sheetArray"> Take an even spread instead of rolling</label>`;
}

const klassName = (id) => (CLASS_CACHE ?? []).find((k) => k.id === id)?.name ?? id;

/** A check the player asked for. It goes to the table, like any other roll. */
async function rollCheck(ability) {
  try {
    const { text, check } = await api(`/sheets/${activePersonaId}/check`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ability, chat: S.chatId }),
    });
    if (!S.chatId) { toast(text); return; }
    closeDrawer();
    $("#sheetDialog").close();
    // Pressing your own Dexterity and being told to roll it by the story are
    // the same die and get the same throw; two different treatments of one
    // roll would make the sheet feel like a different app.
    await showDie({
      label: `${ABIL_NAME[ability]} check`,
      die: check.die,
      total: check.total,
      parts: [
        { label: "d20", value: check.die },
        { label: ABIL_NAME[ability], value: check.modifier },
      ],
    });
    run("reply", `[[${text}]]`);
  } catch (err) {
    fail(err?.message ?? "Could not roll that.");
  }
}

function wireRolls(root, sheet) {
  root.querySelectorAll("[data-roll-ability]").forEach((b) => {
    b.onclick = () => rollCheck(b.dataset.rollAbility);
  });
  root.querySelectorAll("[data-hp]").forEach((b) => {
    b.onclick = async () => {
      const next = Math.max(0, Math.min(sheet.maxHp, sheet.hp + Number(b.dataset.hp)));
      if (next === sheet.hp) return;
      sheet.hp = next;
      document.querySelectorAll("#hpNow, #fsHpNow").forEach((el) => (el.textContent = next));
      document.querySelectorAll(".pips .pip").forEach((p, i) => p.classList.toggle("lit", i < next));
      try {
        await api(`/sheets/${activePersonaId}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ sheet, kind: "persona" }),
        });
      } catch { fail("Could not save that."); }
    };
  });
}

async function openFullSheet(sheet) {
  const dlg = $("#sheetDialog");
  $("#fsBody").innerHTML = fullSheet(sheet, S.personaName || "You");
  wireRolls($("#fsBody"), sheet);
  dlg.showModal();
}

$("#fsClose").onclick = () => $("#sheetDialog").close();

function wireSheet(sheet) {
  const body = $("#sheetBody");
  body.querySelectorAll("[data-klass]").forEach((b) => {
    b.onclick = async () => {
      const how = $("#sheetArray")?.checked ? "array" : "roll";
      try {
        await api(`/sheets/${activePersonaId}/roll`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ klass: b.dataset.klass, how, kind: "persona" }),
        });
        await refreshSheet();
        toast(how === "roll" ? "Rolled." : "Set.");
      } catch (err) { fail(err?.message ?? "Could not make that sheet."); }
    };
  });

  if (sheet) wireRolls(body, sheet);

  const open = $("#csOpen");
  if (open) open.onclick = () => openFullSheet(sheet);

  const die = $("#csRoll");
  if (die) die.onclick = () => $("#diceBtn").click();

  const again = $("#sheetReroll");
  if (again) {
    again.onclick = async () => {
      if (!(await ask("Start again?", "The sheet you have now is replaced."))) return;
      await api(`/sheets/${activePersonaId}`, { method: "DELETE" });
      await refreshSheet();
    };
  }
}

/* ---- modes -------------------------------------------------------------
 * Hearth is a chat app, and Hearth is a tabletop. Same rooms, different table.
 *
 * The switch is shown as a change of room rather than a setting taking effect:
 * the doors shut, the sign above them changes, and they open on the other
 * mode. It is theatre, and it is the point — a mode you can feel yourself
 * walking into is a mode you remember you are in, which matters when the
 * difference is whether a narrator rolls for what happens to you.
 */

const MODES = {
  story: { sign: "HEARTH", title: "Hearth" },
  tabletop: { sign: "HEARTH: TABLETOP", title: "Hearth: Tabletop" },
};

function applyMode(mode) {
  const m = MODES[mode] ? mode : "story";
  document.body.dataset.mode = m;
  if ($("#splash").hidden === false || !S.chatId) setBarTitle(MODES[m].title);
  if ($("#modeCardTitle")) paintModeCard();
  if ($("#show_stats")) applyToggles();
  // Who you are is a different answer in each room, so the list and the sheet
  // are both redrawn. refreshPersonas repaints the sheet on its way out.
  if ($("#personaList")) refreshPersonas();
  else if ($("#sheetSection")) refreshSheet();
  // The shelf is per-room too.
  if ($("#loreList")) refreshLore();
  if ($("#worldSection")) refreshWorld();
  // The table has its own cast, and its own way of adding to it.
  if ($("#bringOverBtn")) $("#bringOverBtn").hidden = m !== "tabletop";
  // Walking through the door changes what a reply is allowed to be rerolled,
  // and whether it can be rewritten at all.
  for (const bar of document.querySelectorAll(".swipes")) capSwipes(bar);
  applyEditLock();
  return m;
}

/**
 * Walks you from one mode to the other.
 *
 * The work happens while the doors are shut, so nothing is ever seen
 * half-changed. If it fails, the doors still open — being stuck behind them
 * would be a far worse bug than a mode that did not change.
 */
async function switchMode(to, doWork) {
  const doors = $("#doors");
  const mode = MODES[to] ? to : "story";
  const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;

  doors.hidden = false;
  /*
   * A frame between unhidden and shut, or the transition has nothing to
   * animate from and the doors simply appear closed.
   *
   * Whichever comes first, a frame or a moment. A backgrounded tab stops
   * serving frames, and waiting only on one leaves you stood in a doorway
   * that never closes — the mode never changes and nothing says why. The
   * animation is worth a frame; correctness is not worth waiting for one.
   */
  await new Promise((r) => {
    let done = false;
    const go = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 60);
  });
  doors.classList.add("shut");
  await new Promise((r) => setTimeout(r, quick ? 0 : 640));

  $("#doorText").textContent = MODES[mode].sign;
  try {
    await doWork?.();
  } catch (err) {
    console.error("Hearth: switching mode failed", err);
  }
  applyMode(mode);

  await new Promise((r) => setTimeout(r, quick ? 120 : 620));
  doors.classList.remove("shut");
  await new Promise((r) => setTimeout(r, quick ? 0 : 640));
  doors.hidden = true;
}

function paintModeCard() {
  const tabletop = document.body.dataset.mode === "tabletop";
  $("#modeCardTitle").textContent = tabletop ? "Leave tabletop mode" : "Tabletop mode";
  $("#modeCardSub").textContent = tabletop
    ? "Back to ordinary chats"
    : "Sheets, classes and a narrator who rolls";
}

$("#modeCard").onclick = () =>
  setMode(document.body.dataset.mode === "tabletop" ? "story" : "tabletop");

async function setMode(to) {
  await switchMode(to, async () => {
    await api("/settings", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: to }),
    });
    // Opening the door onto a table with nobody at it would be a poor trick.
    // Idempotent, and it leaves a deleted narrator deleted.
    if (to === "tabletop") {
      try { await api("/tabletop/narrator", { method: "POST" }); } catch {}
    }
    await refreshCast();
    await showSplash();
  });
}

/* ---- extensions -------------------------------------------------------------
 * Other people's code, running in the page.
 *
 * The server half lives in src/extensions.ts; this is the other one. An
 * extension registers against `hearth` and gets called back when things
 * happen: a message is drawn, a turn is about to be sent, the app has
 * finished loading.
 *
 * Everything an extension does is wrapped. A hook that throws is reported and
 * skipped, and a hook returning the wrong shape leaves the value it was given
 * alone — one broken extension should cost you that extension, not your chat.
 *
 * There is no sandbox here and none is implied. Code in the page can reach the
 * page; that is what makes it able to do anything worth doing. See the note
 * where extensions are installed.
 */
const EXT = { hooks: new Map(), styles: null };

function extHooks(hook) {
  return EXT.hooks.get(hook) ?? [];
}

/** Runs a hook for its side effects only. */
function extNotify(hook, ...args) {
  for (const { name, fn } of extHooks(hook)) {
    try { fn(...args); }
    catch (err) { console.error(`[extension] ${name} threw in ${hook}`, err); }
  }
}

/** Runs a hook that may transform a value, and refuses a nonsense answer. */
function extTransform(hook, value) {
  let current = value;
  for (const { name, fn } of extHooks(hook)) {
    try {
      const out = fn(current);
      if (out !== undefined && out !== null && typeof out === typeof current) current = out;
    } catch (err) {
      console.error(`[extension] ${name} threw in ${hook}`, err);
    }
  }
  return current;
}

const CLIENT_HOOKS = ["ready", "message:render", "send:before"];

function extApi(name) {
  return {
    on(hook, fn) {
      if (!CLIENT_HOOKS.includes(hook)) {
        console.error(`[extension] ${name}: unknown hook "${hook}"`);
        return;
      }
      if (typeof fn !== "function") return;
      EXT.hooks.set(hook, [...extHooks(hook), { name, fn }]);
    },
    /** A button in the composer's row, beside continue and regenerate. */
    addButton(label, onClick, icon) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ico";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.innerHTML = icon ?? `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg>`;
      b.onclick = () => {
        try { onClick(); }
        catch (err) { console.error(`[extension] ${name} threw from ${label}`, err); }
      };
      $(".quickrow").appendChild(b);
      return b;
    },
    /** Styling, in one element per session rather than one per call. */
    css(text) {
      if (!EXT.styles) {
        EXT.styles = document.createElement("style");
        EXT.styles.id = "extensionCss";
        document.head.appendChild(EXT.styles);
      }
      EXT.styles.append(`
/* ${name} */
${text}`);
    },
    log: (...args) => console.log(`[${name}]`, ...args),
    /** Read-only facts an extension might reasonably want. */
    get chatId() { return S.chatId; },
    get characterName() { return S.charName; },
  };
}

async function loadExtensions() {
  EXT.hooks.clear();
  let list = [];
  try { list = await api("/extensions"); } catch { return; }
  if (!Array.isArray(list)) return;

  for (const e of list) {
    if (!e.enabled || !String(e.client ?? "").trim()) continue;
    try {
      // Function rather than eval, so an extension cannot see this scope.
      new Function("hearth", `"use strict";
${e.client}`)(extApi(e.name));
    } catch (err) {
      console.error(`[extension] ${e.name} failed to load`, err);
      toast(`${e.name} could not load.`);
    }
  }
  extNotify("ready");
}


/* ---- managing extensions ---------------------------------------------------
   The list, and the three ways one arrives: pasted from a repository, written
   here, or imported from a file. */

let extensions = [];

function paintExtensions() {
  const list = $("#extList");
  list.innerHTML = "";
  if (!extensions.length) {
    list.innerHTML = `<p class="hint">Nothing installed yet.</p>`;
    return;
  }
  for (const e of extensions) {
    const row = document.createElement("div");
    row.className = "item ext" + (e.enabled ? "" : " off");
    const halves = [e.client.trim() && "page", e.server.trim() && "server"].filter(Boolean).join(" + ");
    row.innerHTML =
      `<label class="exton"><input type="checkbox" ${e.enabled ? "checked" : ""} aria-label="Enabled"></label>` +
      `<span class="meta"><span class="t">${esc(e.name)}` +
      `<span class="when">${esc(e.version)}</span></span>` +
      `<span class="preview">${esc(e.description || "No description")}</span>` +
      `<span class="s">${halves || "nothing to run"}</span></span>` +
      `<span class="rowtools">` +
      `<button data-edit title="Edit" aria-label="Edit">${ICON.edit}</button>` +
      `<button data-del title="Remove" aria-label="Remove">${ICON.del}</button>` +
      `</span>`;
    row.querySelector("input").onchange = async (ev) => {
      await api(`/extensions/${e.id}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: ev.target.checked }),
      });
      await refreshExtensions();
      toast("Reload for that to take effect.");
    };
    row.querySelector("[data-edit]").onclick = () => editExtension(e);
    row.querySelector("[data-del]").onclick = async () => {
      if (!(await ask(`Remove ${e.name}?`, "Its code goes with it."))) return;
      await api(`/extensions/${e.id}`, { method: "DELETE" });
      await refreshExtensions();
    };
    list.appendChild(row);
  }
}

async function refreshExtensions() {
  try { extensions = await api("/extensions"); }
  catch { extensions = []; }
  if (!Array.isArray(extensions)) extensions = [];
  paintExtensions();
}

function editExtension(e) {
  const dlg = $("#extDialog");
  $("#extTitle").textContent = e ? e.name : "New extension";
  $("#extName").value = e?.name ?? "";
  $("#extDesc").value = e?.description ?? "";
  $("#extClient").value = e?.client ?? "";
  $("#extServer").value = e?.server ?? "";
  dlg.returnValue = "";
  dlg.showModal();
  dlg.onclose = async () => {
    if (dlg.returnValue !== "save") return;
    const body = {
      name: $("#extName").value.trim() || "Untitled extension",
      description: $("#extDesc").value.trim(),
      client: $("#extClient").value,
      server: $("#extServer").value,
    };
    if (e) await api(`/extensions/${e.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    else await api("/extensions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await refreshExtensions();
    toast("Reload for that to take effect.");
  };
}

$("#extAdd").onclick = () => editExtension(null);

$("#extInstall").onclick = async () => {
  const url = $("#extUrl").value.trim();
  if (!url) return;
  const btn = $("#extInstall");
  btn.disabled = true;
  btn.textContent = "Fetching…";
  try {
    const made = await api("/extensions/install", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    $("#extUrl").value = "";
    await refreshExtensions();
    toast(`${made.name} installed. Reload to run it.`);
  } catch (err) {
    fail(err?.message ?? "Could not install that.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Install";
  }
};
$("#extUrl").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#extInstall").click(); }
});

$("#extImportBtn").onclick = () => $("#extImport").click();
$("#extImport").onchange = async (e) => {
  for (const file of [...e.target.files]) {
    try {
      const body = JSON.parse(await file.text());
      await api("/extensions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } catch {
      fail(`${file.name} is not an extension.`);
    }
  }
  e.target.value = "";
  await refreshExtensions();
};

// ---- generation ---------------------------------------------------------

async function run(mode, content = "", forcedGuide = "") {
  if (S.busy || !S.chatId) return;
  const chatId = S.chatId;
  S.busy = true;
  S.generating = chatId;
  S.abort = new AbortController();
  leftDuringRun = false;
  quill.prime();
  $("#sendBtn").disabled = true;
  $("#stopBtn").disabled = false;
  $("#stopBtn").hidden = false;

  const thread = $("#thread");
  let target, existingText = "";
  /** A swipe's discarded reasoning, kept only so a failed swipe can undo. */
  let staleThink = null;

  if (mode === "reply" || mode === "silent") {
    if (content) thread.appendChild(messageEl({ role: "user", content }));
    target = messageEl({ role: "assistant", content: "" });
    thread.appendChild(target);
  } else if (mode === "continue") {
    target = thread.querySelector(".msg:not(.mine):last-of-type");
    const all = [...thread.querySelectorAll(".msg")];
    target = all[all.length - 1];
    if (!target || target.classList.contains("mine")) {
      fail("There is no reply to continue.");
      return done();
    }
    existingText = target.dataset.raw;
  } else if (mode === "swipe") {
    const all = [...thread.querySelectorAll(".msg")];
    target = all[all.length - 1];
    if (!target || target.classList.contains("mine")) {
      fail("There is no reply to swipe.");
      return done();
    }
    target.querySelector(".body").innerHTML = "";
    /*
     * The reasoning goes with it.
     *
     * A swipe replaces the reply, and the thinking belonged to the reply being
     * replaced — clearing only the body left the previous take's "Thought for
     * 8s" sitting above an empty bubble, which reads as the model still
     * thinking about something it has already forgotten. A new block is made
     * when new reasoning arrives, so there is nothing to put back unless this
     * generation never happens; see abandon().
     */
    staleThink = target.querySelector(".think");
    staleThink?.remove();
  } else if (mode === "impersonate") {
    target = messageEl({ role: "user", content: "" });
    thread.appendChild(target);
  }

  const body = target.querySelector(".body");
  body.classList.add("cursor");
  // Asking for a reply is a decision to watch it arrive, so this one wins
  // even if you had scrolled away from the bottom beforehand.
  stick(true);

  /**
   * Give up on this generation and leave the thread as the database has it.
   * Reply, silent and impersonate drew a fresh bubble that can simply go away.
   * Continue and swipe are working on a message that still exists, so removing
   * it would wipe a turn from the screen that is very much still saved.
   */
  const abandon = () => {
    if (mode === "continue" || mode === "swipe") {
      body.innerHTML = prose(target.dataset.raw ?? "");
      // The text is back, so the reasoning that went with it should be too.
      if (staleThink && !target.querySelector(".think")) body.before(staleThink);
    } else {
      target.remove();
    }
  };

  let text = "";
  let think = "";

  /*
   * The reveal.
   *
   * A provider does not send prose evenly — it sends nothing for two hundred
   * milliseconds and then eleven words at once, so text landed on screen in
   * slabs. Deltas now go into a queue that is drained on a frame timer, which
   * is what makes it read as writing rather than as paste.
   *
   * The rate is proportional to how far behind the queue is, so it hurries
   * when a big chunk lands and eases as it catches up, and never stalls or
   * dumps. Nothing is lost either way: the queue is flushed before the text is
   * used for anything, and the message is saved server-side regardless.
   */
  let queued = "";
  let frame = 0;

  const paint = () => {
    body.innerHTML = prose(existingText + text);
    stick();
  };

  const pump = () => {
    frame = 0;
    if (!queued) return;
    const take = Math.min(queued.length, Math.max(2, Math.ceil(queued.length / 8)));
    text += queued.slice(0, take);
    queued = queued.slice(take);
    paint();
    quill.scratch();
    if (queued) frame = requestAnimationFrame(pump);
  };

  /** Everything received is on screen, now, with no animation left owing. */
  const flush = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    if (!queued) return;
    text += queued;
    queued = "";
    paint();
  };
  const t0 = Date.now();
  const tick = setInterval(() => {
    const el = target.querySelector(".meta-line");
    if (el) el.innerHTML = `${metaLine({ created_at: Date.now() })} &middot; ${((Date.now() - t0) / 1000).toFixed(1)}s`;
  }, 200);
  try {
    const res = await fetch(`/api/chats/${chatId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, mode, guide: forcedGuide || guideText(), speaker: S.speaker || "" }),
      signal: S.abort.signal,
    });
    // A refusal comes back as plain JSON, not as a stream. Without this the
    // reader below finds no `data:` frames and the reason is never shown.
    if (!res.ok) {
      let why = `The server replied ${res.status}.`;
      try { why = JSON.parse(await res.text()).error ?? why; } catch {}
      abandon();
      fail(why);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5));
        if (evt.userMessageId) {
          // The row was drawn optimistically; now it has an id it can be edited.
          const mine = [...thread.querySelectorAll(".msg.mine")].pop();
          if (mine && !mine.dataset.id) {
            mine.dataset.id = evt.userMessageId;
            mine.querySelector(".plate").insertAdjacentHTML("beforeend", tools());
          }
        } else if (evt.speaker) {
          // The bubble is drawn before anyone knows whose turn it is, and used
          // to fall back to the chat's founder — in a group that left the wrong
          // face and name above the text for the whole stream.
          const who = evt.speaker.name || S.charName;
          const face = target.querySelector('.who');
          if (face) face.innerHTML = medallion(evt.speaker.avatar, who) +
            `<span class="nametext">${esc(who)}</span>`;
          const plate = target.querySelector('.platename');
          if (plate) plate.textContent = who;
        } else if (evt.reasoning) {
          think += evt.reasoning;
          let d = target.querySelector(".think");
          if (!d) {
            target.querySelector(".plate").insertAdjacentHTML(
              "beforeend",
              `<details class="think" open><summary>Thinking…</summary><div class="thinkbody"></div></details>`,
            );
            d = target.querySelector(".think");
            target.querySelector(".plate").appendChild(body.parentElement === target.querySelector(".plate") ? body : body);
          }
          d.querySelector(".thinkbody").textContent = think;
          stick();
        } else if (evt.delta) {
          queued += evt.delta;
          if (!frame) frame = requestAnimationFrame(pump);
        } else if (evt.error) {
          flush();
          abandon();
          fail(evt.error);
        } else if (evt.stopped) {
          flush();
          // Stopped before a single token arrived, so there is nothing to keep.
          if (!text) abandon();
        } else if (evt.done) {
          flush();
          clearInterval(tick);
          /*
           * The reply as the server settled it, not as the model wrote it.
           *
           * Everything in double brackets is resolved once the stream ends —
           * dice rolled, checks made against the sheet, anyone the narrator
           * introduced given a card. Without this the screen keeps the
           * request while the database keeps the answer, and you only see the
           * die by reloading the page.
           */
          if (typeof evt.text === "string" && evt.impersonated === undefined) {
            existingText = "";
            text = evt.text;
            paint();
            if (document.body.dataset.mode === "tabletop") {
              refreshWorld();
              // A hit that landed on you came off your sheet server-side; the
              // ring in the sidebar has to agree or you are reading two
              // different accounts of the same hit point.
              refreshSheet();
            }
          }
          // Display regex scripts run once, here, rather than on every delta:
          // a pack like DEUS EX MACHINA has fifty of them and re-running the
          // lot per token would make a long reply crawl. Nothing they produce
          // is meaningful mid-sentence anyway.
          if (regexScripts.length && text) {
            body.innerHTML = renderBody(existingText + text, mode === "impersonate" ? 1 : 2, 0);
          }
          const meta = target.querySelector(".meta-line");
          if (meta) meta.innerHTML = metaLine({ created_at: Date.now() }) +
            statsLine({ tokens: evt.tokens, ms: evt.ms });
          const th = target.querySelector(".think");
          if (th) {
            th.open = false;
            th.querySelector("summary").textContent =
              `Thought${evt.ms ? ` for ${(evt.ms / 1000).toFixed(0)}s` : ""}`;
          }
          if (evt.impersonated !== undefined) {
            // Impersonation is a draft, not a saved turn — hand it to the box.
            target.remove();
            $("#input").value = evt.impersonated.trim();
            $("#input").dispatchEvent(new Event("input"));
            $("#input").focus();
          } else {
            target.dataset.id = evt.id;
            target.dataset.raw = existingText + text;
            // In a group the reply may not be from whoever the bubble was
            // optimistically drawn for — nextSpeaker() is decided server-side,
            // after the bubble already exists. Rebuild the face and name from
            // what the server settled on rather than patching pieces of it:
            // two characters can share a name (this cast has plenty that do),
            // so comparing names to decide "did the speaker change" is not
            // reliable — always resync instead. `medallion()` is the same
            // markup a fresh page load produces, so there is nothing to drift.
            if (evt.name) {
              target.querySelector(".who").innerHTML =
                medallion(evt.avatar, evt.name) + `<span class="nametext">${esc(evt.name)}</span>`;
              target.querySelector(".platename").textContent = evt.name;
            }
            const bar = target.querySelector(".swipes");
            if (bar && evt.swipes) {
              bar.dataset.count = evt.swipes;
              bar.dataset.i = evt.index;
              bar.querySelector(".sn").textContent = `${evt.index + 1} / ${evt.swipes}`;
              bar.querySelector('[data-swipe="-1"]').disabled = evt.index === 0;
              capSwipes(bar);
            }
            if (!target.querySelector(".tools"))
              target.querySelector(".plate").insertAdjacentHTML("beforeend", tools());
          }
        }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      // A reply interrupted because the app went to the background is not a
      // failure and must not be reported as one: the server is still writing
      // it and will save it. Collect it on the way back in instead.
      if (leftDuringRun) {
        abandon();
        interrupted = chatId;
      } else {
        abandon();
        fail("Lost the connection to the server.");
      }
    } else {
      flush();
      // The fallback path: the server was never told, so keep what is on screen.
      if (text) target.dataset.raw = existingText + text;
    }
  } finally {
    flush();
    clearInterval(tick);
    body.classList.remove("cursor");
    done();
  }
}

/*
 * Leaving the app mid-reply.
 *
 * Android drops the socket the moment Hearth stops being the foreground app,
 * which used to end the turn. The server now runs it to the end and saves it
 * either way (see /chats/:id/generate), so what is left for the page is to
 * notice it was away, wait for the reply to land if it has not yet, and go and
 * fetch what it missed.
 */
let leftDuringRun = false;
let interrupted = null;

addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    if (S.busy) leftDuringRun = true;
    return;
  }
  const chatId = interrupted;
  interrupted = null;
  leftDuringRun = false;
  if (!chatId || chatId !== S.chatId) return;

  // The reply may still be being written. Wait for it rather than reloading
  // into a thread that is missing its last line.
  for (let i = 0; i < 400; i++) {
    let still = false;
    try {
      still = (await api(`/chats/${chatId}/running`))?.running === true;
    } catch { break; }
    if (!still) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (chatId === S.chatId) openChat(chatId);
});

function done() {
  if (!$("#guideRow").hidden) syncGuideActions();
  S.busy = false;
  S.generating = null;
  S.abort = null;
  $("#sendBtn").disabled = false;
  $("#stopBtn").hidden = true;
  stick();
}

/**
 * An error, in the thread.
 *
 * It used to sit there until the page was reloaded, so a run of failures
 * stacked up between the messages and stayed there for the rest of the
 * session. Now: tap it to be rid of it, or leave it and it goes on its own.
 * Long enough to read a provider's error message, not long enough to become
 * furniture.
 */
$("#reloadBtn").onclick = () => location.reload();

// Anywhere on it closes it — a picture on screen has one obvious gesture, and
// hunting for a small × in the corner of a dark image is not it.
$("#faceDialog").onclick = () => $("#faceDialog").close();
$("#faceDialog").addEventListener("close", () => { $("#faceImage").src = ""; });

function fail(msg) {
  const n = document.createElement("div");
  n.className = "notice";
  n.textContent = msg;
  n.title = "Tap to dismiss";

  const dismiss = () => {
    clearTimeout(timer);
    n.classList.add("going");
    // Let the fade finish before the node goes, but never leave it behind if
    // the transition never fires (a hidden tab, reduced motion).
    setTimeout(() => n.remove(), 400);
  };
  n.onclick = dismiss;
  const timer = setTimeout(dismiss, 12000);

  $("#thread").appendChild(n);
  stick(true);
}

async function rollFor(notation) {
  try {
    const { text } = await api("/dice", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ notation, chat: S.chatId }),
    });
    return `[[${text}]]`;
  } catch (err) {
    fail(err?.message ?? "That is not dice.");
    return null;
  }
}

/**
 * The die, thrown where you can watch it.
 *
 * The number is scrambled through the tumble and settled at the end, so the
 * result arrives when the die stops rather than being printed on it from the
 * start — which is the whole difference between a die landing and a label
 * appearing. The working is shown underneath for the same reason the notation
 * is never hidden anywhere else in Hearth: a roll you cannot check is a roll
 * somebody could have made up.
 *
 * Resolves when the die has landed, so the caller can put the result into the
 * conversation while the stage is still up.
 */
function showDie(result) {
  const stage = $("#dieStage");
  const num = stage.querySelector(".dienum");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  stage.hidden = false;
  stage.classList.remove("going", "landed");
  stage.classList.add("rolling");
  stage.querySelector(".dielabel").textContent = result.label ?? "Roll";

  // A modifier of zero is not worth a column; the die always is, even when it
  // is the only thing that happened.
  const parts = (result.parts ?? []).filter((p) => p.value !== 0 || p.label === "d20");
  stage.querySelector(".diebreak").innerHTML =
    parts.map((p) => {
      // Label then number, so it reads "d20 16" rather than "16 d20".
      const sign = p.label === "d20" || p.value < 0 ? "" : "+";
      return `<span>${esc(p.label)} <b>${esc(sign + String(p.value))}</b></span>`;
    }).join(`<span class="diesep">·</span>`) +
    `<span class="diesep">=</span><span class="dietot">${esc(String(result.total))}</span>`;

  const dismiss = () => {
    stage.classList.add("going");
    setTimeout(() => { stage.hidden = true; stage.classList.remove("going", "rolling", "landed"); }, 360);
  };
  stage.onclick = dismiss;

  return new Promise((resolve) => {
    const land = () => {
      num.textContent = String(result.die ?? result.total);
      stage.classList.remove("rolling");
      stage.classList.add("landed");
      // Long enough to read the working, short enough not to be in the way.
      setTimeout(dismiss, 2600);
      resolve();
    };

    if (calm) { land(); return; }

    // Faces flicking past while it tumbles. Stopped by the same timer that
    // lands it, so there is no way for the scramble to outlive the throw.
    const spin = setInterval(() => {
      num.textContent = String(1 + Math.floor(Math.random() * 20));
    }, 60);
    setTimeout(() => { clearInterval(spin); land(); }, 950);
  });
}

$("#diceBtn").onclick = async () => {
  /*
   * At a table, the dice are already chosen.
   *
   * The narrator has just told you what is at stake and you would pick up the
   * d20 without being told which one — so tabletop mode reads the moment and
   * throws it, rather than asking you to translate the last paragraph into
   * "1d20+3". A story chat has no situation to read, so there it still asks.
   */
  if (document.body.dataset.mode === "tabletop" && S.chatId) {
    let result;
    try {
      result = await api(`/chats/${S.chatId}/roll`, { method: "POST" });
    } catch (err) {
      fail(err?.message ?? "Could not roll.");
      return;
    }
    await showDie(result);
    run("reply", `[[${result.text}]]`);
    return;
  }

  // The last thing rolled is the likely next thing rolled, so it is offered
  // back rather than making you retype it every time.
  const notation = await askFor("Roll what?", localStorage.getItem("hearth.lastRoll") || "1d20");
  if (!notation?.trim()) return;
  try { localStorage.setItem("hearth.lastRoll", notation.trim()); } catch {}
  const line = await rollFor(notation.trim());
  if (line) run("reply", line);
};

function send() {
  const input = $("#input");
  // Extensions see what was typed before it becomes a turn, so a slash command
  // or a bit of shorthand can be expanded into what actually gets sent.
  const content = extTransform("send:before", input.value.trim());

  /*
   * `/roll 2d6` is a turn like any other.
   *
   * The result becomes the message, so it is in the history the model reads
   * rather than a decoration beside it — a roll nobody at the table can see is
   * not a roll. The server does the rolling; see POST /dice.
   */
  const asked = content.match(/^\/(?:roll|r)\s+(.+)$/i);
  if (asked) {
    input.value = "";
    input.style.height = "auto";
    rollFor(asked[1].trim()).then((line) => { if (line) run("reply", line); });
    return;
  }

  input.value = "";
  input.style.height = "auto";

  // Nothing typed: stay quiet and let the scene move on by itself.
  if (!content) {
    const all = [...$("#thread").querySelectorAll(".msg")];
    const last = all[all.length - 1];
    if (last && !last.classList.contains("mine")) return run("silent");
  }
  run("reply", content);
}

const guideText = () => ($("#guideRow").hidden ? "" : $("#guide").value.trim());

$("#guideBtn").onclick = () => {
  const row = $("#guideRow");
  row.hidden = !row.hidden;
  $("#guideBtn").classList.toggle("on", !row.hidden);
  if (!row.hidden) { syncGuideActions(); $("#guide").focus(); }
};
const closeSteer = () => {
  $("#guide").value = "";
  $("#guideRow").hidden = true;
  $("#guideBtn").classList.remove("on");
};
$("#guide").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); send(); }
  if (e.key === "Escape") { e.preventDefault(); closeSteer(); }
});

// The same direction can be applied three ways, so name all three rather than
// leaving people to guess that a guide also covers swiping.
$("#guideSend").onclick = () => send();
$("#guideCont").onclick = () => run("continue");
$("#guideSwipe").onclick = () => run("swipe");
$("#guideImper").onclick = () => run("impersonate");

/** Only offer what the thread can actually do right now. */
function syncGuideActions() {
  const all = [...$("#thread").querySelectorAll(".msg")];
  const last = all[all.length - 1];
  const canFollow = !!last && !last.classList.contains("mine");
  $("#guideCont").disabled = !canFollow;
  $("#guideSwipe").disabled = !canFollow;
  $("#guideSend").disabled = false;
  $("#guideImper").disabled = false;   // writing your turn is always available
}

/**
 * Stopping has to reach the server, not just this fetch. Dropping the
 * connection alone left the provider streaming — the completion was paid for in
 * full and the finished reply was saved anyway. The server keeps whatever
 * arrived before the stop and still sends `done`, so the thread stays honest.
 */
// The plus opens the tray. The writing line is on its own until you ask, and
// what it opens is a card joined to the top of the box rather than a row
// wedged inside it.
$("#plusBtn").onclick = () => {
  const c = $("#composer");
  const open = c.dataset.guided !== "true";
  c.dataset.guided = open ? "true" : "false";
  $("#plusBtn").setAttribute("aria-expanded", open ? "true" : "false");
  if (open) syncGuideActions();
};

$("#stopBtn").onclick = async () => {
  const btn = $("#stopBtn");
  btn.disabled = true;
  const r = S.generating ? await api(`/chats/${S.generating}/stop`, { method: "POST" }) : { error: true };
  // If the server could not be told, at least stop listening.
  if (r?.error) S.abort?.abort();
};

// ---- message tools ------------------------------------------------------

$("#thread").addEventListener("click", async (e) => {
  const msg = e.target.closest(".msg");
  if (!msg) return;

  /**
   * A portrait, opened. In banner mode the art is the size of a thumbnail and
   * in portrait mode a coin, and there is nowhere else in Hearth that shows a
   * character's picture large — which is a shame, because it is usually the
   * best thing about the card.
   */
  const face = e.target.closest(".who .medallion");
  if (face && !face.classList.contains("blank")) {
    const url = (face.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/) ?? [])[1];
    if (url) {
      $("#faceImage").src = url;
      $("#faceName").textContent = msg.querySelector(".platename")?.textContent ?? "";
      $("#faceDialog").showModal();
      return;
    }
  }

  const sw = e.target.closest("[data-swipe]");
  if (sw) {
    const bar = msg.querySelector(".swipes");
    const count = +bar.dataset.count;
    const next = +bar.dataset.i + +sw.dataset.swipe;
    if (next < 0) return;
    // Walking past the last alternate asks for a fresh one.
    if (next >= count) return run("swipe");
    const r = await api(`/messages/${msg.dataset.id}/swipe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ index: next }),
    });
    if (r.content !== undefined) {
      msg.dataset.raw = r.content;
      msg.querySelector(".body").innerHTML = prose(r.content);
      bar.dataset.i = next;
      bar.querySelector(".sn").textContent = `${next + 1} / ${count}`;
      bar.querySelector('[data-swipe="-1"]').disabled = next === 0;
      capSwipes(bar);
    }
    return;
  }

  if (e.target.closest("[data-copy]")) {
    const btn = e.target.closest("[data-copy]");
    await navigator.clipboard.writeText(msg.dataset.raw || "").catch(() => {});
    btn.innerHTML = ICON.tick;
    btn.classList.add("done");
    setTimeout(() => { btn.innerHTML = ICON.copy; btn.classList.remove("done"); }, 1400);
    return;
  }

  if (e.target.closest("[data-branch]")) {
    const r = await api(`/messages/${msg.dataset.id}/branch`, { method: "POST" });
    if (r.id) { await refreshChats(); await refreshCast(); openChat(r.id); }
    return;
  }

  if (e.target.closest("[data-del]")) {
    await api("/messages/" + msg.dataset.id, { method: "DELETE" });
    msg.remove();
    return;
  }

  if (e.target.closest("[data-edit]")) {
    const body = msg.querySelector(".body");
    const btn = e.target.closest("[data-edit]");
    if (body.isContentEditable) {
      const text = body.innerText;
      body.contentEditable = "false";
      body.innerHTML = prose(text);
      msg.dataset.raw = text;
      btn.innerHTML = ICON.edit;
      btn.classList.remove("done");
      await api("/messages/" + msg.dataset.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
    } else {
      body.textContent = msg.dataset.raw;
      body.contentEditable = "true";
      body.focus();
      btn.innerHTML = ICON.tick;
      btn.classList.add("done");
    }
  }
});

// ---- chat options -------------------------------------------------------

let chatMeta = null;

const openSheet = () => { $("#chatSheet").hidden = false; };
const closeSheet = () => { $("#chatSheet").hidden = true; };

$("#chatMenuBtn").onclick = openSheet;
$("#chatSheet").onclick = (e) => { if (e.target.id === "chatSheet") closeSheet(); };

$("#chatSheet").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-act]");
  if (!row) return;
  closeSheet();

  switch (row.dataset.act) {
    case "rolls":
      openRollLog();
      break;
    case "campaign":
      // Straight into the storybook with whatever this game already is, since
      // wanting to change it and wanting to see the three again are different
      // errands and this row is the first one.
      openStorybook(chatMeta, campaignOf(chatMeta));
      break;
    case "note":
      $("#n_text").value = chatMeta?.author_note ?? "";
      $("#n_depth").value = chatMeta?.note_depth ?? 2;
      api("/settings").then((st) => {
        $("#default_author_note").value = st.default_author_note ?? "";
        $("#use_default_note").checked = st.use_default_note !== "0";
      });
      $("#noteDialog").showModal();
      break;

    case "tree":
      showTree();
      break;

    case "rename": {
      const title = await askFor("Name this chat", chatMeta?.title ?? "");
      if (!title?.trim()) return;
      await api("/chats/" + S.chatId, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      chatMeta.title = title.trim();
      await refreshCast();
      await refreshChats();
      toast("Renamed.");
      break;
    }

    case "cast": openRoom(); break;
    case "files": openFiles(); break;
    case "inspect": openInspect(); break;
    case "scene": openScene(); break;

    case "timeskip":
      run("reply", "", "Move the scene forward in time. Open on a later moment — " +
        "later that day, the next morning, a week on, whatever the story wants. " +
        "Say plainly how much time has passed, then continue.");
      break;

    case "twist":
      run("reply", "", "Introduce an unexpected complication that changes the situation. " +
        "It must be earned by what has already happened rather than arriving from nowhere, " +
        "and it should make things harder, not easier.");
      break;

    case "new":
      if (chatMeta?.character_id) startChat(chatMeta.character_id);
      break;

    case "close":
      showSplash();
      break;

    case "select": setMsgSelect(true); break;
    case "regen":  run("swipe"); break;
    case "imper":  run("impersonate"); break;
    case "cont":   run("continue"); break;
  }
});

$("#noteForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "save") return;
  const body = { author_note: $("#n_text").value, note_depth: $("#n_depth").value };
  await api("/chats/" + S.chatId, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await api("/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      default_author_note: $("#default_author_note").value,
      use_default_note: $("#use_default_note").checked ? "1" : "0",
    }),
  });
  Object.assign(chatMeta, body);
  toast($("#n_text").value.trim() ? "Note saved." : "Note cleared.");
});

// ---- lorebooks -----------------------------------------------------------

let books = [];
let editingBook = null;

const POSITIONS = [
  ["before_char", "Before the character"],
  ["after_char", "After the character"],
  ["at_depth", "In the conversation"],
];
const LOGICS = [
  ["and_any", "and any of"], ["and_all", "and all of"],
  ["not_any", "and none of"], ["not_all", "and not all of"],
];

const linked = (b, scope, target) =>
  b.links.some((l) => l.scope === scope && (l.target_id ?? "") === (target ?? ""));

async function refreshLore() {
  const r = await api("/lorebooks");
  if (!Array.isArray(r)) return;
  books = r;
  renderLoreList();
}

/** Drawn separately, because which scope buttons exist depends on whether a
    chat is open — and that changes without the books themselves changing. */
/* ---- the shelf --------------------------------------------------------------
   The same books as the list below, standing up.

   Which is not only for the pleasure of it: a lorebook is a thing you go
   looking for by half-remembering it, and a row of identical text rows is the
   worst possible shape for that. A spine has a colour, a width and a height,
   all of them derived from the name, so the same book looks the same every
   time and your eye learns it. The list is still there for the wiring — what a
   book is linked to is a fact about a row, not about an object. */

/** A number from a name. The same name always gives the same book. */
function spineSeed(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/* Bindings rather than arbitrary hues: six leathers that sit with the gold
   instead of arguing with it. */
const LEATHERS = ["#7a3a30", "#3d5644", "#37456a", "#8a6234", "#5b3757", "#4a4c42"];

function shelfBook(b) {
  const seed = spineSeed(b.name);
  // Books are not uniform, and a shelf of identical spines is a bar chart.
  const w = 30 + (seed % 5) * 5;
  const h = 132 + ((seed >> 3) % 6) * 9;
  const leather = LEATHERS[(seed >> 7) % LEATHERS.length];
  const on = b.entries.filter((e) => e.enabled).length;
  // In play here, by any of the three routes — the one fact worth seeing from
  // across the room, so it gets a ribbon rather than a word.
  const inPlay = linked(b, "global", null) ||
    (chatMeta && (linked(b, "character", chatMeta.character_id) || linked(b, "chat", chatMeta.id)));
  return `<div role="button" tabindex="0" class="spine${inPlay ? " inplay" : ""}" data-book="${b.id}"
      style="--w:${w}px;--h:${h}px;--leather:${leather}"
      title="${esc(b.name)} — ${on} of ${b.entries.length} entries in use">
      <span class="band"></span>
      <span class="spinetitle">${esc(b.name)}</span>
      <span class="band"></span>
      <span class="spinecount">${b.entries.length}</span>
      <input type="checkbox" class="pick" data-id="${b.id}" aria-label="Select ${esc(b.name)}">
    </div>`;
}

/** Which book is pulled off the shelf, if any. */
let pulledBook = null;

function renderShelf(shown) {
  const shelf = $("#loreShelf");
  if (!shelf) return;
  shelf.hidden = loreAsList;
  $("#loreDetail").hidden = loreAsList || !pulledBook;
  if (loreAsList) return;

  shelf.innerHTML = shown.length
    ? shown.map(shelfBook).join("")
    : `<p class="hint">${books.length ? "Nothing on the shelf matches that." : "The shelf is empty."}</p>`;

  for (const s of shelf.querySelectorAll("[data-book]")) {
    s.classList.toggle("pulled", s.dataset.book === pulledBook);
    // Enter and space on a div that behaves like a button.
    s.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); s.click(); }
    };
    s.onclick = () => {
      // While picking, the whole shelf is a set of checkboxes; the capture
      // handler in makeSelectable has already dealt with the click.
      if (loreSelection?.isOn()) return;
      // Pulling one out shows what it is and what it is wired to. Pressing it
      // again puts it back — the shelf is the browsing view, and a detail card
      // that will not go away is a panel, not a book.
      pulledBook = pulledBook === s.dataset.book ? null : s.dataset.book;
      renderLoreList();
    };
  }
  renderPulled();
  loreSelection?.repaint();
}

/**
 * The book you took down, opened flat.
 *
 * Everything a lorebook row has ever had — what it is linked to, and the three
 * things you can do with it — lives here. The shelf on its own was a picture:
 * it looked lovely and hid every control behind a view toggle, which is a
 * straight downgrade dressed up as a feature.
 */
function renderPulled() {
  const box = $("#loreDetail");
  if (!box) return;
  const b = books.find((x) => x.id === pulledBook);
  if (!b) { box.hidden = true; return; }

  const on = b.entries.filter((e) => e.enabled).length;
  box.hidden = false;
  box.innerHTML =
    `<div class="pulledhead">` +
    `<span class="pulledname">${esc(b.name)}</span>` +
    `<span class="pulledcount">${on} of ${b.entries.length} in use</span>` +
    `</div>` +
    `<div class="pulledwire">` +
    `<span class="pulledlabel">Used in</span>` +
    `<span class="scopes-inline">${scopeButtons(b)}</span>` +
    `</div>` +
    `<div class="pulledacts">` +
    `<button class="ghost" data-edit>Open and edit</button>` +
    `<button class="ghost" data-export>Export</button>` +
    `<button class="ghost danger" data-del>Delete</button>` +
    `</div>`;
  box.onclick = (e) => loreRowClick(e, b);
}

let loreSelection = null;
let loreAsList = false;
try { loreAsList = localStorage.getItem("hearth.loreList") === "1"; } catch {}

function setLoreView(asList) {
  loreAsList = asList;
  try { localStorage.setItem("hearth.loreList", asList ? "1" : "0"); } catch {}
  const b = $("#loreView");
  if (b) {
    b.title = asList ? "Stand them on a shelf" : "Show them as a list";
    b.setAttribute("aria-label", b.title);
    b.classList.toggle("on", asList);
  }
  renderLoreList();
}

/*
 * What a book is wired to, and what you can do with it.
 *
 * Shared by the shelf's detail card and the list row rather than written
 * twice, because they are the same three questions asked in two places and
 * two copies would answer them differently by Christmas.
 */
const SCOPE_ICON = {
  global: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5z"/></svg>`,
  character: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c0-3.7 3.1-6 7-6s7 2.3 7 6"/></svg>`,
  chat: `<svg viewBox="0 0 24 24"><path d="M20 14.5a2 2 0 0 1-2 2H9l-4 3.5v-3.5H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/></svg>`,
};

function scopeButtons(b) {
  const one = (kind, target, title) =>
    `<button class="scopebtn${linked(b, kind, target) ? " on" : ""}" ` +
    `data-scope="${kind}" data-target="${target ?? ""}" title="${title}" ` +
    `aria-label="${title}">${SCOPE_ICON[kind]}</button>`;
  return one("global", null, "Use in every chat") +
    (chatMeta ? one("character", chatMeta.character_id, `Use with ${chatMeta.character_name}`) : "") +
    (chatMeta ? one("chat", chatMeta.id, "Use in this chat only") : "");
}

async function loreRowClick(e, b) {
  const sc = e.target.closest("[data-scope]");
  if (sc) {
    // Attach or detach right here — no need to open anything.
    const on = !sc.classList.contains("on");
    sc.classList.toggle("on", on);
    await api(`/lorebooks/${b.id}/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: sc.dataset.scope, target_id: sc.dataset.target || null, on }),
    });
    await refreshLore();
    return;
  }
  if (e.target.closest("[data-export]")) {
    window.location.href = `/api/lorebooks/${b.id}/export`;
    return;
  }
  if (e.target.closest("[data-del]")) {
    if (!(await ask(`Delete the lorebook "${b.name}"?`))) return;
    await api("/lorebooks/" + b.id, { method: "DELETE" });
    if (pulledBook === b.id) pulledBook = null;
    return refreshLore();
  }
  if (e.target.closest("[data-edit]")) openBook(b);
}

function renderLoreList() {
  const list = $("#loreList");
  const q = ($("#loreSearch")?.value ?? "").trim().toLowerCase();
  const shown = q
    ? books.filter((b) => b.name.toLowerCase().includes(q) ||
        b.entries.some((e) => (e.comment || "").toLowerCase().includes(q) ||
          e.keys.some((k) => k.toLowerCase().includes(q))))
    : books;

  renderShelf(shown);
  list.hidden = !loreAsList;

  list.innerHTML = books.length
    ? (shown.length ? "" : `<p class="listempty">No lorebook matches “${esc(q)}”.</p>`)
    : `<p class="hint">No lorebooks yet.</p>`;
  if (!loreAsList) return;

  shown.forEach((b) => {
    const on = b.entries.filter((e) => e.enabled).length;
    const row = document.createElement("div");
    row.className = "item lorerow";
    row.innerHTML =
      `<span class="meta"><span class="t">${esc(b.name)}</span>` +
      `<span class="s" title="${on} of ${b.entries.length} entries enabled">${on}/${b.entries.length}</span></span>` +
      `<span class="scopes-inline">${scopeButtons(b)}</span>` +
      `<span class="rowtools">` +
      `<button data-edit title="Edit">${ICON.edit}</button>` +
      `<button data-export title="Export">${ICON.down}</button>` +
      `<button data-del title="Delete">${ICON.del}</button></span>`;

    row.onclick = (e) => loreRowClick(e, b);
    list.appendChild(rowShell(b.id, row));
  });

  renderActiveLore();
}

/** What would fire right now, so keywords can be debugged against a real chat. */
async function renderActiveLore() {
  const box = $("#loreActive");
  if (!S.chatId) { box.innerHTML = ""; return; }
  const active = await api(`/chats/${S.chatId}/lore`);
  if (!Array.isArray(active)) { box.innerHTML = ""; return; }
  box.innerHTML = active.length
    ? `<div class="activehead">Firing in this chat</div>` +
      active.map((a) =>
        `<span class="lorechip" title="${esc(a.keys.join(", ")) || "always on"}">` +
        `<em>${a.via === "constant" ? "always" : a.via}</em> ${esc(a.comment || a.keys[0] || "entry")}</span>`
      ).join("")
    : `<div class="activehead dim">Nothing firing in this chat yet</div>`;
}

function openBook(b) {
  editingBook = JSON.parse(JSON.stringify(b));
  $("#b_name").value = b.name;
  $("#b_search").value = "";
  renderEntries();
  $("#bookDialog").showModal();
}

function renderEntries() {
  const q = $("#b_search").value.trim().toLowerCase();
  const box = $("#b_entries");
  box.innerHTML = "";

  editingBook.entries.forEach((e, i) => {
    const hay = `${e.comment} ${e.keys.join(" ")} ${e.content}`.toLowerCase();
    if (q && !hay.includes(q)) return;

    const el = document.createElement("details");
    el.className = "entry" + (e.enabled ? "" : " off");
    el.innerHTML =
      `<summary>` +
      `<input type="checkbox" class="pick" ${e.enabled ? "checked" : ""} data-i="${i}" data-f="enabled" aria-label="Enabled">` +
      `<span class="etitle">${esc(e.comment || e.keys[0] || "Untitled entry")}</span>` +
      `<span class="ekeys">${e.constant ? "always on" : esc(e.keys.join(", ")) || "no keywords"}</span>` +
      `<button class="ico" data-remove="${i}" title="Remove" aria-label="Remove entry">${ICON.del}</button>` +
      `</summary>` +
      `<div class="ebody">` +
      `<label>Name<input data-i="${i}" data-f="comment" value="${esc(e.comment)}"></label>` +
      `<label>Keywords<input data-i="${i}" data-f="keys" value="${esc(e.keys.join(", "))}" placeholder="comma, separated"></label>` +
      `<div class="row">` +
      `<label>Also requires<input data-i="${i}" data-f="secondary" value="${esc(e.secondary.join(", "))}" placeholder="optional"></label>` +
      `<label>Logic<select data-i="${i}" data-f="logic">` +
        LOGICS.map(([v, l]) => `<option value="${v}"${e.logic === v ? " selected" : ""}>${l}</option>`).join("") +
      `</select></label></div>` +
      `<label>Content<textarea rows="4" data-i="${i}" data-f="content">${esc(e.content)}</textarea></label>` +
      `<div class="row">` +
      `<label>Where<select data-i="${i}" data-f="position">` +
        POSITIONS.map(([v, l]) => `<option value="${v}"${e.position === v ? " selected" : ""}>${l}</option>`).join("") +
      `</select></label>` +
      `<label>Depth<input type="number" min="0" max="30" data-i="${i}" data-f="depth" value="${e.depth}"></label>` +
      `<label>Order<input type="number" data-i="${i}" data-f="order" value="${e.order}"></label>` +
      `</div>` +
      `<div class="row">` +
      `<label>Chance %<input type="number" min="0" max="100" data-i="${i}" data-f="probability" value="${e.probability}"></label>` +
      `<label>Scan depth<input type="number" min="1" max="30" data-i="${i}" data-f="scanDepth" value="${e.scanDepth ?? ""}" placeholder="default"></label>` +
      `</div>` +
      `<label class="check"><input type="checkbox" data-i="${i}" data-f="constant" ${e.constant ? "checked" : ""}> Always on, no keyword needed</label>` +
      `<label class="check"><input type="checkbox" data-i="${i}" data-f="wholeWords" ${e.wholeWords ? "checked" : ""}> Match whole words only</label>` +
      `<label class="check"><input type="checkbox" data-i="${i}" data-f="caseSensitive" ${e.caseSensitive ? "checked" : ""}> Case sensitive</label>` +
      `</div>`;
    box.appendChild(el);
  });

  if (!box.children.length) {
    box.innerHTML = `<p class="hint">${editingBook.entries.length ? "Nothing matches that." : "No entries yet."}</p>`;
  }
}

$("#b_entries").addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.i === undefined) return;
  const entry = editingBook.entries[+el.dataset.i];
  const f = el.dataset.f;
  if (el.type === "checkbox") entry[f] = el.checked;
  else if (f === "keys" || f === "secondary") entry[f] = el.value.split(",").map((x) => x.trim()).filter(Boolean);
  else if (["depth", "order", "probability"].includes(f)) entry[f] = +el.value || 0;
  else if (f === "scanDepth") entry[f] = el.value === "" ? null : +el.value;
  else entry[f] = el.value;
});

$("#b_entries").addEventListener("click", async (e) => {
  const rm = e.target.closest("[data-remove]");
  if (!rm) return;
  e.preventDefault();
  if (!(await ask("Remove this entry?"))) return;
  editingBook.entries.splice(+rm.dataset.remove, 1);
  renderEntries();
});

$("#b_search").oninput = () => renderEntries();

$("#b_add").onclick = () => {
  editingBook.entries.unshift({
    id: "new" + Date.now(), keys: [], secondary: [], logic: "and_any", content: "",
    comment: "", constant: false, enabled: true, order: 100, position: "after_char",
    depth: 4, probability: 100, caseSensitive: false, wholeWords: true, scanDepth: null,
    excludeRecursion: false, preventRecursion: false,
  });
  $("#b_search").value = "";
  renderEntries();
};

$("#b_close").onclick = () => $("#bookDialog").close();

$("#b_save").onclick = async () => {
  await api("/lorebooks/" + editingBook.id, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: $("#b_name").value, entries: editingBook.entries }),
  });
  $("#bookDialog").close();
  await refreshLore();
  toast("Lorebook saved.");
};

$("#newBookBtn").onclick = async () => {
  const name = await askFor("Name this lorebook");
  if (!name?.trim()) return;
  await api("/lorebooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: name.trim(), entries: [] }),
  });
  await refreshLore();
};

$("#loreImport").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  let n = 0;
  for (const f of files) {
    try {
      const json = JSON.parse(await f.text());
      await api("/lorebooks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: json.name ?? f.name.replace(/\.json$/i, ""), entries: json }),
      });
      n++;
    } catch {}
  }
  $("#loreHint").textContent = n ? `Brought in ${n} lorebook${n > 1 ? "s" : ""}.` : "Nothing readable in those files.";
  refreshLore();
};

// ---- what is being sent -------------------------------------------------

async function openInspect() {
  if (!S.chatId) return;
  $("#inspectDialog").showModal();
  $("#i_stats").innerHTML = `<span class="istat">Working it out…</span>`;
  $("#i_sections").innerHTML = "";
  $("#i_lore").innerHTML = "";

  const r = await api(`/chats/${S.chatId}/inspect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "reply", guide: guideText(), content: $("#input").value }),
  });
  if (r.error) { $("#i_stats").innerHTML = `<span class="istat">${esc(r.error)}</span>`; return; }

  const stat = (label, value) => `<span class="istat"><em>${label}</em>${esc(String(value))}</span>`;
  $("#i_stats").innerHTML =
    stat("provider", r.provider) + stat("model", r.model) +
    stat("turns", r.turns) + stat("characters", r.chars.toLocaleString()) +
    stat("about", `${r.estTokens.toLocaleString()} tokens`) +
    stat("temp", r.sampling.temperature) + stat("reply cap", r.sampling.maxTokens);

  $("#i_lore").innerHTML = r.lore.length
    ? `<div class="activehead">Lore firing</div>` + r.lore.map((a) =>
        `<span class="lorechip" title="${esc(a.keys.join(", ")) || "always on"}">` +
        `<em>${a.via === "constant" ? "always" : a.via}</em> ${esc(a.comment || a.keys[0] || "entry")}</span>`).join("")
    : `<div class="activehead dim">No lore firing</div>`;

  // Biggest contributors first — that is what you came to find out.
  const sorted = [...r.sections].sort((a, b) => b.chars - a.chars);
  $("#i_sections").innerHTML = sorted.map((sec) =>
    `<details class="entry"><summary>` +
    `<span class="etitle">${esc(sec.label)}</span>` +
    `<span class="ekeys">${sec.chars.toLocaleString()} chars &middot; ${Math.round(sec.chars / r.chars * 100)}%</span>` +
    `</summary><div class="ebody"><pre class="rawtext">${esc(sec.content)}</pre></div></details>`).join("");
}

$("#i_close").onclick = () => $("#inspectDialog").close();

// ---- scene ---------------------------------------------------------------

let scenePersona = "";

async function openScene() {
  if (!chatMeta) return;
  const people = await api("/personas");

  // Duplicate names are common after a SillyTavern import, so show the face
  // and a line of description rather than a bare list of names.
  scenePersona = chatMeta.persona_id ?? "";
  const grid = $("#scenePersonas");
  const card = (p) => {
    const chosen = (p?.id ?? "") === scenePersona;
    return `<button class="pcard${chosen ? " on" : ""}" data-id="${p?.id ?? ""}">` +
      (p ? medallion(p.avatar, p.name) : `<span class="medallion blank">&mdash;</span>`) +
      `<span class="pmeta"><span class="t">${esc(p?.name ?? "Default")}</span>` +
      `<span class="s">${esc(p ? (p.description || "No description").replace(/\s+/g, " ").slice(0, 44)
        : "Whoever is active")}</span></span>` +
      (p?.is_active ? `<span class="pflag">active</span>` : "") + `</button>`;
  };
  grid.innerHTML = card(null) + (Array.isArray(people) ? people : []).map(card).join("");
  grid.onclick = (e) => {
    const b = e.target.closest("[data-id]");
    if (!b) return;
    scenePersona = b.dataset.id;
    grid.querySelectorAll(".pcard").forEach((x) => x.classList.toggle("on", x === b));
  };
  $("#s_persona_default").checked = false;

  const walls = $("#sceneWalls");
  const cell = (url, label) =>
    `<button class="${chatMeta.wallpaper === url ? "on" : ""}" data-url="${esc(url)}"` +
    (url ? ` style="background-image:url(&quot;${encodeURI(url)}&quot;)"` : ` data-none="1"`) +
    `>${label ?? ""}</button>`;
  walls.innerHTML = cell("", "<span>Default</span>") + wallpaperCache.map((u) => cell(u)).join("");

  walls.onclick = (e) => {
    const b = e.target.closest("[data-url]");
    if (!b) return;
    chatMeta.wallpaper = b.dataset.url;
    walls.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    applyChatWallpaper();
  };

  const ACCENTS = [
    ["", "Default"], ["#c8994f", "Gold"], ["#a8674f", "Rust"], ["#7fa46a", "Moss"],
    ["#6a8fb0", "Slate blue"], ["#a06fa0", "Heather"], ["#b0a06a", "Brass"],
    ["#8a8f96", "Ash"], ["#c06a72", "Wine"],
  ];
  const acc = $("#sceneAccents");
  acc.innerHTML = ACCENTS.map(([hex, name]) =>
    `<button class="accentdot${(chatMeta.accent || "") === hex ? " on" : ""}" data-accent="${hex}"` +
    ` title="${name}" aria-label="${name}"` +
    (hex ? ` style="--dot:${hex}"` : ` data-none="1"`) + `></button>`).join("");
  acc.onclick = (e) => {
    const b = e.target.closest("[data-accent]");
    if (!b) return;
    chatMeta.accent = b.dataset.accent;
    acc.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    applyChatRoom();
  };

  const amb = $("#sceneAmbience");
  const cells = [["", "Silence", "no sound at all"],
    ...Object.entries(AMBIENCE).map(([k, v]) => [k, v.label, v.hint])];
  amb.innerHTML = cells.map(([k, label, hint]) =>
    `<button class="ambcell${(chatMeta.ambience || "") === k ? " on" : ""}" data-amb="${k}">` +
    `<span class="ambname">${esc(label)}</span><span class="ambhint">${esc(hint)}</span></button>`).join("");
  amb.onclick = (e) => {
    const b = e.target.closest("[data-amb]");
    if (!b) return;
    chatMeta.ambience = b.dataset.amb;
    amb.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    // Straight from the press, which is the only moment a browser will let
    // anything start making a noise — and it doubles as a preview.
    ambience.play(chatMeta.ambience);
  };

  $("#sceneDialog").showModal();
}

$("#sceneCancel").onclick = async () => {
  $("#sceneDialog").close();
  const fresh = await api("/chats/" + S.chatId);   // discard unsaved fiddling
  if (fresh.chat) { chatMeta = fresh.chat; applyChatWallpaper(); applyChatRoom(); }
};

$("#sceneSave").onclick = async () => {
  const persona_id = scenePersona;
  await api("/chats/" + S.chatId, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallpaper: chatMeta.wallpaper ?? "", persona_id }),
  });
  chatMeta.persona_id = persona_id || null;

  if ($("#s_persona_default").checked && chatMeta.character_id) {
    await api(`/characters/${chatMeta.character_id}/default-persona`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ persona_id }),
    });
  }

  // The speaker name on your own messages may have changed.
  const people = await api("/personas");
  const me = (Array.isArray(people) ? people : []).find((p) => p.id === persona_id);
  if (me) { S.personaName = me.name; S.personaAvatar = me.avatar || ""; }
  await openChat(S.chatId);

  $("#sceneDialog").close();
  toast("Scene saved.");
};

// ---- chat files ---------------------------------------------------------

async function openFiles() {
  $("#filesDialog").showModal();
  $("#filesTitle").textContent = `Chats with ${chatMeta?.character_name ?? "this character"}`;
  await renderFiles();
}

async function renderFiles() {
  const cast = await api("/cast");
  const me = Array.isArray(cast) ? cast.find((c) => c.id === chatMeta?.character_id) : null;
  const list = $("#filesList");
  const chats = me?.chats ?? [];
  list.innerHTML = chats.length ? "" : `<p class="hint">No chats yet.</p>`;

  chats.forEach((c) => {
    const row = document.createElement("div");
    row.className = "item withface" + (c.id === S.chatId ? " active" : "");
    row.innerHTML =
      `<span class="meta"><span class="t">${c.parent_chat_id ? `<span class="branchmark">${ICON.branch}</span>` : ""}${esc(c.title || "Untitled")}</span>` +
      `<span class="s">${c.turns} message${c.turns === 1 ? "" : "s"} &middot; ${ago(c.updated_at)}</span></span>` +
      `<span class="rowtools">` +
      `<button data-open title="Switch to this chat" aria-label="Switch to this chat">` +
        `<svg viewBox="0 0 24 24"><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/>` +
        `<path d="M10 8l4 4-4 4"/><path d="M14 12H3"/></svg></button>` +
      `<button data-rename title="Rename" aria-label="Rename">${ICON.edit}</button>` +
      `<button data-json title="Export as JSON — everything, and it imports back" aria-label="Export as JSON">${ICON.down}</button>` +
      `<button data-txt title="Export as text — readable, for sending to someone" aria-label="Export as text">` +
        `<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5M9 8h3"/></svg></button>` +
      `<button data-del title="Delete" aria-label="Delete">${ICON.del}</button></span>`;

    row.onclick = async (e) => {
      if (e.target.closest("[data-json]")) {
        window.location.href = `/api/chats/${c.id}/export`;
        $("#filesHint").textContent = "Exported as JSON — it will import back.";
        return;
      }
      if (e.target.closest("[data-txt]")) {
        window.location.href = `/api/chats/${c.id}/export?format=txt`;
        $("#filesHint").textContent = "Exported as text — readable, but not importable.";
        return;
      }
      // Anywhere that is not one of the tools switches to the chat. The button
      // is still there for anyone looking for one, but a row that opens a
      // thing should open it when you press the row.
      if (!e.target.closest(".rowtools") || e.target.closest("[data-open]")) {
        if (c.id === S.chatId) { $("#filesDialog").close(); return; }
        $("#filesDialog").close();
        return openChat(c.id);
      }
      if (e.target.closest("[data-rename]")) {
        const title = await askFor("Name this chat", c.title ?? "");
        if (!title?.trim()) return;
        await api("/chats/" + c.id, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        });
        if (c.id === S.chatId) chatMeta.title = title.trim();
        await renderFiles(); await refreshCast(); await refreshChats();
        return;
      }
      if (e.target.closest("[data-del]")) {
        if (!(await ask(`Delete "${c.title || "this chat"}"?`))) return;
        const r = await api("/chats/" + c.id, { method: "DELETE" });
        if (c.id === S.chatId) { $("#filesDialog").close(); await showSplash(); }
        await renderFiles(); await refreshCast(); await refreshChats();
        return offerUndo(r, "chat");
      }
    };
    list.appendChild(row);
  });
}

$("#filesClose").onclick = () => $("#filesDialog").close();

$("#chatImport").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !chatMeta) return;
  $("#filesHint").textContent = "Reading…";
  const fd = new FormData();
  fd.append("file", file);
  fd.append("character_id", chatMeta.character_id);
  const r = await fetch("/api/chats/import", { method: "POST", body: fd })
    .then((x) => x.json())
    .catch(() => ({ error: "Import failed." }));
  $("#filesHint").textContent = r.error ?? `Brought in ${r.imported} messages as "${r.title}".`;
  await renderFiles(); await refreshCast(); await refreshChats();
};

// ---- picking messages ---------------------------------------------------

let msgSelecting = false;

function setMsgSelect(on) {
  msgSelecting = on;
  $("#thread").classList.toggle("picking", on);
  $("#msgBar").hidden = !on;
  $("#composer").hidden = on || !S.chatId;
  if (!on) $("#thread").querySelectorAll(".msg.picked").forEach((m) => m.classList.remove("picked"));
  syncMsgBar();
}

const pickedMsgs = () => [...$("#thread").querySelectorAll(".msg.picked")];

function syncMsgBar() {
  const n = pickedMsgs().length;
  $("#msgBarCount").textContent = `${n} selected`;
  $("#msgBarDelete").disabled = !n;
}

$("#msgBarDone").onclick = () => setMsgSelect(false);
$("#msgBarAll").onclick = () => {
  const all = [...$("#thread").querySelectorAll(".msg")];
  const every = all.every((m) => m.classList.contains("picked"));
  all.forEach((m) => m.classList.toggle("picked", !every));
  syncMsgBar();
};
$("#msgBarDelete").onclick = async () => {
  const rows = pickedMsgs();
  const ids = rows.map((m) => m.dataset.id).filter(Boolean);
  if (!ids.length) return;
  if (!(await ask(`Delete ${ids.length} message${ids.length > 1 ? "s" : ""}? Messages are not kept in the bin.`))) return;
  await api("/messages/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  rows.forEach((m) => m.remove());
  setMsgSelect(false);
  toast(`${ids.length} message${ids.length > 1 ? "s" : ""} deleted.`);
};

// Selection takes over clicks in the thread while it is on.
$("#thread").addEventListener("click", (e) => {
  if (!msgSelecting) return;
  const msg = e.target.closest(".msg");
  if (!msg) return;
  e.preventDefault();
  e.stopPropagation();
  msg.classList.toggle("picked");
  syncMsgBar();
}, true);

// ---- swipe gestures -----------------------------------------------------

let touchX = null, touchY = null;
$("#thread").addEventListener("touchstart", (e) => {
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}, { passive: true });

$("#thread").addEventListener("touchend", (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  touchX = null;
  if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return; // ignore scrolls
  const msg = e.target.closest(".msg");
  if (!msg || msg.classList.contains("mine")) return;
  msg.querySelector(`[data-swipe="${dx < 0 ? 1 : -1}"]`)?.click();
});

/**
 * The same gesture for a keyboard. Phones get the swipe above; on a desktop
 * there was no way to reach alternates but the two small chevrons, which is a
 * lot of mouse for something you do every other turn.
 *
 * Arrows are only claimed when nothing is being typed into and no dialog is
 * open — otherwise this would eat cursor movement in the composer.
 */
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
  if (document.querySelector("dialog[open]")) return;
  if ($("#thread").offsetParent === null) return;

  // The last reply is the only one with a fresh alternate to ask for, and the
  // only one the touch gesture would land on by default either.
  const last = [...$("#thread").querySelectorAll(".msg:not(.mine)")].pop();
  if (!last || !last.dataset.id) return;
  const btn = last.querySelector(`[data-swipe="${e.key === "ArrowRight" ? 1 : -1}"]`);
  if (!btn || btn.disabled) return;
  e.preventDefault();
  btn.click();
});

// ---- panel --------------------------------------------------------------

const openDrawer = () => {
  $("#drawer").classList.add("open");
  $("#scrim").hidden = false;
  refreshChats();
  refreshCast();
  refreshPersonas();
  refreshPresets();
  refreshLore();
};
const closeDrawer = () => {
  $("#drawer").classList.remove("open");
  $("#scrim").hidden = true;
};
/**
 * Wide screens fold the panel away rather than sliding it off, so the two
 * breakpoints need one pair of words for the same idea.
 */
const wide = () => matchMedia("(min-width: 900px)").matches;
const panelShowing = () =>
  wide() ? !document.body.classList.contains("tucked") : $("#drawer").classList.contains("open");
const retractPanel = () => {
  // A lit link means "this one is up", so once nothing is up nothing is lit.
  for (const x of document.querySelectorAll(".chainlink, .raillink")) x.classList.remove("on");
  if (!wide()) return closeDrawer();
  document.body.classList.add("tucked");
};
const showPanel = () => {
  if (!wide()) return openDrawer();
  document.body.classList.remove("tucked");
  refreshChats(); refreshCast(); refreshPersonas(); refreshPresets(); refreshLore();
};

$("#scrim").onclick = closeDrawer;

/**
 * Click back into the room and the panel folds itself away. You came out of
 * the chain to look something up; once you have looked at it, the thing you
 * want back is the story, and having to find a second control to dismiss what
 * one control opened is the sort of bookkeeping this redesign is meant to end.
 *
 * Capture, so the target is still attached: plenty of things in here re-render
 * their own list from the click handler, which would leave a detached node
 * with no ancestors to test by the time a bubbled listener ran.
 */
addEventListener("click", (e) => {
  if (!panelShowing()) return;
  if (e.target.closest("#drawer, .chain, .chainveil, #menuBtn, dialog, .palette")) return;
  retractPanel();
}, true);

// ---- the chain ----------------------------------------------------------
//
// The seven panels used to be a row of icons across the top of the drawer.
// They hang off the hamburger now instead: poke the three lines and the links
// unroll down the thumb side, poke one and it pulls that panel up.

const chainOpen = () => document.body.classList.contains("chained");
const closeChain = () => {
  document.body.classList.remove("chained");
  $("#menuBtn").setAttribute("aria-expanded", "false");
};
const openChain = () => {
  document.body.classList.add("chained");
  $("#menuBtn").setAttribute("aria-expanded", "true");
};

$("#menuBtn").setAttribute("aria-haspopup", "true");
$("#menuBtn").setAttribute("aria-expanded", "false");
$("#menuBtn").onclick = (e) => {
  e.stopPropagation();
  chainOpen() ? closeChain() : openChain();
};
$("#chainVeil").onclick = closeChain;

/**
 * One place decides which of the seven is up, because two things now point at
 * them: the chain you summon and the rail down the panel's inner edge. They
 * have to agree, and the way to make sure they agree is to have one of them.
 */
function pickPanel(tab) {
  for (const x of document.querySelectorAll(".chainlink, .raillink"))
    x.classList.toggle("on", x.dataset.tab === tab);
  for (const p of document.querySelectorAll("[data-panel]"))
    p.hidden = p.dataset.panel !== tab;
  closeChain();
  showPanel();
}
for (const b of document.querySelectorAll(".chainlink, .raillink"))
  b.onclick = () => pickPanel(b.dataset.tab);

async function refreshChats() {
  const chats = await api("/chats");
  if (!Array.isArray(chats)) return;
  const list = $("#chatList");
  $("#recentChatsWrap").hidden = chats.length === 0;
  list.innerHTML = "";
  chats.forEach((c) => {
    const b = document.createElement("button");
    b.className = "item";
    b.innerHTML =
      medallion(c.avatar, c.character_name) +
      `<span class="meta">` +
      `<span class="t">${c.parent_chat_id ? `<span class="branchmark" title="A branch">${ICON.branch}</span>` : ""}${esc(c.character_name)}` +
      `<span class="when">${ago(c.updated_at)}</span></span>` +
      `<span class="preview">${preview(c)}</span>` +
      `<span class="s">${c.turns} message${c.turns === 1 ? "" : "s"}</span></span>` +
      `<span class="rowtools"><button data-del-chat title="Delete" aria-label="Delete chat">${ICON.del}</button></span>`;
    b.className = "item withface";
    b.onclick = (e) => {
      if (e.target.closest("[data-del-chat]")) {
        api("/chats/" + c.id, { method: "DELETE" })
          .then(async (r) => { await refreshChats(); await refreshCast(); offerUndo(r, "chat"); });
        return;
      }
      openChat(c.id);
    };
    list.appendChild(rowShell(c.id, b));
  });
}

let castCache = [];

async function refreshCast() {
  const cast = await api("/cast");
  if (!Array.isArray(cast)) return;
  castCache = cast;
  renderCast();
}

/** Matches on name, description, tags and the text of any chat in the fold. */
function castMatches(ch, q) {
  if (!q) return true;
  const hay = [
    ch.name,
    ch.description ?? "",
    ...(ch.chats ?? []).map((c) => `${c.title ?? ""} ${c.last_message ?? ""}`),
  ].join(" ").toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

function renderCast() {
  const q = ($("#castSearch").value ?? "").trim().toLowerCase();
  const cast = castCache.filter((ch) => castMatches(ch, q));
  const list = $("#castList");
  list.innerHTML = cast.length
    ? ""
    : `<p class="hint">${castCache.length ? "Nobody matches that." : "Your cast is empty."}</p>`;
  cast.forEach((ch) => {
    const b = document.createElement("button");
    b.className = "item withface";
    b.innerHTML =
      medallion(ch.avatar, ch.name) +
      `<span class="meta"><span class="t">${esc(ch.name)}</span>` +
      `<span class="s">${ch.chats.length ? `${ch.chats.length} chat${ch.chats.length > 1 ? "s" : ""}` : "No chats yet"}</span></span>` +
      `<span class="rowtools">` +
      `<button data-new-chat title="Start a new chat" aria-label="New chat with ${esc(ch.name)}">${ICON.plus}</button>` +
      `<button data-edit-char title="Edit" aria-label="Edit ${esc(ch.name)}">${ICON.edit}</button>` +
      // Only at the table, and never for somebody who lives only here — there
      // is nowhere to send them that is not simply somewhere else.
      (document.body.dataset.mode === "tabletop"
        ? `<button data-untable title="Send back to the library"` +
          ` aria-label="Send ${esc(ch.name)} back to the library">${ICON.up}</button>`
        : "") +
      `<button data-export-char title="Export as a card" aria-label="Export ${esc(ch.name)}">${ICON.down}</button>` +
      `<button data-del-char title="Delete" aria-label="Delete ${esc(ch.name)}">${ICON.del}</button></span>`;
    b.onclick = async (e) => {
      if (e.target.closest("[data-new-chat]")) return startChat(ch.id);
      if (e.target.closest("[data-edit-char]")) return editChar(ch);
      if (e.target.closest("[data-export-char]")) {
        window.location.href = `/api/characters/${ch.id}/export`;
        return;
      }
      if (e.target.closest("[data-untable]")) {
        await api(`/characters/${ch.id}/world`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at: false }),
        });
        await refreshCast();
        await refreshChats();
        toast(`${ch.name} has left the table.`);
        return;
      }
      if (e.target.closest("[data-del-char]")) {
        if (!(await ask(`Delete ${ch.name} and every chat with them?`))) return;
        const r = await api("/characters/" + ch.id, { method: "DELETE" });
        await refreshCast();
        await showSplash();
        return offerUndo(r, "character");
      }
      const sub = list.querySelector(`[data-chats="${ch.id}"]`);
      if (sub) sub.hidden = !sub.hidden;
    };
    list.appendChild(rowShell(ch.id, b));

    // Chats belonging to this character, folded away until asked for — but
    // opened automatically when a search has matched something inside them.
    const sub = document.createElement("div");
    sub.className = "sublist";
    sub.dataset.chats = ch.id;
    sub.hidden = !(q && ch.chats?.some((c) =>
      `${c.title ?? ""} ${c.last_message ?? ""}`.toLowerCase().includes(q)));
    // Sibling buttons, not nested — a button cannot contain another button.
    sub.innerHTML = ch.chats.length
      ? ch.chats.map((c) =>
          `<div class="subrow">` +
          `<button class="subitem" data-open="${c.id}">` +
          `<span class="subtext">` +
          `<span class="t">${c.parent_chat_id ? `<span class="branchmark" title="A branch">${ICON.branch}</span>` : ""}${esc(c.title || "Untitled")}</span>` +
          `<span class="subpreview">${preview(c, 70)}</span></span>` +
          `<span class="s">${c.turns} &middot; ${ago(c.updated_at)}</span>` +
          `</button>` +
          `<button class="subdel" data-del-one="${c.id}" title="Delete this chat" aria-label="Delete chat">${ICON.del}</button>` +
          `</div>`).join("")
      : `<p class="hint">No chats yet. Use the plus to start one.</p>`;
    sub.onclick = async (e) => {
      const del = e.target.closest("[data-del-one]");
      if (del) {
        if (!(await ask("Delete this chat?"))) return;
        const r = await api("/chats/" + del.dataset.delOne, { method: "DELETE" });
        await refreshCast(); await refreshChats();
        offerUndo(r, "chat");
        const again = list.querySelector(`[data-chats="${ch.id}"]`);
        if (again) again.hidden = false;
        return;
      }
      const open = e.target.closest("[data-open]");
      if (open) openChat(open.dataset.open);
    };
    list.appendChild(sub);
  });
}

function editChar(ch) {
  S.editing = ch?.id ?? null;
  $("#charDialogTitle").textContent = ch ? "Edit character" : "New character";
  $("#c_name").value = ch?.name ?? "";
  $("#c_description").value = ch?.description ?? "";
  $("#c_personality").value = ch?.personality ?? "";
  $("#c_scenario").value = ch?.scenario ?? "";
  $("#c_first").value = ch?.first_message ?? "";
  charFace.reset(ch?.avatar ?? "");
  $("#charDialog").showModal();
}
/* ---- what the game is about -------------------------------------------------
   Asked once, at the top of a new game, straight after the memory book. A
   tabletop chat that opens on "what are you in the mood for?" is asking a
   question most people cannot answer cold; at a real table somebody has done
   the reading and the first half hour is spent playing rather than deciding.

   Three are already written, and the fourth option opens a page where you
   write one. Declining is a real answer and is remembered as firmly as any
   other — the question is asked once. */

const LENGTH_NAMES = {
  "one-shot": "One evening",
  short: "A few sittings",
  long: "A long campaign",
  open: "Open-ended",
};
const LENGTH_LINES = {
  "one-shot": "Brisk. Stakes early, and nothing opened that cannot be closed tonight.",
  short: "One clear arc across a handful of sittings, with room for a subplot.",
  long: "More planted than resolved. People carry on offstage.",
  open: "No shape imposed — it follows whatever you turn out to be interested in.",
};

let campaignCache = [];
let building = null;          // the campaign being written, while the page is open

/** What a chat is already playing, if anything, in the storybook's shape. */
function campaignOf(chat) {
  try {
    const c = chat?.campaign ? JSON.parse(chat.campaign) : null;
    if (!c) return null;
    return { ...c, bestiary: [...(c.bestiary ?? [])], books: [...(c.books ?? [])] };
  } catch { return null; }
}

async function askAboutCampaign(chat) {
  try { campaignCache = await api("/campaigns"); } catch { campaignCache = []; }

  $("#campCards").innerHTML = campaignCache.map((c) => `
    <button type="button" class="campcard" data-camp="${esc(c.id)}">
      <span class="camptitle">${esc(c.title)}</span>
      <span class="camptags">
        <span class="camptag">${esc(LENGTH_NAMES[c.length] ?? c.length)}</span>
        ${c.bestiary.length ? `<span class="camptag">${c.bestiary.length} things out there</span>` : ""}
      </span>
      <span class="camphook">${esc(c.premise)}</span>
    </button>`).join("");

  for (const b of $("#campCards").children) {
    b.onclick = () => settleCampaign(chat.id, { id: b.dataset.camp });
  }

  $("#campPick").hidden = false;
  $("#campBuild").hidden = true;
  const dlg = $("#campaignDialog");
  dlg.showModal();
  return new Promise((resolve) => dlg.addEventListener("close", resolve, { once: true }));
}

async function settleCampaign(chatId, body) {
  let settled;
  try {
    ({ campaign: settled } = await api(`/chats/${chatId}/campaign`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  } catch (err) {
    fail(err?.message ?? "Could not set that up.");
    return;
  }
  $("#campaignDialog").close();
  // Kept on the open chat as well as on the server, so opening the storybook
  // again shows what is actually being played rather than a blank page.
  if (chatMeta?.id === chatId) {
    chatMeta.campaign_asked = 1;
    chatMeta.campaign = settled ? JSON.stringify(settled) : "";
  }
  if (settled?.title) toast(`${settled.title} it is.`);
  // A book the game named is now bound to the chat; the panel lists those.
  renderLoreList();
}

/** The page where you write one. */
async function openStorybook(chat, from) {
  building = from ?? {
    id: "", title: "", premise: "", theme: "", length: "short",
    opening: "", bestiary: [], books: [], notes: "",
  };
  $("#camp_title").value = building.title;
  $("#camp_premise").value = building.premise;
  $("#camp_theme").value = building.theme;
  $("#camp_opening").value = building.opening;
  $("#camp_notes").value = building.notes;

  $("#camp_length").innerHTML = Object.entries(LENGTH_NAMES).map(([k, name]) =>
    `<button type="button" data-len="${k}"${k === building.length ? ' class="on"' : ""}>${esc(name)}</button>`,
  ).join("");
  for (const b of $("#camp_length").children) {
    b.onclick = () => {
      building.length = b.dataset.len;
      for (const s of $("#camp_length").children) s.classList.toggle("on", s === b);
      $("#camp_lengthhint").textContent = LENGTH_LINES[building.length] ?? "";
    };
  }
  $("#camp_lengthhint").textContent = LENGTH_LINES[building.length] ?? "";

  drawBeasts();

  let books = [];
  try { books = await api("/lorebooks"); } catch { books = []; }
  $("#camp_books").innerHTML = books.length
    ? books.map((b) => `<label class="check"><input type="checkbox" value="${esc(b.id)}"` +
        `${building.books.includes(b.id) ? " checked" : ""}> ${esc(b.name)}</label>`).join("")
    : `<p class="hint">No books yet. Anything you make later can be linked from the chat menu.</p>`;

  $("#campPick").hidden = true;
  $("#campBuild").hidden = false;
  if (!$("#campaignDialog").open) $("#campaignDialog").showModal();
  $("#camp_title").focus();
}

function drawBeasts() {
  $("#camp_bestiary").innerHTML = building.bestiary.map((m, i) =>
    `<span class="chip">${esc(m)}<button type="button" data-drop="${i}" aria-label="Remove ${esc(m)}">&times;</button></span>`,
  ).join("");
  for (const b of $("#camp_bestiary").querySelectorAll("[data-drop]")) {
    b.onclick = () => { building.bestiary.splice(+b.dataset.drop, 1); drawBeasts(); };
  }
}

$("#camp_beast").onkeydown = (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const v = e.target.value.trim();
  // Twelve is the server's ceiling; stopping here means the list you see is
  // the list that gets stored rather than one silently trimmed on the way.
  if (!v || building.bestiary.length >= 12) { e.target.value = ""; return; }
  building.bestiary.push(v);
  e.target.value = "";
  drawBeasts();
};

$("#campOwn").onclick = () => openStorybook(chatMeta);

/*
 * A whole one, in one press.
 *
 * It fills every field rather than the empty ones, so pressing it twice gives
 * you a second campaign instead of a chimera of the first two — and everything
 * it writes is ordinary text in ordinary boxes, so the next thing to do with a
 * dream you half like is edit it.
 *
 * The books you ticked are yours and are left alone; they are about your
 * library rather than about the story.
 */
/*
 * A few words, written out.
 *
 * The seed is whatever is in the situation box — the one field somebody with
 * half an idea will actually have typed in — and the title comes along if
 * there is one. What comes back lands in the same ordinary boxes, so the
 * result is a draft rather than a decision.
 */
$("#campWrite").onclick = async () => {
  const seed = [$("#camp_title").value.trim(), $("#camp_premise").value.trim()]
    .filter(Boolean).join(". ");
  if (!seed) {
    fail("Write a few words in the situation first — anything at all.");
    $("#camp_premise").focus();
    return;
  }
  const btn = $("#campWrite");
  btn.disabled = true;
  const said = $("#campWriteHint").textContent;
  $("#campWriteHint").textContent = "Thinking about it…";
  try {
    const { campaign } = await api("/campaigns/write", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed, length: building.length }),
    });
    // The books ticked and the monsters typed by hand are the player's own
    // work and are not overwritten by a draft of the prose.
    openStorybook(chatMeta, {
      ...campaign,
      books: building.books,
      bestiary: [...new Set([...building.bestiary, ...campaign.bestiary])].slice(0, 12),
    });
  } catch (err) {
    fail(err?.message ?? "Could not write that.");
  } finally {
    btn.disabled = false;
    $("#campWriteHint").textContent = said;
  }
};

$("#campRoll").onclick = async () => {
  let dreamt;
  try { dreamt = await api("/campaigns/dream"); } catch { fail("Could not think of one."); return; }
  openStorybook(chatMeta, { ...dreamt, books: building?.books ?? [] });
};
$("#campBack").onclick = () => { $("#campBuild").hidden = true; $("#campPick").hidden = false; };
$("#campNone").onclick = () => settleCampaign(chatMeta.id, {});
$("#campBegin").onclick = () => {
  building.title = $("#camp_title").value.trim();
  building.premise = $("#camp_premise").value.trim();
  building.theme = $("#camp_theme").value.trim();
  building.opening = $("#camp_opening").value.trim();
  building.notes = $("#camp_notes").value.trim();
  building.books = [...$("#camp_books").querySelectorAll("input:checked")].map((i) => i.value);
  settleCampaign(chatMeta.id, { campaign: building });
};

/* ---- bringing somebody to the table ----------------------------------------
   The table starts empty on purpose: walking through the door and finding your
   whole library standing there is not going anywhere. So they come over one at
   a time, and coming over is additive — a character you play with in a story
   is still there afterwards, in that story, with every chat intact. */

let elsewhereCache = [];
/** Which list the picker is showing: the cast, or your own personas. */
let bringKind = "cast";

async function openBring(kind = "cast") {
  bringKind = kind;
  $("#bringSearch").value = "";
  $("#bringDialog").querySelector("h2").textContent =
    kind === "personas" ? "Bring one of your personas over"
    : kind === "lorebooks" ? "Bring a book to the table"
    : "Bring someone to the table";
  const from = { personas: "/personas/elsewhere", lorebooks: "/lorebooks/elsewhere" };
  try {
    elsewhereCache = await api(from[kind] ?? "/cast/elsewhere");
  } catch { elsewhereCache = []; }
  renderBring();
  $("#bringDialog").showModal();
}

function renderBring() {
  const q = ($("#bringSearch").value ?? "").trim().toLowerCase();
  const rows = elsewhereCache.filter((ch) =>
    !q || `${ch.name} ${ch.description ?? ""}`.toLowerCase().includes(q));
  const list = $("#bringList");
  list.innerHTML = rows.length
    ? ""
    : `<p class="hint">${elsewhereCache.length
        ? "Nobody matches that."
        : "Everybody you have is already here."}</p>`;
  // Capped rather than paged: a library of seven hundred is a scroll nobody
  // finishes, and the search above is the real way through it.
  for (const ch of rows.slice(0, 60)) {
    const b = document.createElement("button");
    b.className = "item withface";
    b.innerHTML = medallion(ch.avatar, ch.name) +
      `<span class="meta"><span class="t">${esc(ch.name)}</span>` +
      `<span class="s">${esc((ch.description ?? "").slice(0, 70)) || "No description"}</span></span>`;
    b.onclick = async () => {
      const where = { personas: "personas", lorebooks: "lorebooks" }[bringKind] ?? "characters";
      await api(`/${where}/${ch.id}/world`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ at: true }),
      });
      elsewhereCache = elsewhereCache.filter((x) => x.id !== ch.id);
      renderBring();
      if (bringKind === "personas") await refreshPersonas();
      else if (bringKind === "lorebooks") await refreshLore();
      else { await refreshCast(); await refreshChats(); }
      toast(bringKind === "lorebooks"
        ? `${ch.name} is on the table's shelf.`
        : `${ch.name} has pulled up a chair.`);
    };
    list.appendChild(b);
  }
  if (rows.length > 60) {
    list.insertAdjacentHTML("beforeend",
      `<p class="hint">${rows.length - 60} more — narrow it with the search.</p>`);
  }
}

$("#bringOverBtn").onclick = () => openBring("cast");
$("#bringMeBtn").onclick = () => openBring("personas");
$("#bringBookBtn").onclick = () => openBring("lorebooks");
$("#bringSearch").oninput = () => renderBring();
$("#bringDone").onclick = () => $("#bringDialog").close();

$("#castSearch").oninput = () => renderCast();
$("#castSearch").onkeydown = (e) => {
  if (e.key === "Escape") { $("#castSearch").value = ""; renderCast(); }
};

$("#newCharBtn").onclick = () => editChar(null);
$("#homeBtn").onclick = showSplash;

/**
 * The answer to an upload, whatever shape it arrives in.
 *
 * These posts all did `.then(x => x.json())`. A 500 answers with the plain
 * text "Internal Server Error", so json() threw, the rejection went unhandled,
 * and the hint sat on "Reading 1 file…" for ever — which is what a failed
 * import looked like from the outside: nothing at all.
 */
async function uploadResult(res, fallback = "The import failed.") {
  const body = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = JSON.parse(body); } catch {}
  if (parsed && typeof parsed === "object") {
    return res.ok ? parsed : { error: parsed.error ?? fallback };
  }
  return { error: body.trim() ? `${fallback} (${body.trim().slice(0, 140)})` : fallback };
}

$("#cardFile").onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  $("#importHint").textContent = `Reading ${files.length} file${files.length > 1 ? "s" : ""}…`;
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const r = await uploadResult(await fetch("/api/import/characters", { method: "POST", body: fd }));

  const bits = [];
  if (r.error) bits.push(r.error);
  if (r.imported?.length) bits.push(`Brought in ${r.imported.length}: ${r.imported.join(", ")}.`);
  if (r.failed?.length)
    bits.push(`Could not read ${r.failed.map((f) => `${f.name} (${f.reason})`).join("; ")}`);
  $("#importHint").textContent = bits.join(" ") || "Nothing was imported.";
  e.target.value = "";
  refreshCast();
  if (!S.chatId) showSplash();
};
$("#emptyAction").onclick = () => {
  openDrawer();
  document.querySelector('.chainlink[data-tab="cast"]').click();
};

$("#charForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "save") return;
  const p = {
    name: $("#c_name").value,
    description: $("#c_description").value,
    personality: $("#c_personality").value,
    scenario: $("#c_scenario").value,
    first_message: $("#c_first").value,
  };
  if (!p.name.trim()) return;
  const r = await api(S.editing ? "/characters/" + S.editing : "/characters", {
    method: S.editing ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(p),
  });
  await charFace.commit(S.editing ?? r.id);
  refreshCast();
  if (S.chatId) S.charAvatar = "";
});

// ---- settings sections --------------------------------------------------

function showView(name) {
  document.querySelectorAll('[data-panel="settings"] [data-view]').forEach((v) => {
    v.hidden = v.dataset.view !== name;
  });
}
document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => showView(b.dataset.go)));
document.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => showView("menu")));

/**
 * The preset currently overriding the sampling fields, if any.
 *
 * While one is active it wins over the stored settings for every field in
 * PRESET_FIELDS — so a Sampling panel that loaded and saved the global
 * settings was showing numbers the model never saw and writing numbers it
 * would go on ignoring. When a preset is active this panel reads and writes
 * *it* instead, and says so.
 */
let samplingPreset = null;

function paintSampling() {
  const n = (v) => Number(v || 0).toLocaleString();
  $("#v_max_tokens").textContent = `${n($("#max_tokens").value)} tokens`;
  const ctx = Number($("#context_tokens").value || 0);
  $("#v_context_tokens").textContent = ctx >= 1000
    ? `${(ctx / 1000).toFixed(ctx % 1000 ? 1 : 0)}k tokens`
    : `${ctx} tokens`;
  // Moving this slider moves the line, and a preset loading moves it too. This
  // is the one place both of those come through, so the line is redrawn here
  // rather than wired to the slider — which would have missed the preset.
  markCutoff();
}

function showSamplingSource() {
  const el = $("#samplingSource");
  if (!el) return;
  el.textContent = samplingPreset
    ? `These are “${samplingPreset.name}”’s values. It is active, so it overrides ` +
      `your saved settings — editing here changes the preset.`
    : "No preset is active, so these are the values every reply uses.";
}

["max_tokens", "context_tokens"].forEach((f) => {
  $("#" + f).addEventListener("input", paintSampling);
});

$("#saveSampling").onclick = async () => {
  if (samplingPreset) {
    const patch = {};
    PRESET_FIELDS.forEach((f) => { const v = fieldValue(f); if (v !== undefined) patch[f] = v; });
    await api(`/presets/${samplingPreset.id}/sampling`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    Object.assign(samplingPreset.sampling, patch);
    await refreshPresets();
    $("#samplingHint").textContent = `Saved into “${samplingPreset.name}”.`;
  } else {
    await saveSettings();
    $("#samplingHint").textContent = "Settings saved.";
  }
  setTimeout(() => ($("#samplingHint").textContent = ""), 2500);
};

// ---- bulk selection -----------------------------------------------------

/**
 * Turns a list into a picker. In select mode the whole row toggles, shift
 * extends a range from the last row you touched, and ctrl/cmd toggles one
 * without moving that anchor — the conventions people already know from
 * file managers.
 */
function makeSelectable(listId, prefix, endpoint, refresh, noun) {
  let on = false;
  let anchor = -1;
  /*
   * A resolver rather than an id, because the lorebooks are drawn twice — as
   * a shelf and as a list — and bulk delete bound to the list alone was a set
   * of buttons that quietly did nothing whenever the shelf was showing.
   */
  const list = () => (typeof listId === "function" ? listId() : $("#" + listId));
  const boxes = () => [...list().querySelectorAll(".pick")];
  const chosen = () => boxes().filter((c) => c.checked).map((c) => c.dataset.id);

  function sync() {
    const n = chosen().length;
    const total = boxes().length;
    $("#" + prefix + "Count").textContent = n ? `${n} of ${total}` : "";
    $("#" + prefix + "Count").hidden = !on;
    $("#" + prefix + "Delete").hidden = !on || !n;
    $("#" + prefix + "All").hidden = false;
    // Only the cast list can start a group, and only from two or more.
    const group = $("#" + prefix + "Group");
    if (group) group.hidden = !on || n < 2;
    $("#" + prefix + "All").classList.toggle("on", n > 0 && n === total);
  }

  function setMode(next) {
    on = next;
    anchor = -1;
    paint();
    $("#" + prefix + "Select").classList.toggle("on", on);
    if (!on) boxes().forEach((c) => (c.checked = false));
    sync();
  }

  /**
   * Puts the picking class on whichever container is currently on screen.
   *
   * Called again after a redraw and after a view switch, because the shelf and
   * the list are two elements and only one of them is showing — marking the
   * one that was showing when picking started is how the checkboxes ended up
   * on the wrong view.
   */
  function paint() {
    /*
     * Clear it off both of the lorebooks' two views before marking the one
     * that is showing. Written as `$("#" + listId)` at first, which builds a
     * selector out of a function when listId is one, and querySelector throws
     * on that — taking the whole of select-all down with it, silently.
     */
    for (const el of [$("#loreShelf"), $("#loreList")]) el?.classList.remove("selecting");
    list()?.classList.toggle("selecting", on);
  }

  $("#" + prefix + "Select").onclick = () => setMode(!on);

  /**
   * Select-all is always available, and turns picking on by itself.
   *
   * It used to be hidden until the mode was on, which made the three icons an
   * order you had to know: select, then all, then the bin. Anyone who reached
   * for "select all" first clicked a hidden button, selected nothing, and
   * never saw the bin appear — a bulk delete that looked simply broken.
   */
  $("#" + prefix + "All").onclick = () => {
    if (!on) setMode(true);
    const all = boxes();
    const every = all.length > 0 && all.every((c) => c.checked);
    all.forEach((c) => (c.checked = !every));
    sync();
  };

  /*
   * Capture, so a row's own click handler never fires while picking — and on
   * the document rather than on the container, since which container this is
   * can change under it. The `on` guard is first, so this costs nothing at all
   * the rest of the time.
   */
  document.addEventListener("click", (e) => {
    if (!on) return;
    const here = list();
    if (!here) return;
    // A spine is its own wrapper; a list row has one around it.
    const wrap = e.target.closest(".rowwrap, .spine");
    if (!wrap || !here.contains(wrap)) return;
    e.preventDefault();
    e.stopPropagation();

    const all = boxes();
    const box = wrap.querySelector(".pick");
    const i = all.indexOf(box);

    if (e.shiftKey && anchor >= 0) {
      const [lo, hi] = i < anchor ? [i, anchor] : [anchor, i];
      const value = !box.checked;
      for (let k = lo; k <= hi; k++) all[k].checked = value;
    } else {
      box.checked = !box.checked;
      if (!(e.ctrlKey || e.metaKey)) anchor = i;
    }
    sync();
  }, true);

  $("#" + prefix + "Delete").onclick = async () => {
    const ids = chosen();
    if (!ids.length) return;
    if (!(await ask(`Delete ${ids.length} ${noun}${ids.length > 1 ? "s" : ""}? This cannot be undone.`))) return;
    const r = await api(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    await refresh();
    setMode(false);
    offerUndo(r, noun, ids.length);
  };

  setMode(false);
  // So a redraw or a change of view can put the picking state back.
  return { repaint: () => { paint(); sync(); }, off: () => setMode(false), isOn: () => on };
}

/**
 * A search box over a results list, shared by the new-group dialog and the
 * room dialog. Plain text in, a matching row's medallion+name out — a select
 * with hundreds of characters in it is a list nobody can actually search.
 */
function wirePicker(searchEl, resultsEl, candidates, onPick) {
  const render = () => {
    const q = searchEl.value.trim().toLowerCase();
    const matches = (q ? candidates.filter((c) => c.name.toLowerCase().includes(q)) : candidates).slice(0, 40);
    resultsEl.hidden = !q && !candidates.length;
    resultsEl.innerHTML = matches.length
      ? matches.map((c) =>
          `<button type="button" class="pickrow" data-id="${c.id}">${medallion(c.avatar, c.name)}<span>${esc(c.name)}</span></button>`,
        ).join("")
      : `<p class="hint">No one matches.</p>`;
    resultsEl.hidden = !q;
  };
  searchEl.oninput = render;
  searchEl.onfocus = render;
  resultsEl.onclick = (e) => {
    const row = e.target.closest("[data-id]");
    if (!row) return;
    searchEl.value = "";
    resultsEl.hidden = true;
    onPick(row.dataset.id);
  };
  render();
}

// ---- starting a group chat -------------------------------------------------
// One dialog, two doors in: the always-visible icon opens it empty, picking
// several characters first and tapping the group icon opens it pre-filled.
// Either way you can still add or drop anyone before the chat is created.

let ngPicked = [];   // [{id, name, avatar}]

function renderNgMembers() {
  const el = $("#ng_members");
  el.innerHTML = "";
  ngPicked.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "blockrow";
    row.innerHTML =
      `<div class="brow">${medallion(p.avatar, p.name)}<span class="b-fixed">${esc(p.name)}</span>` +
      `<span class="btools"><button type="button" class="bico danger" data-drop aria-label="Remove ${esc(p.name)}">&minus;</button></span></div>`;
    row.querySelector("[data-drop]").onclick = () => { ngPicked.splice(i, 1); renderNgMembers(); };
    el.appendChild(row);
  });
  $("#ng_hint").textContent = ngPicked.length < 2
    ? "Add at least two characters." : `${ngPicked.length} in the scene.`;
  $("#ng_create").disabled = ngPicked.length < 2;

  const here = new Set(ngPicked.map((p) => p.id));
  wirePicker($("#ng_search"), $("#ng_results"), allCharacters.filter((c) => !here.has(c.id)), (id) => {
    const c = allCharacters.find((x) => x.id === id);
    if (c) ngPicked.push(c);
    renderNgMembers();
  });
}

let allCharacters = [];
async function openNewGroup(preselected = []) {
  const cast = await api("/characters");
  allCharacters = Array.isArray(cast) ? cast : [];
  ngPicked = allCharacters.filter((c) => preselected.includes(c.id));
  $("#ng_title").value = "";
  $("#ng_scenario").value = "";
  $("#ng_search").value = "";
  renderNgMembers();
  $("#newGroupDialog").showModal();
}

$("#newGroupBtn").onclick = () => openNewGroup([]);

$("#newGroupForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "create" || ngPicked.length < 2) return;
  const r = await api("/chats/group", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      character_ids: ngPicked.map((p) => p.id),
      title: $("#ng_title").value,
      scenario: $("#ng_scenario").value,
    }),
  });
  if (r?.error) return void toast(r.error);
  await refreshChats();
  await refreshCast();
  openChat(r.id);
});

$("#castGroup").onclick = async () => {
  const ids = [...$("#castList").querySelectorAll(".pick")].filter((x) => x.checked).map((x) => x.dataset.id);
  if (ids.length < 2) return;
  openNewGroup(ids);
};

makeSelectable("castList", "cast", "/characters/delete",
  async () => { await refreshCast(); await showSplash(); }, "character");
makeSelectable("personaList", "persona", "/personas/delete",
  () => refreshPersonas(), "persona");
makeSelectable("chatList", "chat", "/chats/delete",
  async () => { await refreshChats(); await refreshCast(); }, "chat");

// A SillyTavern import brings in dozens of each of these at once, so both get
// the same treatment the cast already had: a filter, and a way to remove more
// than one without a confirm apiece.
loreSelection = makeSelectable(
  () => (loreAsList ? $("#loreList") : $("#loreShelf")),
  "lore", "/lorebooks/delete", refreshLore, "lorebook",
);

/**
 * Import lives with the other list controls now, not as a button underneath a
 * list six hundred rows long. The file inputs stay hidden and these open them.
 */
for (const [button, input] of [
  ["#loreImportBtn", "#loreImport"],
  ["#presetImportBtn", "#presetImport"],
  ["#regexImportBtn", "#regexImport"],
]) {
  const b = $(button);
  if (b) b.onclick = () => $(input).click();
}
makeSelectable("presetList", "preset", "/presets/delete", refreshPresets, "preset");

/**
 * The Regex list. A row says what a script does and where it lands: `shown`
 * for the display, `sent` for the prompt, and the depth window if it has one —
 * "from 6 back" is what makes a context cleanup a cleanup rather than a way to
 * delete the scene you are in.
 */
function renderRegexList() {
  const el = $("#regexList");
  if (!el) return;
  const q = ($("#regexSearch")?.value ?? "").trim().toLowerCase();
  const shown = q
    ? regexScripts.filter((r) =>
        r.name.toLowerCase().includes(q) || (r.source || "").toLowerCase().includes(q))
    : regexScripts;

  el.innerHTML = regexScripts.length
    ? (shown.length ? "" : `<p class="listempty">No script matches \u201c${esc(q)}\u201d.</p>`)
    : `<p class="hint">No regex scripts yet.</p>`;

  shown.forEach((r) => {
    const where = [r.display ? "shown" : null, r.prompt ? "sent" : null].filter(Boolean).join(" + ");
    const window = r.minDepth !== null && r.minDepth !== undefined
      ? `from ${r.minDepth} back`
      : r.maxDepth !== null && r.maxDepth !== undefined ? `to ${r.maxDepth} back` : "";
    const bits = [where, window, r.source].filter(Boolean).join(" \u00b7 ");

    const row = document.createElement("div");
    row.className = "item regexrow" + (r.enabled ? "" : " off");
    row.innerHTML =
      `<span class="meta"><span class="t">${esc(r.name)}</span>` +
      `<span class="s">${esc(bits || "no placement")}</span></span>` +
      `<span class="rowtools">` +
      `<button data-toggle title="${r.enabled ? "Switch off" : "Switch on"}" aria-label="Switch ${r.enabled ? "off" : "on"}">${r.enabled ? ICON.tick : ICON.plus}</button>` +
      `<button data-del title="Delete" aria-label="Delete">${ICON.del}</button></span>`;

    row.onclick = async (e) => {
      if (e.target.closest("[data-toggle]")) {
        await api(`/regex/${encodeURIComponent(r.id)}/toggle`, { method: "POST" });
        return refreshRegex();
      }
      if (e.target.closest("[data-del]")) {
        if (!(await ask(`Delete the script "${r.name}"?`))) return;
        await api("/regex/" + encodeURIComponent(r.id), { method: "DELETE" });
        return refreshRegex();
      }
    };
    el.appendChild(rowShell(r.id, row));
  });
}

$("#regexSearch").oninput = renderRegexList;
makeSelectable("regexList", "regex", "/regex/delete", refreshRegex, "script");

$("#regexImport").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  let total = 0;
  for (const f of files) {
    try {
      const json = JSON.parse(await f.text());
      const r = await api("/regex/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scripts: json, source: f.name.replace(/\.json$/i, "") }),
      });
      if (r.imported) total += r.imported;
    } catch {}
  }
  $("#regexHint").textContent = total
    ? `Imported ${total} script${total === 1 ? "" : "s"}.`
    : "No regex scripts in those files.";
  await refreshRegex();
  // A newly imported display script should change the thread already on screen.
  if (S.chatId) openChat(S.chatId);
};

$("#loreSearch").oninput = renderLoreList;
$("#loreView").onclick = () => setLoreView(!loreAsList);
// Remembered from last time, and applied before anything is drawn.
setLoreView(loreAsList);
$("#presetSearch").oninput = renderPresetList;

// Opening a chat from anywhere should leave the splash behind.


/**
 * A checkbox cannot live inside a <button> — that is invalid HTML and browsers
 * either drop it or let the button eat its clicks. So the row is a wrapper
 * holding the checkbox and the button side by side.
 */
function rowShell(id, button) {
  const wrap = document.createElement("div");
  wrap.className = "rowwrap";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "pick";
  box.dataset.id = id;
  box.setAttribute("aria-label", "Select");
  wrap.append(box, button);
  return wrap;
}

// ---- presets ------------------------------------------------------------

const PRESET_FIELDS = [
  "temperature", "max_tokens", "context_tokens",
  "top_p", "min_p", "repetition_penalty", "frequency_penalty", "presence_penalty",
  "stream", "reasoning_effort",
];

/** The last list the server sent, so the search box costs no request. */
let presetsCache = [];

async function refreshPresets() {
  const list = await api("/presets");
  if (!Array.isArray(list)) return;
  presetsCache = list;
  renderPresetList();
}

/**
 * The dropdown at the top of the Sampling page, and the card under it.
 *
 * Switching preset is the common act and now takes one click; the full list
 * below is for managing them — renaming, blocks, export, bulk delete — and
 * lives behind a fold so a library of two hundred does not bury the sliders.
 */
function renderPresetPick() {
  const sel = $("#presetPick");
  if (!sel) return;
  const active = presetsCache.find((p) => p.is_active);
  sel.innerHTML =
    `<option value="">No preset — use the values above</option>` +
    presetsCache.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  sel.value = active ? active.id : "";

  const card = $("#presetCard");
  if (!card) return;
  if (!active) {
    card.innerHTML = `<p class="hint">Nothing is overriding the sampling values above.</p>`;
    return;
  }
  let d = {};
  try { d = JSON.parse(active.data); } catch {}
  const blocks = Array.isArray(d.blocks) ? d.blocks : [];
  const on = blocks.filter((b) => b.enabled).length;
  const bit = (label, value) =>
    value === undefined || value === "" ? "" : `<span class="pstat"><em>${label}</em>${esc(String(value))}</span>`;
  card.innerHTML =
    `<div class="pname">${esc(active.name)}</div>` +
    `<div class="pstats">` +
      bit("temp", d.temperature) + bit("top-p", d.top_p) +
      bit("reply", d.max_tokens) + bit("context", d.context_tokens) +
      bit("stream", d.stream === undefined ? undefined : d.stream === "0" ? "off" : "on") +
      bit("thinking", d.reasoning_effort) +
      (blocks.length ? `<span class="pstat"><em>blocks</em>${on} of ${blocks.length} on</span>` : "") +
    `</div>` +
    `<div class="prow">` +
      `<button class="ghost" data-card-blocks>Prompt blocks</button>` +
      `<button class="ghost" data-card-export>Export</button>` +
    `</div>`;
  card.onclick = (e) => {
    if (e.target.closest("[data-card-blocks]")) return openBlocks(active, d);
    if (e.target.closest("[data-card-export]")) window.location.href = `/api/presets/${active.id}/export`;
  };
}

$("#presetPick")?.addEventListener("change", async (e) => {
  const id = e.target.value;
  await api(id ? `/presets/${id}/activate` : "/presets/none", { method: "POST" });
  await refreshPresets();
  // Which preset is active decides what the sliders above show and save to.
  await loadSettings();
});

/** Drawn from the cache, so typing in the search box costs no request. */
function renderPresetList() {
  const list = presetsCache;
  const el = $("#presetList");
  const q = ($("#presetSearch")?.value ?? "").trim().toLowerCase();
  const shown = q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list;

  el.innerHTML = list.length
    ? (shown.length ? "" : `<p class="listempty">No preset matches “${esc(q)}”.</p>`)
    : `<p class="hint">No presets yet.</p>`;

  shown.forEach((p) => {
    const b = document.createElement("button");
    b.className = "item withface" + (p.is_active ? " active" : "");
    let d = {};
    try { d = JSON.parse(p.data); } catch {}
    const summary = [
      d.temperature !== undefined ? `temp ${d.temperature}` : null,
      d.max_tokens !== undefined ? `${d.max_tokens} out` : null,
      d.top_p !== undefined ? `top-p ${d.top_p}` : null,
      Array.isArray(d.blocks) && d.blocks.length
        ? `${d.blocks.length} block${d.blocks.length > 1 ? "s" : ""}` : null,
    ].filter(Boolean).join(" · ");
    b.innerHTML =
      `<span class="meta"><span class="t">${esc(p.name)}</span>` +
      `<span class="s">${p.is_active ? "Active · " : ""}${esc(summary || "no values")}</span></span>` +
      `<span class="rowtools">` +
      `<button data-blocks-p title="Prompt blocks" aria-label="Edit prompt blocks">${ICON.edit}</button>` +
      `<button data-load-p title="Load into the fields" aria-label="Load">${ICON.copy}</button>` +
      `<button data-export-preset title="Export" aria-label="Export">${ICON.down}</button>` +
      `<button data-del-preset title="Delete" aria-label="Delete">${ICON.del}</button></span>`;
    b.onclick = async (e) => {
      if (e.target.closest("[data-del-preset]")) {
        if (!(await ask(`Delete the preset "${p.name}"?`))) return;
        const r = await api("/presets/" + p.id, { method: "DELETE" });
        await refreshPresets();
        return offerUndo(r, "preset");
      }
      if (e.target.closest("[data-export-preset]")) {
        window.location.href = `/api/presets/${p.id}/export`;
        return;
      }
      if (e.target.closest("[data-blocks-p]")) {
        openBlocks(p, d);
        return;
      }
      if (e.target.closest("[data-load-p]")) {
        PRESET_FIELDS.forEach((f) => { if (d[f] !== undefined) setField(f, d[f]); });
        paintSampling();
        $("#presetHint").textContent = `Loaded "${p.name}" into the fields below.`;
        return;
      }
      await api(`/presets/${p.id}/activate`, { method: "POST" });
      await refreshPresets();
      // Which preset is active decides what the Sampling panel shows and saves
      // to, so it has to be told when that changes.
      await loadSettings();
    };
    el.appendChild(rowShell(p.id, b));
  });
  renderPresetPick();
}

$("#savePresetBtn").onclick = async () => {
  const name = await askFor("Name this preset");
  if (!name?.trim()) return;
  const data = {};
  PRESET_FIELDS.forEach((f) => { const v = fieldValue(f); if (v !== undefined) data[f] = v; });
  await api("/presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: name.trim(), data }),
  });
  refreshPresets();
  refreshLore();
};

// ---- prompt blocks -------------------------------------------------------
// An ordered list of named pieces the active preset contributes to every
// prompt. Rows are plain divs: the controls are siblings of each other, never
// children of a clickable row, so nothing clickable ends up inside anything
// else clickable.

let editing = null;   // { id, name, data } of the preset being edited
let blocks = [];

const ROLES = [["system", "system"], ["user", "user"], ["assistant", "assistant"]];

const ROLE_DOT = { system: "sys", user: "usr", assistant: "asst" };

/**
 * Markers stand in for pieces Hearth assembles rather than text you typed, so
 * a preset is an ordering of the whole prompt. They have nothing to edit — only
 * a place in the list and a switch.
 */
const MARKER_LABEL = {
  main: "Framing",
  worldInfoBefore: "Lore · before",
  charDescription: "Character",
  charPersonality: "Personality",
  scenario: "Scene",
  personaDescription: "Your persona",
  dialogueExamples: "Example dialogue",
  worldInfoAfter: "Lore · after",
  authorsNote: "Author's note",
  chatHistory: "The conversation",
  jailbreak: "Card instructions",
};
const DEFAULT_ORDER = Object.keys(MARKER_LABEL);
const defaultBlocks = () =>
  DEFAULT_ORDER.map((marker) => ({ id: marker, name: marker, role: "system", content: "", enabled: true, marker }));

function renderBlocks() {
  const el = $("#blockList");
  el.innerHTML = "";
  if (!blocks.length) {
    el.innerHTML = `<p class="hint">No blocks yet. Add one to extend every prompt this preset is active for.</p>`;
    return;
  }
  blocks.forEach((b, i) => {
    const row = document.createElement("div");
    row.className = "blockrow" + (b.enabled ? "" : " off") + (b.open ? " open" : "");
    const fixed = !!b.marker;
    row.classList.toggle("marker", fixed);
    row.innerHTML =
      `<div class="brow">` +
      `<span class="bmark" aria-hidden="true">${fixed ? "&#9670;" : "&#10033;"}</span>` +
      `<span class="bdot ${fixed ? "mark" : ROLE_DOT[b.role] || "sys"}" aria-hidden="true"></span>` +
      (fixed
        ? `<span class="b-fixed">${esc(MARKER_LABEL[b.marker] || b.marker)}</span>`
        : `<input class="b-name" aria-label="Block name">`) +
      `<span class="bchars"></span>` +
      `<span class="btools">` +
        `<button type="button" class="bico" data-up title="Move up" aria-label="Move up">${ICON.up}</button>` +
        `<button type="button" class="bico" data-down title="Move down" aria-label="Move down">${ICON.downArrow}</button>` +
        (fixed ? "" :
          `<button type="button" class="bico" data-edit title="Edit text" aria-label="Edit text">${ICON.edit}</button>` +
          `<button type="button" class="bico" data-role title="Change role" aria-label="Change role">${ICON.role}</button>`) +
        `<label class="switch" title="On or off"><input type="checkbox" class="b-on" aria-label="Enabled"><span></span></label>` +
        (fixed ? "" :
          `<button type="button" class="bico danger" data-del title="Remove" aria-label="Remove">&minus;</button>`) +
      `</span></div>` +
      (fixed ? "" :
        `<div class="bbody"><textarea class="b-content" rows="6" placeholder="What this block says. {{char}} and {{user}} work."></textarea></div>`);

    // Values are assigned, never interpolated — a quote in a name would
    // otherwise break straight out of the attribute.
    const name = row.querySelector(".b-name");
    const on = row.querySelector(".b-on");
    const content = row.querySelector(".b-content");
    const chars = row.querySelector(".bchars");
    if (name) name.value = b.name;
    on.checked = b.enabled;
    if (content) content.value = b.content;

    const stamp = () => {
      chars.textContent = fixed ? "built in" : `${b.role} · ${b.content.length.toLocaleString()}`;
      row.classList.toggle("off", !b.enabled);
      row.querySelector(".bdot").className = `bdot ${fixed ? "mark" : ROLE_DOT[b.role] || "sys"}`;
    };
    const pull = () => {
      if (name) b.name = name.value;
      b.enabled = on.checked;
      if (content) b.content = content.value;
      stamp();
    };
    row.addEventListener("input", pull);
    row.addEventListener("change", pull);
    stamp();

    const move = (to) => { pull(); blocks.splice(to, 0, blocks.splice(i, 1)[0]); renderBlocks(); };
    const up = row.querySelector("[data-up]");
    const down = row.querySelector("[data-down]");
    up.disabled = i === 0;
    down.disabled = i === blocks.length - 1;
    up.onclick = () => move(i - 1);
    down.onclick = () => move(i + 1);

    // The text is folded away by default. A preset with twenty blocks is a list
    // you scan, not twenty textareas you scroll past.
    const edit = row.querySelector("[data-edit]");
    if (edit) edit.onclick = () => {
      b.open = !b.open;
      row.classList.toggle("open", b.open);
      if (b.open) content.focus();
    };
    // Three roles, so a button that cycles beats a select that needs two taps.
    const role = row.querySelector("[data-role]");
    if (role) role.onclick = () => {
      const order = ["system", "user", "assistant"];
      b.role = order[(order.indexOf(b.role) + 1) % order.length];
      stamp();
    };
    const del = row.querySelector("[data-del]");
    if (del) del.onclick = () => { blocks.splice(i, 1); renderBlocks(); };

    el.appendChild(row);
  });
}

function openBlocks(p, data) {
  editing = { id: p.id, name: p.name, data };
  // A preset with no list of its own is shown the default pipeline, so the
  // first thing you see is what it is actually sending rather than a blank.
  blocks = Array.isArray(data.blocks) && data.blocks.length
    ? data.blocks.map((b) => ({ ...b }))
    : defaultBlocks();
  $("#blocksTitle").textContent = `Prompt blocks — ${p.name}`;
  renderBlocks();
  $("#blocksDialog").showModal();
}

$("#addBlockBtn").onclick = () => {
  blocks.push({
    id: crypto.randomUUID(),
    name: `Block ${blocks.length + 1}`,
    role: "system",
    content: "",
    enabled: true,
  });
  renderBlocks();
};

$("#blocksForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "save" || !editing) return;
  // An empty block would be dropped on the way in anyway; drop it here so what
  // you see saved is what the server kept.
  const keep = blocks.filter((b) => b.marker || b.content.trim());
  const r = await api("/presets/" + editing.id, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: editing.name, data: { ...editing.data, blocks: keep } }),
  });
  editing = null;
  if (r?.error) return void ($("#presetHint").textContent = r.error);
  await refreshPresets();
  toast(keep.length ? `Saved ${keep.length} block${keep.length > 1 ? "s" : ""}.` : "Blocks cleared.");
});

$("#presetImport").onchange = async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const r = await uploadResult(await fetch("/api/import/presets", { method: "POST", body: fd }));
  $("#presetHint").textContent = r.imported
    ? `Brought in ${r.imported.length}: ${r.imported.join(", ")}.` : r.error;
  e.target.value = "";
  refreshPresets();
  refreshLore();
};

// ---- SillyTavern backup -------------------------------------------------

/** Shared by the You tab and the Import section. */
async function importSettingsFile(input, hintId) {
  const file = input.files[0];
  if (!file) return;
  const hint = $("#" + hintId);
  hint.textContent = "Reading…";
  input.value = "";

  let r;
  try {
    const res = await fetch("/api/import/settings", {
      method: "POST",
      body: (() => { const fd = new FormData(); fd.append("file", file); return fd; })(),
    });
    // A non-JSON body means the route is missing or the server fell over.
    const raw = await res.text();
    try { r = JSON.parse(raw); }
    catch { throw new Error(`Server replied ${res.status}: ${raw.slice(0, 120)}`); }
  } catch (err) {
    hint.textContent = `Import failed. ${err.message ?? err}`;
    return;
  }

  if (r.error) { hint.textContent = r.error; return; }

  const bits = [];
  if (r.personas?.length) bits.push(`Brought in ${r.personas.length} personas.`);
  if (r.skipped?.length) bits.push(`${r.skipped.length} already existed.`);
  if (r.active) bits.push(`Active persona set to ${r.active}.`);
  if (r.preset) bits.push(`Saved your sampler as the preset "${r.preset}".`);
  if (r.note) bits.push(r.note);
  hint.textContent = bits.join(" ") || "Nothing was found in that file.";
  refreshPersonas();
  refreshPresets();
}


/** Only the parts of a SillyTavern folder we can actually use. */
const WANTED = [
  /(^|\/)settings\.json$/i,
  /\/characters\/[^/]+\.(png|json)$/i,
  /\/user avatars\/[^/]+\.(png|jpe?g|webp)$/i,
  /\/worlds\/[^/]+\.json$/i,
  /\/(openai settings|textgen settings|presets)\/[^/]+\.json$/i,
  /\/backgrounds\/[^/]+\.(png|jpe?g|webp)$/i,
  /\/chats\/.+\.jsonl$/i,
  /\.zip$/i,
];
const SKIP = /(^|\/)(thumbnails|_?uploads|backups|node_modules)\//i;

const relPath = (f) => f.webkitRelativePath || f.name;
const bytes = (n) =>
  n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.round(n / 1e3)} kB`;

async function runImport(files, prepared, label) {
  const bar = $("#backupProgress");
  const fill = $("#backupFill");
  const setBar = (pct, stage) => {
    fill.style.width = `${pct}%`;
    $("#backupPct").textContent = `${Math.round(pct)}%`;
    if (stage) $("#backupStage").textContent = stage;
  };

  if (!prepared && !files?.length) {
    $("#backupHint").textContent = "Nothing usable in that selection.";
    return;
  }

  bar.hidden = false;
  bar.classList.remove("failed");
  setBar(0, label ?? `Sending ${files.length} files (${bytes(files.reduce((n, f) => n + f.size, 0))})…`);
  $("#backupHint").textContent = "";

  try {
    const fd = prepared ?? new FormData();
    if (!prepared) {
      for (const f of files) {
        fd.append("files", f);
        fd.append("paths", relPath(f));
      }
    }
    const res = await fetch("/api/import/backup", { method: "POST", body: fd });
    if (!res.body) throw new Error(`Server replied ${res.status}.`);

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!line.startsWith("data:")) continue;
        const evt = JSON.parse(line.slice(5));
        if (evt.error) throw new Error(evt.error);
        if (evt.finished) { result = evt; setBar(100, "Finished"); continue; }
        if (evt.total) setBar((evt.done / evt.total) * 100, evt.stage);
      }
    }

    if (!result) throw new Error("The import stopped early.");
    const parts = Object.entries(result.count).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
    $("#backupHint").textContent = parts.length
      ? `Brought in ${parts.join(", ")}.` +
        (result.notes?.length ? ` Skipped ${result.notes.length} unreadable files.` : "")
      : "Nothing recognisable was found.";

    await Promise.all([refreshCast(), refreshPersonas(), refreshPresets(), refreshChats(), refreshWallpapers()]);
    await showSplash();
    setTimeout(() => (bar.hidden = true), 1800);
  } catch (err) {
    bar.classList.add("failed");
    $("#backupStage").textContent = "Import failed";
    $("#backupHint").textContent = err.message ?? String(err);
  }
}

// ---- folder browser -----------------------------------------------------

let fsTarget = null;

/** A backup the user has picked in the browser, rather than a folder. */
let fsZip = null;

async function fsGo(path) {
  const r = await api("/fs/list" + (path ? "?path=" + encodeURIComponent(path) : ""));
  if (r.error && !r.dirs) { $("#fsHint").textContent = r.error; return; }

  $("#fsPath").value = r.path;
  fsTarget = r.target;

  $("#fsCrumbs").innerHTML =
    `<button data-path="" class="crumb">home</button>` +
    r.crumbs.map((c) => `<button data-path="${esc(c.path)}" class="crumb">${esc(c.name)}</button>`).join("");

  const rows = [];
  if (r.parent) rows.push(`<button class="fsrow up" data-path="${esc(r.parent)}">${ICON.up} <span>..</span></button>`);
  rows.push(...r.dirs.map((d) =>
    `<button class="fsrow" data-path="${esc(d.path)}">${ICON.folder} <span>${esc(d.name)}</span></button>`));
  /**
   * Archives are offered alongside folders. On a phone you cannot browse into
   * SillyTavern's own storage, but its backup lands in Downloads like any
   * other file — so picking the zip has to be as ordinary as picking a folder.
   * It is read straight out of the archive; nothing is unpacked by hand first.
   */
  const mb = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.round(n / 1048576)} MB`);
  rows.push(...(r.zips ?? []).map((z) =>
    `<button class="fsrow zip${z.path === fsZip ? " on" : ""}" data-zip="${esc(z.path)}">${ICON.down} ` +
    `<span>${esc(z.name)}</span><em>${mb(z.size)}</em></button>`));
  $("#fsList").innerHTML = rows.join("") || `<p class="hint">${esc(r.error ?? "Nothing in here.")}</p>`;

  const zipName = fsZip ? fsZip.split("/").pop() : null;
  $("#fsHint").textContent = zipName
    ? `Ready to import ${zipName}.`
    : r.hint || "Keep going until this says it has found a SillyTavern folder, or pick a backup.";
  $("#fsHint").style.color = (r.target || fsZip) ? "var(--lumiverse-primary)" : "";
  $("#fsUse").disabled = !r.target && !fsZip;
  $("#fsUse").textContent = zipName ? "Import this backup"
    : r.kind === "root" && r.users?.length > 1 ? `Import ${r.users[0]}` : "Import from here";
}

$("#fsCrumbs").onclick = (e) => {
  const b = e.target.closest("[data-path]");
  if (b) fsGo(b.dataset.path);
};
$("#fsList").onclick = (e) => {
  const z = e.target.closest("[data-zip]");
  if (z) {
    // Tap once to choose the archive, again to change your mind.
    fsZip = fsZip === z.dataset.zip ? null : z.dataset.zip;
    return fsGo($("#fsPath").value);
  }
  const b = e.target.closest("[data-path]");
  // Walking into a folder is choosing a folder, so forget any archive.
  if (b) { fsZip = null; fsGo(b.dataset.path); }
};
$("#fsPath").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); fsGo($("#fsPath").value); }
});

async function fsPlaces() {
  const r = await api("/fs/places");
  if (!r.places) return;
  const chip = (p, strong) =>
    `<button class="place${strong ? " strong" : ""}" data-path="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</button>`;
  $("#fsPlaces").innerHTML =
    r.found.map((p) => chip(p, true)).join("") + r.places.map((p) => chip(p, false)).join("");
}

$("#fsPlaces").onclick = (e) => {
  const b = e.target.closest("[data-path]");
  if (b) fsGo(b.dataset.path);
};

/**
 * Android hands an app its own sandbox and the media collections, and a
 * SillyTavern install is in neither — so browsing to one needs all-files
 * access, which is granted on a Settings screen rather than by a prompt. The
 * host exposes exactly two methods for this; on the desktop there is no host
 * and nothing to ask for. See MainActivity's HearthHost.
 */
const storageHost = () => (typeof HearthHost === "undefined" ? null : HearthHost);

function canReadFiles() {
  const host = storageHost();
  if (!host) return true;
  try { return host.hasAllFiles(); } catch { return true; }
}

$("#browseBtn").onclick = async () => {
  if (!canReadFiles()) {
    const go = await askDialog({
      title: "Hearth needs permission to read your files",
      text: "Android keeps apps out of each other's folders, so Hearth cannot see a " +
            "SillyTavern install until you allow it. This opens the settings screen; " +
            "turn on “Allow access to manage all files”, then come back.",
      confirmLabel: "Open settings",
    });
    if (go) { try { storageHost().requestAllFiles(); } catch {} }
    return;
  }
  $("#fsDialog").showModal();
  await fsPlaces();
  fsGo("");
};
$("#fsCancel").onclick = () => $("#fsDialog").close();

/**
 * Unpacks a backup with the host's own zip reader, then imports the folder.
 *
 * The server can stream an archive itself, and does on the desktop. On a phone
 * it cannot: a real SillyTavern backup is four gigabytes and ZIP64, and the
 * JavaScript reader ran the runtime out of heap about fifty files in. Android
 * has java.util.zip, which streams, understands ZIP64, and does none of it on
 * the JavaScript heap — so when there is a host, it does the unpacking and
 * hands back a folder the ordinary folder import already understands.
 */
async function importArchiveViaHost(host, path, name) {
  const stage = host.unpackZip(path);
  const bar = $("#backupProgress");
  bar.hidden = false;
  bar.classList.remove("failed");
  $("#backupFill").style.width = "0%";
  $("#backupPct").textContent = "";
  $("#backupStage").textContent = `Opening ${name}`;
  $("#backupHint").textContent = "";

  for (;;) {
    await new Promise((r) => setTimeout(r, 400));
    const state = String(host.unpackState() || "");
    if (state.startsWith("error")) {
      bar.classList.add("failed");
      $("#backupStage").textContent = `Could not open ${name}`;
      $("#backupHint").textContent = state.slice(6);
      return;
    }
    const m = state.match(/^\w+ (\d+)\/(\d+)$/);
    if (m) $("#backupStage").textContent =
      `Unpacking ${name} — ${Number(m[1]).toLocaleString()} of ${Number(m[2]).toLocaleString()} files read`;
    if (state.startsWith("done")) break;
  }

  const fd = new FormData();
  fd.append("localPath", stage);
  await runImport(null, fd, `Importing ${name}`);
  try { host.clearUnpacked(); } catch {}
}

$("#fsUse").onclick = () => {
  // An archive wins over the folder it is sitting in — you cannot have picked
  // it by accident, and the folder around it is usually just Downloads.
  const path = fsZip || fsTarget;
  const name = path.split("/").pop();
  const host = storageHost();
  $("#fsDialog").close();
  fsZip = null;

  if (/\.zip$/i.test(path) && host?.unpackZip) return importArchiveViaHost(host, path, name);

  const fd = new FormData();
  fd.append("localPath", path);
  runImport(null, fd, /\.zip$/i.test(path) ? `Opening ${name}` : `Reading ${path}`);
};

$("#looseImport").onchange = (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  runImport(files);
};

// ---- the bin ------------------------------------------------------------

const BIN_NOUN = { characters: "Character", chats: "Chat", personas: "Persona", presets: "Preset" };

async function refreshBin() {
  const rows = await api("/bin").catch(() => []);
  const el = $("#binList");
  $("#binPurge").hidden = !rows.length;
  el.innerHTML = rows.length ? "" : `<p class="hint">Nothing deleted recently.</p>`;
  rows.slice(0, 60).forEach((r) => {
    const b = document.createElement("button");
    b.className = "item";
    b.innerHTML =
      `<span class="meta"><span class="t">${esc(r.label || "Untitled")}</span>` +
      `<span class="s">${BIN_NOUN[r.table]} &middot; ${ago(r.deleted_at)}</span></span>` +
      `<span class="rowtools"><span class="linkish">Restore</span></span>`;
    b.onclick = async () => {
      await api("/undo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table: r.table, ids: [r.id] }),
      });
      await Promise.all([refreshCast(), refreshPersonas(), refreshPresets(), refreshChats()]);
      await showSplash();
      refreshBin();
      toast("Put back.");
    };
    el.appendChild(b);
  });
}

/**
 * Two prompts on purpose. This is the only button in Hearth with no undo, and
 * the bin is emptied too, so a mis-click has nowhere to recover from.
 */
$("#wipeBtn").onclick = async () => {
  if (!(await askDialog({
    title: "Delete every character, chat, persona, preset, lorebook and picture?",
    text: "This cannot be undone. Your API keys and appearance settings are kept.",
    confirmLabel: "Delete everything",
  }))) return;
  if (prompt('Last check. Type "delete" to wipe everything.')?.trim().toLowerCase() !== "delete") {
    $("#wipeHint").textContent = "Nothing was deleted.";
    return;
  }
  $("#wipeBtn").disabled = true;
  $("#wipeHint").textContent = "Deleting…";
  const r = await api("/wipe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: "delete" }),
  });
  $("#wipeBtn").disabled = false;
  if (r?.error) { $("#wipeHint").textContent = r.error; return; }
  $("#wipeHint").textContent = "Everything is gone. Hearth is empty.";
  // Reload rather than refresh each panel: the open chat, the wallpaper and
  // every cached list are all pointing at rows that no longer exist.
  setTimeout(() => location.reload(), 700);
};

$("#binPurge").onclick = async () => {
  if (!(await askDialog({
    title: "Permanently destroy everything in the bin?",
    text: "This really cannot be undone.",
    confirmLabel: "Destroy",
  }))) return;
  const r = await api("/bin/purge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ all: true }),
  });
  refreshBin();
  toast(`${r.purged} item${r.purged === 1 ? "" : "s"} destroyed.`);
};

$("#exportBtn").onclick = () => {
  toast("Building your backup…");
  window.location.href = "/api/backup/export";
};

// ---- model picker -------------------------------------------------------

let allModels = [];
let currentModel = "";

const money = (n) =>
  n === null ? "—" : n === 0 ? "free" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;

function setModel(id, info) {
  currentModel = id;
  $("#modelLabel").textContent = id || "Choose a model";
  const m = info ?? allModels.find((x) => x.id === id);
  $("#modelPrice").textContent =
    m && (m.in !== null || m.out !== null) ? `${money(m.in)} / ${money(m.out)}` : "";
  saveSettings();
}

/** Cost to fill this model's whole context window once, at prompt rates. */
function fillCost(m) {
  if (!m.context || m.in === null) return "";
  const c = (m.context / 1e6) * m.in;
  return `${(m.context / 1000).toFixed(0)}k ctx &middot; ${c < 0.01 ? "<$0.01" : "$" + c.toFixed(2)} to fill`;
}

function renderModels(filter = "") {
  const q = filter.trim().toLowerCase();
  const rows = allModels.filter((m) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  const list = $("#modelList");
  list.innerHTML = rows.length ? "" : `<p class="hint">Nothing matches that.</p>`;
  rows.slice(0, 400).forEach((m) => {
    const b = document.createElement("button");
    b.className = "modelrow" + (m.id === currentModel ? " on" : "");
    const free = m.in === 0 && m.out === 0;
    b.innerHTML =
      `<span class="mid"><span class="mname">${esc(m.name)}</span>` +
      `<span class="msub">${esc(m.id)}</span></span>` +
      `<span class="mprice${free ? " free" : ""}${m.approx ? " approx" : ""}">` +
      `${money(m.in)} in &middot; ${money(m.out)} out` +
      `<span class="fill">${fillCost(m)}</span></span>`;
    b.onclick = () => { setModel(m.id, m); $("#modelDialog").close(); renderModels(q); };
    list.appendChild(b);
  });
}

async function loadModels() {
  $("#modelHint").textContent = "Fetching the model list…";
  const r = await api("/models?provider=" + encodeURIComponent($("#provider").value));
  if (r.error) {
    allModels = [];
    $("#modelHint").textContent = r.error;
    $("#modelList").innerHTML = "";
    return;
  }
  allModels = r.models;
  const priced = allModels.filter((m) => m.in !== null).length;
  $("#modelHint").innerHTML =
    `${allModels.length} models, cheapest first. Prices are US dollars per million tokens` +
    (priced < allModels.length ? `; ${allModels.length - priced} have no published price.` : ".") +
    ` <span class="approx">Italic prices are local estimates, not quotes.</span>`;
  renderModels($("#modelSearch").value);
}

$("#modelBtn").onclick = async () => {
  $("#modelDialog").showModal();
  if (!allModels.length) await loadModels();
  else renderModels($("#modelSearch").value);
};
$("#modelSearch").oninput = () => renderModels($("#modelSearch").value);
$("#modelClose").onclick = () => $("#modelDialog").close();
$("#modelCustom").onclick = async () => {
  const id = await askFor("Model name", currentModel);
  if (id && id.trim()) { setModel(id.trim()); $("#modelDialog").close(); }
};

// ---- personas -----------------------------------------------------------

let editingPersona = null;

async function refreshPersonas() {
  const list = await api("/personas");
  if (!Array.isArray(list)) return;
  activePersonaId = null;
  const el = $("#personaList");
  el.innerHTML = list.length ? "" : `<p class="hint">No personas yet. Make one so characters know who you are.</p>`;
  list.forEach((p) => {
    if (p.is_active) {
      S.personaName = p.name;
      S.personaAvatar = p.avatar || "";
      activePersonaId = p.id;
    }
    const b = document.createElement("button");
    b.className = "item withface" + (p.is_active ? " active" : "");
    b.innerHTML =
      medallion(p.avatar, p.name) +
      `<span class="meta"><span class="t">${esc(p.name)}</span>` +
      `<span class="s">${p.is_active ? "Active" : esc((p.description || "Tap to use").slice(0, 46))}</span></span>` +
      `<span class="rowtools">` +
      `<button data-edit-p title="Edit" aria-label="Edit ${esc(p.name)}">${ICON.edit}</button>` +
      `<button data-export-p title="Export" aria-label="Export ${esc(p.name)}">${ICON.down}</button>` +
      (document.body.dataset.mode === "tabletop"
        ? `<button data-untable-p title="Send back to your library"` +
          ` aria-label="Send ${esc(p.name)} back to your library">${ICON.up}</button>`
        : "") +
      `<button data-del-p title="Delete" aria-label="Delete ${esc(p.name)}">${ICON.del}</button></span>`;
    b.onclick = async (e) => {
      if (e.target.closest("[data-edit-p]")) return editPersona(p);
      if (e.target.closest("[data-untable-p]")) {
        await api(`/personas/${p.id}/world`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ at: false }),
        });
        await refreshPersonas();
        toast(`${p.name} has left the table.`);
        return;
      }
      if (e.target.closest("[data-export-p]")) {
        window.location.href = `/api/personas/${p.id}/export`;
        return;
      }
      if (e.target.closest("[data-del-p]")) {
        if (!(await ask(`Delete the persona "${p.name}"?`))) return;
        const r = await api("/personas/" + p.id, { method: "DELETE" });
        await refreshPersonas();
        return offerUndo(r, "persona");
      }
      await api(`/personas/${p.id}/activate`, { method: "POST" });
      refreshPersonas();
    };
    el.appendChild(rowShell(p.id, b));
  });
  // The sheet belongs to whoever is active, so it is repainted with them.
  await refreshSheet();
}

/**
 * Wires a dialog's picture well. A new record has no id yet, so the chosen file
 * is held and uploaded once the record exists.
 */
function faceWell(prefix, endpointFor) {
  const state = { file: null, url: "", cleared: false };

  const paint = () => {
    const el = $(`#${prefix}_facepreview`);
    const src = state.file ? URL.createObjectURL(state.file) : state.cleared ? "" : state.url;
    el.style.backgroundImage = src ? `url("${src}")` : "";
    el.classList.toggle("empty", !src);
    $(`#${prefix}_faceclear`).hidden = !src;
  };

  $(`#${prefix}_facebtn`).onclick = () => $(`#${prefix}_facefile`).click();
  $(`#${prefix}_facefile`).onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    state.file = f;
    state.cleared = false;
    paint();
    e.target.value = "";
  };
  $(`#${prefix}_faceclear`).onclick = () => {
    state.file = null;
    state.cleared = true;
    paint();
  };

  return {
    reset(url) { state.file = null; state.url = url ?? ""; state.cleared = false; paint(); },
    /** Called after the record is saved, when an id is known. */
    async commit(id) {
      if (!state.file) return;
      const fd = new FormData();
      fd.append("file", state.file);
      await fetch(endpointFor(id), { method: "POST", body: fd });
      state.file = null;
    },
    get cleared() { return state.cleared && !state.file; },
  };
}

const personaFace = faceWell("p", (id) => `/api/personas/${id}/avatar`);
const charFace = faceWell("c", (id) => `/api/characters/${id}/avatar`);

function editPersona(p) {
  editingPersona = p?.id ?? null;
  $("#personaDialogTitle").textContent = p ? "Edit persona" : "New persona";
  $("#p_name").value = p?.name ?? "";
  $("#p_description").value = p?.description ?? "";
  personaFace.reset(p?.avatar ?? "");
  $("#personaDialog").showModal();
}

$("#newPersonaBtn").onclick = () => editPersona(null);

$("#personaForm").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "save") return;
  const body = { name: $("#p_name").value, description: $("#p_description").value };
  if (!body.name.trim()) return;
  const r = await api(editingPersona ? "/personas/" + editingPersona : "/personas", {
    method: editingPersona ? "PUT" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await personaFace.commit(editingPersona ?? r.id);
  refreshPersonas();
});

$("#personaImport").onchange = (e) => importSettingsFile(e.target, "personaImportHint");

$("#personaFiles").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  const r = await fetch("/api/import/persona-files", { method: "POST", body: fd })
    .then((x) => x.json()).catch(() => ({ error: "Import failed." }));
  $("#personaFilesHint").textContent = r.imported
    ? `Brought in ${r.imported.length}: ${r.imported.join(", ")}.` : r.error;
  refreshPersonas();
};

// ---- appearance ---------------------------------------------------------

const THEME_TOKENS = [
  ["--lumiverse-primary",        "Accent"],
  ["--lumiverse-bg",             "Background"],
  ["--lumiverse-bg-elevated",    "Panels"],
  ["--lumiverse-text",           "Text"],
  ["--lumiverse-text-muted",     "Muted text"],
  ["--lumiverse-text-dim",       "Dim text"],
  ["--lumiverse-prose-dialogue", "Dialogue"],
  ["--lumiverse-prose-italic",   "Narration"],
  ["--lumiverse-danger",         "Warnings"],
];

let themeVars = {};

function applyTheme() {
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(themeVars)) if (v) r.setProperty(k, v);
  // Borders follow the accent so it never looks half-changed.
  const a = themeVars["--lumiverse-primary"];
  if (a) {
    const { r: R, g: G, b: B } = hexRgb(a);
    r.setProperty("--lumiverse-border", `rgba(${R},${G},${B},0.16)`);
    r.setProperty("--lumiverse-border-hover", `rgba(${R},${G},${B},0.34)`);
    r.setProperty("--lumiverse-primary-muted", `rgba(${R},${G},${B},0.55)`);
  }
}

const hexRgb = (h) => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

const readVar = (k) =>
  themeVars[k] || getComputedStyle(document.documentElement).getPropertyValue(k).trim() || "#000000";

function buildSwatches() {
  const wrap = $("#swatches");
  wrap.innerHTML = "";
  for (const [token, label] of THEME_TOKENS) {
    const row = document.createElement("div");
    row.className = "swatch";
    row.innerHTML = `<span>${label}</span>`;
    const inp = document.createElement("input");
    inp.type = "color";
    inp.value = readVar(token);
    inp.oninput = () => {
      themeVars[token] = inp.value;
      applyTheme();
      saveLook();
    };
    row.appendChild(inp);
    wrap.appendChild(row);
  }
}

const LORE_SETTINGS = ["lore_scan_depth", "lore_budget", "auto_lore_every", "auto_lore_scope"];
const LOOK = ["overlay_opacity", "glow_opacity", "font_scale", "avatar_size", "radius", "banner_width", "measure", "fade_start", "plate_blur", "plate_opacity", "tuck"];
const TOGGLES = ["bleed", "show_stats", "show_cutoff", "sound"];
const PREFS = ["confirm_deletes", "dice_enabled"];

function applyLook() {
  const r = document.documentElement.style;
  r.setProperty("--overlay-opacity", $("#overlay_opacity").value);
  r.setProperty("--glow-opacity", $("#glow_opacity").value);
  r.setProperty("--lumiverse-font-scale", $("#font_scale").value);
  r.setProperty("--avatar-size", $("#avatar_size").value + "px");
  // --banner-w-user, not --banner-w: a phone bounds the width without throwing
  // the setting away. See :root and the narrow-screen rule in style.css.
  r.setProperty("--banner-w-user", $("#banner_width").value + "px");
  r.setProperty("--measure", $("#measure").value + "rem");
  r.setProperty("--fade-start", $("#fade_start").value + "%");
  r.setProperty("--plate-blur", $("#plate_blur").value + "px");
  r.setProperty("--plate-opacity", $("#plate_opacity").value);
  r.setProperty("--tuck", $("#tuck").value);
  const rad = $("#radius").value;
  r.setProperty("--lumiverse-radius", rad + "px");
  r.setProperty("--lumiverse-radius-sm", Math.round(rad * 0.6) + "px");
  $("#v_overlay").textContent = Math.round($("#overlay_opacity").value * 100) + "%";
  $("#v_glow").textContent = Math.round($("#glow_opacity").value * 100) + "%";
  $("#v_font").textContent = Math.round($("#font_scale").value * 100) + "%";
  $("#v_avatar").textContent = $("#avatar_size").value + "px";
  $("#v_radius").textContent = $("#radius").value + "px";
  $("#v_banner").textContent = $("#banner_width").value + "px";
  $("#v_measure").textContent = $("#measure").value + "rem";
  $("#v_fade").textContent = $("#fade_start").value + "%";
  $("#v_blur").textContent = $("#plate_blur").value + "px";
  $("#v_solid").textContent = Math.round($("#plate_opacity").value * 100) + "%";
  $("#v_tuck").textContent = Math.round($("#tuck").value * 100) + "%";
}

let lookTimer;
function saveLook() {
  clearTimeout(lookTimer);
  lookTimer = setTimeout(() => {
    const patch = { theme_vars: JSON.stringify(themeVars) };
    LOOK.forEach((f) => (patch[f] = $("#" + f).value));
    patch.wallpaper = document.body.dataset.wallpaper ?? "";
    patch.message_style = document.body.dataset.msgstyle ?? "banner";
    TOGGLES.forEach((t) => (patch[t] = $("#" + t).checked ? "1" : "0"));
    patch.custom_css = $("#custom_css").value;
    PREFS.forEach((t) => (patch[t] = $("#" + t).checked ? "1" : "0"));
    api("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, 400);
}

LOOK.forEach((f) => ($("#" + f).oninput = () => { applyLook(); saveLook(); }));

function paintLoreSettings() {
  $("#v_scan").textContent = `${$("#lore_scan_depth").value} messages`;
  $("#v_budget").textContent = `${Math.round($("#lore_budget").value / 1000)}k characters`;
  // Zero is the off switch rather than a separate checkbox that could disagree
  // with it, so it needs to say so in words.
  const every = Number($("#auto_lore_every").value) || 0;
  $("#v_autolore").textContent = every ? `${every} messages` : "never";
  $("#autoLoreScopeRow").hidden = !every;
}
let loreTimer;
function saveLoreSettings() {
  clearTimeout(loreTimer);
  loreTimer = setTimeout(() => {
    const patch = {};
    LORE_SETTINGS.forEach((f) => (patch[f] = $("#" + f).value));
    api("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
  }, 400);
}

/**
 * The owner's own CSS, dropped into a style element that sits last in the
 * cascade.
 *
 * Written to a <style> rather than injected as a rule at a time: the browser's
 * own parser is better than anything worth writing here, a syntax error costs
 * only the rule it is in, and it cannot escape the stylesheet into the page.
 */
/**
 * Whether the past can be changed, on screen as well as on the server.
 *
 * The server refuses either way — see editsLocked() — but a button that
 * exists and then fails is worse than one that is not there: at the table the
 * point is not to catch you, it is to not put the pencil in front of you at
 * two in the morning after a wolf ate your rogue.
 */
function applyEditLock() {
  const locked = document.body.dataset.mode === "tabletop" && !$("#tabletop_edits")?.checked;
  document.body.classList.toggle("nopencil", locked);
  // Leaving select mode open would be a way straight round it.
  if (locked && msgSelecting) setMsgSelect(false);
}

function applyCustomCss() {
  $("#customCss").textContent = $("#custom_css").value ?? "";
}

$("#custom_css").oninput = () => { applyCustomCss(); saveLook(); };

function applyToggles() {
  document.body.classList.toggle("bleed", $("#bleed").checked);
  const page = document.body.dataset.msgstyle === "page";
  $("#fadeRow").hidden = page || !$("#bleed").checked;
  $("#tuckRow").hidden = page || !$("#bleed").checked || document.body.dataset.msgstyle !== "banner";
  document.body.classList.toggle("nostats", !$("#show_stats").checked);
  /*
   * In tabletop mode dice are always on, so a switch offering to turn them on
   * is a switch that does nothing — and one you would reasonably flick and
   * then wonder about. It is hidden there and says why.
   */
  const tabletop = document.body.dataset.mode === "tabletop";
  const diceRow = $("#dice_enabled")?.closest("label");
  if (diceRow) diceRow.hidden = tabletop;
  // And the reverse: a swipe allowance is meaningless in a story, where a
  // reply you did not like is a draft and there is no cost to another.
  if ($("#tableSwipeRow")) $("#tableSwipeRow").hidden = !tabletop;
  if ($("#tableSwipeHint")) $("#tableSwipeHint").hidden = !tabletop;
  if ($("#tableEditRow")) $("#tableEditRow").hidden = !tabletop;
  if ($("#tableEditHint")) $("#tableEditHint").hidden = !tabletop;
  if ($("#tablePresetRow")) $("#tablePresetRow").hidden = !tabletop;
  if ($("#tablePresetHint")) $("#tablePresetHint").hidden = !tabletop;
  // And the preset list says so, rather than letting somebody switch presets
  // in tabletop and wonder why nothing changed.
  if ($("#presetTableNote")) {
    $("#presetTableNote").hidden = !(tabletop && $("#tabletop_preset")?.checked);
  }
  applyEditLock();
  if ($("#diceHint")) {
    $("#diceHint").textContent = tabletop
      ? "Dice are always on at the table — this is a tabletop."
      : "Teaches them the [[2d6]] notation. Off by default: it is one sentence in every " +
        "prompt, and a character who has just learnt to roll will find reasons to.";
  }
  markCutoff();
}

/**
 * Draws the line where the conversation stops being sent.
 *
 * Everything above it is still here and still yours; it is simply older than
 * the model's window and is not in the prompt. Worth being able to see, and
 * worth being able to turn off — it is a fact about the request, not about
 * the story.
 *
 * The arithmetic is buildMessages' arithmetic in prompt.ts, deliberately: walk
 * backwards adding four tokens of role envelope to each message's estimate,
 * and stop when the budget is gone. Keeping the two in step matters more than
 * being clever here — if they drift, the line points at the wrong message,
 * which is worse than not drawing it.
 */
function markCutoff() {
  const thread = $("#thread");
  thread.querySelector(".cutline")?.remove();
  if (!$("#show_cutoff")?.checked) return;

  const budget = Number($("#context_tokens")?.value) || 8000;
  const msgs = [...thread.querySelectorAll(".msg")];
  let used = 0;
  let first = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const cost = Math.ceil((msgs[i].dataset.raw ?? "").length / 4) + 4;
    // Always keep one, or a single long turn would send nothing at all.
    if (used + cost > budget && first !== -1) break;
    used += cost;
    first = i;
  }
  // No line when the whole conversation fits: there is nothing being cut.
  if (first <= 0) return;

  const line = document.createElement("div");
  line.className = "cutline";
  line.innerHTML =
    `<svg viewBox="0 0 240 16" aria-hidden="true" focusable="false" preserveAspectRatio="none">` +
    `<use href="#cutline-rule"/></svg>` +
    `<span>everything above is out of context</span>` +
    `<svg viewBox="0 0 240 16" aria-hidden="true" focusable="false" preserveAspectRatio="none">` +
    `<use href="#cutline-rule"/></svg>`;
  msgs[first].before(line);
}

function setMsgStyle(style) {
  document.body.dataset.msgstyle = style;
  document.querySelectorAll("[data-style]").forEach((b) =>
    b.classList.toggle("on", b.dataset.style === style));
  $("#avatarRow").hidden = style !== "portrait";
  $("#bannerRow").hidden = style !== "banner";
  $("#fadeRow").hidden = style === "page" || !$("#bleed").checked;
  $("#bleed").closest("label").hidden = style === "page";
}

document.querySelectorAll("[data-style]").forEach((b) => {
  b.onclick = () => { setMsgStyle(b.dataset.style); saveLook(); };
});

/** A chat's own wallpaper wins while it is open; otherwise the global one. */
function applyChatWallpaper() {
  const url = chatMeta?.wallpaper || document.body.dataset.wallpaper || "";
  $("#wallpaper").style.backgroundImage = url ? `url("${encodeURI(url)}")` : "";
}

function setWallpaper(url) {
  document.body.dataset.wallpaper = url ?? "";
  applyChatWallpaper();
  document.querySelectorAll(".wallgrid button").forEach((b) =>
    b.classList.toggle("on", b.dataset.url === url));
  saveLook();
}

let wallpaperCache = [];

async function refreshWallpapers() {
  const urls = await api("/wallpapers");
  wallpaperCache = Array.isArray(urls) ? urls : [];
  $("#wallCount").textContent = wallpaperCache.length || "";
  renderWallpapers();
}

/**
 * Wallpapers picked for a bulk delete, and whether the grid is in that mode.
 *
 * The grid is tiles rather than rows, so it cannot use makeSelectable — but it
 * behaves the same way from the outside: a toggle turns the whole grid into a
 * picker, and while it is on a tile is chosen rather than applied.
 */
const wallPicked = new Set();
let wallSelecting = false;

function syncWallBar() {
  const n = wallPicked.size;
  const total = $("#wallGrid").querySelectorAll(".wallcell").length;
  $("#wallSelect").classList.toggle("on", wallSelecting);
  // Always offered, and it turns picking on by itself — see makeSelectable.
  $("#wallAll").hidden = false;
  $("#wallSelCount").hidden = !wallSelecting;
  $("#wallSelCount").textContent = n ? `${n} of ${total}` : "";
  $("#wallDelete").hidden = !wallSelecting || !n;
  $("#wallAll").classList.toggle("on", n > 0 && n === total);
}

function setWallSelecting(on) {
  wallSelecting = on;
  if (!on) wallPicked.clear();
  renderWallpapers();
}

$("#wallSelect").onclick = () => setWallSelecting(!wallSelecting);

$("#wallAll").onclick = () => {
  wallSelecting = true;
  const shown = [...$("#wallGrid").querySelectorAll(".wallcell")].map((c) => c.dataset.url);
  const every = shown.every((u) => wallPicked.has(u));
  shown.forEach((u) => (every ? wallPicked.delete(u) : wallPicked.add(u)));
  renderWallpapers();
};

$("#wallDelete").onclick = async () => {
  const urls = [...wallPicked];
  if (!urls.length) return;
  if (!(await ask(`Delete ${urls.length} wallpaper${urls.length === 1 ? "" : "s"}? This cannot be undone.`))) return;
  await api("/wallpapers/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (urls.includes(document.body.dataset.wallpaper)) setWallpaper("");
  wallPicked.clear();
  wallSelecting = false;
  await refreshWallpapers();
};

function renderWallpapers() {
  const q = ($("#wallSearch")?.value ?? "").trim().toLowerCase();
  const urls = wallpaperCache.filter((u) => !q || u.toLowerCase().includes(q));
  // A wallpaper deleted or filtered away cannot stay picked, or the delete
  // would take something the grid is no longer showing.
  for (const u of [...wallPicked]) if (!wallpaperCache.includes(u)) wallPicked.delete(u);
  const grid = $("#wallGrid");
  grid.innerHTML = urls.length
    ? ""
    : `<p class="hint">${wallpaperCache.length ? "Nothing matches that." : "No images uploaded yet."}</p>`;
  urls.forEach((u) => {
    const b = document.createElement("button");
    b.dataset.url = u;
    b.style.backgroundImage = `url("${u}")`;
    b.className = document.body.dataset.wallpaper === u ? "on" : "";
    b.onclick = () => {
      if (!wallSelecting) return setWallpaper(u);
      if (wallPicked.has(u)) wallPicked.delete(u); else wallPicked.add(u);
      renderWallpapers();
    };
    const x = document.createElement("button");
    x.className = "wallx";
    x.title = "Delete this wallpaper";
    x.setAttribute("aria-label", "Delete wallpaper");
    x.innerHTML = ICON.del;
    x.onclick = async (e) => {
      e.stopPropagation();
      if (!(await ask("Delete this wallpaper?"))) return;
      await api("/wallpaper", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      if (document.body.dataset.wallpaper === u) setWallpaper("");
      refreshWallpapers();
    };
    const cell = document.createElement("div");
    cell.className = "wallcell" + (wallPicked.has(u) ? " picked" : "");
    cell.dataset.url = u;
    // One delete button per tile is noise while picking several.
    cell.append(b, ...(wallSelecting ? [] : [x]));
    grid.appendChild(cell);
  });
  syncWallBar();
}

$("#wallFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  const r = await uploadResult(await fetch("/api/wallpaper", { method: "POST", body: fd }));
  if (r.url) {
    await refreshWallpapers();
    setWallpaper(r.url);
  }
  e.target.value = "";
};

$("#wallClear").onclick = () => setWallpaper("");
$("#wallSearch").oninput = () => renderWallpapers();

$("#themeReset").onclick = () => {
  themeVars = {};
  document.documentElement.removeAttribute("style");
  applyLook();
  buildSwatches();
  saveLook();
  $("#themeHint").textContent = "Back to the default theme.";
};

$("#themeCopy").onclick = async () => {
  const css =
    ":root {\n" +
    Object.entries(themeVars).map(([k, v]) => `  ${k}: ${v};`).join("\n") +
    `\n  --overlay-opacity: ${$("#overlay_opacity").value};` +
    `\n  --glow-opacity: ${$("#glow_opacity").value};\n}`;
  await navigator.clipboard.writeText(css).catch(() => {});
  $("#themeHint").textContent = "Theme copied to the clipboard.";
  setTimeout(() => ($("#themeHint").textContent = ""), 3000);
};

// ---- settings -----------------------------------------------------------

const FIELDS = [
  "provider",
  "temperature", "max_tokens", "context_tokens",
  "top_p", "min_p", "repetition_penalty", "frequency_penalty", "presence_penalty",
  "stream", "reasoning_effort",
];

let providerMeta = {};
let keys = {};

async function loadSettings() {
  const s = await api("/settings");
  providerMeta = s.providers;
  const sel = $("#provider");
  sel.innerHTML = "";
  for (const [id, meta] of Object.entries(providerMeta))
    sel.insertAdjacentHTML("beforeend", `<option value="${id}">${meta.label}</option>`);

  FIELDS.forEach((f) => setField(f, s[f]));
  // An active preset overrides the sampling fields, so show its values rather
  // than the stored ones the model is not using.
  samplingPreset = s.preset ?? null;
  if (samplingPreset) {
    PRESET_FIELDS.forEach((f) => {
      const v = samplingPreset.sampling[f];
      // "" on reasoning_effort is a real choice — let the model decide — so an
      // empty string is only skipped for the numeric fields.
      if (v !== undefined && (v !== "" || f === "reasoning_effort")) setField(f, v);
    });
  }
  showSamplingSource();
  paintSampling();
  for (const id of Object.keys(providerMeta)) keys[id] = s["key_" + id] ?? "";
  S.personaName = s.persona_name || "You";
  setModelLabel(s.model);

  applyMode(s.mode);
  paintModeCard();
  LOOK.forEach((f) => ($("#" + f).value = s[f]));
  LORE_SETTINGS.forEach((f) => {
    $("#" + f).value = s[f];
    $("#" + f).oninput = () => { paintLoreSettings(); saveLoreSettings(); };
  });
  paintLoreSettings();
  setMsgStyle(s.message_style || "banner");
  TOGGLES.forEach((t) => {
    $("#" + t).checked = s[t] === "1";
    $("#" + t).onchange = () => { applyToggles(); saveLook(); };
  });
  $("#custom_css").value = s.custom_css ?? "";
  applyCustomCss();
  applyToggles();
  $("#tabletop_preset").checked = s.tabletop_preset !== "0";
  $("#tabletop_preset").onchange = () => {
    api("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabletop_preset: $("#tabletop_preset").checked ? "1" : "0" }),
    });
    applyToggles();
  };
  $("#tabletop_edits").checked = s.tabletop_edits === "1";
  $("#tabletop_edits").onchange = () => {
    api("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabletop_edits: $("#tabletop_edits").checked ? "1" : "0" }),
    });
    applyEditLock();
  };
  // Again, now the boxes hold their stored answers: applyToggles ran before
  // this and read them unticked, which would have locked a table that had
  // asked to keep the pencil and hidden the note about the table's preset.
  applyToggles();
  tableSwipes = Math.max(0, Math.min(10, Number(s.tabletop_swipes ?? 3) || 0));
  $("#tabletop_swipes").value = String(tableSwipes);
  $("#tabletop_swipes").onchange = () => {
    tableSwipes = Number($("#tabletop_swipes").value) || 0;
    api("/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tabletop_swipes: String(tableSwipes) }),
    });
    // Every reply on screen is now allowed a different number of takes.
    for (const bar of document.querySelectorAll(".swipes")) capSwipes(bar);
  };
  $("#confirm_deletes").checked = s.confirm_deletes !== "0";
  askBeforeDelete = $("#confirm_deletes").checked;
  $("#confirm_deletes").onchange = () => {
    askBeforeDelete = $("#confirm_deletes").checked;
    saveLook();
  };
  try { themeVars = JSON.parse(s.theme_vars || "{}"); } catch { themeVars = {}; }
  applyLook();
  applyTheme();
  buildSwatches();
  setWallpaper(s.wallpaper || "");
  refreshWallpapers();
  showProvider();
}

function setModelLabel(id) {
  currentModel = id || "";
  $("#modelLabel").textContent = currentModel || "Choose a model";
  $("#modelPrice").textContent = "";
}

function showProvider() {
  const id = $("#provider").value;
  const meta = providerMeta[id];
  $("#api_key").value = keys[id] ?? "";
  $("#api_key").placeholder = `Your ${meta.label} key`;
  $("#keyHint").innerHTML =
    `Keys are stored separately per provider. Get one at ` +
    `<a href="${meta.keyUrl}" target="_blank" rel="noopener">${meta.keyUrl.replace(/^https:\/\//, "")}</a>`;
}
$("#provider").onchange = () => {
  showProvider();
  $("#testHint").textContent = "";
  allModels = [];              // each provider has its own catalogue
  $("#modelHint").textContent = "";
};
$("#api_key").oninput = () => { keys[$("#provider").value] = $("#api_key").value; };

/**
 * Reading and writing a settings field without caring what kind of control it
 * is. `stream` is a checkbox and everything else is a box or a select, and one
 * `.value` for all of them silently stored "on"/"" instead of "1"/"0".
 */
function fieldValue(f) {
  const el = $("#" + f);
  if (!el) return undefined;
  return el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value;
}

function setField(f, v) {
  const el = $("#" + f);
  if (!el) return;
  if (el.type === "checkbox") el.checked = v !== "0" && v !== "" && v !== undefined;
  else el.value = v ?? "";
}

function collect() {
  const patch = {};
  FIELDS.forEach((f) => { const v = fieldValue(f); if (v !== undefined) patch[f] = v; });
  for (const [id, v] of Object.entries(keys)) patch["key_" + id] = v;
  patch.model = currentModel;
  return patch;
}

async function saveSettings() {
  const patch = collect();
  await api("/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  S.personaName = patch.persona_name || "You";
}

$("#saveSettings").onclick = async () => {
  await saveSettings();
  $("#saveHint").textContent = "Settings saved.";
  setTimeout(() => ($("#saveHint").textContent = ""), 2500);
};

$("#testBtn").onclick = async () => {
  $("#testHint").textContent = "Testing…";
  await saveSettings();
  const r = await api("/test", { method: "POST" });
  $("#testHint").textContent = r.message;
  $("#testHint").style.color = r.ok ? "var(--lumiverse-primary)" : "var(--lumiverse-danger)";
};

// ---- composer -----------------------------------------------------------

const input = $("#input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 176) + "px";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && window.innerWidth >= 900) {
    e.preventDefault();
    send();
  }
});
$("#composer").addEventListener("submit", (e) => { e.preventDefault(); send(); });

/** Each step stands alone: one failing panel must not blank the others. */
async function boot() {
  const steps = [
    ["settings", loadSettings], ["presets", refreshPresets], ["personas", refreshPersonas],
    // Before the chats, so the first thread drawn already has its scripts.
    ["regex", refreshRegex], ["extensions", loadExtensions], ["extension list", refreshExtensions],
    ["chats", refreshChats], ["cast", refreshCast], ["splash", showSplash],
    ["bin", refreshBin], ["lore", refreshLore],
  ];
  for (const [label, fn] of steps) {
    try { await fn(); }
    catch (err) { console.error(`Hearth: ${label} failed to load`, err); }
  }
  openTheHearth();
}

/**
 * Draws back the loading screen.
 *
 * Held for as long as the fire needs to climb, so the app never appears
 * halfway through it being lit — but measured from when the page began, not
 * from when loading finished, so a slow start is covered by the wait rather
 * than added to it. On a phone, where the server has to wake up first, this is
 * usually already past by the time everything has loaded and the curtain goes
 * straight back.
 */
function openTheHearth() {
  const el = $("#boot");
  if (!el) return;

  /*
   * On the phone the fire has already been burning on the way in: the activity
   * shows its own copy out of the APK while Node wakes up, and hands over with
   * #lit. The class is put on in the markup, before the first paint — deciding
   * it here would be far too late, since everything below has to load first and
   * the fire would climb again in the meantime.
   *
   * So there is nothing left to wait for: it is already at full height, and
   * only has to draw back.
   */
  const RISE = el.classList.contains("lit") ? 260 : 2600;
  const wait = Math.max(0, RISE - performance.now());
  setTimeout(() => {
    el.classList.add("parting");
    // Gone rather than hidden: it sits over the whole app, and a decoration
    // has no business staying in the tree once it is done.
    setTimeout(() => el.remove(), 1000);
  }, wait);
}

boot();

/* ---- everything, from one box -----------------------------------------------
   A deep app with its depth behind a gear icon is an app most people only ever
   use the top of. Presets as reorderable blocks, regex, extensions, branching,
   lorebook binding, a tabletop: all of it real, most of it unfindable unless
   you already knew it was there.

   This is the way through to all of it without knowing where any of it lives.
   Ctrl+K, type, enter. Characters, chats, books, presets, every panel, the
   handful of things you actually do, and — the one nothing else in this space
   does properly — the text of every message you have ever sent or been sent. */

const PAL_LIMIT = 9;
let palRows = [];
let palAt = 0;
let palSeq = 0;

/**
 * Subsequence matching, the way every command palette works.
 *
 * "swp" finds "Swipes at the table" because the letters appear in order, and a
 * run of them together scores higher than the same letters scattered. Nobody
 * types a whole word into one of these; they type the shape of it.
 */
function fuzzy(needle, hay) {
  if (!needle) return 0;
  const n = needle.toLowerCase(), h = String(hay ?? "").toLowerCase();
  // A straight substring is always the better answer, and a hit at the start
  // of a word is what somebody meant when they typed three letters.
  const direct = h.indexOf(n);
  if (direct === 0) return 1000;
  if (direct > 0) return 800 - Math.min(direct, 200) + (/\W/.test(h[direct - 1]) ? 100 : 0);

  let i = 0, score = 0, run = 0;
  for (const ch of h) {
    if (ch === n[i]) { i++; run++; score += 10 + run * 6; }
    else run = 0;
    if (i === n.length) return score;
  }
  return 0;
}

/** Everything the palette can offer, gathered fresh each time it opens. */
function palSources() {
  const rows = [];
  const add = (kind, label, sub, run, icon) => rows.push({ kind, label, sub, run, icon });

  for (const ch of castCache) {
    add("Character", ch.name,
      ch.chats?.length ? `${ch.chats.length} chat${ch.chats.length > 1 ? "s" : ""}` : "no chats yet",
      () => (ch.chats?.[0] ? openChat(ch.chats[0].id) : startChat(ch.id)),
      medallion(ch.avatar, ch.name));
    for (const c of (ch.chats ?? []).slice(0, 6)) {
      add("Chat", c.title || "Untitled", `${ch.name} · ${c.turns} turns`,
        () => openChat(c.id), medallion(ch.avatar, ch.name));
    }
  }
  for (const b of books) {
    add("Lorebook", b.name, `${b.entries.length} entries`, () => openBook(b));
  }
  for (const p of presetsCache) {
    add("Preset", p.name, p.is_active ? "active" : "switch to this",
      async () => { await api(`/presets/${p.id}/activate`, { method: "POST" }); refreshPresets(); });
  }
  for (const [tab, name] of [
    ["cast", "Cast"], ["you", "You and your personas"], ["lore", "Lorebooks"],
    ["presets", "Presets and sampling"], ["regex", "Regex scripts"],
    ["look", "Look and theme"], ["settings", "Settings"],
  ]) {
    add("Go to", name, "panel", () => {
      openDrawer?.();
      document.querySelector(`.chainlink[data-tab="${tab}"]`)?.click();
    });
  }
  add("Do", "New chat with…", "pick a character", () => {
    openDrawer?.();
    document.querySelector('.chainlink[data-tab="cast"]')?.click();
  });
  add("Do", "Roll dice", "the composer's die", () => $("#diceBtn")?.click());
  add("Do", document.body.dataset.mode === "tabletop" ? "Leave tabletop mode" : "Enter tabletop mode",
    "the door", () => setMode(document.body.dataset.mode === "tabletop" ? "story" : "tabletop"));
  add("Do", "The story tree", "where this chat forked", () => showTree?.());
  return rows;
}

function palDraw() {
  const list = $("#palList");
  $("#palCount").textContent = palRows.length ? `${palRows.length} found` : "";
  if (!palRows.length) {
    list.innerHTML = `<p class="palempty">Nothing matches that.</p>`;
    return;
  }
  list.innerHTML = palRows.map((r, i) => `
    <button class="palrow${i === palAt ? " at" : ""}" data-i="${i}" role="option"
            aria-selected="${i === palAt}">
      <span class="palicon">${r.icon ?? ""}</span>
      <span class="paltext">
        <span class="pallabel">${esc(r.label)}</span>
        ${r.sub ? `<span class="palsub">${esc(r.sub)}</span>` : ""}
      </span>
      <span class="palkind">${esc(r.kind)}</span>
    </button>`).join("");
  for (const b of list.children) {
    if (!b.dataset) continue;
    b.onmousemove = () => { if (palAt !== +b.dataset.i) { palAt = +b.dataset.i; palDraw(); } };
    b.onclick = () => palRun(+b.dataset.i);
  }
  list.children[palAt]?.scrollIntoView({ block: "nearest" });
}

async function palSearch(q) {
  const mine = ++palSeq;
  /*
   * An empty box offers what you would actually want next, not the alphabet.
   *
   * Ranking nothing against nothing sorted the whole library by name and
   * filled the list with everybody whose name begins with A, which is a worse
   * answer than showing nothing at all. Where you were, and the handful of
   * things there are to do.
   */
  const all = palSources();
  const local = q
    ? all
        .map((r) => ({ r, score: fuzzy(q, r.label + " " + (r.sub ?? "")) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, PAL_LIMIT)
        .map((x) => x.r)
    : [
        ...all.filter((r) => r.kind === "Chat").slice(0, 4),
        ...all.filter((r) => r.kind === "Do"),
      ].slice(0, PAL_LIMIT);

  palRows = local;
  palAt = 0;
  palDraw();

  /*
   * And what you actually said, which is the part no other frontend does.
   *
   * Fetched rather than filtered, because it is the whole library and there
   * are far too many messages to hold in the page. Sequence-guarded: typing
   * is faster than a round trip and the answer to "hel" must not land on top
   * of the answer to "hello".
   */
  if (q.length < 2) return;
  let hits = [];
  try { hits = await api(`/search?q=${encodeURIComponent(q)}`); } catch { return; }
  if (mine !== palSeq || !Array.isArray(hits)) return;

  for (const h of hits.slice(0, 6)) {
    palRows.push({
      kind: "Said", label: h.snippet,
      sub: `${h.character_name}${h.title ? ` · ${h.title}` : ""} · ${ago(h.created_at)}`,
      icon: medallion(h.avatar, h.character_name),
      run: () => openChat(h.chat_id),
    });
  }
  palDraw();
}

function palRun(i) {
  const row = palRows[i];
  if (!row) return;
  closePalette();
  row.run();
}

function openPalette() {
  const el = $("#palette");
  if (!el || !el.hidden) return;
  el.hidden = false;
  $("#palInput").value = "";
  palSearch("");
  $("#palInput").focus();
}

function closePalette() {
  const el = $("#palette");
  if (el) el.hidden = true;
}

$("#palInput").oninput = (e) => palSearch(e.target.value.trim());
$("#palette").onclick = (e) => { if (e.target.id === "palette") closePalette(); };

$("#palInput").onkeydown = (e) => {
  if (e.key === "Escape") { closePalette(); return; }
  if (e.key === "Enter") { e.preventDefault(); palRun(palAt); return; }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!palRows.length) return;
    palAt = (palAt + (e.key === "ArrowDown" ? 1 : -1) + palRows.length) % palRows.length;
    palDraw();
  }
};

addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    $("#palette").hidden ? openPalette() : closePalette();
  }
});

/* ---- the roll log -----------------------------------------------------------
   Every table keeps one, and for the same reason: it is the only proof a
   player has that the dice were not quietly decided by whoever is narrating.
   Hearth's have always been honest — thrown on the server, never by the model
   — but "trust me" is not evidence and a scrollback is.

   It is also just nice to look at. Twenty rolls into an evening you can see
   the shape of your own luck. */

const ROLL_KIND = { dice: "Dice", check: "Check", attack: "Attack", initiative: "Initiative" };

async function openRollLog() {
  const box = $("#rollList");
  box.innerHTML = `<p class="hint">Reading the log…</p>`;
  $("#rollStats").textContent = "";
  $("#rollDialog").showModal();

  let rolls = [];
  try { rolls = await api(`/chats/${S.chatId}/rolls`); } catch {}
  if (!Array.isArray(rolls) || !rolls.length) {
    box.innerHTML = `<p class="hint">Nothing thrown in this game yet.</p>`;
    return;
  }

  box.innerHTML = rolls.map((r) => {
    /*
     * A natural twenty and a natural one are the two results anybody
     * remembers, so they are the two the log picks out. Read off the working
     * rather than the total, since a 20 with a +3 on it is a 23 and still the
     * thing that happened.
     */
    const die = /:\s*(\d+)/.exec(r.detail)?.[1];
    const crit = r.kind !== "initiative" && die === "20";
    const fumble = r.kind !== "initiative" && die === "1";
    return `<div class="rollrow${crit ? " crit" : ""}${fumble ? " fumble" : ""}">
      <span class="rolltotal">${r.total}</span>
      <span class="rollmid">
        <span class="rolllabel">${esc(r.label)}${crit ? " · natural twenty" : ""}${fumble ? " · natural one" : ""}</span>
        <span class="rolldetail">${esc(r.detail)}</span>
      </span>
      <span class="rollwhen">
        <span class="rollkind">${esc(ROLL_KIND[r.kind] ?? r.kind)}</span>
        <span>${ago(r.created_at)}</span>
      </span>
    </div>`;
  }).join("");

  // The shape of your own luck, which is half the reason to keep one.
  const d20s = rolls
    .filter((r) => r.kind !== "initiative")
    .map((r) => Number(/:\s*(\d+)/.exec(r.detail)?.[1]))
    .filter((n) => Number.isFinite(n) && n <= 20);
  if (d20s.length > 2) {
    const mean = d20s.reduce((a, b) => a + b, 0) / d20s.length;
    const nat20 = d20s.filter((n) => n === 20).length;
    const nat1 = d20s.filter((n) => n === 1).length;
    $("#rollStats").textContent =
      `${rolls.length} rolls · average ${mean.toFixed(1)} · ${nat20} nat 20 · ${nat1} nat 1`;
  } else {
    $("#rollStats").textContent = `${rolls.length} roll${rolls.length === 1 ? "" : "s"}`;
  }
}

$("#rollClose").onclick = () => $("#rollDialog").close();

/* ---- what the room sounds like ----------------------------------------------
   Rain, wind, a fire, the sea, a room full of people. All of it made here out
   of filtered noise rather than shipped as audio files — the same trick the
   quill uses, and the reason this costs nothing to download and belongs to
   nobody. A loop of real rain is a licence and four megabytes; this is thirty
   lines and it never repeats, because there is no loop to repeat.

   Off unless asked for, per chat, and it only ever starts from a press —
   browsers refuse to make noise otherwise, and they are right to. */

const AMBIENCE = {
  rain:   { label: "Rain",          hint: "steady, close, on a roof" },
  wind:   { label: "Wind",          hint: "open country, moving" },
  fire:   { label: "A fire",        hint: "low, with the odd crack" },
  sea:    { label: "The sea",       hint: "long, slow, further off" },
  room:   { label: "A room of people", hint: "murmur, no words in it" },
};

const ambience = (() => {
  let ctx = null, noise = null, out = null, chain = null, timer = 0;
  let playing = "";

  /** Two seconds of noise, looped. Long enough that the ear finds no seam. */
  function makeNoise(context) {
    const buf = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const d = buf.getChannelData(0);
    // Brown-ish rather than white: white noise is a hiss, and everything here
    // is meant to be weather rather than a broken television.
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }

  /** A slow wander, so nothing sits perfectly still. */
  function drift(param, low, high, seconds) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 1 / seconds;
    depth.gain.value = (high - low) / 2;
    param.value = (high + low) / 2;
    lfo.connect(depth).connect(param);
    lfo.start();
    return lfo;
  }

  function build(kind) {
    const nodes = [];
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    if (kind === "rain") {
      filter.type = "highpass"; filter.frequency.value = 900;
      const shelf = ctx.createBiquadFilter();
      shelf.type = "lowpass"; shelf.frequency.value = 6000;
      gain.gain.value = 0.34;
      noise.connect(filter).connect(shelf).connect(gain);
      nodes.push(drift(gain.gain, 0.26, 0.38, 11));
    } else if (kind === "wind") {
      filter.type = "bandpass"; filter.Q.value = 0.7;
      gain.gain.value = 0.5;
      noise.connect(filter).connect(gain);
      nodes.push(drift(filter.frequency, 260, 900, 17));
      nodes.push(drift(gain.gain, 0.22, 0.6, 9));
    } else if (kind === "fire") {
      filter.type = "lowpass"; filter.frequency.value = 420;
      gain.gain.value = 0.6;
      noise.connect(filter).connect(gain);
      nodes.push(drift(gain.gain, 0.42, 0.7, 5));
      // And the crackle, which is the whole difference between a fire and a
      // rumble: short bright bursts at uneven intervals.
      const crack = () => {
        if (!ctx || playing !== "fire") return;
        const b = ctx.createBufferSource();
        b.buffer = noise.buffer;
        b.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass"; hp.frequency.value = 1800;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.25 + Math.random() * 0.3, ctx.currentTime + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07 + Math.random() * 0.08);
        b.connect(hp).connect(g).connect(out);
        b.start();
        b.stop(ctx.currentTime + 0.3);
        timer = setTimeout(crack, 180 + Math.random() * 1400);
      };
      timer = setTimeout(crack, 400);
    } else if (kind === "sea") {
      filter.type = "lowpass"; filter.Q.value = 1.2;
      gain.gain.value = 0.5;
      noise.connect(filter).connect(gain);
      // Long and slow. A wave is about nine seconds and that is most of why
      // the sea sounds like the sea rather than like wind.
      nodes.push(drift(filter.frequency, 260, 1400, 9));
      nodes.push(drift(gain.gain, 0.14, 0.62, 9));
    } else {
      // A room of people: the shape of speech with none of the words, which is
      // what a crowd actually sounds like from across it.
      filter.type = "bandpass"; filter.frequency.value = 500; filter.Q.value = 1.4;
      gain.gain.value = 0.42;
      noise.connect(filter).connect(gain);
      nodes.push(drift(filter.frequency, 380, 780, 4.5));
      nodes.push(drift(gain.gain, 0.3, 0.5, 3.1));
    }

    gain.connect(out);
    return { nodes, gain, filter };
  }

  function stop() {
    playing = "";
    if (timer) { clearTimeout(timer); timer = 0; }
    if (chain) {
      for (const n of chain.nodes) { try { n.stop(); } catch {} }
      try { chain.gain.disconnect(); } catch {}
      chain = null;
    }
    if (noise) { try { noise.stop(); } catch {} noise = null; }
  }

  return {
    /** What is playing, so the picker can show it. */
    get current() { return playing; },

    /**
     * Start, stop, or change. Called from a press, which is the only way a
     * browser will let anything make a sound.
     */
    play(kind) {
      if (!AMBIENCE[kind]) { stop(); return; }
      if (playing === kind) return;
      stop();
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        out = ctx.createGain();
        out.gain.value = 0.5;
        out.connect(ctx.destination);
      }
      ctx.resume?.();
      noise = ctx.createBufferSource();
      noise.buffer = makeNoise(ctx);
      noise.loop = true;
      playing = kind;
      chain = build(kind);
      noise.start();
      // Faded in, because a room that starts at full volume is a jump scare.
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(0.0001, ctx.currentTime);
      out.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 1.4);
    },

    stop,
    /** True once a press has woken the audio context; see applyChatRoom. */
    get awake() { return !!ctx && ctx.state === "running"; },
  };
})();

/**
 * The room this chat is in: its gilt, and what it sounds like.
 *
 * Both are per-chat and both fall back to nothing, which is what every chat
 * that existed before this wants. The colour is set on the root so every gold
 * thing in the app follows it at once — the ornament, the plates, the dice —
 * rather than being applied in eighty places that would fall out of step.
 *
 * The sound is only ever *resumed*, never started, unless it was you who
 * pressed something. A browser will not make a noise on a page load and it is
 * right not to; opening a chat is not consent to be made to hear rain.
 */
function applyChatRoom() {
  const r = document.documentElement.style;
  const accent = chatMeta?.accent || "";
  if (accent) {
    r.setProperty("--lumiverse-primary", accent);
    // The two shades that hang off it, so hovers and muted text stay related
    // to the colour rather than to the gold they used to be.
    r.setProperty("--lumiverse-primary-hover",
      `color-mix(in srgb, ${accent} 78%, white)`);
    r.setProperty("--lumiverse-primary-muted",
      `color-mix(in srgb, ${accent} 68%, black)`);
  } else {
    for (const k of ["--lumiverse-primary", "--lumiverse-primary-hover", "--lumiverse-primary-muted"]) {
      r.removeProperty(k);
    }
    applyTheme?.();
  }

  const want = chatMeta?.ambience || "";
  if (!want) { ambience.stop(); return; }
  // Already awake means a press happened at some point in this session, so
  // carrying the sound from chat to chat is a continuation rather than a
  // surprise. Otherwise it waits for the Scene dialog.
  if (ambience.awake) ambience.play(want);
}

/* ---- panel chrome -----------------------------------------------------------
   The drawer used to open on two rows of icons before you reached anything you
   came for: a strip of tabs, then a strip of tools, then rows that each carried
   four more buttons at rest. That is the shape of a cockpit, and it is why it
   read as SillyTavern however carefully everything was drawn.

   The rule underneath the fix: controls at rest should be the quietest thing in
   the panel, and the content — names, faces, spines — the loudest. So the tools
   move behind one ⋯, and the ones that only mean something while you are
   choosing several move to a bar that does not exist until you are.

   Every button keeps its own id and its own handler; this only moves them. */

function wirePanelChrome() {
  for (const panel of document.querySelectorAll(".panel")) {
    const head = panel.querySelector(":scope > .panelhead");
    if (!head) continue;
    const menu = head.querySelector(".moremenu");
    const more = head.querySelector(".panelmore");

    // Only a toolbar that belongs to the panel itself — the ones nested inside
    // a collapsible section are that section's, and are already out of the way.
    const bar = panel.querySelector(":scope > .listbar");
    if (bar) {
      const sel = document.createElement("div");
      sel.className = "selbar";

      for (const el of [...bar.children]) {
        if (el.classList.contains("grow")) continue;
        // Anything that only means something once you have picked something
        // belongs with the picking, not in a menu you opened beforehand.
        if (/(Count|Delete|Group)$/.test(el.id)) { sel.append(el); continue; }
        if (el.tagName !== "BUTTON" && el.tagName !== "LABEL") { menu.append(el); continue; }
        el.classList.add("morerow");
        const label = document.createElement("span");
        label.textContent = el.title || el.getAttribute("aria-label") || "";
        el.append(label);
        menu.append(el);
      }
      bar.remove();
      if (sel.children.length) panel.append(sel);
      if (menu.children.length) more.hidden = false;
    }

    if (more) {
      more.onclick = (e) => {
        e.stopPropagation();
        const open = menu.hidden;
        closeAllMenus();
        menu.hidden = !open;
        more.setAttribute("aria-expanded", String(open));
      };
      // Choosing something should put the menu away; the handler on the button
      // itself has already run by the time this fires.
      menu.onclick = (e) => { if (e.target.closest("button")) closeAllMenus(); };
    }
  }

  /*
   * How many of the thing this panel is for.
   *
   * Watched rather than pushed, so every list that draws itself gets a count
   * without any of them having to remember to say so — and the lorebooks get
   * one whichever of their two views is showing.
   */
  for (const slot of document.querySelectorAll("[data-count-for]")) {
    const id = slot.dataset.countFor;
    if (!id) continue;
    const list = document.getElementById(id);
    if (!list) continue;
    const shelf = id === "loreList" ? document.getElementById("loreShelf") : null;
    const paint = () => {
      const n = (shelf && !shelf.hidden)
        ? shelf.querySelectorAll(".spine").length
        : list.querySelectorAll(":scope > .rowwrap, :scope > .item, :scope > .lorerow").length;
      slot.textContent = n ? String(n) : "";
    };
    new MutationObserver(paint).observe(list, { childList: true });
    if (shelf) new MutationObserver(paint).observe(shelf, { childList: true, attributes: true, attributeFilter: ["hidden"] });
    paint();
  }
}

function closeAllMenus() {
  for (const m of document.querySelectorAll(".moremenu")) m.hidden = true;
  for (const b of document.querySelectorAll(".panelmore")) b.setAttribute("aria-expanded", "false");
}
addEventListener("click", closeAllMenus);
addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeAllMenus();
  closeChain();
  $("#composer").dataset.guided = "false";
  $("#plusBtn").setAttribute("aria-expanded", "false");
});

wirePanelChrome();
