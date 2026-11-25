/*
 * The hearth, from inside — what sits over Hearth while it loads.
 *
 * You are in the firebox, looking at its back: a wall of weathered stone, fitted the way a mason lays it — courses
 * of mixed sizes, worn corners, moss in the joints and on the damp stones low down and at the sides, soot over the
 * top and the middle — the side walls running in to it, and an arch of worn blocks round the edge of the screen. On
 * the floor, a woodpile, four, three and two, its ringed ends toward you, cracks glowing through the bark over a bed
 * of embers that breathes. A fireball circles in the middle, drawn the way a cartoon one is — flat bands of red,
 * orange, yellow and a pale core, a tail of flickering tongues streaming behind it, flakes of flame thrown off — and
 * lights the stone as it passes. When Hearth is ready it spirals in, quicker and brighter, and bursts: its bands
 * thrown out as rings, a burning edge that clears the hearth away from the middle out, embers flying, and the app
 * is there behind it.
 *
 * One file for both places it is drawn: the app's own loading screen (public/index.html) and the phone's
 * boot.html, shown out of the APK while the server wakes. The phone draws first and hands over with #lit; the
 * ball's place on its circle is worked out from the clock, not from when each page started, so the app's copy
 * picks it up exactly where the phone's left it.
 *
 * Canvas 2D: no WebGL, nothing a phone's GPU can refuse. The hearth is drawn once per size and kept; each frame
 * is that picture, the light on it, the embers, the fireball and its flakes. With reduced motion asked for, the
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

  /** A closed shape through points, its corners rounded: a stone's outline. */
  function rounded(g, pts) {
    const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    g.beginPath();
    const m0 = mid(pts[n - 1], pts[0]);
    g.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) { const m = mid(pts[i], pts[(i + 1) % n]); g.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
    g.closePath();
  }

  /**
   * One stone, filling its place in the wall: a block with straight-ish sides and worn, rounded corners — not an
   * oval — a flat face with the grain of the rock in it, lit along its top edge and shadowed along its bottom, as a
   * dressed stone set in mortar is. Moss where `moss` says the wall is damp, gathered on its top edge.
   */
  /**
   * A block's outline from its four corners: each corner cut back by wear, each side with a bend or two in it.
   * Rounded through, it is a stone with straight-ish sides and worn corners. (Four points alone round to an oval.)
   */
  function worn(rnd, corners, size) {
    const j = size * 0.08, c = size * (0.12 + rnd() * 0.1);
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const p0 = corners[i], p1 = corners[(i + 1) % 4];
      const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, ux = (p1[0] - p0[0]) / d, uy = (p1[1] - p0[1]) / d, cut = Math.min(c, d * 0.3);
      pts.push([p0[0] + ux * cut, p0[1] + uy * cut]);
      for (const t of [0.3, 0.7]) pts.push([lerp(p0[0], p1[0], t) + (rnd() - 0.5) * j, lerp(p0[1], p1[1], t) + (rnd() - 0.5) * j]);
      pts.push([p1[0] - ux * cut, p1[1] - uy * cut]);
    }
    return pts;
  }

  function stone(g, rnd, x, y, sw, sh, moss, tint = 1, shape = null) {
    const j = Math.min(sw, sh) * 0.08;                       // how far a corner wanders
    const pts = shape ?? worn(rnd, [[x + rnd() * j, y + rnd() * j], [x + sw - rnd() * j, y + rnd() * j], [x + sw - rnd() * j, y + sh - rnd() * j], [x + rnd() * j, y + sh - rnd() * j]], Math.min(sw, sh));
    const l = (58 + rnd() * 40) * tint, warm = (rnd() - 0.3) * 10, green = rnd() * 6;
    rounded(g, pts);
    g.fillStyle = `rgb(${l + warm | 0},${l + green | 0},${l - 4 | 0})`; g.fill();
    g.save(); g.clip();
    // The face: the rock's grain in soft blotches, lighter and darker.
    for (let i = 0; i < 5; i++) {
      const bx = x + rnd() * sw, by = y + rnd() * sh, br = Math.max(sw, sh) * (0.2 + rnd() * 0.3);
      const blot = g.createRadialGradient(bx, by, 0, bx, by, br);
      const lighter = rnd() < 0.5;
      blot.addColorStop(0, lighter ? "rgba(255,250,240,0.09)" : "rgba(0,0,0,0.14)"); blot.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = blot; g.fillRect(bx - br, by - br, br * 2, br * 2);
    }
    // Pitted.
    for (let i = 0; i < (sw * sh) / 120; i++) {
      g.fillStyle = rnd() < 0.55 ? "rgba(0,0,0,0.2)" : "rgba(255,245,230,0.08)";
      g.fillRect(x + rnd() * sw, y + rnd() * sh, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    // Lit along the top, in shadow along the bottom: a face set slightly proud of the mortar.
    const bevel = g.createLinearGradient(0, y, 0, y + sh);
    bevel.addColorStop(0, "rgba(255,245,225,0.16)"); bevel.addColorStop(0.18, "rgba(255,245,225,0)"); bevel.addColorStop(0.75, "rgba(0,0,0,0)"); bevel.addColorStop(1, "rgba(0,0,0,0.42)");
    g.fillStyle = bevel; g.fillRect(x, y, sw, sh);
    // Moss along the top edge, creeping down the face the damper the wall.
    if (moss > 0.15 && rnd() < moss * 1.4) {
      const col = [[62, 80, 34], [78, 96, 40], [54, 70, 30], [92, 108, 48]][(rnd() * 4) | 0];
      const deep = sh * (0.18 + moss * 0.5);
      const m = g.createLinearGradient(0, y, 0, y + deep);
      m.addColorStop(0, `rgba(${col},${0.55 + moss * 0.35})`); m.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = m;
      g.beginPath();
      const from = x + rnd() * sw * 0.4, to = x + sw * (0.6 + rnd() * 0.4);
      g.moveTo(from, y - 2);
      for (let mx = from; mx <= to; mx += Math.max(3, sw * 0.08)) g.lineTo(mx, y + deep * (0.4 + rnd() * 0.6));
      g.lineTo(to, y - 2); g.closePath(); g.fill();
      for (let i = 0; i < 6 + moss * 10; i++) {
        g.fillStyle = `rgba(${col[0] + 34},${col[1] + 38},${col[2] + 12},${0.35 + rnd() * 0.35})`;
        g.beginPath(); g.arc(lerp(from, to, rnd()), y + rnd() * deep * 0.6, 0.8 + rnd() * 1.6, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    rounded(g, pts); g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 1.2; g.stroke();
  }

  /**
   * A stretch of stone wall, packed the way a mason lays one: courses of different heights, stones of different
   * lengths along each, and here and there a place filled with two smaller stones instead of one big one. The
   * joints are narrow and dark, with moss in them where it is damp.
   */
  function cobbles(g, rnd, x0, y0, x1, y1, size, squash, mossAt) {
    const gap = Math.max(2, size * 0.05);
    g.fillStyle = "#120d09"; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // Moss in the joints, before the stones go over them.
    for (let i = 0; i < ((x1 - x0) * (y1 - y0)) / (size * size) * 6; i++) {
      const x = lerp(x0, x1, rnd()), y = lerp(y0, y1, rnd()), m = mossAt(x, y);
      if (rnd() > m) continue;
      g.fillStyle = `rgba(${60 + rnd() * 30 | 0},${82 + rnd() * 30 | 0},${34 + rnd() * 12 | 0},${0.35 + rnd() * 0.4})`;
      g.fillRect(x, y, size * 0.14, size * 0.14);
    }
    for (let y = y1; y > y0 - size; ) {
      const ch = size * (0.55 + rnd() * 0.6);
      let x = x0 - rnd() * size * squash;
      while (x < x1) {
        const cw = size * squash * (0.7 + rnd() * 1.3);
        const r = rnd(), cy = y - ch;
        if (r < 0.16 && ch > size * 0.75) {
          // Two smaller stones, one above the other.
          const split = ch * (0.4 + rnd() * 0.2);
          stone(g, rnd, x + gap / 2, cy + gap / 2, cw - gap, split - gap, mossAt(x, cy));
          stone(g, rnd, x + gap / 2, cy + split + gap / 2, cw - gap, ch - split - gap, mossAt(x, cy + split));
        } else if (r < 0.3 && cw > size * squash * 1.2) {
          // Two side by side.
          const split = cw * (0.35 + rnd() * 0.3);
          stone(g, rnd, x + gap / 2, cy + gap / 2, split - gap, ch - gap, mossAt(x, cy));
          stone(g, rnd, x + split + gap / 2, cy + gap / 2, cw - split - gap, ch - gap, mossAt(x + split, cy));
        } else {
          stone(g, rnd, x + gap / 2, cy + gap / 2, cw - gap, ch - gap, mossAt(x, cy));
        }
        x += cw;
      }
      y -= ch;
    }
  }

  /** The hearth itself, drawn once for this size of screen. */
  function paintHearth(s) {
    const { w, h, dpr } = s;
    const c = document.createElement("canvas");
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    const rnd = seeded(1971);

    const back = { l: w * 0.15, r: w * 0.85, floor: h * 0.72 };
    const vp = { x: w / 2, y: h * 0.5 };
    const logsY = back.floor + (h - back.floor) * 0.26;
    s.layout = { back, vp, ball: { x: w / 2, y: h * 0.33, r: Math.min(w * 0.25, h * 0.15) }, logs: { x: w / 2, y: logsY } };
    const size = clamp(Math.min(w, h) * 0.09, 30, 70);

    g.fillStyle = "#0b0705";
    g.fillRect(0, 0, w, h);

    // How damp the stone is, and so how mossy: more low down and toward the sides; none where the fire has been.
    const mossAt = (x, y) => {
      const low = y / h, side = Math.abs(x - w / 2) / (w / 2);
      const burnt = Math.max(0, 1 - Math.hypot((x - w / 2) / (w * 0.28), (y - back.floor) / (h * 0.32)));
      return clamp(0.05 + low * 0.45 + side * 0.45 - burnt * 0.9, 0, 1);
    };

    // The back wall.
    g.save(); g.beginPath(); g.rect(back.l, 0, back.r - back.l, back.floor); g.clip();
    cobbles(g, rnd, back.l, 0, back.r, back.floor, size, 1, mossAt);
    // Soot: thick at the top where the smoke goes up, and black right through where the fire stands.
    const soot = g.createLinearGradient(0, 0, 0, back.floor);
    soot.addColorStop(0, "rgba(4,2,1,0.94)"); soot.addColorStop(0.45, "rgba(5,3,2,0.66)"); soot.addColorStop(1, "rgba(8,4,2,0.3)");
    g.fillStyle = soot; g.fillRect(back.l, 0, back.r - back.l, back.floor);
    const scorch = g.createRadialGradient(w / 2, back.floor, 0, w / 2, back.floor, (back.r - back.l) * 0.5);
    scorch.addColorStop(0, "rgba(2,1,0,0.7)"); scorch.addColorStop(1, "rgba(2,1,0,0)");
    g.fillStyle = scorch; g.fillRect(back.l, 0, back.r - back.l, back.floor);
    g.restore();

    // The side walls, running in: the same stone, narrowed by the angle, darker for facing away from the fire.
    const side = (edgeX, wallX) => {
      g.save();
      g.beginPath(); g.moveTo(wallX, 0); g.lineTo(wallX, back.floor); g.lineTo(edgeX, h); g.lineTo(edgeX, 0); g.closePath(); g.clip();
      cobbles(g, rnd, Math.min(edgeX, wallX), 0, Math.max(edgeX, wallX), h, size * 1.15, 0.5, mossAt);
      const shade = g.createLinearGradient(edgeX, 0, wallX, 0);
      shade.addColorStop(0, "rgba(3,2,1,0.82)"); shade.addColorStop(1, "rgba(3,2,1,0.45)");
      g.fillStyle = shade; g.fillRect(0, 0, w, h);
      const top = g.createLinearGradient(0, 0, 0, h);
      top.addColorStop(0, "rgba(3,2,1,0.75)"); top.addColorStop(0.6, "rgba(3,2,1,0)");
      g.fillStyle = top; g.fillRect(0, 0, w, h);
      g.restore();
    };
    side(0, back.l);
    side(w, back.r);
    // The corners, where the walls meet: a line of shadow.
    g.strokeStyle = "rgba(0,0,0,0.6)"; g.lineWidth = 3;
    for (const x of [back.l, back.r]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, back.floor); g.stroke(); }

    // The floor: hearthstones under ash, warmest under the logs.
    g.save();
    g.beginPath(); g.moveTo(back.l, back.floor); g.lineTo(back.r, back.floor); g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.clip();
    const ash = g.createLinearGradient(0, back.floor, 0, h);
    ash.addColorStop(0, "#2b221b"); ash.addColorStop(1, "#16110d");
    g.fillStyle = ash; g.fillRect(0, back.floor, w, h - back.floor);
    for (let i = 0; i < 320; i++) {
      const t = rnd(), y = lerp(back.floor, h, t), half = lerp((back.r - back.l) / 2, w / 2, t);
      const x = w / 2 + (rnd() * 2 - 1) * half, r = lerp(0.6, 2.4, t) * (0.5 + rnd());
      g.fillStyle = `rgba(${140 + rnd() * 60 | 0},${125 + rnd() * 40 | 0},${110 + rnd() * 30 | 0},${0.06 + rnd() * 0.12})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.restore();

    // The logs: a woodpile, not yet burning, stacked four, three and two with their sawn ends toward you, each
    // running back into the hearth. Some are split, and show a wedge. Drawn as the references are: bark in bands,
    // pale end grain with its rings, the grain in strokes.
    const R = clamp((back.r - back.l) * 0.105, 18, 58);
    const span = R * 8.4, thick = R * 2;
    const BARK = [["#7a5636", "#5c3f27", "#2e1e12"], ["#6e5a3e", "#54442e", "#2a2116"], ["#80603f", "#644a30", "#33261a"], ["#5f4a36", "#4a3a2a", "#241c14"], ["#6b5a44", "#52452f", "#292116"]];
    // Back into the hearth: toward the vanishing point, foreshortened.
    const depth = (x, y) => { const dx = (vp.x - x) * 0.25, dy = -R * 3, d = Math.hypot(dx, dy) || 1; return [dx / d, dy / d]; };
    const endFace = (x, y, r, split, turn) => {
      const face = g.createRadialGradient(x - r * 0.25, y - r * 0.3, 0, x, y, r);
      face.addColorStop(0, "#d6aa70"); face.addColorStop(0.75, "#b4834e"); face.addColorStop(1, "#86592f");
      g.fillStyle = face;
      g.beginPath();
      if (split) { g.moveTo(x + Math.cos(turn) * r * 0.15, y + Math.sin(turn) * r * 0.15); g.arc(x, y, r, turn + 0.5, turn + Math.PI * 1.25); g.closePath(); }
      else g.ellipse(x, y, r, r * 0.96, 0, 0, Math.PI * 2);
      g.fill();
      g.save(); g.clip();
      // The rings, round the heart of the wood, not quite in the middle.
      const hx = x + (split ? Math.cos(turn) * r * 0.15 : (rnd() - 0.5) * r * 0.2), hy = y + (split ? Math.sin(turn) * r * 0.15 : (rnd() - 0.5) * r * 0.2);
      g.strokeStyle = "rgba(110,70,32,0.55)"; g.lineWidth = Math.max(1, r * 0.035);
      for (const k of [0.18, 0.36, 0.55, 0.74, 0.9]) { g.beginPath(); g.ellipse(hx, hy, r * k, r * k * 0.95, 0, 0, Math.PI * 2); g.stroke(); }
      // A check from the heart: the crack sawn ends get as they dry.
      g.strokeStyle = "rgba(60,36,16,0.8)"; g.lineWidth = Math.max(1.2, r * 0.07);
      const ca = rnd() * Math.PI * 2;
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(ca) * r * 0.85, hy + Math.sin(ca) * r * 0.85); g.stroke();
      g.restore();
      // The bark round the edge of the cut.
      g.strokeStyle = "#2a1a0e"; g.lineWidth = Math.max(2, r * 0.12);
      g.beginPath();
      if (split) g.arc(x, y, r, turn + 0.5, turn + Math.PI * 1.25); else g.ellipse(x, y, r, r * 0.96, 0, 0, Math.PI * 2);
      g.stroke();
    };
    const log = (x, y, r, split) => {
      const [hi, mid, lo] = BARK[(rnd() * BARK.length) | 0];
      const [dx, dy] = depth(x, y), run = r * (0.75 + rnd() * 0.35), bx = x + dx * run, by = y + dy * run, br = r * 0.88;
      const nx = -dy, ny = dx;
      // The length of it, going back: bark, lit along its top.
      const side = g.createLinearGradient(x - nx * r, y - ny * r, x + nx * r, y + ny * r);
      side.addColorStop(0, ny < 0 ? lo : hi); side.addColorStop(0.45, mid); side.addColorStop(1, ny < 0 ? hi : lo);
      g.fillStyle = side;
      g.beginPath();
      g.moveTo(x + nx * r, y + ny * r); g.lineTo(bx + nx * br, by + ny * br);
      g.arc(bx, by, br, Math.atan2(ny, nx), Math.atan2(-ny, -nx), dx * ny - dy * nx > 0);
      g.lineTo(x - nx * r, y - ny * r); g.closePath();
      g.fill();
      // The grain along the bark.
      g.strokeStyle = "rgba(20,12,6,0.5)"; g.lineWidth = Math.max(1, r * 0.06); g.lineCap = "round";
      for (let i = 0; i < 4; i++) {
        const k = (rnd() * 2 - 1) * 0.8;
        g.beginPath(); g.moveTo(x + nx * r * k + dx * r * 0.3, y + ny * r * k + dy * r * 0.3); g.lineTo(bx + nx * br * k * (0.9 + rnd() * 0.2), by + ny * br * k); g.stroke();
      }
      // Cracks glowing through the bark, low on the side, where the heat comes from below.
      g.lineCap = "round";
      for (let i = 0; i < 2; i++) {
        const k = 0.35 + rnd() * 0.5, sx = x + nx * r * k * (ny < 0 ? -1 : 1) + dx * r * 0.4, sy = y + ny * r * k * (ny < 0 ? -1 : 1) + dy * r * 0.4;
        g.strokeStyle = `rgba(255,${90 + rnd() * 70 | 0},30,${0.55 + rnd() * 0.3})`; g.lineWidth = Math.max(1.2, r * (0.06 + rnd() * 0.05));
        g.beginPath(); g.moveTo(sx, sy);
        for (let j = 1; j <= 4; j++) g.lineTo(sx + dx * run * 0.15 * j + (rnd() - 0.5) * r * 0.2, sy + dy * run * 0.15 * j + (rnd() - 0.5) * r * 0.2);
        g.stroke();
      }
      endFace(x, y, r, split, rnd() * Math.PI * 2);
      // Some ends are burning through: a hot ring under the bark, and the check in the middle glowing.
      if (rnd() < 0.45) {
        g.strokeStyle = "rgba(255,110,35,0.55)"; g.lineWidth = Math.max(1.5, r * 0.08);
        g.beginPath(); g.arc(x, y, r * 0.88, Math.PI * (0.1 + rnd() * 0.3), Math.PI * (0.8 + rnd() * 0.4)); g.stroke();
        g.strokeStyle = "rgba(255,170,60,0.7)"; g.lineWidth = Math.max(1, r * 0.05);
        const ca = rnd() * Math.PI * 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ca) * r * 0.6, y + Math.sin(ca) * r * 0.6); g.stroke();
      }
    };
    // The bed of embers under the pile, glowing up between the logs.
    const bedY = logsY + R * 2.2;
    const bed = g.createRadialGradient(w / 2, bedY, 0, w / 2, bedY, R * 6);
    bed.addColorStop(0, "rgba(255,110,30,0.55)"); bed.addColorStop(0.45, "rgba(180,50,10,0.3)"); bed.addColorStop(1, "rgba(80,20,5,0)");
    g.fillStyle = bed; g.fillRect(0, back.floor, w, h - back.floor);
    for (let i = 0; i < 90; i++) {
      const x = w / 2 + (rnd() * 2 - 1) * R * 5, y = bedY + (rnd() - 0.3) * R * 1.2;
      g.fillStyle = `rgba(255,${70 + rnd() * 110 | 0},${15 + rnd() * 30 | 0},${0.35 + rnd() * 0.5})`;
      g.beginPath(); g.ellipse(x, y, R * (0.08 + rnd() * 0.16), R * (0.05 + rnd() * 0.09), rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    // The pile: four on the floor, three in the hollows above them, two on top. Laid down top first, so the
    // logs below and in front cover the ones resting on them.
    const baseY = logsY + R * 1.6, rowH = R * 1.62;
    const rows = [[2, 2], [1, 3], [0, 4]];
    for (const [k, n] of rows) {
      for (let i = 0; i < n; i++) {
        const x = w / 2 + (i - (n - 1) / 2) * R * 2.04 + (rnd() - 0.5) * R * 0.12;
        log(x, baseY - k * rowH + (rnd() - 0.5) * R * 0.1, R * (0.92 + rnd() * 0.14), rnd() < 0.3);
      }
    }
    s.layout.logs = { x: w / 2, y: bedY, len: span, thick, R };

    // The mouth: an arch of wedge-shaped stones round the edge of the screen, mossy, its inner edge caught by the light.
    const rim = clamp(Math.min(w, h) * 0.06, 22, 54), top = rim + Math.min(w * 0.36, h * 0.2);
    const inner = [];
    const rx = w / 2 - rim, ry = top - rim;
    for (let y = h; y > top; y -= rim * 1.3) inner.push([rim, y]);
    for (let i = 0; i <= 14; i++) { const a = Math.PI + (i / 14) * Math.PI; inner.push([w / 2 + Math.cos(a) * rx, top + Math.sin(a) * ry]); }
    for (let y = top + rim * 1.3; y <= h + rim; y += rim * 1.3) inner.push([w - rim, y]);
    g.save();
    g.beginPath(); g.rect(0, 0, w, h);
    g.moveTo(rim, h); g.lineTo(rim, top); g.ellipse(w / 2, top, rx, ry, 0, Math.PI, Math.PI * 2); g.lineTo(w - rim, h); g.closePath();
    g.fillStyle = "#0b0806"; g.fill("evenodd");
    g.restore();
    for (let i = 0; i < inner.length - 1; i++) {
      const [x0, y0] = inner[i], [x1, y1] = inner[i + 1];
      const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy) || 1;
      // Outward: away from the middle of the opening.
      let nx = -dy / d, ny = dx / d;
      if ((x0 + x1) / 2 + nx * 4 > rim && (x0 + x1) / 2 + nx * 4 < w - rim && (y0 + y1) / 2 + ny * 4 > top - ry) { nx = -nx; ny = -ny; }
      const T = rim * (1.05 + rnd() * 0.25), gap = 1.5;
      const ux = dx / d * gap, uy = dy / d * gap;
      const corners = [[x0 + ux, y0 + uy], [x1 - ux, y1 - uy], [x1 - ux + nx * T, y1 - uy + ny * T], [x0 + ux + nx * T, y0 + uy + ny * T]];
      const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
      const bx = Math.min(...xs), by = Math.min(...ys), cy = (by + Math.max(...ys)) / 2;
      stone(g, rnd, bx, by, Math.max(...xs) - bx, Math.max(...ys) - by, clamp(0.35 + cy / h * 0.5, 0, 1), 0.85, worn(rnd, corners, Math.min(d, T)));
      // Its inner face, where the firelight catches it.
      g.strokeStyle = "rgba(255,160,90,0.18)"; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(corners[0][0], corners[0][1]); g.lineTo(corners[1][0], corners[1][1]); g.stroke();
    }

    s.layout.ball = fitCircle(w, h, rim, top, rx, ry);
    s.hearth = c;
  }

  /**
   * The fireball's circle, fitted inside the arch on this screen: the ball, its whole tail and a margin never cross
   * onto the stones. The tail streams straight back from the ball, so near the edge of a big circle it reaches out
   * past it; the circle (then the ball) is made smaller until nothing touches.
   */
  function fitCircle(w, h, rim, top, rx, ry) {
    const MARGIN = 10;
    // A disc of radius q at (x, y) is inside the opening: clear of both sides, and under the arch's curve.
    const inside = (x, y, q) => {
      if (x - q < rim + MARGIN || x + q > w - rim - MARGIN || y + q > h) return false;
      if (y >= top) return true;
      const ex = rx - q - MARGIN, ey = ry - q - MARGIN;
      if (ex <= 0 || ey <= 0) return false;
      return ((x - w / 2) / ex) ** 2 + ((y - top) / ey) ** 2 <= 1;
    };
    const cx = w / 2, cy = h * 0.33;
    let size = clamp(Math.min(w, h) * 0.095, 30, 66), r = Math.min(w * 0.25, h * 0.15);
    for (let tries = 0; tries < 40; tries++) {
      let ok = true;
      for (let i = 0; i < 72 && ok; i++) {
        const a = (i / 72) * Math.PI * 2, wob = 1.05;
        const x = cx + Math.cos(a) * r * wob, y = cy + Math.sin(a) * r * 0.78 * wob;
        if (!inside(x, y, size * 1.1)) { ok = false; break; }
        // Its tail, trailing back along the circle: wide near the ball, narrowing to the tongues' tips.
        for (const [t, spread] of [[1.2, 1], [2.2, 0.85], [3.1, 0.65], [3.6, 0.35]]) {
          const back = a - (size * t) / Math.max(r, 1);
          if (!inside(cx + Math.cos(back) * r * wob, cy + Math.sin(back) * r * 0.78 * wob, size * spread)) { ok = false; break; }
        }
      }
      if (ok) return { x: cx, y: cy, r, size };
      // Smaller circle first; once it is small, a smaller ball too.
      if (r > size * 1.6) r *= 0.94; else size *= 0.94;
    }
    return { x: cx, y: cy, r, size };
  }

  /** Where the ball is on its circle at a moment, by the clock: the same place on the phone's copy and the app's. */
  function onCircle(s, squeeze = 1) {
    const B = s.layout.ball;
    const a = ((Date.now() % LAP_MS) / LAP_MS) * Math.PI * 2;
    const wob = Math.sin(a * 3) * B.r * 0.05;
    return { x: B.x + Math.cos(a) * (B.r + wob) * squeeze, y: B.y + Math.sin(a) * (B.r * 0.78 + wob) * squeeze, a };
  }

  /**
   * The fireball, drawn the way a cartoon one is: a round head in flat bands — red rim, orange, yellow, a pale core
   * pushed to the front — and a tail of flame streaming back from it in tongues that flicker. `dir` is the way it is
   * going; the tail always points the other way.
   */
  const BANDS = [["#d9381b", 1, 1], ["#f26a1f", 0.84, 0.86], ["#ffa62b", 0.68, 0.7], ["#ffd84d", 0.5, 0.52], ["#fff4cf", 0.3, 0.2]];
  function drawFireball(g, x, y, R, dir, t, heat = 1, bend = 0) {
    const L = R * 3.5;
    // The tail follows the path it came along: a point `d` back and `off` to the side of a straight tail, carried
    // round a curve of radius 1/bend (its centre on the side the sign says) — so on a circle it trails along the
    // circle, not out past it.
    const curve = ([px, py]) => {
      if (px >= 0 || !bend) return [px, py];
      const rho = 1 / Math.abs(bend), sgn = Math.sign(bend), th = -px / rho;
      const cxp = -rho * Math.sin(th), cyp = sgn * rho * (1 - Math.cos(th));
      return [cxp + py * sgn * Math.sin(th), cyp + py * Math.cos(th)];
    };
    // The glow round it, first, under everything.
    const halo = g.createRadialGradient(x, y, R * 0.5, x, y, R * 3.6);
    halo.addColorStop(0, `rgba(255,150,50,${0.45 * heat})`); halo.addColorStop(0.45, `rgba(255,90,25,${0.16 * heat})`); halo.addColorStop(1, "rgba(255,70,20,0)");
    g.globalCompositeOperation = "lighter";
    g.fillStyle = halo; g.beginPath(); g.arc(x, y, R * 3.6, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
    g.save(); g.translate(x, y); g.rotate(dir);
    BANDS.forEach(([colour, k, tail], i) => {
      const r = R * k, len = L * tail, ph = t * 11 + i * 0.7;
      const pts = [];
      // The head: the front half of a circle, a little longer than round, as a moving one is.
      for (let a = -90; a <= 90; a += 18) { const q = (a * Math.PI) / 180; pts.push([Math.cos(q) * r * 1.06 + R * (1 - k) * 0.45, Math.sin(q) * r]); }
      // The lower edge, back to the tongues.
      for (let u = 0.15; u < 0.6; u += 0.15) pts.push([-u * len, r * Math.pow(1 - u, 0.7) * (1 + 0.14 * Math.sin(ph + u * 9))]);
      // Three tongues at the tail, each flickering its own way; the notches between them come and go.
      const tip = (frac, side, w) => [-len * frac * (0.86 + 0.18 * Math.sin(ph * 1.3 + side * 2)), r * side * (0.62 + 0.28 * Math.sin(ph * 1.7 + w))];
      pts.push(tip(0.86, 0.75, 1));
      pts.push([-len * 0.55, r * 0.3]);
      pts.push(tip(1.0, 0.05, 2.4));
      pts.push([-len * 0.58, -r * 0.28]);
      pts.push(tip(0.8, -0.8, 4.1));
      for (let u = 0.45; u >= 0.15; u -= 0.15) pts.push([-u * len, -r * Math.pow(1 - u, 0.7) * (1 + 0.14 * Math.sin(ph * 1.1 + u * 8 + 1))]);
      rounded(g, pts.map(curve));
      g.fillStyle = colour; g.fill();
    });
    // The hot spot, at the front.
    g.fillStyle = "rgba(255,255,245,0.9)";
    g.beginPath(); g.ellipse(R * 0.42, -R * 0.08, R * 0.2, R * 0.16, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  /** A flake of flame thrown off it: a teardrop, pointed the way it flies, red with a hotter middle. */
  function drawFlake(g, p, k) {
    const ang = Math.atan2(p.vy, p.vx), r = p.r * (0.55 + 0.45 * k);
    g.save(); g.translate(p.x, p.y); g.rotate(ang); g.globalAlpha = Math.min(1, k * 1.4);
    g.fillStyle = p.burst ? "#f2621f" : "#e0371c";
    g.beginPath(); g.moveTo(r * 1.6, 0); g.quadraticCurveTo(r * 0.2, -r, -r, 0); g.quadraticCurveTo(r * 0.2, r, r * 1.6, 0); g.fill();
    g.fillStyle = p.burst ? "#ffd24d" : "#ff9a2e";
    g.beginPath(); g.ellipse(-r * 0.05, 0, r * 0.45, r * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function frame(now) {
    const s = state;
    if (!s) return;
    const { ctx: g, w, h } = s;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    g.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const B = s.layout.ball, size = B.size;
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
      g.globalCompositeOperation = "lighter";
      // The embers under the pile, breathing.
      const L = s.layout.logs, breathe = 0.75 + 0.25 * Math.sin(now / 700) + 0.08 * Math.sin(now / 173);
      const glow = g.createRadialGradient(L.x, L.y, 0, L.x, L.y, L.R * 5.5);
      glow.addColorStop(0, `rgba(255,120,40,${0.32 * breathe})`); glow.addColorStop(1, "rgba(255,90,20,0)");
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      for (const e of s.coals) {
        const k = 0.35 + 0.65 * Math.max(0, Math.sin(now / e.speed + e.phase));
        g.fillStyle = `rgba(255,${100 + k * 100 | 0},40,${0.65 * k})`;
        g.beginPath(); g.ellipse(L.x + e.dx * L.R * 4.6, L.y + e.dy * L.R * 0.9, e.r * L.R * 0.1, e.r * L.R * 0.06, 0, 0, Math.PI * 2); g.fill();
      }
      // The ball's own light on the stone and the logs around it.
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

    // Which way it is going, for its tail: from where it was a moment ago, eased so the tail swings rather than snaps.
    if (s.prev && (x !== s.prev.x || y !== s.prev.y)) {
      const want = Math.atan2(y - s.prev.y, x - s.prev.x);
      let d = want - s.dir; d = Math.atan2(Math.sin(d), Math.cos(d));
      s.dir += d * Math.min(1, dt * 14);
    }
    s.prev = { x, y };
    if (!burst) {
      // Flakes of flame thrown off the back, fewer while it circles, more as it winds in.
      s.flakeDue = (s.flakeDue ?? 0) + dt * (s.partAt ? 26 : 9);
      while (s.flakeDue >= 1) {
        s.flakeDue -= 1;
        const back = s.dir + Math.PI + (Math.random() - 0.5) * 0.9, v = 40 + Math.random() * 70;
        s.sparks.push({ x: x + Math.cos(back) * r * 1.4, y: y + Math.sin(back) * r * 1.4, vx: Math.cos(back) * v, vy: Math.sin(back) * v - 15,
          life: 0.45 + Math.random() * 0.5, age: 0, r: r * (0.14 + Math.random() * 0.14) });
      }
    }
    for (const p of s.sparks) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= p.drag ?? 0.97; p.vy = p.vy * (p.drag ?? 0.97) - (p.burst ? -40 : 25) * dt;
      const k = 1 - p.age / p.life;
      if (k > 0) drawFlake(g, p, k);
    }
    s.sparks = s.sparks.filter((p) => p.age < p.life);
    if (!burst) {
      // Which side the circle's centre is on, as it goes, and how tight the curve is there.
      const toC = (B.x - x) * -Math.sin(s.dir) + (B.y - y) * Math.cos(s.dir);
      const rad = Math.max(r * 1.2, Math.hypot(B.x - x, B.y - y));
      drawFireball(g, x, y, r, s.dir, now / 1000, heat, rad > 1 ? Math.sign(toC) / rad : 0);
    }
    else if (burst < 0.3) {
      // The burst itself: the bands thrown out as rings, fast, and gone.
      const k = burst / 0.3, big = size * (2 + k * 9);
      g.globalAlpha = 1 - k;
      BANDS.forEach(([colour, f]) => { g.fillStyle = colour; g.beginPath(); g.arc(x, y, big * f, 0, Math.PI * 2); g.fill(); });
      g.globalAlpha = 1;
    }
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
      s.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.93, burst: true, life: 0.6 + Math.random() * 0.7, age: 0, r: size * (0.18 + Math.random() * 0.32) });
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
      trail: [], sparks: [], partAt: 0, blown: false, spinFrom: 0, dir: Math.PI / 2, prev: null,
      coals: Array.from({ length: 22 }, () => ({ dx: Math.random() * 2 - 1, dy: Math.random() * 1.2 - 0.2, r: 1 + Math.random() * 1.6, speed: 260 + Math.random() * 520, phase: Math.random() * 6 })),
    };
    state = s;
    const size = () => {
      s.w = window.innerWidth; s.h = window.innerHeight;
      // Sharp on a phone, but never more than about three million pixels redrawn a frame: a big Retina screen at full
      // resolution was fifteen million, and the fireball crawled at a few frames a second.
      s.dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.2e6 / (s.w * s.h))));
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
