/* ---- a guided way to fill a description ---------------------------------------
 *
 * An empty box with "Description" over it is the hardest part of this whole
 * program. People know exactly who their character is and stall completely on
 * what a program wants written down about them — so they put in three lines,
 * the model has nothing to work with, and they conclude the app is bad at this.
 *
 * So: the same box, with optional scaffolding over it. Headed fields with a
 * line of help each, showing the *kind* of thing that goes there.
 *
 * ## The text is still the truth
 *
 * Nothing here changes what is sent. The fields compose into the same
 * description they always were, in the same box, and the model receives one
 * piece of prose exactly as before. Guided is a way of typing, not a way of
 * storing — which is what lets it be entirely optional, and what makes it safe
 * to switch off halfway through.
 *
 * ## Which is why it has to round-trip
 *
 * Anything imported, pasted or typed by hand has to survive being opened in
 * the guided view and closed again. So the format is the one people already
 * use without being asked — `Appearance:` and then the appearance — and text
 * under no heading is kept, first and whole, rather than being tidied away.
 * `parse(compose(x))` is tested, because a description quietly losing a
 * paragraph is far worse than no scaffolding at all.
 */
(function () {

/**
 * What a persona is asked for.
 *
 * Fewer than a character gets. A persona is who *you* are in the scene and
 * mostly needs to answer "what do they see and how do I come across"; a
 * fifteen-field form for that is a form nobody finishes.
 */
const PERSONA = [
  { key: "Gender", hint: "However you would say it. One word is fine." },
  { key: "Appearance", also: ["physical appearance", "looks", "physique"],
    hint: "What somebody notices first: height and build, hair, eyes, how you dress." },
  { key: "Voice and manner", also: ["voice", "manner", "speech", "speech pattern"],
    hint: "How you speak and carry yourself. An accent that thickens when you are angry." },
  { key: "Quirks", also: ["mannerisms", "habits", "quirks and mannerisms"],
    hint: "Small repeated things you do. These are what a narrator writes you by." },
  { key: "Background", also: ["history", "backstory", "bio"],
    hint: "Where you are from and what you have done. A short paragraph beats a CV." },
  { key: "Interests", also: ["interests/style", "style", "hobbies", "likes"],
    hint: "What you like, what you are good at, what you will argue about all night." },
  { key: "Scent",
    hint: "What you smell of, if it matters. Perfume, smoke, horses, cold air." },
  { key: "Anything else", also: ["additional info", "notes", "other", "misc"],
    hint: "Jewellery you never take off, a scar with a story, how you sign your name." },
];

/**
 * And a character.
 *
 * Personality and the scene have boxes of their own in that dialog, so they
 * are deliberately not repeated here — two places to write the same thing is
 * how one of them ends up stale and contradicting the other.
 */
const CHARACTER = [
  /*
   * Name and Personality have boxes of their own on this dialog, so these two
   * are aimed slightly to the side of them rather than repeating them: the
   * names a character goes *by*, and a temperament that can sit with the rest
   * of the sheet. A sheet written elsewhere has both under these headings and
   * would otherwise land unsplit in the block at the top.
   */
  { key: "Name", also: ["names", "aliases", "titles", "full name"],
    hint: "Titles and what people call them — Ser, the Kingslayer, a name only " +
          "their sister uses. The plain name goes in the box above." },
  { key: "Gender", hint: "However the character would say it." },
  { key: "Personality", also: ["temperament", "character", "disposition"],
    hint: "Who they are to be around. There is a Personality box below as well — " +
          "one or the other, not both, or they will end up disagreeing." },
  { key: "Appearance", also: ["physical appearance", "looks", "physique"],
    hint: "Height, build, colouring, what they wear, how they move through a room." },
  { key: "Background", also: ["history", "backstory", "bio"],
    hint: "Where they came from, and what happened to them that still matters." },
  { key: "Ego",
    hint: "What they think they are, and whether they are right. Earned or a front?" },
  { key: "Emotional maturity", also: ["maturity"],
    hint: "How they handle being refused, frightened, or wrong. Where the age shows." },
  { key: "Speech pattern", also: ["speech", "speech patterns", "voice", "manner of speech"],
    hint: "How they talk. Fast and mocking? Formal? Do they answer, or dodge and change the subject?" },
  { key: "Quirks and mannerisms", also: ["quirks", "mannerisms", "quirks & mannerisms", "habits"],
    hint: "Where their hands go, what they do when cornered, the tell nobody has mentioned. " +
          "This is the section that makes a model write a person rather than a description." },
  { key: "Important relationships", also: ["relationships", "key relationships", "relations"],
    hint: "Who matters to them, and what that relationship actually is — not just the label." },
  { key: "Likes", hint: "What they seek out, and what they are like when they get it." },
  { key: "Dislikes", hint: "What sets them off, and what they do about it." },
  { key: "Scent", hint: "What they smell of, if it matters." },
  { key: "Anything else", also: ["additional info", "notes", "other", "misc"],
    hint: "Anything that did not fit above." },
];

/*
 * Sections somebody added themselves.
 *
 * The built-in lists cannot be right for everybody — a sheet with Ego, House
 * Affiliations and Emotional Maturity on it is a perfectly good sheet, and the
 * form should learn those rather than sweeping them into "already written".
 * Kept on the server so they survive a new device and travel with a backup.
 */
const extra = { persona: [], character: [] };

const SETTING = { persona: "guided_persona", character: "guided_character" };

async function loadExtra() {
  try {
    const s = await fetch("/api/settings").then((r) => (r.ok ? r.json() : null));
    if (!s) return;
    for (const which of ["persona", "character"]) {
      const raw = JSON.parse(s[SETTING[which]] ?? "[]");
      extra[which] = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
    }
  } catch { /* a guest has no settings, and the built-ins are still fine */ }
}

function saveExtra(which) {
  fetch("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [SETTING[which]]: JSON.stringify(extra[which]) }),
  }).catch(() => { /* it stays for this session either way */ });
}

/** A name somebody typed, made safe to use as a heading. */
function tidyName(v) {
  return String(v ?? "").replace(/[:\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
}

/** A heading line: "Appearance:" on its own, or "Gender: female" inline. */
const HEADING = /^[ \t]*([A-Za-z][A-Za-z '&/-]{1,30}?)[ \t]*:[ \t]*(.*)$/;

const norm = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Pulls a description apart into the fields it was written in.
 *
 * Only headings this form knows about are treated as headings — otherwise a
 * line of dialogue with a colon in it would silently become a section and take
 * the rest of the description with it. Everything before the first known
 * heading is kept as-is, because that is where an imported card's prose lives
 * and it must never be dropped.
 */
function parse(text, sections) {
  /*
   * A heading and everything it is commonly called instead.
   *
   * The point of the whole feature is meeting people where they already write,
   * and "Speech:", "Physical Appearance:" and "Key Relationships:" are all
   * things somebody has genuinely typed. Recognising only the exact wording
   * this form happens to use would leave real sheets sitting unsplit in the
   * block at the top, which is the failure the fields exist to prevent.
   */
  const known = new Map();
  for (const s of sections) {
    known.set(norm(s.key), s.key);
    for (const a of s.also ?? []) if (!known.has(norm(a))) known.set(norm(a), s.key);
  }
  const lines = String(text ?? "").split("\n");
  const found = {};
  const lead = [];
  let current = null;
  let bucket = [];

  const stash = () => {
    if (!current) return;
    const body = bucket.join("\n").trim();
    // A heading written twice keeps both halves rather than losing the first.
    found[current] = found[current] ? `${found[current]}\n${body}`.trim() : body;
  };

  for (const line of lines) {
    const m = HEADING.exec(line);
    const key = m ? known.get(norm(m[1])) : null;
    if (key) {
      stash();
      current = key;
      bucket = m[2].trim() ? [m[2].trim()] : [];
    } else if (current) {
      bucket.push(line);
    } else {
      lead.push(line);
    }
  }
  stash();
  return { lead: lead.join("\n").trim(), fields: found };
}

/**
 * And puts it back together.
 *
 * A one-line answer sits on the heading — "Gender: female" — and anything
 * longer starts underneath it, which is how people write these by hand and so
 * how they read back correctly.
 */
function compose(lead, fields, sections) {
  const parts = [];
  if (lead.trim()) parts.push(lead.trim());
  for (const s of sections) {
    const v = String(fields[s.key] ?? "").trim();
    if (!v) continue;
    parts.push(v.includes("\n") ? `${s.key}:\n${v}` : `${s.key}: ${v}`);
  }
  return parts.join("\n\n");
}

/**
 * Headings sitting in the unstructured text that this form has never heard of.
 *
 * Somebody pasting a sheet they wrote elsewhere has all of it in one block,
 * and the useful thing is not to reformat it for them but to offer: "you have
 * written Ego — do you want a box for that?"
 */
function unknownHeadings(text, sections) {
  /*
   * The whole description, not only the loose block at the top.
   *
   * An unknown heading that turns up *after* a known one is not left over — it
   * is swallowed into whichever field it followed, silently, and then nobody
   * is ever offered a box for it. Found with a real sheet whose last two
   * headings disappeared into the field above them.
   */
  const known = new Set();
  for (const s of sections) {
    known.add(norm(s.key));
    for (const a of s.also ?? []) known.add(norm(a));
  }
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = HEADING.exec(line);
    if (!m) continue;
    const name = tidyName(m[1]);
    if (!name || known.has(norm(name)) || out.some((o) => norm(o) === norm(name))) continue;
    out.push(name);
  }
  return out.slice(0, 8);
}

/* ---- the control ------------------------------------------------------------ */

/**
 * Puts a guided view over a textarea.
 *
 * The textarea keeps being the value that gets saved; this writes into it on
 * every keystroke. Switching back to plain text is therefore free, and closing
 * the dialog from either view saves the same thing.
 */
function attach(id, base, remember, which) {
  const area = document.getElementById(id);
  if (!area || area.dataset.guided) return;
  area.dataset.guided = "1";

  /*
   * Built-ins first, then whatever this person added.
   *
   * Read fresh on every paint rather than captured once, so adding a section
   * takes effect immediately and the same list is used for parsing, composing
   * and drawing — three places that disagreeing would silently move somebody's
   * text between a field and the loose block above it.
   */
  const all = () => [
    ...base,
    ...extra[which].map((key) => ({ key, hint: "", custom: true })),
  ];

  const wrap = document.createElement("div");
  wrap.className = "guided";
  const bar = document.createElement("div");
  bar.className = "guidedbar";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "linkish";
  const fields = document.createElement("div");
  fields.className = "guidedfields";
  fields.hidden = true;
  bar.append(toggle);
  wrap.append(bar, fields);
  area.parentElement.insertBefore(wrap, area.nextSibling);

  let on = false;
  try { on = localStorage.getItem(remember) === "1"; } catch { /* private window */ }

  const paint = () => {
    const sections = all();
    const { lead, fields: got } = parse(area.value, sections);
    fields.innerHTML = "";

    if (lead) {
      // Whatever was already written and does not belong to a heading. Shown
      // rather than hidden, because it is usually the whole imported card.
      const l = document.createElement("label");
      l.className = "guidedfield";
      l.innerHTML = `<span class="gk">Already written</span>` +
        `<span class="gh">This was here before, and is kept at the top as it is.</span>`;
      const t = document.createElement("textarea");
      t.rows = Math.min(8, Math.max(2, lead.split("\n").length));
      t.value = lead;
      t.oninput = () => write();
      t.dataset.lead = "1";
      l.append(t);
      fields.append(l);
    }

    for (const s of sections) {
      const l = document.createElement("label");
      l.className = "guidedfield";

      const head = document.createElement("span");
      head.className = "gk";
      head.textContent = s.key;
      if (s.custom) {
        // Removing one risks nothing: the words stay in the box and reappear
        // in the block above rather than going anywhere.
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "gdrop";
        drop.title = `Remove the ${s.key} section`;
        drop.setAttribute("aria-label", `Remove the ${s.key} section`);
        drop.textContent = "×";
        drop.onclick = (e) => {
          e.preventDefault();
          extra[which] = extra[which].filter((k) => norm(k) !== norm(s.key));
          saveExtra(which);
          paint();
        };
        head.append(drop);
      }

      const hint = document.createElement("span");
      hint.className = "gh";
      hint.textContent = s.hint || "Yours. Whatever belongs under this heading.";

      const t = document.createElement("textarea");
      const v = got[s.key] ?? "";
      t.rows = Math.min(6, Math.max(2, (v.split("\n").length || 1)));
      t.value = v;
      t.dataset.key = s.key;
      t.oninput = () => write();

      l.append(head, hint, t);
      fields.append(l);
    }

    /*
     * Headings already written that this form has never heard of — offered,
     * not imposed. Somebody pasting a sheet from elsewhere gets asked "you
     * have written Ego, shall I give it a box?" rather than having their own
     * text quietly rearranged around them.
     */
    const spotted = unknownHeadings(area.value, sections);
    if (spotted.length) {
      const row = document.createElement("div");
      row.className = "guidedspot";
      const says = document.createElement("span");
      says.className = "gh";
      says.textContent = "Already written, and this form has no box for them yet:";
      row.append(says);
      for (const name of spotted) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghost small";
        b.textContent = name;
        b.onclick = () => addSection(name);
        row.append(b);
      }
      fields.append(row);
    }

    const add = document.createElement("div");
    add.className = "guidedadd";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add a section of your own";
    input.maxLength = 30;
    input.setAttribute("aria-label", "Name a new section");
    const go = document.createElement("button");
    go.type = "button";
    go.className = "ghost small";
    go.textContent = "Add";
    const submit = () => { addSection(input.value); input.value = ""; };
    go.onclick = submit;
    // Enter in a dialog submits the form; here it should add the section.
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    add.append(input, go);
    fields.append(add);
  };

  /** A new heading, if it is a name and not one there is already a box for. */
  const addSection = (raw) => {
    const name = tidyName(raw);
    if (!name) return;
    if (all().some((s) => norm(s.key) === norm(name))) return;
    extra[which] = [...extra[which], name];
    saveExtra(which);
    paint();
  };

  /** Fields -> the textarea, which is the thing that gets saved. */
  const write = () => {
    const got = {};
    let lead = "";
    for (const t of fields.querySelectorAll("textarea")) {
      if (t.dataset.lead) lead = t.value;
      else got[t.dataset.key] = t.value;
    }
    area.value = compose(lead, got, all());
    area.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const show = () => {
    toggle.textContent = on ? "Write it as one piece" : "Fill it in step by step";
    fields.hidden = !on;
    area.hidden = on;
    if (on) paint();
    try { localStorage.setItem(remember, on ? "1" : "0"); } catch { /* fine */ }
  };

  toggle.onclick = () => { on = !on; show(); };
  show();

  // Reopening the dialog on somebody else must not show the last one's fields.
  area.addEventListener("hearth:reset", () => { if (on) paint(); });
}

window.HearthGuided = { attach, parse, compose, unknownHeadings, PERSONA, CHARACTER };

/*
 * Wired here rather than from app.js, so that this file is the only thing that
 * knows which set of fields belongs to which box.
 */
async function wire() {
  await loadExtra();
  attach("p_description", PERSONA, "hearth.guided.persona", "persona");
  attach("c_description", CHARACTER, "hearth.guided.character", "character");
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire, { once: true });
} else {
  wire();
}

})();
