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
 * writes it from gen_icon.py). The fire is drawn the way the icon draws fire —
 * flat bands of its own colours, deep red to a pale-gold heart — but it is one
 * body, not shapes: a field of heat, hottest where it burns, with turbulence
 * rising through it, and each colour is where that field passes a level. So
 * tongues rise out of the mass, pinch off and go, and the bands run together
 * the way a fire's do; nothing in it is a piece that can be told apart.
 *
 * It starts on the logs, in front of everything, and only ever grows: up out
 * of the mouth of the hearth, over the stone, and out and down until it is the
 * whole screen. There is one fire, so nothing passes from behind the stone to
 * in front of it.
 *
 * And then it parts, the way water would: an opening wells up in the middle of
 * the flames — a rippling oval with a thick rim, each colour drawn back by its
 * own amount so the rim is layered — and spreads, taller and wider, throwing
 * drops of flame off its edge, until the fire has drawn away to the sides of
 * the screen. The app is in the opening.
 *
 * Drawn on the GPU (WebGL), because the field is worked out for every pixel.
 * Where there is no WebGL the hearth is shown as it is, and fades when it parts.
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

  // The icon's fire, outermost first. Where each colour begins: the rim at the edge; the next three that
  // many band-widths in from it; the pale heart where the heat passes a level.
  const COLOURS = ["#7a2410", "#c9471a", "#f0862b", "#ffc14c", "#fff0be"];
  const LEVELS = [0, 1, 2, 3.4, 0.78];
  // And deep in the body, how hot it must be for each: so where the fire is broad, its cooler parts are orange.
  const DEEP = [0, 0.04, 0.12, 0.24, 0];

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  // Easing for the rise itself: gentle at both ends.
  const glide = (t) => (1 - Math.cos(Math.PI * t)) / 2;
  // From a to b by the same proportion each step: a fire growing at a steady rate.
  const grow = (a, b, k) => a * Math.pow(b / a, k);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  const VERT = `attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;
  const FRAG = (deriv) => `${deriv ? "#extension GL_OES_standard_derivatives : enable\n" : ""}
precision highp float;
uniform vec2 uRes;          // the canvas, in its own pixels
uniform float uT;
uniform vec2 uSrc;          // where the fire burns from
uniform vec3 uR;            // how far it reaches: to the sides, up, and down
uniform float uFill;        // at the end, heat everywhere, so the screen is fire edge to edge
uniform vec2 uScale;        // the size of its turbulence: fine, and broad
uniform float uBroad;       // how much of the broad there is
uniform vec4 uOpen;         // the opening: centre, and radii
uniform float uRim;
uniform float uBand;        // how thick each outer colour is, in pixels: the rim and the bands inside it
uniform vec3 uC[5];
uniform float uL[5];
uniform float uD[5];        // how hot it must be, deep in the body, for each colour

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Two octaves, not more: a flame's edge is round lobes and long waves, not crinkle.
float fbm(vec2 p) { return noise(p) * 0.68 + noise(p * 2.03 + 7.1) * 0.32; }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 d = p - uSrc;
  float up = max(0.0, -d.y), dn = max(0.0, d.y);
  // The body: hottest where it burns, reaching further up than out, and least down.
  float base = 1.0 - length(vec2(d.x / uR.x, up / uR.y + dn / uR.z));
  // Turbulence rising through it, stretched upward, and stirred by a slower turbulence of its own — so
  // tongues lift out of the body, lean, pinch off and go.
  vec2 qf = vec2(d.x / uScale.x, d.y / (uScale.x * 1.7));
  vec2 qb = vec2(d.x / uScale.y, d.y / (uScale.y * 1.5));
  float stir = fbm(qb * 0.6 + vec2(0.0, uT * 0.35));
  float fine = fbm(qf + vec2((stir - 0.5) * 1.6, uT * 2.1));
  float broad = fbm(qb + vec2((stir - 0.5) * 1.2, uT * 1.15));
  float n = mix(fine, broad, uBroad);
  float rise = clamp(up / uR.y, 0.0, 1.4);
  float f = base + (n - 0.5) * (0.4 + 1.15 * rise) + uFill;
  float aa = ${deriv ? "max(fwidth(f) * 0.8, 0.0015)" : "0.006"};
  // How far in from the fire's edge this pixel is: the outer colours are insets of the one outline, a thin
  // rim and a band or two inside it, the way a drawn flame's are; past them it is yellow, and where it is
  // hottest, the pale heart.
  ${deriv ? "float inset = f / max(length(vec2(dFdx(f), dFdy(f))), 1e-4);" : "float inset = f / 0.004;"}

  // The opening, rippling; each colour drawn back from it by its own amount, the brightest most.
  vec2 e = p - uOpen.xy;
  float ang = atan(e.y, e.x);
  float ripple = 1.0 + 0.07 * sin(ang * 5.0 + uT * 6.5) + 0.035 * sin(ang * 11.0 - uT * 9.5) + 0.02 * sin(ang * 17.0 + uT * 13.0);

  vec3 col = uC[0];
  float alpha = 0.0;
  for (int i = 0; i < 5; i++) {
    float on;
    if (i == 0) on = smoothstep(-aa, aa, f);
    // A band-width in from the edge, and — inside the body, where the edge is far — hot enough: so the
    // cooler reaches of a fire that fills the screen still show as orange tongues running up through it.
    else if (i < 4) on = max(smoothstep(uBand * uL[i] - 0.8, uBand * uL[i] + 0.8, inset), smoothstep(0.3, 0.34, f))
      * smoothstep(uD[i] - aa, uD[i] + aa, f);
    else on = smoothstep(uL[4] - aa, uL[4] + aa, f);
    if (uOpen.z > 0.0) {
      float g = float(i) * uRim;
      float k = length(vec2(e.x / ((uOpen.z + g) * ripple), e.y / ((uOpen.w + g * 1.6) * ripple)));
      on *= smoothstep(1.0 - 1.5 / (uOpen.z + g), 1.0 + 1.5 / (uOpen.z + g), k);
    }
    if (i == 0) alpha = on; else col = mix(col, uC[i], on);
  }
  gl_FragColor = vec4(col * alpha, alpha);
}`;

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
#boot.hf.parting .hf-room, #boot.hf.parting .hf-hearth, #boot.hf.parting .hf-light { display: none; }
`;

  let state = null;

  /** The GPU side: the field, compiled once. Null where there is no WebGL. */
  function fieldOn(canvas) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return null;
    const deriv = !!gl.getExtension("OES_standard_derivatives");
    const shader = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG(deriv));
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const u = {};
    for (const n of ["uRes", "uT", "uSrc", "uR", "uFill", "uScale", "uBroad", "uOpen", "uRim", "uBand", "uC", "uL", "uD"]) u[n] = gl.getUniformLocation(prog, n);
    gl.uniform3fv(u.uC, new Float32Array(COLOURS.flatMap(rgb)));
    gl.uniform1fv(u.uL, new Float32Array(LEVELS));
    gl.uniform1fv(u.uD, new Float32Array(DEEP));
    return { gl, u };
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
    // The fire is in front of the hearth from the first: it starts on the logs. Embers and the drops thrown
    // off the opening are drawn over it.
    root.innerHTML = `<div class="hf-room"></div>
      <svg class="hf-hearth" viewBox="14 16 80 74" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${HEARTH}</svg>
      <canvas class="hf-fire hf-field"></canvas><canvas class="hf-fire hf-sparks"></canvas><div class="hf-light"></div>`;
    const svg = root.querySelector(".hf-hearth");
    const field = root.querySelector(".hf-field");
    const sparks = root.querySelector(".hf-sparks");
    const s = {
      root, svg, field, gpu: fieldOn(field), sparks, ctx: sparks.getContext("2d"), still,
      unit: 4, archTop: 0, mouth: 50,
      start: performance.now() - (opts.lit ? RISE_MS : 0),
      split: 0, splitStart: 0, last: performance.now(), raf: 0, done: null,
      licks: [], embers: [], w: 0, h: 0, dpr: 1, gdpr: 1, grate: { x: 0, y: 0, half: 10, open: 40 }, hearthBottom: 0,
    };
    state = s;
    const size = () => {
      s.dpr = Math.min(window.devicePixelRatio || 1, 2);
      // The field is smooth bands; it needs fewer pixels than the sparks, and the phone's GPU thanks it.
      s.gdpr = Math.min(window.devicePixelRatio || 1, 1.5);
      s.w = window.innerWidth; s.h = window.innerHeight;
      sparks.width = Math.round(s.w * s.dpr); sparks.height = Math.round(s.h * s.dpr);
      field.width = Math.round(s.w * s.gdpr); field.height = Math.round(s.h * s.gdpr);
      if (s.gpu) s.gpu.gl.viewport(0, 0, field.width, field.height);
      const m = svg.getScreenCTM();
      if (m) {
        const pt = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; return p.matrixTransform(m); };
        const at = pt(GRATE.x, GRATE.y), edge = pt(GRATE.x + GRATE.half, GRATE.y), top = pt(GRATE.x, GRATE.top);
        s.grate = { x: at.x, y: at.y, half: Math.max(8, edge.x - at.x), open: Math.max(20, at.y - top.y) };
        s.hearthBottom = pt(GRATE.x, 84).y;
        // The mouth of the firebox: its arch, in screen pixels — 14 units either side of the middle, its
        // crown 50 units down.
        s.unit = pt(1, 0).x - pt(0, 0).x;
        s.archTop = pt(GRATE.x, 50).y;
        s.mouth = 14 * s.unit;
      } else {
        s.grate = { x: s.w / 2, y: s.h * 0.8, half: s.w * 0.07, open: s.h * 0.1 };
        s.hearthBottom = s.h * 0.9;
        s.archTop = s.grate.y - s.grate.open;
        s.mouth = s.grate.half * 1.3;
      }
    };
    size();
    s.onResize = size;
    window.addEventListener("resize", size);
    if (still || !s.gpu) { draw(s, 0.25, performance.now() / 1000, 0); return; }
    s.raf = requestAnimationFrame(frame);
  }

  /** How big the fire is at a given heat, in screen pixels: where it burns from, and how far it reaches. */
  function reach(s, heat) {
    const { w, h, grate } = s;
    const u0 = s.unit || 4, mouth = s.mouth;
    const inBox = Math.max(10, grate.y - s.archTop);
    return {
      x: grate.x, y: grate.y + u0,
      // Up before out, and out before down: a fire climbs, spreads, and last spills.
      rx: grow(mouth * 0.6, Math.max(w * 0.95, h * 0.5), Math.pow(heat, 1.3)),
      ry: grow(inBox * 1.1, h * 1.08, Math.pow(heat, 0.8)),
      rd: grow(u0 * 2.5, h * 1.3, Math.pow(heat, 1.4)),
      fill: smooth(0.7, 1, heat) * 0.16,
    };
  }

  /** One frame of the fire, at a given heat and parting. */
  function draw(s, heat, t, split) {
    const { ctx, w, h, dpr, gpu } = s;
    const r = reach(s, heat);
    // The opening: an oval welling up in the middle of the fire, taller than it is wide. It spreads until it is
    // past every edge of the screen.
    const cx = r.x, cy = h * 0.52;
    const rx = Math.pow(split, 1.25) * w * 0.85;
    const ry = Math.min(h * 1.4, rx * 2.3 + split * h * 0.15);
    const rim = Math.min(1, split * 5) * Math.max(5, Math.min(w, h) * 0.022);
    if (gpu) {
      const { gl, u } = gpu, k = s.gdpr;
      gl.uniform2f(u.uRes, s.field.width, s.field.height);
      gl.uniform1f(u.uT, t % 1000);
      gl.uniform2f(u.uSrc, r.x * k, r.y * k);
      gl.uniform3f(u.uR, r.rx * k, r.ry * k, r.rd * k);
      gl.uniform1f(u.uFill, r.fill);
      // Its turbulence: fine while it is in the hearth, broad as it takes the room.
      gl.uniform2f(u.uScale, s.mouth * 0.55 * k, Math.min(w, h) * 0.34 * k);
      gl.uniform1f(u.uBroad, smooth(0.2, 0.85, heat) * 0.85);
      gl.uniform4f(u.uOpen, cx * k, cy * k, rx * k, ry * k);
      gl.uniform1f(u.uRim, rim * k);
      // Bands that thicken a little as the fire grows, as a bigger drawing's outline would.
      gl.uniform1f(u.uBand, clamp(r.rx * 0.035, 3, Math.min(w, h) * 0.035) * k);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Drops thrown off the opening's rim as it spreads; embers going up.
    for (const k of s.licks) {
      const f = k.age / k.life, rr = k.size * (1 - f * 0.7);
      ctx.fillStyle = COLOURS[k.layer];
      ctx.globalAlpha = 1 - f * f;
      ctx.beginPath();
      const x = k.x, y = k.y;
      ctx.moveTo(x, y - 2.1 * rr);
      ctx.bezierCurveTo(x + 0.35 * rr, y - 1.15 * rr, x + rr, y - 0.5 * rr, x + rr, y + 0.15 * rr);
      ctx.bezierCurveTo(x + rr, y + 0.75 * rr, x + 0.5 * rr, y + rr, x, y + rr);
      ctx.bezierCurveTo(x - 0.5 * rr, y + rr, x - rr, y + 0.75 * rr, x - rr, y + 0.15 * rr);
      ctx.bezierCurveTo(x - rr, y - 0.5 * rr, x - 0.35 * rr, y - 1.15 * rr, x, y - 2.1 * rr);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ffe3a0";
    for (const e of s.embers) {
      const f = e.age / e.life, rr = e.size * (1 - f);
      ctx.globalAlpha = 1 - f * 0.6;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - rr); ctx.lineTo(e.x + rr * 0.7, e.y); ctx.lineTo(e.x, e.y + rr); ctx.lineTo(e.x - rr * 0.7, e.y);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return { r, cx, cy, rx, ry };
  }

  function frame(now) {
    const s = state;
    if (!s) return;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    const t = now / 1000;
    const heat = glide(clamp((now - s.start) / RISE_MS, 0, 1));
    if (s.splitStart) s.split = ease(clamp((now - s.splitStart) / PART_MS, 0, 1));
    s.root.style.setProperty("--heat", heat.toFixed(3));
    // The hearth goes as the fire takes it, not before and not after.
    const gone = smooth(0.45, 0.75, heat);
    s.svg.style.opacity = String(1 - gone);
    const g = draw(s, heat, t, s.split);

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
    // Embers off the top of the fire.
    if (!s.splitStart && Math.random() < (1 + heat * 8) * dt) {
      const x = g.r.x + (Math.random() - 0.5) * g.r.rx * 0.9;
      s.embers.push({ x, y: Math.max(s.h * 0.05, g.r.y - g.r.ry * lerp(0.55, 0.95, Math.random())),
        vx: (Math.random() - 0.5) * 30, vy: -lerp(50, 200, Math.random()) * lerp(1, 2, heat), size: lerp(1.5, 3.2, Math.random()),
        age: 0, life: lerp(1, 2.4, Math.random()), seed: Math.random() * 9 });
    }
    s.licks = s.licks.filter((k) => { k.age += dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vy *= 1 - 0.4 * dt; return k.age < k.life; });
    s.embers = s.embers.filter((e) => { e.age += dt; e.vx += Math.sin(t * 3 + e.seed) * 40 * dt; e.x += e.vx * dt; e.y += e.vy * dt; return e.age < e.life; });

    // Done when the opening is past every edge and the last drops thrown off it have gone — not later,
    // with a few of them hanging over the app.
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
    if (s.still || !s.gpu) {
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
