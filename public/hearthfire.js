/*
 * The hearth, from inside — what sits over Hearth while it loads.
 *
 * You are in the firebox, looking at its back: a soot-black brick wall, the side walls running in to it, the
 * arch of the mouth around the edge of the screen, and an ash floor with two logs smouldering on it. A small
 * ball of fire circles in the middle, trailing light and throwing sparks, and lights the brick as it passes.
 * When Hearth is ready it spirals in, quicker and brighter, and bursts: the blast clears the hearth away from
 * the middle out, embers fly, and the app is there behind it.
 *
 * One file for both places it is drawn: the app's own loading screen (public/index.html) and the phone's
 * boot.html, shown out of the APK while the server wakes. The phone draws first and hands over with #lit; the
 * ball's place on its circle is worked out from the clock, not from when each page started, so the app's copy
 * picks it up exactly where the phone's left it.
 *
 * Canvas 2D: no WebGL, nothing a phone's GPU can refuse. The hearth is drawn once per size and kept; each frame
 * is that picture, the light on it, the ball, its trail and the sparks. With reduced motion asked for, the
 * hearth is shown still and fades.
 *
 *   HearthFire.light(el, { lit })   start it; lit = it has already been circling (the phone's copy)
 *   HearthFire.part()               burst; resolves when it is gone
 *   HearthFire.RISE_MS              how long it circles, at least, before it may burst
 */
(function () {
  "use strict";

  const RISE_MS = 1700;            // about a lap: it is seen going round before it goes
  const LAP_MS = 1600;
  const SPIRAL_MS = 650;
  const BURST_MS = 1100;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIn = (t) => t * t * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  const CSS = `
.hf { position: fixed; inset: 0; z-index: 2147483000; background: #0b0705; overflow: hidden; pointer-events: auto; }
.hf.parting { background: transparent; pointer-events: none; }
.hf canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
`;

  /** A repeatable random: the same bricks every time the hearth is drawn. */
  function seeded(n) {
    let x = n >>> 0 || 1;
    return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
  }

  let state = null;

  /** The hearth itself, drawn once for this size of screen. */
  function paintHearth(s) {
    const { w, h, dpr } = s;
    const c = document.createElement("canvas");
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const rnd = seeded(1971);

    // Where things are: the back wall's edges, where it meets the floor, and the point the side walls run to.
    const back = { l: w * 0.17, r: w * 0.83, floor: h * 0.74 };
    const vp = { x: w / 2, y: h * 0.5 };
    s.layout = { back, vp, ball: { x: w / 2, y: h * 0.44, r: Math.min(w, h) * 0.15 }, logs: { x: w / 2, y: back.floor + (h - back.floor) * 0.42 } };

    g.fillStyle = "#0b0705";
    g.fillRect(0, 0, w, h);

    // The back wall: brick, in a running bond, each a little its own colour, under soot that is thickest at the top.
    const bh = clamp(Math.min(w, h) * 0.042, 12, 30), bw = bh * 2.5, mortar = Math.max(1.2, bh * 0.1);
    g.save();
    g.beginPath(); g.rect(back.l, 0, back.r - back.l, back.floor); g.clip();
    g.fillStyle = "#140b07"; g.fillRect(back.l, 0, back.r - back.l, back.floor);
    for (let row = 0, y = back.floor - bh; y > -bh; row++, y -= bh) {
      const shift = row % 2 ? bw / 2 : 0;
      for (let x = back.l - bw + shift; x < back.r + bw; x += bw) {
        const k = rnd();
        const r = 50 + k * 34, gg = 24 + k * 14, b = 15 + k * 8;
        g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
        g.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar);
        // A worn face: a lighter top edge, a darker underside.
        g.fillStyle = "rgba(255,190,140,0.05)"; g.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh * 0.18);
        g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(x + mortar / 2, y + bh * 0.72, bw - mortar, bh * 0.28 - mortar / 2);
      }
    }
    // Soot: black at the top, thinning to the warm brick low down, where the fire has been licking it clean;
    // and in smears and blooms across it, where smoke has hung for years.
    const soot = g.createLinearGradient(0, 0, 0, back.floor);
    soot.addColorStop(0, "rgba(4,2,1,0.98)"); soot.addColorStop(0.4, "rgba(6,3,2,0.82)"); soot.addColorStop(0.8, "rgba(8,4,2,0.5)"); soot.addColorStop(1, "rgba(10,5,2,0.32)");
    g.fillStyle = soot; g.fillRect(back.l, 0, back.r - back.l, back.floor);
    for (let i = 0; i < 18; i++) {
      const x = lerp(back.l, back.r, rnd()), y = back.floor * (0.15 + rnd() * 0.8), r = Math.min(w, h) * (0.06 + rnd() * 0.16);
      const blot = g.createRadialGradient(x, y, 0, x, y, r);
      blot.addColorStop(0, `rgba(3,2,1,${0.25 + rnd() * 0.3})`); blot.addColorStop(1, "rgba(3,2,1,0)");
      g.fillStyle = blot; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Where the fire has stood longest, low in the middle, the brick is scorched black right through.
    const scorch = g.createRadialGradient(w / 2, back.floor, 0, w / 2, back.floor, (back.r - back.l) * 0.45);
    scorch.addColorStop(0, "rgba(2,1,0,0.6)"); scorch.addColorStop(1, "rgba(2,1,0,0)");
    g.fillStyle = scorch; g.fillRect(back.l, 0, back.r - back.l, back.floor);
    g.restore();

    // The side walls, running in to the back: their courses of brick drawn toward the vanishing point.
    const side = (edgeX, wallX) => {
      g.save();
      g.beginPath(); g.moveTo(wallX, 0); g.lineTo(wallX, back.floor); g.lineTo(edgeX, h); g.lineTo(edgeX, 0); g.closePath(); g.clip();
      const grad = g.createLinearGradient(edgeX, 0, wallX, 0);
      grad.addColorStop(0, "#090504"); grad.addColorStop(1, "#24130b");
      g.fillStyle = grad; g.fillRect(Math.min(edgeX, wallX), 0, Math.abs(wallX - edgeX), h);
      g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = mortar;
      for (let y = back.floor; y > -h; y -= bh) {
        // The same course on the back wall, carried out to the screen's edge along the line from the vanishing point.
        const t = (edgeX - vp.x) / (wallX - vp.x);
        g.beginPath(); g.moveTo(wallX, y); g.lineTo(edgeX, vp.y + (y - vp.y) * t); g.stroke();
      }
      const sootSide = g.createLinearGradient(0, 0, 0, h);
      sootSide.addColorStop(0, "rgba(4,2,1,0.9)"); sootSide.addColorStop(0.7, "rgba(4,2,1,0.35)"); sootSide.addColorStop(1, "rgba(4,2,1,0.6)");
      g.fillStyle = sootSide; g.fillRect(0, 0, w, h);
      g.restore();
    };
    side(0, back.l);
    side(w, back.r);

    // The floor: ash, in perspective, warmest under the logs.
    g.save();
    g.beginPath(); g.moveTo(back.l, back.floor); g.lineTo(back.r, back.floor); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.clip();
    const ash = g.createLinearGradient(0, back.floor, 0, h);
    ash.addColorStop(0, "#2a1c14"); ash.addColorStop(1, "#140c08");
    g.fillStyle = ash; g.fillRect(0, back.floor, w, h - back.floor);
    for (let i = 0; i < 260; i++) {
      const t = rnd(), y = lerp(back.floor, h, t), half = lerp((back.r - back.l) / 2, w / 2, t);
      const x = w / 2 + (rnd() * 2 - 1) * half, r = lerp(0.6, 2.2, t) * (0.5 + rnd());
      g.fillStyle = `rgba(${120 + rnd() * 60 | 0},${100 + rnd() * 40 | 0},${90 + rnd() * 30 | 0},${0.08 + rnd() * 0.12})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.restore();

    // The logs: two, crossed, charred black, split along the grain where they have burned, the cracks still hot.
    const L = s.layout.logs, len = Math.min(w * 0.5, 360), thick = clamp(len * 0.15, 14, 46);
    const log = (angle, dx, dy, endRight) => {
      g.save(); g.translate(L.x + dx, L.y + dy); g.rotate(angle);
      const body = g.createLinearGradient(0, -thick / 2, 0, thick / 2);
      body.addColorStop(0, "#2a1810"); body.addColorStop(0.45, "#170d08"); body.addColorStop(1, "#070403");
      g.fillStyle = body;
      g.beginPath(); g.roundRect ? g.roundRect(-len / 2, -thick / 2, len, thick, thick / 2.2) : g.rect(-len / 2, -thick / 2, len, thick); g.fill();
      // Bark, in checks: the charred skin split into blocks.
      g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 1.2;
      for (let i = 0; i < 9; i++) {
        const x = -len / 2 + len * (0.08 + i * 0.1) + (rnd() - 0.5) * 8;
        g.beginPath(); g.moveTo(x, -thick / 2 + 2); g.lineTo(x + (rnd() - 0.5) * 6, thick / 2 - 2); g.stroke();
      }
      // The cracks still glowing: along the underside, where the heat is.
      g.strokeStyle = "rgba(255,110,30,0.55)"; g.lineWidth = Math.max(1, thick * 0.05); g.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const x0 = -len / 2 + len * (0.15 + rnd() * 0.6), y0 = thick * (0.05 + rnd() * 0.3);
        g.beginPath(); g.moveTo(x0, y0);
        for (let j = 1; j <= 4; j++) g.lineTo(x0 + j * len * 0.03, y0 + (rnd() - 0.5) * thick * 0.25);
        g.stroke();
      }
      // The sawn end: dark rings, burned at the rim.
      const ex = (endRight ? 1 : -1) * (len / 2 - thick * 0.2);
      g.fillStyle = "#3a2416"; g.beginPath(); g.ellipse(ex, 0, thick * 0.28, thick / 2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(255,120,40,0.45)"; g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(ex, 0, thick * 0.28, thick / 2, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = "rgba(15,8,4,0.8)"; g.lineWidth = 1;
      for (const k of [0.35, 0.65]) { g.beginPath(); g.ellipse(ex, 0, thick * 0.28 * k, thick / 2 * k, 0, 0, Math.PI * 2); g.stroke(); }
      g.restore();
    };
    log(0.13, len * 0.04, thick * 0.45, false);
    log(-0.1, -len * 0.04, 0, true);
    s.layout.logs.len = len; s.layout.logs.thick = thick;

    // The mouth of the hearth: an arch of dark stone round the edge of the screen, its inner edge caught by the light.
    const rim = clamp(Math.min(w, h) * 0.05, 18, 46), top = rim + Math.min(w * 0.36, h * 0.2);
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.moveTo(rim, h);
    g.lineTo(rim, top);
    g.quadraticCurveTo(rim, rim, w / 2, rim);
    g.quadraticCurveTo(w - rim, rim, w - rim, top);
    g.lineTo(w - rim, h);
    g.closePath();
    g.fillStyle = "#0a0605";
    g.fill("evenodd");
    g.strokeStyle = "rgba(255,170,100,0.16)"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(rim, h); g.lineTo(rim, top); g.quadraticCurveTo(rim, rim, w / 2, rim); g.quadraticCurveTo(w - rim, rim, w - rim, top); g.lineTo(w - rim, h); g.stroke();
    g.restore();

    s.hearth = c;
  }

  /** Where the ball is on its circle at a moment, by the clock: the same place on the phone's copy and the app's. */
  function onCircle(s, squeeze = 1) {
    const B = s.layout.ball;
    const a = ((Date.now() % LAP_MS) / LAP_MS) * Math.PI * 2;
    const wob = Math.sin(a * 3) * B.r * 0.05;
    return { x: B.x + Math.cos(a) * (B.r + wob) * squeeze, y: B.y + Math.sin(a) * (B.r * 0.78 + wob) * squeeze, a };
  }

  function drawBall(g, x, y, r, heat) {
    const halo = g.createRadialGradient(x, y, 0, x, y, r * 3.4);
    halo.addColorStop(0, `rgba(255,190,90,${0.55 * heat})`); halo.addColorStop(0.35, `rgba(255,110,30,${0.25 * heat})`); halo.addColorStop(1, "rgba(255,80,20,0)");
    g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 3.4, 0, Math.PI * 2); g.fill();
    const core = g.createRadialGradient(x - r * 0.2, y - r * 0.25, 0, x, y, r);
    core.addColorStop(0, "#fff8e6"); core.addColorStop(0.35, "#ffd36e"); core.addColorStop(0.75, "#ff8a2a"); core.addColorStop(1, "rgba(230,70,20,0)");
    g.fillStyle = core; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  function frame(now) {
    const s = state;
    if (!s) return;
    const { ctx: g, w, h } = s;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const B = s.layout.ball, size = clamp(Math.min(w, h) * 0.022, 7, 16);
    let x, y, r = size, heat = 1, burst = 0;
    if (s.partAt) {
      const t = (now - s.partAt) / SPIRAL_MS;
      if (t < 1) {
        // In, quicker and quicker, and brighter: the circle closes on the middle.
        const k = easeIn(clamp(t, 0, 1));
        // From the speed it was circling at, faster and faster: no jump as it starts in.
        const a = s.spinFrom + ((t * SPIRAL_MS) / LAP_MS + t * t * 2.4) * Math.PI * 2;
        const rad = B.r * (1 - k);
        x = B.x + Math.cos(a) * rad; y = B.y + Math.sin(a) * rad * 0.78;
        r = size * (1 + k * 1.6); heat = 1 + k;
      } else {
        x = B.x; y = B.y;
        burst = clamp((now - s.partAt - SPIRAL_MS) / BURST_MS, 0, 1);
        if (!s.blown) blow(s, x, y, size);
      }
    } else {
      const p = onCircle(s);
      x = p.x; y = p.y;
    }

    // The hearth, and the light the ball throws on it.
    if (burst < 1) {
      g.globalAlpha = 1;
      g.drawImage(s.hearth, 0, 0, w, h);
      // The embers under the logs, breathing.
      const L = s.layout.logs, breathe = 0.75 + 0.25 * Math.sin(now / 700) + 0.08 * Math.sin(now / 173);
      const bed = g.createRadialGradient(L.x, L.y + L.thick * 0.4, 0, L.x, L.y + L.thick * 0.4, L.len * 0.6);
      bed.addColorStop(0, `rgba(255,120,40,${0.38 * breathe})`); bed.addColorStop(1, "rgba(255,90,20,0)");
      g.globalCompositeOperation = "lighter";
      g.fillStyle = bed; g.fillRect(0, 0, w, h);
      for (const e of s.coals) {
        const glow = 0.4 + 0.6 * Math.max(0, Math.sin(now / e.speed + e.phase));
        g.fillStyle = `rgba(255,${110 + glow * 90 | 0},40,${0.55 * glow})`;
        g.beginPath(); g.arc(L.x + e.dx * L.len * 0.5, L.y + e.dy * L.thick, e.r, 0, Math.PI * 2); g.fill();
      }
      // The ball's own light on the brick around it.
      const lit = g.createRadialGradient(x, y, 0, x, y, Math.max(w, h) * 0.45);
      lit.addColorStop(0, `rgba(255,140,60,${0.22 * heat})`); lit.addColorStop(0.4, `rgba(255,100,40,${0.08 * heat})`); lit.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = lit; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
    }

    if (burst > 0) {
      // The blast clears the hearth from the middle out: a hole with a burning edge, growing past every corner.
      const far = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) * 1.15;
      const hole = easeOut(burst) * far;
      g.globalCompositeOperation = "destination-out";
      const cut = g.createRadialGradient(x, y, Math.max(0, hole * 0.82), x, y, Math.max(1, hole));
      cut.addColorStop(0, "rgba(0,0,0,1)"); cut.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = cut; g.beginPath(); g.arc(x, y, hole, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#000"; g.beginPath(); g.arc(x, y, Math.max(0, hole * 0.82), 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = "lighter";
      // The burning edge of it.
      const ring = g.createRadialGradient(x, y, Math.max(0, hole * 0.78), x, y, Math.max(1, hole * 1.02));
      ring.addColorStop(0, "rgba(255,140,40,0)"); ring.addColorStop(0.6, `rgba(255,170,70,${0.55 * (1 - burst)})`); ring.addColorStop(1, "rgba(255,90,20,0)");
      g.fillStyle = ring; g.beginPath(); g.arc(x, y, hole * 1.02, 0, Math.PI * 2); g.fill();
      // The flash, at the very start.
      const flash = Math.max(0, 1 - burst * 5);
      if (flash > 0) { g.fillStyle = `rgba(255,230,180,${0.6 * flash})`; g.fillRect(0, 0, w, h); }
      g.globalCompositeOperation = "source-over";
    }

    // The trail: where it has just been, fading.
    g.globalCompositeOperation = "lighter";
    if (!burst) {
      s.trail.push({ x, y, r });
      if (s.trail.length > 18) s.trail.shift();
      s.trail.forEach((p, i) => {
        const k = i / s.trail.length;
        g.fillStyle = `rgba(255,${120 + k * 60 | 0},40,${0.22 * k * k})`;
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.4 + 0.6 * k), 0, Math.PI * 2); g.fill();
      });
      // Sparks thrown off it, rising as they cool.
      for (let i = 0; i < (s.partAt ? 4 : 2); i++) {
        s.sparks.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 60, life: 0.5 + Math.random() * 0.6, age: 0, r: 0.8 + Math.random() * 1.6 });
      }
    }
    for (const p of s.sparks) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= p.drag ?? 0.98; p.vy = p.vy * (p.drag ?? 0.98) - (p.burst ? -40 : 30) * dt;
      const k = 1 - p.age / p.life;
      if (k <= 0) continue;
      g.fillStyle = `rgba(255,${150 + k * 80 | 0},${60 + k * 60 | 0},${k})`;
      g.beginPath(); g.arc(p.x, p.y, p.r * (0.5 + k * 0.5), 0, Math.PI * 2); g.fill();
    }
    s.sparks = s.sparks.filter((p) => p.age < p.life);
    if (!burst) drawBall(g, x, y, r, heat);
    else if (burst < 0.25) drawBall(g, x, y, size * 2.6 * (1 + burst * 8), Math.max(0, 1 - burst * 4) * 2);
    g.globalCompositeOperation = "source-over";

    if (burst >= 1 && !s.sparks.length) return finish(s);
    s.raf = requestAnimationFrame(frame);
  }

  /** The burst: embers flung out in every direction, fast, slowing as they go. */
  function blow(s, x, y, size) {
    s.blown = true;
    s.root.classList.add("parting");
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, v = 250 + Math.random() * 700;
      s.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.93, burst: true, life: 0.6 + Math.random() * 0.7, age: 0, r: size * (0.12 + Math.random() * 0.3) });
    }
  }

  function finish(s) {
    cancelAnimationFrame(s.raf);
    window.removeEventListener("resize", s.onResize);
    state = null;
    if (s.done) s.done();
  }

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
    root.innerHTML = `<canvas></canvas>`;
    const canvas = root.querySelector("canvas");
    const s = {
      root, canvas, ctx: canvas.getContext("2d"), still, lit: !!opts.lit,
      w: 0, h: 0, dpr: 1, last: performance.now(), raf: 0, done: null,
      trail: [], sparks: [], partAt: 0, blown: false, spinFrom: 0,
      coals: Array.from({ length: 14 }, () => ({ dx: Math.random() * 2 - 1, dy: Math.random() * 0.9 + 0.1, r: 1 + Math.random() * 2.2, speed: 300 + Math.random() * 500, phase: Math.random() * 6 })),
    };
    state = s;
    const size = () => {
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = window.innerWidth; s.h = window.innerHeight;
      canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr);
      paintHearth(s);
      s.trail = [];
    };
    size();
    s.onResize = size;
    window.addEventListener("resize", size);
    if (still) {
      s.ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      s.ctx.drawImage(s.hearth, 0, 0, s.w, s.h);
      return;
    }
    s.raf = requestAnimationFrame(frame);
  }

  /** The ball spirals in and bursts. Resolves once it is gone; the caller removes the element. */
  function part() {
    const s = state;
    if (!s) return Promise.resolve();
    if (s.still) {
      s.root.style.transition = "opacity .35s linear";
      s.root.style.opacity = "0";
      return new Promise((r) => setTimeout(() => { state = null; r(); }, 380));
    }
    if (s.partAt) return new Promise((r) => { const prev = s.done; s.done = () => { prev && prev(); r(); }; });
    s.spinFrom = onCircle(s).a;
    s.partAt = performance.now();
    return new Promise((r) => { s.done = r; });
  }

  window.HearthFire = { light, part, RISE_MS };
})();
