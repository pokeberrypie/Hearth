/*
 * The hearth, lit — what sits over Hearth while it loads.
 *
 * One file for both places it is drawn: the app's own loading screen
 * (public/index.html) and the phone's boot.html, shown out of the APK while
 * the server wakes. The phone burns first and hands over with #lit, and the
 * app's copy carries on from a fire already at full height — so the two must
 * be the same fire, which is why this is one file and not two kept in step.
 *
 * The hearth is the icon's own drawing (mobile/android/icon/boot_hearth.py
 * writes it from gen_icon.py), and the fire is drawn the way the icon draws
 * fire: flat shapes in its own colours, deep red to a pale-gold heart, layered.
 * Each layer is a row of pointed tongues that flicker and sway on their own
 * time; licks break off the tips and rise, and embers drift up.
 *
 * It comes out of the hearth. It burns in the firebox, behind the logs, seen
 * through the open mouth of it; and as it grows it pours out of that mouth —
 * a second fire in front of the stone, whose foot is the arch of the opening
 * itself, reaching down into the top of the opening so the fire inside and the
 * fire pouring out are one, fanning up and out over the chimney breast and the
 * mantel. Then the room catches: flames rise from the floor across the whole
 * width, from below the screen, and climb to meet it until the hearth and the
 * screen are fire. Never a flat edge: the one fire starts in the grate, and the
 * other below the bottom of the screen.
 *
 * And then it parts, the way water would: an opening wells up in the middle of
 * the flames — a rippling oval with a thick rim, each colour drawn back by its
 * own amount so the rim is layered — and spreads, taller and wider, throwing
 * drops of flame off its edge, until the fire has drawn away to the sides of
 * the screen. The app is in the opening.
 *
 *   HearthFire.light(el, { lit })   start it; lit = already at full height
 *   HearthFire.part()               part it; resolves when it is gone
 */
(function () {
  "use strict";

  const HEARTH = `__HEARTH__`;
  // Where the fire sits in the drawing: the grate, in the icon's 108-unit viewBox, and how high the opening is.
  const GRATE = { x: 54, y: 78.5, half: 11, top: 52 };
  const RISE_MS = 2600;
  const PART_MS = 2000;

  // The icon's fire, outermost first: each a colour, how tall it stands against the tallest, how much of it
  // is body rather than tongue at full height, and its tongues — how many, how wide, how quick.
  const LAYERS = [
    { colour: "#7a2410", tall: 1.00, body: 0.97, n: 7, width: 0.36, speed: 1.0 },
    { colour: "#c9471a", tall: 0.86, body: 0.66, n: 8, width: 0.30, speed: 1.35 },
    { colour: "#f0862b", tall: 0.68, body: 0.48, n: 9, width: 0.24, speed: 1.75 },
    { colour: "#ffc14c", tall: 0.48, body: 0.34, n: 9, width: 0.19, speed: 2.2 },
    { colour: "#fff0be", tall: 0.27, body: 0.22, n: 7, width: 0.14, speed: 2.8 },
  ];

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** A fixed scatter, so both copies of the fire (the phone's and the app's) flicker the same way. */
  function seeded(n) {
    let x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }
  const TONGUES = LAYERS.map((L, li) => Array.from({ length: L.n }, (_, i) => ({
    u: -1 + (2 * (i + 0.5)) / L.n + (seeded(li * 31 + i) - 0.5) * (1.6 / L.n),
    f: L.speed * lerp(0.8, 1.3, seeded(li * 17 + i * 3)),
    p: seeded(li * 7 + i * 11) * Math.PI * 2,
    q: seeded(li * 13 + i * 5) * Math.PI * 2,
  })));

  const CSS = `
#boot.hf { position: fixed; inset: 0; z-index: 999; pointer-events: none; overflow: hidden; background: #120c09; }
#boot.hf svg { fill: initial; stroke: none; stroke-width: 0; }
#boot.hf .hf-room { position: absolute; inset: 0;
  background: radial-gradient(75% 55% at 50% 82%, #3a2014 0%, #1e120c 45%, #0e0907 100%); }
#boot.hf .hf-hearth { position: absolute; left: 50%; bottom: 4vh; transform: translateX(-50%);
  width: min(88vw, 64vh); height: auto; aspect-ratio: 80 / 74; overflow: visible;
  filter: brightness(calc(0.6 + var(--heat, 0) * 0.55)); }
#boot.hf .hf-fire { position: absolute; inset: 0; width: 100%; height: 100%; }
#boot.hf .hf-light { position: absolute; inset: 0; mix-blend-mode: screen;
  background: radial-gradient(70% 55% at 50% 80%, rgba(255, 170, 80, .28), rgba(194, 90, 30, .10) 55%, transparent 80%);
  opacity: calc(0.3 + var(--heat, 0) * 0.7); }
#boot.hf.parting { background: transparent; }
#boot.hf.parting .hf-room, #boot.hf.parting .hf-hearth, #boot.hf.parting .hf-light, #boot.hf.parting .hf-back { display: none; }
`;

  let state = null;

  function light(root, opts = {}) {
    if (!root || state) return;
    if (!document.getElementById("hf-style")) {
      const st = document.createElement("style");
      st.id = "hf-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const still = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    root.classList.add("hf");
    // The fire is behind the hearth: the stone in front hides where it starts, and the open firebox shows it.
    // Two fires: the one in the firebox, behind the stone and the logs; and the one pouring out of its
    // mouth, in front of the stone.
    root.innerHTML = `<div class="hf-room"></div><canvas class="hf-fire hf-back"></canvas>
      <svg class="hf-hearth" viewBox="14 16 80 74" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${HEARTH}</svg>
      <canvas class="hf-fire hf-front"></canvas><div class="hf-light"></div>`;
    const svg = root.querySelector(".hf-hearth");
    const canvas = root.querySelector(".hf-front");
    const back = root.querySelector(".hf-back");
    const s = {
      root, svg, canvas, ctx: canvas.getContext("2d"), back, bctx: back.getContext("2d"), still,
      unit: 4, archTop: 0, mouth: 50,
      start: performance.now() - (opts.lit ? RISE_MS : 0),
      split: 0, splitStart: 0, last: performance.now(), raf: 0, done: null,
      licks: [], embers: [], w: 0, h: 0, dpr: 1, grate: { x: 0, y: 0, half: 10, open: 40 }, hearthHalf: 100, hearthBottom: 0,
    };
    state = s;
    const size = () => {
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = window.innerWidth; s.h = window.innerHeight;
      canvas.width = back.width = Math.round(s.w * s.dpr); canvas.height = back.height = Math.round(s.h * s.dpr);
      const m = svg.getScreenCTM();
      if (m) {
        const pt = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m); };
        const at = pt(GRATE.x, GRATE.y), edge = pt(GRATE.x + GRATE.half, GRATE.y), top = pt(GRATE.x, GRATE.top);
        s.grate = { x: at.x, y: at.y, half: Math.max(8, edge.x - at.x), open: Math.max(20, at.y - top.y) };
        s.hearthHalf = Math.max(s.grate.half * 2, pt(84, GRATE.y).x - at.x);
        s.hearthBottom = pt(GRATE.x, 84).y;
        // The mouth of the firebox: its arch, in screen pixels — 14 units either side of the middle, its
        // crown 50 units down, its springing 58.
        s.unit = pt(1, 0).x - pt(0, 0).x;
        s.archTop = pt(GRATE.x, 50).y;
        s.mouth = 14 * s.unit;
      } else {
        s.grate = { x: s.w / 2, y: s.h * 0.8, half: s.w * 0.07, open: s.h * 0.1 };
        s.hearthBottom = s.h * 0.9;
      }
    };
    size();
    s.onResize = size;
    window.addEventListener("resize", size);
    if (still) { draw(s, 0.12, performance.now() / 1000, 0); return; }
    s.raf = requestAnimationFrame(frame);
  }

  /** How tall the fire is at a point, as a share of its tallest: the layer's body, and its tongues above it. */
  function heightAt(li, u, t, heat) {
    const L = LAYERS[li];
    if (Math.abs(u) >= 1.15) return 0;
    // A dome in the grate; a wall across the screen once it is full.
    const dome = Math.sqrt(Math.max(0, 1 - Math.min(1, u * u)));
    const env = lerp(dome, Math.abs(u) <= 1 ? 1 : 0, Math.pow(heat, 2));
    if (env <= 0) return 0;
    let tongue = 0;
    for (const g of TONGUES[li]) {
      const sway = 0.035 * Math.sin(t * g.f * 0.7 + g.q);
      const d = Math.abs(u - g.u - sway) / L.width;
      if (d >= 1) continue;
      const flick = 0.6 + 0.26 * Math.sin(t * g.f * 2.1 + g.p) + 0.14 * Math.sin(t * g.f * 4.3 + g.q);
      tongue = Math.max(tongue, flick * Math.pow(1 - d, 1.55));
    }
    const body = lerp(0.42, L.body, Math.pow(heat, 1.2));
    return L.tall * env * (body + (1 - body) * tongue);
  }

  /** One frame of the fire, at a given heat and parting. */
  function draw(s, heat, t, split) {
    const { ctx, bctx, w, h, dpr, grate } = s;
    for (const c of [ctx, bctx]) { c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h); }
    const cx = grate.x;
    const N = 96;
    const u0 = s.unit || 4;
    const mouth = s.mouth || grate.half * 1.3;
    const archTop = s.archTop || grate.y - grate.open;

    // The fire in the firebox, behind the logs: as wide as the mouth, reaching up into the arch — and, once
    // it is spilling out, filling it to the crown and past, so the fire inside and the fire pouring out are
    // one fire (what reaches past the arch is behind the stone, and unseen).
    if (!split) {
      const tallIn = (grate.y - archTop) * lerp(0.9, 2.6, clamp(heat / 0.12, 0, 1));
      for (let li = 0; li < LAYERS.length; li++) {
        bctx.fillStyle = LAYERS[li].colour;
        bctx.beginPath();
        bctx.moveTo(cx - mouth * 1.1, grate.y + 2 * u0);
        for (let i = 0; i <= N; i++) {
          const u = -1.15 + (2.3 * i) / N;
          bctx.lineTo(cx + u * mouth, grate.y - tallIn * heightAt(li, u, t, 0.15));
        }
        bctx.lineTo(cx + mouth * 1.1, grate.y + 2 * u0);
        bctx.closePath();
        bctx.fill();
      }
    }

    // The fire out of the mouth. Its foot is the arch of the opening; beyond the opening its lower edge
    // rises, so the flames fan up and out over the stone; as it grows that edge sweeps down to the floor.
    const out = clamp((heat - 0.12) / 0.88, 0, 1);              // nothing outside until the firebox is full
    const half = lerp(mouth * 1.05, w * 0.95, Math.pow(out, 1.9));
    const tall = lerp((grate.y - archTop) * 0.5, h * 1.55, Math.pow(out, 1.2));
    // The room catching: flames from the floor, rising to meet the fire from the hearth.
    const floor = ease(clamp((heat - 0.36) / 0.56, 0, 1));
    const floorTall = lerp(0, h * 1.6, floor);
    // The foot of the fire pouring out: across the mouth it is the grate itself — one fire from the logs up
    // and out, the logs drawn over it — and at the sides of the mouth it meets the arch's springing.
    // Its foot is the floor of the firebox, over the logs — the fire has them — and past the jambs it
    // rises off the floor in one wavering line, so nothing of the stone shows between the two fires.
    const floorY = (s.hearthBottom || grate.y + 6 * u0) - 0.5 * u0;
    // It takes the logs as it comes out: its foot goes down from the grate to the floor.
    const footY = lerp(grate.y, floorY, ease(clamp(out / 0.18, 0, 1)));
    // The opening: an oval welling up in the middle of the fire, taller than it is wide, rippling at its rim.
    // It spreads until it is past every edge of the screen. Each colour is drawn back by its own amount, the
    // brightest most, so the rim is a layered wall of fire around the gap.
    const cy = h * 0.52;
    const rx = Math.pow(split, 1.25) * w * 0.85;
    const ry = Math.min(h * 1.4, rx * 2.3 + split * h * 0.15);
    const rim = Math.min(1, split * 5) * Math.max(5, Math.min(w, h) * 0.022);
    const opening = (grow) => {
      ctx.moveTo(-10, -10); ctx.lineTo(w + 10, -10); ctx.lineTo(w + 10, h + 10); ctx.lineTo(-10, h + 10); ctx.closePath();
      if (rx <= 0) return;
      const M = 72;
      for (let k = 0; k <= M; k++) {
        const a = (k / M) * Math.PI * 2;
        const ripple = 1 + 0.07 * Math.sin(a * 5 + t * 6.5) + 0.035 * Math.sin(a * 11 - t * 9.5) + 0.02 * Math.sin(a * 17 + t * 13);
        const x = cx + (rx + grow) * ripple * Math.cos(a), y = cy + (ry + grow * 1.6) * ripple * Math.sin(a);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    if (out > 0) {
      for (let li = 0; li < LAYERS.length; li++) {
        ctx.save();
        if (split > 0) { ctx.beginPath(); opening(li * rim); ctx.clip("evenodd"); }
        ctx.fillStyle = LAYERS[li].colour;
        const tops = [], lows = [];
        // The brighter the colour, the narrower: in the mouth the fire is deep orange at its sides and gold
        // to pale at its heart, as a fire in a grate is.
        const narrow = 1 - li * 0.13;
        for (let i = 0; i <= N; i++) {
          const u = -1.15 + (2.3 * i) / N;
          const x = cx + u * half * narrow;
          const dx = Math.abs(x - cx);
          // The foot: on the floor across the mouth, and past the jambs rising off it in a diagonal that is
          // a flame's edge, not a ruled line — waves run along it, bigger the further from the mouth.
          const reach = Math.max(1, 1.15 * half * narrow - mouth * 0.85);
          const beyond = clamp((dx - mouth * 0.85) / reach, 0, 1);
          const lift = Math.pow(beyond, 1.5) * (footY - archTop + tall * LAYERS[li].tall * lerp(0.5, 0.3, out));
          const wave = (Math.sin(beyond * 9 - t * 5.2 + li * 1.7) * 0.7 + Math.sin(beyond * 17 + t * 7.9 + li) * 0.3)
            * Math.sin(Math.PI * beyond) * Math.max(2.5 * u0, reach * 0.07);
          const foot = footY - lift + wave;
          // Inside the mouth the brighter colours sit lower, and rise out of it as tongues; towards the colour's
          // edge its crown comes down to meet its foot, so no side is ever cut straight down.
          const sink = dx < mouth ? (grate.y - archTop) * 0.22 * li * (1 - out) : 0;
          const side = clamp((Math.abs(u) - 0.7) / 0.3, 0, 1);
          const crown = archTop + sink - tall * heightAt(li, u, t, out) + (1 - out) * 4 * u0;
          const top = Math.min(foot, lerp(crown, foot, side * side * (3 - 2 * side)));
          // And as the room catches, its foot goes down with the fire from the floor, so the two are one.
          const low = Math.max(top, lerp(foot, h + 12, Math.min(1, floor * 1.6)));
          tops.push([x, top]); lows.push([x, low]);
        }
        ctx.beginPath();
        ctx.moveTo(lows[0][0], lows[0][1]);
        for (const [x, y] of tops) ctx.lineTo(x, y);
        for (let i = lows.length - 1; i >= 0; i--) ctx.lineTo(lows[i][0], lows[i][1]);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // The room's, in the same colour — the two fires drawn as one, colour by colour, so neither cuts
        // across the other.
        if (floorTall > 0) {
        ctx.save();
        if (split > 0) { ctx.beginPath(); opening(li * rim); ctx.clip("evenodd"); }
        ctx.fillStyle = LAYERS[li].colour;
        ctx.beginPath();
        ctx.moveTo(-20, h + 20);
        for (let i = 0; i <= N; i++) {
          const u = -1 + (2 * i) / N;
          ctx.lineTo(w / 2 + u * (w / 2 + 20), h + 8 - floorTall * heightAt(li, u * 0.92, t + 7.3, 0.6));
        }
        ctx.lineTo(w + 20, h + 20);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        }
      }
    }
    // Licks broken off the tongues, and thrown off the walls as they part; embers above them.
    for (const k of s.licks) {
      const f = k.age / k.life, r = k.size * (1 - f * 0.7);
      ctx.fillStyle = LAYERS[k.layer].colour;
      ctx.globalAlpha = 1 - f * f;
      ctx.beginPath();
      const x = k.x, y = k.y;
      ctx.moveTo(x, y - 2.1 * r);
      ctx.bezierCurveTo(x + 0.35 * r, y - 1.15 * r, x + r, y - 0.5 * r, x + r, y + 0.15 * r);
      ctx.bezierCurveTo(x + r, y + 0.75 * r, x + 0.5 * r, y + r, x, y + r);
      ctx.bezierCurveTo(x - 0.5 * r, y + r, x - r, y + 0.75 * r, x - r, y + 0.15 * r);
      ctx.bezierCurveTo(x - r, y - 0.5 * r, x - 0.35 * r, y - 1.15 * r, x, y - 2.1 * r);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffe3a0";
    for (const e of s.embers) {
      const f = e.age / e.life, r = e.size * (1 - f);
      ctx.globalAlpha = 1 - f * 0.6;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - r); ctx.lineTo(e.x + r * 0.7, e.y); ctx.lineTo(e.x, e.y + r); ctx.lineTo(e.x - r * 0.7, e.y);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The tongues' tips, for the licks and embers, are measured from the crown of the arch.
    return { half, baseY: archTop, tall, cx, cy, rx, ry };
  }

  function frame(now) {
    const s = state;
    if (!s) return;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    const t = now / 1000;
    const heat = ease(clamp((now - s.start) / RISE_MS, 0, 1));
    if (s.splitStart) s.split = ease(clamp((now - s.splitStart) / PART_MS, 0, 1));
    s.root.style.setProperty("--heat", heat.toFixed(3));
    // The hearth and its logs go as the fire from the floor reaches them, not before and not after.
    const floorNow = ease(clamp((heat - 0.36) / 0.56, 0, 1));
    const gone = clamp((floorNow - 0.18) / 0.3, 0, 1);
    s.svg.style.opacity = String(1 - gone * gone * (3 - 2 * gone));
    const g = draw(s, heat, t, s.split);

    // New licks off the tips of the brighter layers, and — parting — off the walls, thrown outward.
    const tips = (2 + heat * 14) * dt;
    if (Math.random() < tips) {
      const li = 2 + Math.floor(Math.random() * 2);
      const tg = TONGUES[li][Math.floor(Math.random() * TONGUES[li].length)];
      const x = g.cx + tg.u * g.half;
      s.licks.push({ layer: li, x, y: g.baseY - g.tall * heightAt(li, tg.u, t, heat) * 0.92,
        vx: (Math.random() - 0.5) * 20, vy: -lerp(40, 160, heat), size: lerp(g.half * 0.06, Math.min(s.w, s.h) * 0.03, heat),
        age: 0, life: lerp(0.45, 0.9, Math.random()) });
    }
    // Drops of flame thrown off the rim of the opening as it spreads, outward from its middle.
    if (s.split > 0 && s.split < 0.85 && g.rx > 0) {
      for (let n = 0; n < 2 && Math.random() < 40 * dt; n++) {
        const a = Math.random() * Math.PI * 2;
        const x = g.cx + g.rx * Math.cos(a), y = g.cy + g.ry * Math.sin(a);
        const speed = lerp(140, 420, Math.random());
        s.licks.push({ layer: 1 + Math.floor(Math.random() * 3), x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed * 0.7 - 60,
          size: Math.min(s.w, s.h) * lerp(0.014, 0.032, Math.random()), age: 0, life: lerp(0.35, 0.7, Math.random()) });
      }
    }
    if (Math.random() < (1 + heat * 8) * dt) {
      s.embers.push({ x: g.cx + (Math.random() - 0.5) * g.half * 1.4, y: g.baseY - g.tall * 0.3 * Math.random(),
        vx: (Math.random() - 0.5) * 30, vy: -lerp(50, 200, Math.random()) * lerp(1, 2, heat), size: lerp(1.5, 3.2, Math.random()),
        age: 0, life: lerp(1, 2.4, Math.random()), seed: Math.random() * 9 });
    }
    s.licks = s.licks.filter((k) => { k.age += dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vy *= 1 - 0.4 * dt; return k.age < k.life; });
    s.embers = s.embers.filter((e) => { e.age += dt; e.vx += Math.sin(t * 3 + e.seed) * 40 * dt; e.x += e.vx * dt; e.y += e.vy * dt; return e.age < e.life; });

    // Done when the opening is past every edge and the last drops thrown off it have gone — not later,
    // with a few of them hanging over the app.
    // Open: every corner of the screen inside the opening, even at the low point of its ripple.
    const inside = (x, y) => Math.pow((x - g.cx) / (g.rx * 0.86), 2) + Math.pow((y - g.cy) / (g.ry * 0.86), 2) < 1;
    const open = g.rx > 0 && inside(0, 0) && inside(s.w, 0) && inside(0, s.h) && inside(s.w, s.h);
    if (s.split >= 1 || (open && !s.licks.length)) { finish(); return; }
    if (open) s.embers = [];
    s.raf = requestAnimationFrame(frame);
  }

  function finish() {
    const s = state;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    window.removeEventListener("resize", s.onResize);
    state = null;
    if (s.done) s.done();
  }

  /** The fire parts and draws away to either side. Resolves once it is gone; the caller removes the element. */
  function part() {
    const s = state;
    if (!s) return Promise.resolve();
    if (s.still) {
      s.root.style.transition = "opacity .35s linear";
      s.root.style.opacity = "0";
      return new Promise((r) => setTimeout(() => { state = null; r(); }, 380));
    }
    if (s.splitStart) return new Promise((r) => { const prev = s.done; s.done = () => { prev && prev(); r(); }; });
    // At full height the fire covers everything, so the room and the hearth behind it can go unseen:
    // what is left is the fire, and the gap in it shows the app.
    s.root.classList.add("parting");
    s.splitStart = performance.now();
    return new Promise((r) => { s.done = r; });
  }

  window.HearthFire = { light, part, RISE_MS };
})();
