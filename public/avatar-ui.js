/* ---- the face maker ----------------------------------------------------------
 *
 * The dialog. avatar.js composes and rasterises; this decides what you are
 * shown and in what order.
 *
 * ## Swatches are whole faces
 *
 * Each choice is rendered as the face you would get, with that one part swapped
 * in — not the part alone on a blank square. A hairstyle in isolation is a
 * shape nobody can read, and the thing you are actually choosing between is the
 * face it makes. It costs a render per swatch, which is nothing, and it is the
 * difference between choosing and guessing.
 *
 * ## Nothing here names a part
 *
 * Every list is built from what is registered. That is what lets a pack drop in
 * without this file changing, and it is why the maker degrades honestly: with
 * no pack installed you get the built-in gear and a plain silhouette, and the
 * dialog says where faces come from rather than pretending to be finished.
 */
(function () {

const A = () => window.HearthAvatar;
const $$ = (sel) => document.querySelector(sel);

let current = null;
let activeLayer = "head";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ---- painting the dialog ---------------------------------------------------- */

function paintPreview() {
  const box = $$("#avPreview");
  if (box) box.innerHTML = A().renderSvg(current, 240);
}

function paintLayers() {
  const wrap = $$("#avLayers");
  wrap.innerHTML = "";
  for (const layer of A().LAYERS) {
    if (!A().partsFor(layer).length) continue;
    const b = el("button", "avlayer" + (layer === activeLayer ? " on" : ""),
      A().LAYER_NAMES[layer] || layer);
    b.type = "button";
    b.onclick = () => { activeLayer = layer; paintLayers(); paintChoices(); };
    wrap.append(b);
  }
}

/** One swatch: the whole face, with this part swapped in. */
function swatch(label, recipe, on, onPick) {
  const b = el("button", "avchoice" + (on ? " on" : ""));
  b.type = "button";
  b.title = label;
  b.innerHTML = A().renderSvg(recipe, 74);
  b.append(el("span", "avname", label));
  b.onclick = onPick;
  return b;
}

async function paintChoices() {
  const wrap = $$("#avChoices");
  const layer = activeLayer;
  wrap.innerHTML = "";

  // Drawn parts have to be inlined before they can be composed at all, so the
  // row is painted after its art arrives rather than flickering in.
  await A().ensureLayerArt(layer);
  if (activeLayer !== layer) return;      // somebody moved on while we waited

  const chosen = current.parts[layer] || "";
  const swap = (id) => {
    const parts = { ...current.parts };
    if (id) parts[layer] = id; else delete parts[layer];
    current = { ...current, parts };
    paintPreview();
    paintChoices();
  };

  if (!A().REQUIRED.has(layer)) {
    const off = { ...current, parts: { ...current.parts } };
    delete off.parts[layer];
    wrap.append(swatch("None", off, !chosen, () => swap("")));
  }
  for (const p of A().partsFor(layer)) {
    wrap.append(swatch(p.name,
      { ...current, parts: { ...current.parts, [layer]: p.id } },
      p.id === chosen, () => swap(p.id)));
  }

  paintColours();
}

function paintColours() {
  const wrap = $$("#avColours");
  wrap.innerHTML = "";
  const tint = A().LAYER_TINT[activeLayer];
  if (!tint) return;

  const set = (c) => {
    current = { ...current, tints: { ...current.tints, [tint]: c } };
    paintPreview();
  };

  const row = el("div", "avcolours");
  for (const c of A().PALETTE[tint] || []) {
    const b = el("button", "avdot" + (current.tints[tint] === c ? " on" : ""));
    b.type = "button";
    b.style.background = c;
    b.style.setProperty("--tick", A().isDark(c) ? "#fff" : "#241a14");
    b.title = c;
    b.onclick = () => { set(c); paintChoices(); };
    row.append(b);
  }

  const custom = el("label", "avcustom", "Any colour");
  const input = document.createElement("input");
  input.type = "color";
  input.value = current.tints[tint];
  input.oninput = () => set(input.value);
  // Swatches are only repainted when the drag ends. Sixty full re-renders a
  // second while somebody scrubs a colour wheel is how a picker starts to stick.
  input.onchange = () => paintChoices();
  custom.append(input);

  wrap.append(row, custom);
}

/** The line under the title, which is also where "install a pack" lives. */
function paintNote() {
  const note = $$("#avNote");
  if (!note) return;
  note.innerHTML = A().canMakeFaces()
    ? ""
    : `No face packs installed yet — this is the gear that ships with Hearth, ` +
      `and a plain head to hang a face on. Faces, hair and expressions come ` +
      `from packs.`;
  note.hidden = A().canMakeFaces();
}

/* ---- packs ------------------------------------------------------------------ */

async function paintPacks() {
  const list = $$("#avPackList");
  if (!list) return;
  list.innerHTML = "";
  let packs = [];
  try { packs = await fetch("/api/avatar/packs").then((r) => (r.ok ? r.json() : [])); }
  catch { /* offline is not an error worth a red box here */ }

  if (!packs.length) {
    list.append(el("p", "hint", "Nothing installed."));
    return;
  }
  for (const p of packs) {
    const row = el("div", "item");
    const meta = el("span", "meta");
    meta.append(el("span", "t", p.name));
    meta.append(el("span", "s",
      `${p.parts.length} part${p.parts.length === 1 ? "" : "s"}` +
      (p.author ? ` · ${p.author}` : "")));
    row.append(meta);

    const del = el("button", "ico danger");
    del.type = "button";
    del.title = "Remove";
    del.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>`;
    del.onclick = async () => {
      const sure = typeof askDialog === "function"
        ? await askDialog({
            title: `Remove ${p.name}?`,
            text: "Faces already made with it keep the picture they have — only " +
                  "editing one back into its parts would miss them.",
            confirmLabel: "Remove",
          })
        : true;
      if (!sure) return;
      await fetch(`/api/avatar/packs/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      await A().loadPacks();
      await paintPacks();
      paintNote();
      paintLayers();
      paintChoices();
    };
    row.append(del);
    list.append(row);
  }
}

async function installPack(files) {
  const list = [...files];
  if (!list.length) return;
  const form = new FormData();
  // A browser does not send a file's folder with it, so the paths travel
  // alongside in the same order. A zip carries its own and ignores these.
  form.append("paths", JSON.stringify(list.map((f) => f.webkitRelativePath || f.name)));
  for (const f of list) form.append("files", f);

  const out = await fetch("/api/avatar/packs", { method: "POST", body: form })
    .then((r) => r.json())
    .catch(() => null);

  if (!out || out.error) {
    if (typeof toast === "function") toast(out?.error || "That pack could not be read.");
    return;
  }
  await A().loadPacks();
  await paintPacks();
  paintNote();
  paintLayers();
  await paintChoices();
  if (typeof toast === "function") {
    toast(`${out.name}: ${out.added} part${out.added === 1 ? "" : "s"}.` +
      (out.skipped?.length ? ` Skipped ${out.skipped.length}.` : ""));
  }
}

/* ---- the drawing template ---------------------------------------------------
 *
 * Handed out so that somebody drawing a pack draws to the same landmarks as
 * everything else. This is the single thing that makes packs interchangeable,
 * and asking people to read coordinates out of a comment was never going to
 * work — so it ships as a picture you open in whatever you draw in.
 */
const TEMPLATE_GUIDES = `
  <rect width="200" height="200" fill="#ffffff"/>
  <g fill="none" stroke="#59a7d8" stroke-width="0.8" opacity="0.95">
    <path d="M100 0v200M0 100h200" stroke-dasharray="3 3" opacity="0.5"/>
    <path d="M100 38c21 0 38 17 38 42 0 17-3 32-8 44-5 13-13 22-24 24H94
             c-11-2-19-11-24-24-5-12-8-27-8-44 0-25 17-42 38-42z"/>
    <path d="M0 100h200M0 86h200M0 118h200M0 128h200M0 148h200M0 164h200"/>
    <path d="M75 100c4-7 13-8 17-1-4 7-13 8-17 1zM125 100c-4-7-13-8-17-1 4 7 13 8 17 1z"/>
    <path d="M64 95c-6-1-10 3-10 9s4 11 10 12M136 95c6-1 10 3 10 9s-4 11-10 12"/>
    <path d="M89 148h22M100 164c-29 0-54 15-60 36M100 164c29 0 54 15 60 36"/>
  </g>
  <g fill="#59a7d8" font-family="monospace" font-size="5" opacity="0.9">
    <text x="2" y="84">brows 86</text>
    <text x="2" y="98">eyes 100</text>
    <text x="2" y="116">nose 118</text>
    <text x="2" y="126">mouth 128</text>
    <text x="2" y="146">chin 148</text>
    <text x="2" y="162">shoulders 164</text>
  </g>`;

async function downloadTemplate() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" ` +
    `width="1024" height="1024">${TEMPLATE_GUIDES}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1024;
  canvas.getContext("2d").drawImage(img, 0, 0, 1024, 1024);
  URL.revokeObjectURL(url);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hearth-avatar-template.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

/* ---- opening it ------------------------------------------------------------- */

/**
 * Opens the maker over an existing avatar, if that avatar was made here.
 *
 * Resolves to a File — a PNG with the recipe already written into it — or null
 * if it was closed. A File rather than a URL because that is what the dialogs'
 * picture wells already take, so a made face goes up the same path a
 * photograph does and nothing downstream learns a new case.
 */
async function openMaker(existing) {
  const box = $$("#avatarDialog");
  if (!box) return null;

  await A().loadPacks();
  /*
   * `existing` is a URL for an avatar already saved, and a File for one drawn
   * a moment ago and not yet uploaded. Both have the recipe inside them; only
   * the fetch differs.
   */
  let found = null;
  try {
    if (typeof existing === "string" && existing) found = await A().recipeOf(existing);
    else if (existing && typeof existing.arrayBuffer === "function") {
      found = A().recipeIn(new Uint8Array(await existing.arrayBuffer()));
    }
  } catch { /* an unreadable picture just means starting fresh */ }
  current = found || A().starterRecipe();
  activeLayer = A().partsFor("head").length ? "head" : "bg";

  await A().ensureArt(current);
  paintNote();
  paintLayers();
  paintPreview();
  await paintChoices();
  paintPacks();

  box.returnValue = "";
  box.showModal();

  /*
   * How the dialog was left, from whichever event actually reports it.
   *
   * The buttons produce a `submit` (the form is `method="dialog"`), while
   * Escape and the backdrop produce `cancel` and `close` and no submit at all.
   * Listening for all three and taking the first is not belt-and-braces: it is
   * the only way every exit resolves, exactly once. Every listener is removed
   * on the way out, or the next time this opens a stale one answers for it.
   */
  const how = await new Promise((resolve) => {
    const form = box.querySelector("form");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      form.removeEventListener("submit", onSubmit);
      box.removeEventListener("close", onClose);
      box.removeEventListener("cancel", onCancel);
      resolve(value);
    };
    const onSubmit = (e) => finish(e.submitter ? e.submitter.value : box.returnValue);
    const onClose = () => finish(box.returnValue);
    const onCancel = () => finish("cancel");
    form.addEventListener("submit", onSubmit);
    box.addEventListener("close", onClose);
    box.addEventListener("cancel", onCancel);
  });
  if (box.open) box.close();
  if (how !== "save") return null;

  const blob = await A().toPngBlob(current, 512).catch(() => null);
  if (!blob) {
    if (typeof toast === "function") toast("That could not be turned into a picture.");
    return null;
  }
  const withIt = A().withRecipe(new Uint8Array(await blob.arrayBuffer()), current);
  return new File([withIt], "avatar.png", { type: "image/png" });
}

/* ---- wiring ----------------------------------------------------------------- */

document.addEventListener("click", (e) => {
  if (e.target.closest("#avRandom")) {
    current = A().randomRecipe();
    A().ensureArt(current).then(() => { paintPreview(); paintChoices(); });
    return;
  }
  if (e.target.closest("#avTemplate")) { downloadTemplate(); return; }
  if (e.target.closest("#avPackAdd")) { $$("#avPackFile")?.click(); return; }
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "avPackFile") return;
  const files = [...(e.target.files || [])];
  e.target.value = "";
  installPack(files);
});

window.HearthAvatarUI = { open: openMaker, downloadTemplate, installPack };

})();
