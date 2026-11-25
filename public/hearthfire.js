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

  // The woodpile, as drawn on the design canvas (390-wide phone frame): each piece's box relative to the middle of
  // the pile's foot, its rotation, and its picture. The ember bed is first, under the logs.
  const WOODPILE = [{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 120\" aria-hidden=\"true\"><defs><radialGradient id=\"bedglow\" cx=\"150\" cy=\"70\" r=\"150\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#ff6e1e\" stop-opacity=\".6\"/><stop offset=\".45\" stop-color=\"#b4320a\" stop-opacity=\".3\"/><stop offset=\"1\" stop-color=\"#501405\" stop-opacity=\"0\"/></radialGradient></defs><ellipse cx=\"150\" cy=\"70\" rx=\"150\" ry=\"50\" fill=\"url(#bedglow)\"/><ellipse cx=\"63.6\" cy=\"62.2\" rx=\"2.6\" ry=\"1.8\" fill=\"#c8380f\" opacity=\"0.56\"/><ellipse cx=\"98.5\" cy=\"69.0\" rx=\"3.5\" ry=\"1.0\" fill=\"#ffa03a\" opacity=\"0.52\"/><ellipse cx=\"193.0\" cy=\"73.5\" rx=\"3.5\" ry=\"2.3\" fill=\"#c8380f\" opacity=\"0.64\"/><ellipse cx=\"209.8\" cy=\"68.0\" rx=\"3.4\" ry=\"1.1\" fill=\"#ff7a24\" opacity=\"0.67\"/><ellipse cx=\"189.9\" cy=\"75.2\" rx=\"3.6\" ry=\"1.1\" fill=\"#e2451a\" opacity=\"0.66\"/><ellipse cx=\"187.4\" cy=\"69.3\" rx=\"3.8\" ry=\"1.1\" fill=\"#ffa03a\" opacity=\"0.47\"/><ellipse cx=\"127.7\" cy=\"62.6\" rx=\"2.6\" ry=\"1.8\" fill=\"#e2451a\" opacity=\"0.79\"/><ellipse cx=\"121.3\" cy=\"66.0\" rx=\"3.4\" ry=\"1.6\" fill=\"#c8380f\" opacity=\"0.83\"/><ellipse cx=\"124.3\" cy=\"74.8\" rx=\"2.7\" ry=\"1.9\" fill=\"#ffa03a\" opacity=\"0.71\"/><ellipse cx=\"105.9\" cy=\"85.2\" rx=\"2.5\" ry=\"1.8\" fill=\"#ff5a1a\" opacity=\"0.45\"/><ellipse cx=\"206.3\" cy=\"63.9\" rx=\"1.7\" ry=\"1.8\" fill=\"#e2451a\" opacity=\"0.49\"/><ellipse cx=\"156.5\" cy=\"57.3\" rx=\"2.5\" ry=\"1.9\" fill=\"#c8380f\" opacity=\"0.45\"/><ellipse cx=\"102.3\" cy=\"78.4\" rx=\"1.6\" ry=\"1.6\" fill=\"#ff5a1a\" opacity=\"0.68\"/><ellipse cx=\"51.1\" cy=\"68.2\" rx=\"1.8\" ry=\"1.0\" fill=\"#ffa03a\" opacity=\"0.41\"/><ellipse cx=\"114.7\" cy=\"67.2\" rx=\"2.1\" ry=\"1.9\" fill=\"#ff5a1a\" opacity=\"0.79\"/><ellipse cx=\"172.2\" cy=\"87.5\" rx=\"3.1\" ry=\"2.0\" fill=\"#ff7a24\" opacity=\"0.85\"/><ellipse cx=\"85.1\" cy=\"58.2\" rx=\"1.7\" ry=\"1.9\" fill=\"#e2451a\" opacity=\"0.62\"/><ellipse cx=\"64.0\" cy=\"57.5\" rx=\"1.4\" ry=\"1.2\" fill=\"#e2451a\" opacity=\"0.58\"/><ellipse cx=\"144.1\" cy=\"58.3\" rx=\"3.4\" ry=\"1.2\" fill=\"#c8380f\" opacity=\"0.54\"/><ellipse cx=\"142.2\" cy=\"81.7\" rx=\"2.2\" ry=\"1.2\" fill=\"#ff5a1a\" opacity=\"0.72\"/><ellipse cx=\"120.7\" cy=\"68.6\" rx=\"2.6\" ry=\"1.8\" fill=\"#e2451a\" opacity=\"0.84\"/><ellipse cx=\"216.9\" cy=\"64.8\" rx=\"2.2\" ry=\"2.2\" fill=\"#ffa03a\" opacity=\"0.49\"/><ellipse cx=\"86.0\" cy=\"61.8\" rx=\"2.2\" ry=\"1.2\" fill=\"#ff5a1a\" opacity=\"0.46\"/><ellipse cx=\"173.9\" cy=\"71.1\" rx=\"1.7\" ry=\"2.2\" fill=\"#c8380f\" opacity=\"0.60\"/><ellipse cx=\"129.7\" cy=\"79.9\" rx=\"1.3\" ry=\"1.5\" fill=\"#c8380f\" opacity=\"0.62\"/><ellipse cx=\"240.0\" cy=\"86.0\" rx=\"1.8\" ry=\"1.5\" fill=\"#e2451a\" opacity=\"0.47\"/><ellipse cx=\"176.9\" cy=\"67.8\" rx=\"1.5\" ry=\"1.0\" fill=\"#ff7a24\" opacity=\"0.52\"/><ellipse cx=\"213.3\" cy=\"71.8\" rx=\"3.6\" ry=\"1.4\" fill=\"#e2451a\" opacity=\"0.65\"/><ellipse cx=\"46.6\" cy=\"67.5\" rx=\"3.8\" ry=\"1.4\" fill=\"#ff5a1a\" opacity=\"0.71\"/><ellipse cx=\"253.2\" cy=\"76.1\" rx=\"1.2\" ry=\"0.9\" fill=\"#ff5a1a\" opacity=\"0.41\"/><ellipse cx=\"150.7\" cy=\"72.4\" rx=\"1.7\" ry=\"1.7\" fill=\"#ff7a24\" opacity=\"0.49\"/><ellipse cx=\"254.2\" cy=\"72.2\" rx=\"3.3\" ry=\"2.3\" fill=\"#ff5a1a\" opacity=\"0.57\"/><ellipse cx=\"205.3\" cy=\"77.5\" rx=\"2.2\" ry=\"2.3\" fill=\"#e2451a\" opacity=\"0.78\"/><ellipse cx=\"65.2\" cy=\"69.3\" rx=\"2.1\" ry=\"1.9\" fill=\"#c8380f\" opacity=\"0.48\"/><ellipse cx=\"202.8\" cy=\"81.0\" rx=\"3.4\" ry=\"1.7\" fill=\"#e2451a\" opacity=\"0.56\"/><ellipse cx=\"131.2\" cy=\"63.8\" rx=\"3.2\" ry=\"1.6\" fill=\"#ff7a24\" opacity=\"0.77\"/><ellipse cx=\"151.6\" cy=\"81.6\" rx=\"3.6\" ry=\"1.9\" fill=\"#c8380f\" opacity=\"0.42\"/><ellipse cx=\"77.8\" cy=\"81.6\" rx=\"3.3\" ry=\"1.0\" fill=\"#ff5a1a\" opacity=\"0.54\"/><ellipse cx=\"172.2\" cy=\"83.2\" rx=\"1.3\" ry=\"1.8\" fill=\"#ff5a1a\" opacity=\"0.60\"/><ellipse cx=\"237.3\" cy=\"80.9\" rx=\"2.1\" ry=\"1.5\" fill=\"#ff5a1a\" opacity=\"0.49\"/><ellipse cx=\"213.1\" cy=\"87.1\" rx=\"2.1\" ry=\"1.4\" fill=\"#c8380f\" opacity=\"0.44\"/><ellipse cx=\"182.8\" cy=\"64.2\" rx=\"1.3\" ry=\"1.1\" fill=\"#e2451a\" opacity=\"0.66\"/><ellipse cx=\"42.6\" cy=\"63.8\" rx=\"3.7\" ry=\"1.2\" fill=\"#ffa03a\" opacity=\"0.63\"/><ellipse cx=\"151.1\" cy=\"86.8\" rx=\"2.0\" ry=\"2.2\" fill=\"#e2451a\" opacity=\"0.61\"/><ellipse cx=\"176.9\" cy=\"57.4\" rx=\"3.3\" ry=\"1.8\" fill=\"#ff5a1a\" opacity=\"0.49\"/><ellipse cx=\"236.5\" cy=\"58.9\" rx=\"2.4\" ry=\"1.2\" fill=\"#ffa03a\" opacity=\"0.45\"/><ellipse cx=\"146.8\" cy=\"78.7\" rx=\"3.0\" ry=\"1.5\" fill=\"#c8380f\" opacity=\"0.75\"/><ellipse cx=\"104.2\" cy=\"88.1\" rx=\"2.4\" ry=\"1.5\" fill=\"#ff5a1a\" opacity=\"0.64\"/><ellipse cx=\"142.1\" cy=\"80.8\" rx=\"1.4\" ry=\"1.4\" fill=\"#c8380f\" opacity=\"0.74\"/><ellipse cx=\"243.3\" cy=\"79.3\" rx=\"2.1\" ry=\"2.1\" fill=\"#ff5a1a\" opacity=\"0.67\"/><ellipse cx=\"87.1\" cy=\"67.9\" rx=\"3.8\" ry=\"1.4\" fill=\"#c8380f\" opacity=\"0.60\"/><ellipse cx=\"95.2\" cy=\"67.0\" rx=\"3.1\" ry=\"1.2\" fill=\"#e2451a\" opacity=\"0.79\"/><ellipse cx=\"257.0\" cy=\"76.8\" rx=\"3.6\" ry=\"1.7\" fill=\"#c8380f\" opacity=\"0.57\"/><ellipse cx=\"82.1\" cy=\"77.2\" rx=\"2.3\" ry=\"2.2\" fill=\"#c8380f\" opacity=\"0.61\"/><ellipse cx=\"169.3\" cy=\"57.2\" rx=\"3.7\" ry=\"0.9\" fill=\"#ff5a1a\" opacity=\"0.41\"/></svg>","x":-150,"y":-133,"w":300,"h":120,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 226 48\" aria-hidden=\"true\"><defs><linearGradient id=\"sbback-log\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#5f4a36\"/><stop offset=\".4\" stop-color=\"#4a3a2a\"/><stop offset=\".85\" stop-color=\"#241c14\"/><stop offset=\"1\" stop-color=\"#120a05\"/></linearGradient><radialGradient id=\"seback-log\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".75\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient></defs><ellipse cx=\"113.0\" cy=\"39.6\" rx=\"98.0\" ry=\"4.8\" fill=\"#000\" opacity=\".35\"/><rect x=\"15.0\" y=\"9.0\" width=\"196.0\" height=\"30.0\" rx=\"12.6\" fill=\"url(#sbback-log)\"/><path d=\"M29.8,20.3 C61.7,18.8 93.5,20.4 126.4,19.9\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M64.7,14.7 C78.8,14.5 92.8,13.2 107.2,13.5\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M96.0,22.4 C112.6,21.4 129.1,22.9 146.2,23.8\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M53.9,25.6 C95.2,24.0 136.6,26.9 179.2,25.0\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M26.5,16.5 C48.5,17.7 70.4,15.4 93.0,16.8\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M51.5,26.9 C80.4,25.3 109.3,25.3 139.0,26.0\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><ellipse cx=\"134.2\" cy=\"23.1\" rx=\"3.0\" ry=\"1.8\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"91.1\" cy=\"25.0\" rx=\"3.0\" ry=\"1.8\" fill=\"#140c06\" opacity=\".6\"/><polyline points=\"97.7,32.6 109.7,32.1 121.7,29.6 133.7,31.4 145.7,31.2\" fill=\"none\" stroke=\"#ff8a2a\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".85\"/><polyline points=\"147.3,32.2 159.3,35.9 171.3,31.3 183.3,32.9 195.3,34.7\" fill=\"none\" stroke=\"#ff8a2a\" stroke-width=\"2.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".85\"/><ellipse cx=\"206.5\" cy=\"24.0\" rx=\"9.0\" ry=\"15.0\" fill=\"url(#seback-log)\" stroke=\"#24160b\" stroke-width=\"3.0\"/><ellipse cx=\"206.5\" cy=\"24.0\" rx=\"2.7\" ry=\"4.5\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><ellipse cx=\"206.5\" cy=\"24.0\" rx=\"5.4\" ry=\"9.0\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/></svg>","x":-112.0,"y":-215.0,"w":226,"h":48.0,"rot":-4},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 78 13\" aria-hidden=\"true\"><defs><linearGradient id=\"sbkindling-1\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4f3b2b\"/><stop offset=\".4\" stop-color=\"#3d2d20\"/><stop offset=\".85\" stop-color=\"#1d150e\"/><stop offset=\"1\" stop-color=\"#120a05\"/></linearGradient><radialGradient id=\"sekindling-1\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".75\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient></defs><ellipse cx=\"39.0\" cy=\"10.6\" rx=\"35.0\" ry=\"1.3\" fill=\"#000\" opacity=\".35\"/><rect x=\"4.0\" y=\"2.4\" width=\"70.0\" height=\"8.0\" rx=\"3.4\" fill=\"url(#sbkindling-1)\"/><path d=\"M21.1,4.5 C26.1,4.6 31.2,4.7 36.3,4.5\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M15.0,8.5 C26.8,8.6 38.7,8.6 50.9,8.5\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M37.1,8.3 C46.6,8.5 56.2,7.9 66.0,8.5\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M38.8,7.2 C51.9,7.0 65.1,7.1 78.6,7.4\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M20.2,3.7 C26.5,3.4 32.9,3.3 39.5,3.9\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M12.7,4.3 C21.4,4.7 30.0,3.9 39.0,4.3\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><ellipse cx=\"41.1\" cy=\"7.6\" rx=\"0.8\" ry=\"0.5\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"52.4\" cy=\"7.6\" rx=\"0.8\" ry=\"0.5\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"72.8\" cy=\"6.4\" rx=\"2.4\" ry=\"4.0\" fill=\"url(#sekindling-1)\" stroke=\"#24160b\" stroke-width=\"2.0\"/><ellipse cx=\"72.8\" cy=\"6.4\" rx=\"0.7\" ry=\"1.2\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><ellipse cx=\"72.8\" cy=\"6.4\" rx=\"1.4\" ry=\"2.4\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/></svg>","x":-48.0,"y":-219.4,"w":78,"h":12.8,"rot":-58},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 69 11\" aria-hidden=\"true\"><defs><linearGradient id=\"sbkindling-2\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6e5a3e\"/><stop offset=\".4\" stop-color=\"#54442e\"/><stop offset=\".85\" stop-color=\"#2a2116\"/><stop offset=\"1\" stop-color=\"#120a05\"/></linearGradient><radialGradient id=\"sekindling-2\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".75\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient></defs><ellipse cx=\"34.5\" cy=\"9.2\" rx=\"31.0\" ry=\"1.1\" fill=\"#000\" opacity=\".35\"/><rect x=\"3.5\" y=\"2.1\" width=\"62.0\" height=\"7.0\" rx=\"2.9\" fill=\"url(#sbkindling-2)\"/><path d=\"M16.4,4.5 C23.8,4.8 31.2,4.9 38.8,4.3\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M10.7,4.0 C16.9,4.0 23.2,4.1 29.6,3.8\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M16.5,3.2 C24.0,3.2 31.5,3.6 39.2,3.3\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M22.6,5.7 C33.0,5.3 43.3,6.0 53.9,5.9\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M28.2,7.4 C35.9,7.4 43.6,7.1 51.6,7.5\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><path d=\"M5.6,3.5 C11.6,3.2 17.6,3.3 23.8,3.1\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.0\" stroke-linecap=\"round\"/><ellipse cx=\"15.9\" cy=\"4.6\" rx=\"0.7\" ry=\"0.4\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"19.7\" cy=\"5.2\" rx=\"0.7\" ry=\"0.4\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"4.5\" cy=\"5.6\" rx=\"2.1\" ry=\"3.5\" fill=\"url(#sekindling-2)\" stroke=\"#24160b\" stroke-width=\"2.0\"/><ellipse cx=\"4.5\" cy=\"5.6\" rx=\"0.6\" ry=\"1.1\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><ellipse cx=\"4.5\" cy=\"5.6\" rx=\"1.3\" ry=\"2.1\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/></svg>","x":-15.5,"y":-214.6,"w":69,"h":11.2,"rot":52},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 106 106\" aria-hidden=\"true\"><defs><radialGradient id=\"egmid-left\" cx=\"47.0\" cy=\"45.8\" r=\"26.2\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".72\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient><linearGradient id=\"bkmid-left\" gradientUnits=\"userSpaceOnUse\" x1=\"73.0\" y1=\"37.9\" x2=\"33.5\" y2=\"68.6\"><stop offset=\"0\" stop-color=\"#7a5636\"/><stop offset=\".45\" stop-color=\"#5c3f27\"/><stop offset=\"1\" stop-color=\"#2e1e12\"/></linearGradient></defs><path d=\"M73.0,37.9 L57.4,22.1 A22.5,22.5 0 0 0 22.0,49.8 L33.5,68.6Z\" fill=\"url(#bkmid-left)\"/><path d=\"M32.1,57.1 L25.2,46.4\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><path d=\"M50.7,42.6 L42.7,33.4\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><path d=\"M39.3,51.5 L32.9,41.4\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><path d=\"M42.8,48.7 L36.1,38.9\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><polyline points=\"35.9,55.7 30.8,49.1 25.7,43.2 24.6,40.8 25.0,36.6\" fill=\"none\" stroke=\"#ff8a2a\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".85\"/><path d=\"M77.9,57.6L75.5,62.4L73.7,67.4L69.1,70.4L65.4,74.3L60.5,77.3L54.8,77.9L49.0,77.1L44.0,74.6L39.0,72.2L35.3,68.3L30.8,64.7L29.2,59.5L27.6,54.2L29.0,49.0L30.8,44.1L32.2,38.8L35.8,34.4L40.7,31.5L46.1,29.6L51.7,28.7L57.5,29.3L62.5,32.0L67.7,34.0L71.6,37.9L74.0,42.6L76.1,47.3L77.6,52.3Z\" fill=\"url(#egmid-left)\"/><ellipse cx=\"49.7\" cy=\"56.6\" rx=\"5.0\" ry=\"4.7\" transform=\"rotate(10 49.7 56.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"49.7\" cy=\"56.6\" rx=\"9.5\" ry=\"8.9\" transform=\"rotate(10 49.7 56.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"49.7\" cy=\"56.6\" rx=\"14.0\" ry=\"13.2\" transform=\"rotate(10 49.7 56.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"49.7\" cy=\"56.6\" rx=\"18.2\" ry=\"17.2\" transform=\"rotate(10 49.7 56.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"49.7\" cy=\"56.6\" rx=\"22.0\" ry=\"20.7\" transform=\"rotate(10 49.7 56.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><path d=\"M49.7,56.6 L49.0,70.1 L45.9,77.5\" fill=\"none\" stroke=\"#ffa040\" stroke-width=\"1.8\" stroke-linecap=\"round\"/><path d=\"M78.2,57.6L77.1,63.0L73.6,67.3L70.4,71.8L65.8,75.0L60.4,76.9L54.7,76.8L49.2,76.2L43.9,74.7L39.2,72.0L35.1,68.5L31.2,64.5L28.6,59.7L27.7,54.2L28.7,48.9L29.9,43.7L32.4,38.9L37.1,35.8L41.0,32.0L46.1,29.6L51.8,29.0L57.4,29.5L62.7,31.4L67.3,34.5L72.2,37.4L74.8,42.2L77.7,46.9L79.0,52.2Z\" fill=\"none\" stroke=\"#24160b\" stroke-width=\"3.2\"/><path d=\"M60.2,73.6 A21.5,21.5 0 0 1 32.7,59.6\" fill=\"none\" stroke=\"#ff7a2a\" stroke-opacity=\".6\" stroke-width=\"1.8\"/></svg>","x":-98.2,"y":-202.2,"w":106.5,"h":106.5,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 123 123\" aria-hidden=\"true\"><defs><radialGradient id=\"egmid-right\" cx=\"54.0\" cy=\"52.5\" r=\"31.5\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".72\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient><linearGradient id=\"bkmid-right\" gradientUnits=\"userSpaceOnUse\" x1=\"35.5\" y1=\"46.5\" x2=\"87.5\" y2=\"76.5\"><stop offset=\"0\" stop-color=\"#80603f\"/><stop offset=\".45\" stop-color=\"#644a30\"/><stop offset=\"1\" stop-color=\"#33261a\"/></linearGradient></defs><path d=\"M87.5,76.5 L96.9,54.2 A27.0,27.0 0 0 0 50.1,27.2 L35.5,46.5Z\" fill=\"url(#bkmid-right)\"/><path d=\"M63.4,48.7 L69.5,38.6\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.1\" stroke-linecap=\"round\"/><path d=\"M76.8,56.5 L81.4,45.6\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.1\" stroke-linecap=\"round\"/><path d=\"M52.0,42.2 L60.5,32.7\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.1\" stroke-linecap=\"round\"/><path d=\"M84.3,60.8 L89.6,49.5\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.1\" stroke-linecap=\"round\"/><path d=\"M91.9,53.4L91.9,60.0L90.4,66.4L88.9,72.6L84.5,77.6L79.8,81.9L75.8,87.8L69.0,89.4L62.2,90.1L55.3,90.9L49.3,87.7L42.8,85.6L37.8,81.1L35.7,74.8L33.2,69.1L32.2,62.9L33.0,56.7L34.0,50.3L38.2,45.2L42.4,40.2L48.4,37.3L53.8,32.8L60.8,33.4L67.4,33.4L73.9,34.9L80.3,37.3L84.2,42.7L89.2,47.2Z\" fill=\"url(#egmid-right)\"/><ellipse cx=\"58.3\" cy=\"64.4\" rx=\"6.0\" ry=\"5.6\" transform=\"rotate(-15 58.3 64.4)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.9\"/><ellipse cx=\"58.3\" cy=\"64.4\" rx=\"11.4\" ry=\"10.7\" transform=\"rotate(-15 58.3 64.4)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.9\"/><ellipse cx=\"58.3\" cy=\"64.4\" rx=\"16.8\" ry=\"15.8\" transform=\"rotate(-15 58.3 64.4)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.9\"/><ellipse cx=\"58.3\" cy=\"64.4\" rx=\"21.9\" ry=\"20.6\" transform=\"rotate(-15 58.3 64.4)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.9\"/><ellipse cx=\"58.3\" cy=\"64.4\" rx=\"26.4\" ry=\"24.8\" transform=\"rotate(-15 58.3 64.4)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.9\"/><path d=\"M58.3,64.4 L43.3,65.5 L33.0,61.1\" fill=\"none\" stroke=\"#3c2410\" stroke-width=\"2.1\" stroke-linecap=\"round\"/><path d=\"M90.5,53.7L91.4,60.1L89.8,66.3L88.6,72.5L84.8,77.8L80.1,82.2L75.4,87.1L68.7,88.4L62.2,90.0L55.5,90.1L49.2,88.0L43.7,84.5L38.6,80.5L34.8,75.2L31.9,69.4L32.4,62.9L32.1,56.5L34.7,50.6L38.0,45.1L41.9,39.7L47.9,36.4L54.1,33.9L60.7,32.4L67.6,32.5L73.8,35.2L79.7,38.1L84.4,42.6L88.1,47.8Z\" fill=\"none\" stroke=\"#24160b\" stroke-width=\"3.9\"/></svg>","x":-34.5,"y":-218.5,"w":123.0,"h":123.0,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 91 91\" aria-hidden=\"true\"><defs><radialGradient id=\"egwedge\" cx=\"40.0\" cy=\"38.9\" r=\"23.1\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".72\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient><linearGradient id=\"bkwedge\" gradientUnits=\"userSpaceOnUse\" x1=\"29.9\" y1=\"29.9\" x2=\"61.1\" y2=\"61.1\"><stop offset=\"0\" stop-color=\"#6b5a44\"/><stop offset=\".45\" stop-color=\"#52452f\"/><stop offset=\"1\" stop-color=\"#292116\"/></linearGradient></defs><path d=\"M61.1,61.1 L72.2,46.8 A19.8,19.8 0 0 0 44.2,18.8 L29.9,29.9Z\" fill=\"url(#bkwedge)\"/><path d=\"M56.5,44.1 L62.5,37.1\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M52.6,40.1 L59.0,33.5\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M62.7,50.3 L68.5,42.7\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M61.1,48.6 L67.4,41.2\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.5\" stroke-linecap=\"round\"/><path d=\"M43.0,44.6 L31.8,28.3 A22.0,22.0 0 0 1 51.6,66.6Z\" fill=\"url(#egwedge)\"/><path d=\"M37.5,37.7 A8.8,8.8 0 0 1 45.4,53.1\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><path d=\"M33.4,32.5 A15.4,15.4 0 0 1 47.3,59.4\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><path d=\"M31.8,28.3 A22.0,22.0 0 0 1 51.6,66.6\" fill=\"none\" stroke=\"#24160b\" stroke-width=\"2.9\"/></svg>","x":29.5,"y":-182.5,"w":91.0,"h":91.0,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 120 38\" aria-hidden=\"true\"><defs><linearGradient id=\"sbleaner\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#6e5a3e\"/><stop offset=\".4\" stop-color=\"#54442e\"/><stop offset=\".85\" stop-color=\"#2a2116\"/><stop offset=\"1\" stop-color=\"#120a05\"/></linearGradient><radialGradient id=\"seleaner\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".75\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient></defs><ellipse cx=\"60.0\" cy=\"31.7\" rx=\"48.0\" ry=\"3.8\" fill=\"#000\" opacity=\".35\"/><rect x=\"12.0\" y=\"7.2\" width=\"96.0\" height=\"24.0\" rx=\"10.1\" fill=\"url(#sbleaner)\"/><path d=\"M52.3,26.6 C60.6,25.6 68.9,26.5 77.4,25.6\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M15.5,14.8 C31.4,15.7 47.3,16.0 63.6,14.0\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M43.7,22.8 C52.1,23.9 60.4,24.2 69.1,22.2\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M31.1,26.8 C44.4,28.2 57.7,27.8 71.4,26.0\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M36.7,18.0 C47.9,17.2 59.1,17.5 70.6,18.6\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><path d=\"M38.6,11.1 C51.2,9.7 63.8,10.6 76.8,11.4\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.2\" stroke-linecap=\"round\"/><ellipse cx=\"60.7\" cy=\"15.0\" rx=\"2.4\" ry=\"1.4\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"87.9\" cy=\"22.0\" rx=\"2.4\" ry=\"1.4\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"15.6\" cy=\"19.2\" rx=\"7.2\" ry=\"12.0\" fill=\"url(#seleaner)\" stroke=\"#24160b\" stroke-width=\"2.4\"/><ellipse cx=\"15.6\" cy=\"19.2\" rx=\"2.2\" ry=\"3.6\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><ellipse cx=\"15.6\" cy=\"19.2\" rx=\"4.3\" ry=\"7.2\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/></svg>","x":-159.0,"y":-132.2,"w":120,"h":38.4,"rot":-38},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 108 108\" aria-hidden=\"true\"><defs><radialGradient id=\"egfront-left\" cx=\"47.0\" cy=\"45.6\" r=\"28.4\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".72\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient><linearGradient id=\"bkfront-left\" gradientUnits=\"userSpaceOnUse\" x1=\"78.8\" y1=\"43.6\" x2=\"28.7\" y2=\"63.9\"><stop offset=\"0\" stop-color=\"#5f4a36\"/><stop offset=\".45\" stop-color=\"#4a3a2a\"/><stop offset=\"1\" stop-color=\"#241c14\"/></linearGradient></defs><path d=\"M78.8,43.6 L68.8,26.1 A24.3,24.3 0 0 0 23.7,44.3 L28.7,63.9Z\" fill=\"url(#bkfront-left)\"/><path d=\"M68.6,36.1 L61.9,28.3\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.9\" stroke-linecap=\"round\"/><path d=\"M40.3,47.5 L38.6,38.6\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.9\" stroke-linecap=\"round\"/><path d=\"M60.9,39.2 L55.9,31.1\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.9\" stroke-linecap=\"round\"/><path d=\"M34.9,49.7 L33.1,40.6\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.9\" stroke-linecap=\"round\"/><polyline points=\"36.4,49.5 30.5,41.2 33.5,40.4 30.5,33.4 24.7,33.7\" fill=\"none\" stroke=\"#ff8a2a\" stroke-width=\"2.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".85\"/><path d=\"M79.3,65.7L75.5,70.3L71.6,74.7L65.6,76.2L60.8,79.9L54.6,78.5L48.4,79.9L43.0,76.9L38.0,73.6L33.3,69.8L29.0,65.3L28.5,59.2L28.0,53.6L27.4,47.8L29.9,42.6L33.1,38.1L37.0,34.1L41.9,31.4L47.2,29.2L52.9,28.3L58.8,29.0L64.9,29.9L69.4,34.0L74.1,37.8L76.7,43.0L79.2,48.3L79.2,53.9L79.4,59.6Z\" fill=\"url(#egfront-left)\"/><ellipse cx=\"53.1\" cy=\"50.3\" rx=\"5.4\" ry=\"5.1\" transform=\"rotate(25 53.1 50.3)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"53.1\" cy=\"50.3\" rx=\"10.3\" ry=\"9.6\" transform=\"rotate(25 53.1 50.3)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"53.1\" cy=\"50.3\" rx=\"15.1\" ry=\"14.2\" transform=\"rotate(25 53.1 50.3)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"53.1\" cy=\"50.3\" rx=\"19.7\" ry=\"18.5\" transform=\"rotate(25 53.1 50.3)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"53.1\" cy=\"50.3\" rx=\"23.8\" ry=\"22.3\" transform=\"rotate(25 53.1 50.3)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><path d=\"M53.1,50.3 L66.6,52.7 L75.6,55.2\" fill=\"none\" stroke=\"#ffa040\" stroke-width=\"1.9\" stroke-linecap=\"round\"/><path d=\"M78.6,65.3L75.3,70.1L70.7,73.7L66.1,77.1L60.7,79.8L54.6,78.9L48.5,79.5L43.0,76.9L37.7,73.9L32.9,70.1L30.2,64.7L27.8,59.3L26.6,53.6L26.6,47.6L29.5,42.5L31.8,37.1L36.2,33.1L41.3,30.1L47.0,28.6L52.9,28.1L58.7,29.3L64.3,31.1L69.3,34.2L74.5,37.5L77.1,42.9L79.0,48.3L79.7,53.9L80.6,59.8Z\" fill=\"none\" stroke=\"#24160b\" stroke-width=\"3.5\"/><path d=\"M32.4,62.9 A23.2,23.2 0 0 1 45.2,32.2\" fill=\"none\" stroke=\"#ff7a2a\" stroke-opacity=\".6\" stroke-width=\"1.9\"/></svg>","x":-130.8,"y":-142.8,"w":107.5,"h":107.5,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 140 140\" aria-hidden=\"true\"><defs><radialGradient id=\"egfront-big\" cx=\"61.0\" cy=\"59.2\" r=\"36.8\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".72\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient><linearGradient id=\"bkfront-big\" gradientUnits=\"userSpaceOnUse\" x1=\"104.6\" y1=\"66.1\" x2=\"34.9\" y2=\"73.4\"><stop offset=\"0\" stop-color=\"#6e5a3e\"/><stop offset=\".45\" stop-color=\"#54442e\"/><stop offset=\"1\" stop-color=\"#2a2116\"/></linearGradient></defs><path d=\"M104.6,66.1 L98.4,40.6 A31.5,31.5 0 0 0 35.7,47.2 L34.9,73.4Z\" fill=\"url(#bkfront-big)\"/><path d=\"M77.8,54.8 L75.2,43.0\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><path d=\"M53.9,57.3 L54.6,45.3\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><path d=\"M66.0,56.1 L65.1,44.1\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><path d=\"M65.3,56.1 L64.4,44.2\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><polyline points=\"51.1,58.7 46.9,47.1 50.0,42.5 44.2,34.7 43.8,33.6\" fill=\"none\" stroke=\"#ff8a2a\" stroke-width=\"3.1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".85\"/><path d=\"M104.6,66.7L102.7,73.9L101.7,81.1L97.6,87.3L93.5,93.5L86.7,97.0L79.8,99.9L72.6,102.2L64.9,101.8L57.1,101.2L50.2,97.6L43.7,93.4L39.1,87.1L35.7,80.3L33.6,72.9L35.5,65.4L37.6,58.3L39.3,50.6L46.6,46.6L51.6,40.6L59.0,37.7L67.0,38.1L74.8,35.7L82.8,37.4L89.5,41.6L95.8,46.2L100.8,52.1L101.9,59.8Z\" fill=\"url(#egfront-big)\"/><ellipse cx=\"69.8\" cy=\"66.6\" rx=\"7.0\" ry=\"6.6\" transform=\"rotate(-5 69.8 66.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"1.1\"/><ellipse cx=\"69.8\" cy=\"66.6\" rx=\"13.3\" ry=\"12.5\" transform=\"rotate(-5 69.8 66.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"1.1\"/><ellipse cx=\"69.8\" cy=\"66.6\" rx=\"19.6\" ry=\"18.4\" transform=\"rotate(-5 69.8 66.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"1.1\"/><ellipse cx=\"69.8\" cy=\"66.6\" rx=\"25.6\" ry=\"24.0\" transform=\"rotate(-5 69.8 66.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"1.1\"/><ellipse cx=\"69.8\" cy=\"66.6\" rx=\"30.8\" ry=\"29.0\" transform=\"rotate(-5 69.8 66.6)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"1.1\"/><path d=\"M69.8,66.6 L52.5,65.4 L41.1,58.7\" fill=\"none\" stroke=\"#ffa040\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><path d=\"M104.6,66.7L105.2,74.2L103.1,81.6L99.5,88.4L93.9,93.9L88.0,99.1L80.5,101.8L72.7,103.3L64.9,102.1L57.6,99.9L50.8,96.8L44.5,92.6L40.4,86.4L35.6,80.3L34.7,72.8L34.8,65.3L36.8,58.0L40.3,51.3L45.8,45.8L52.6,42.2L58.9,37.5L66.8,36.1L74.7,36.8L82.3,38.5L89.4,41.6L94.4,47.4L100.4,52.3L102.5,59.6Z\" fill=\"none\" stroke=\"#24160b\" stroke-width=\"4.5\"/><path d=\"M99.0,76.7 A30.1,30.1 0 0 1 61.9,98.8\" fill=\"none\" stroke=\"#ff7a2a\" stroke-opacity=\".6\" stroke-width=\"2.5\"/></svg>","x":-79.8,"y":-152.8,"w":139.5,"h":139.5,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 112 112\" aria-hidden=\"true\"><defs><radialGradient id=\"egfront-right\" cx=\"49.0\" cy=\"47.6\" r=\"29.4\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".72\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient><linearGradient id=\"bkfront-right\" gradientUnits=\"userSpaceOnUse\" x1=\"28.8\" y1=\"49.2\" x2=\"83.2\" y2=\"62.8\"><stop offset=\"0\" stop-color=\"#4f3b2b\"/><stop offset=\".45\" stop-color=\"#3d2d20\"/><stop offset=\"1\" stop-color=\"#1d150e\"/></linearGradient></defs><path d=\"M83.2,62.8 L85.5,41.7 A25.2,25.2 0 0 0 36.6,29.5 L28.8,49.2Z\" fill=\"url(#bkfront-right)\"/><path d=\"M48.5,42.6 L51.5,33.3\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.0\" stroke-linecap=\"round\"/><path d=\"M45.9,41.9 L49.0,32.7\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.0\" stroke-linecap=\"round\"/><path d=\"M79.4,50.3 L79.7,40.3\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.0\" stroke-linecap=\"round\"/><path d=\"M53.6,43.9 L56.5,34.5\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"2.0\" stroke-linecap=\"round\"/><path d=\"M77.7,74.2L73.4,78.4L67.4,80.0L61.9,81.8L56.0,82.5L49.8,82.8L44.3,79.4L38.8,76.5L35.6,71.1L32.4,66.1L29.9,60.6L28.1,54.6L28.7,48.5L30.8,42.8L35.0,38.4L38.9,33.9L44.1,31.0L49.9,29.3L56.0,29.9L62.3,28.8L67.5,32.8L73.9,34.6L78.4,39.4L79.5,46.0L82.6,51.3L84.3,57.4L84.0,63.7L80.6,68.9Z\" fill=\"url(#egfront-right)\"/><ellipse cx=\"57.5\" cy=\"58.2\" rx=\"5.6\" ry=\"5.3\" transform=\"rotate(40 57.5 58.2)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"57.5\" cy=\"58.2\" rx=\"10.6\" ry=\"10.0\" transform=\"rotate(40 57.5 58.2)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"57.5\" cy=\"58.2\" rx=\"15.7\" ry=\"14.7\" transform=\"rotate(40 57.5 58.2)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"57.5\" cy=\"58.2\" rx=\"20.4\" ry=\"19.2\" transform=\"rotate(40 57.5 58.2)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><ellipse cx=\"57.5\" cy=\"58.2\" rx=\"24.6\" ry=\"23.2\" transform=\"rotate(40 57.5 58.2)\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\" stroke-width=\"0.8\"/><path d=\"M57.5,58.2 L55.9,73.3 L51.9,81.4\" fill=\"none\" stroke=\"#3c2410\" stroke-width=\"2.0\" stroke-linecap=\"round\"/><path d=\"M77.0,73.6L73.6,78.8L67.7,80.5L62.1,82.9L56.0,82.5L49.9,82.2L43.7,80.6L39.3,75.9L34.1,72.2L31.3,66.6L28.5,60.8L28.2,54.6L29.8,48.8L30.6,42.6L34.6,38.0L39.5,34.7L44.5,31.8L49.9,29.2L56.0,28.9L62.0,30.2L67.6,32.7L72.9,35.8L77.2,40.3L81.3,45.2L81.8,51.5L83.9,57.4L83.4,63.5L80.1,68.7Z\" fill=\"none\" stroke=\"#24160b\" stroke-width=\"3.6\"/></svg>","x":1.0,"y":-147.0,"w":112.0,"h":112.0,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 73 73\" aria-hidden=\"true\"><defs><radialGradient id=\"egsmall\" cx=\"32.0\" cy=\"31.1\" r=\"18.9\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".72\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient><linearGradient id=\"bksmall\" gradientUnits=\"userSpaceOnUse\" x1=\"19.6\" y1=\"30.3\" x2=\"53.4\" y2=\"42.7\"><stop offset=\"0\" stop-color=\"#80603f\"/><stop offset=\".45\" stop-color=\"#644a30\"/><stop offset=\"1\" stop-color=\"#33261a\"/></linearGradient></defs><path d=\"M53.4,42.7 L56.5,28.9 A16.2,16.2 0 0 0 26.1,17.8 L19.6,30.3Z\" fill=\"url(#bksmall)\"/><path d=\"M50.5,33.9 L52.1,27.1\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M49.8,33.7 L50.7,26.9\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M35.5,28.5 L38.2,22.2\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M52.5,34.6 L53.7,27.8\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><path d=\"M38.7,36.5 L51.8,45.9 A18.0,18.0 0 0 1 25.9,21.9Z\" fill=\"url(#egsmall)\"/><path d=\"M44.8,40.3 A7.2,7.2 0 0 1 34.4,30.7\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><path d=\"M49.4,43.1 A12.6,12.6 0 0 1 31.3,26.3\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><path d=\"M51.8,45.9 A18.0,18.0 0 0 1 25.9,21.9\" fill=\"none\" stroke=\"#24160b\" stroke-width=\"2.3\"/></svg>","x":72.5,"y":-105.5,"w":73.0,"h":73.0,"rot":0},{"svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 147 43\" aria-hidden=\"true\"><defs><linearGradient id=\"sbfront-across\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#7a5636\"/><stop offset=\".4\" stop-color=\"#5c3f27\"/><stop offset=\".85\" stop-color=\"#2e1e12\"/><stop offset=\"1\" stop-color=\"#120a05\"/></linearGradient><radialGradient id=\"sefront-across\" cx=\".4\" cy=\".35\" r=\".7\"><stop offset=\"0\" stop-color=\"#d9ad72\"/><stop offset=\".75\" stop-color=\"#b3824d\"/><stop offset=\"1\" stop-color=\"#835730\"/></radialGradient></defs><ellipse cx=\"73.5\" cy=\"35.6\" rx=\"60.0\" ry=\"4.3\" fill=\"#000\" opacity=\".35\"/><rect x=\"13.5\" y=\"8.1\" width=\"120.0\" height=\"27.0\" rx=\"11.3\" fill=\"url(#sbfront-across)\"/><path d=\"M16.4,17.4 C26.1,18.4 35.9,16.7 45.9,18.5\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><path d=\"M29.4,16.9 C46.5,15.9 63.5,16.5 81.0,18.1\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><path d=\"M62.2,28.9 C81.4,30.2 100.5,30.3 120.3,29.0\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><path d=\"M16.5,25.7 C37.4,25.6 58.4,26.6 80.0,26.1\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><path d=\"M16.4,17.6 C40.9,16.4 65.3,17.5 90.5,17.1\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><path d=\"M57.8,17.8 C83.2,17.0 108.5,18.3 134.6,17.2\" fill=\"none\" stroke=\"#140c06\" stroke-opacity=\".5\" stroke-width=\"1.4\" stroke-linecap=\"round\"/><ellipse cx=\"77.6\" cy=\"20.5\" rx=\"2.7\" ry=\"1.6\" fill=\"#140c06\" opacity=\".6\"/><ellipse cx=\"49.5\" cy=\"17.9\" rx=\"2.7\" ry=\"1.6\" fill=\"#140c06\" opacity=\".6\"/><polyline points=\"46.5,30.8 57.3,29.5 68.1,32.8 78.9,33.3 89.7,30.6\" fill=\"none\" stroke=\"#ff8a2a\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".85\"/><polyline points=\"41.6,25.4 52.4,26.6 63.2,25.4 74.0,26.1 84.8,26.2\" fill=\"none\" stroke=\"#ff8a2a\" stroke-width=\"1.9\" stroke-linecap=\"round\" stroke-linejoin=\"round\" opacity=\".85\"/><ellipse cx=\"17.6\" cy=\"21.6\" rx=\"8.1\" ry=\"13.5\" fill=\"url(#sefront-across)\" stroke=\"#24160b\" stroke-width=\"2.7\"/><ellipse cx=\"17.6\" cy=\"21.6\" rx=\"2.4\" ry=\"4.0\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/><ellipse cx=\"17.6\" cy=\"21.6\" rx=\"4.9\" ry=\"8.1\" fill=\"none\" stroke=\"#6e4620\" stroke-opacity=\".5\"/></svg>","x":-2.5,"y":-42.6,"w":147,"h":43.2,"rot":-11}];

  // Their pictures, made once and kept: SVG drawn onto the canvas like any image. Until they have loaded the hearth
  // is drawn without the pile, and drawn again with it the moment they are ready.
  let pileImages = null;
  function loadPile() {
    if (pileImages) return pileImages.ready;
    const imgs = WOODPILE.map((p) => { const im = new Image(); im.decoding = "async"; im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(p.svg); return im; });
    pileImages = { imgs, done: false, ready: null };
    pileImages.ready = Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.onload = r; im.onerror = r; })))).then(() => { pileImages.done = true; });
    return pileImages.ready;
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

    // The woodpile, as designed: at a phone's size exactly as drawn, wider screens a bigger pile, but never so tall
    // that it reaches up into the fireball's circle. Its foot sits on the floor near the front of the hearth.
    const k = Math.min((back.r - back.l) / 274, (h * 0.4) / 219);
    const footX = w / 2, footY = h - 31 * k;
    if (pileImages?.done) {
      WOODPILE.forEach((p, i) => {
        const im = pileImages.imgs[i];
        if (!im.naturalWidth && !im.width) return;
        const cx = footX + (p.x + p.w / 2) * k, cy = footY + (p.y + p.h / 2) * k;
        g.save(); g.translate(cx, cy); g.rotate((p.rot * Math.PI) / 180);
        g.drawImage(im, (-p.w / 2) * k, (-p.h / 2) * k, p.w * k, p.h * k);
        g.restore();
      });
    }
    // Where the embers are, for the glow that breathes over them; and the top of the pile, which the circle keeps clear of.
    // (Its top is the kindling's tips, which stand above the logs.)
    s.layout.logs = { x: footX, y: footY - 73 * k, R: 30 * k, top: footY - 258 * k };

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

    s.layout.ball = fitCircle(w, h, rim, top, rx, ry, s.layout.logs.top);
    s.hearth = c;
  }

  /**
   * The fireball's circle, fitted inside the arch on this screen: the ball, its whole tail and a margin never cross
   * onto the stones. The tail streams straight back from the ball, so near the edge of a big circle it reaches out
   * past it; the circle (then the ball) is made smaller until nothing touches.
   */
  function fitCircle(w, h, rim, top, rx, ry, floorY = h) {
    const MARGIN = 10;
    // A disc of radius q at (x, y) is inside the opening: clear of both sides, and under the arch's curve.
    const inside = (x, y, q) => {
      if (x - q < rim + MARGIN || x + q > w - rim - MARGIN || y + q > floorY - MARGIN) return false;
      if (y >= top) return true;
      const ex = rx - q - MARGIN, ey = ry - q - MARGIN;
      if (ex <= 0 || ey <= 0) return false;
      return ((x - w / 2) / ex) ** 2 + ((y - top) / ey) ** 2 <= 1;
    };
    // Centred between the crown of the arch and the top of the pile: the most room above and below.
    const cx = w / 2, cy = (rim + floorY) / 2;
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
    if (!pileImages?.done) loadPile().then(() => { if (state === s) { size(); if (s.still) { s.ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); s.ctx.drawImage(s.hearth, 0, 0, s.w, s.h); } } });
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
