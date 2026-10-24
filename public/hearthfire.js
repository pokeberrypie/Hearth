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

  const HEARTH = `<defs><clipPath id="bh0"><path clip-rule="evenodd" d="M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z"/></clipPath></defs><path d="M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z" fill-rule="evenodd" fill="#3F3124"/><g clip-path="url(#bh0)"><path d="M26.4,23 L34.6,23 A1.4,1.4 0 0 1 36,24.4 L36,27.6 A1.4,1.4 0 0 1 34.6,29 L26.4,29 A1.4,1.4 0 0 1 25,27.6 L25,24.4 A1.4,1.4 0 0 1 26.4,23 Z" fill="#9A7E60"/><path d="M38.4,23 L46.6,23 A1.4,1.4 0 0 1 48,24.4 L48,27.6 A1.4,1.4 0 0 1 46.6,29 L38.4,29 A1.4,1.4 0 0 1 37,27.6 L37,24.4 A1.4,1.4 0 0 1 38.4,23 Z" fill="#8A6E52"/><path d="M50.4,23 L58.6,23 A1.4,1.4 0 0 1 60,24.4 L60,27.6 A1.4,1.4 0 0 1 58.6,29 L50.4,29 A1.4,1.4 0 0 1 49,27.6 L49,24.4 A1.4,1.4 0 0 1 50.4,23 Z" fill="#A88B69"/><path d="M62.4,23 L70.6,23 A1.4,1.4 0 0 1 72,24.4 L72,27.6 A1.4,1.4 0 0 1 70.6,29 L62.4,29 A1.4,1.4 0 0 1 61,27.6 L61,24.4 A1.4,1.4 0 0 1 62.4,23 Z" fill="#7E6448"/><path d="M74.4,23 L82.6,23 A1.4,1.4 0 0 1 84,24.4 L84,27.6 A1.4,1.4 0 0 1 82.6,29 L74.4,29 A1.4,1.4 0 0 1 73,27.6 L73,24.4 A1.4,1.4 0 0 1 74.4,23 Z" fill="#937A5C"/><path d="M20.4,30 L28.6,30 A1.4,1.4 0 0 1 30,31.4 L30,34.6 A1.4,1.4 0 0 1 28.6,36 L20.4,36 A1.4,1.4 0 0 1 19,34.6 L19,31.4 A1.4,1.4 0 0 1 20.4,30 Z" fill="#9A7E60"/><path d="M32.4,30 L40.6,30 A1.4,1.4 0 0 1 42,31.4 L42,34.6 A1.4,1.4 0 0 1 40.6,36 L32.4,36 A1.4,1.4 0 0 1 31,34.6 L31,31.4 A1.4,1.4 0 0 1 32.4,30 Z" fill="#8A6E52"/><path d="M44.4,30 L52.6,30 A1.4,1.4 0 0 1 54,31.4 L54,34.6 A1.4,1.4 0 0 1 52.6,36 L44.4,36 A1.4,1.4 0 0 1 43,34.6 L43,31.4 A1.4,1.4 0 0 1 44.4,30 Z" fill="#A88B69"/><path d="M56.4,30 L64.6,30 A1.4,1.4 0 0 1 66,31.4 L66,34.6 A1.4,1.4 0 0 1 64.6,36 L56.4,36 A1.4,1.4 0 0 1 55,34.6 L55,31.4 A1.4,1.4 0 0 1 56.4,30 Z" fill="#7E6448"/><path d="M68.4,30 L76.6,30 A1.4,1.4 0 0 1 78,31.4 L78,34.6 A1.4,1.4 0 0 1 76.6,36 L68.4,36 A1.4,1.4 0 0 1 67,34.6 L67,31.4 A1.4,1.4 0 0 1 68.4,30 Z" fill="#937A5C"/><path d="M80.4,30 L88.6,30 A1.4,1.4 0 0 1 90,31.4 L90,34.6 A1.4,1.4 0 0 1 88.6,36 L80.4,36 A1.4,1.4 0 0 1 79,34.6 L79,31.4 A1.4,1.4 0 0 1 80.4,30 Z" fill="#9A7E60"/><path d="M26.4,37 L34.6,37 A1.4,1.4 0 0 1 36,38.4 L36,41.6 A1.4,1.4 0 0 1 34.6,43 L26.4,43 A1.4,1.4 0 0 1 25,41.6 L25,38.4 A1.4,1.4 0 0 1 26.4,37 Z" fill="#8A6E52"/><path d="M38.4,37 L46.6,37 A1.4,1.4 0 0 1 48,38.4 L48,41.6 A1.4,1.4 0 0 1 46.6,43 L38.4,43 A1.4,1.4 0 0 1 37,41.6 L37,38.4 A1.4,1.4 0 0 1 38.4,37 Z" fill="#A88B69"/><path d="M50.4,37 L58.6,37 A1.4,1.4 0 0 1 60,38.4 L60,41.6 A1.4,1.4 0 0 1 58.6,43 L50.4,43 A1.4,1.4 0 0 1 49,41.6 L49,38.4 A1.4,1.4 0 0 1 50.4,37 Z" fill="#7E6448"/><path d="M62.4,37 L70.6,37 A1.4,1.4 0 0 1 72,38.4 L72,41.6 A1.4,1.4 0 0 1 70.6,43 L62.4,43 A1.4,1.4 0 0 1 61,41.6 L61,38.4 A1.4,1.4 0 0 1 62.4,37 Z" fill="#937A5C"/><path d="M74.4,37 L82.6,37 A1.4,1.4 0 0 1 84,38.4 L84,41.6 A1.4,1.4 0 0 1 82.6,43 L74.4,43 A1.4,1.4 0 0 1 73,41.6 L73,38.4 A1.4,1.4 0 0 1 74.4,37 Z" fill="#9A7E60"/><path d="M20.4,44 L28.6,44 A1.4,1.4 0 0 1 30,45.4 L30,48.6 A1.4,1.4 0 0 1 28.6,50 L20.4,50 A1.4,1.4 0 0 1 19,48.6 L19,45.4 A1.4,1.4 0 0 1 20.4,44 Z" fill="#8A6E52"/><path d="M32.4,44 L40.6,44 A1.4,1.4 0 0 1 42,45.4 L42,48.6 A1.4,1.4 0 0 1 40.6,50 L32.4,50 A1.4,1.4 0 0 1 31,48.6 L31,45.4 A1.4,1.4 0 0 1 32.4,44 Z" fill="#A88B69"/><path d="M44.4,44 L52.6,44 A1.4,1.4 0 0 1 54,45.4 L54,48.6 A1.4,1.4 0 0 1 52.6,50 L44.4,50 A1.4,1.4 0 0 1 43,48.6 L43,45.4 A1.4,1.4 0 0 1 44.4,44 Z" fill="#7E6448"/><path d="M56.4,44 L64.6,44 A1.4,1.4 0 0 1 66,45.4 L66,48.6 A1.4,1.4 0 0 1 64.6,50 L56.4,50 A1.4,1.4 0 0 1 55,48.6 L55,45.4 A1.4,1.4 0 0 1 56.4,44 Z" fill="#937A5C"/><path d="M68.4,44 L76.6,44 A1.4,1.4 0 0 1 78,45.4 L78,48.6 A1.4,1.4 0 0 1 76.6,50 L68.4,50 A1.4,1.4 0 0 1 67,48.6 L67,45.4 A1.4,1.4 0 0 1 68.4,44 Z" fill="#9A7E60"/><path d="M80.4,44 L88.6,44 A1.4,1.4 0 0 1 90,45.4 L90,48.6 A1.4,1.4 0 0 1 88.6,50 L80.4,50 A1.4,1.4 0 0 1 79,48.6 L79,45.4 A1.4,1.4 0 0 1 80.4,44 Z" fill="#8A6E52"/><path d="M26.4,51 L34.6,51 A1.4,1.4 0 0 1 36,52.4 L36,55.6 A1.4,1.4 0 0 1 34.6,57 L26.4,57 A1.4,1.4 0 0 1 25,55.6 L25,52.4 A1.4,1.4 0 0 1 26.4,51 Z" fill="#A88B69"/><path d="M38.4,51 L46.6,51 A1.4,1.4 0 0 1 48,52.4 L48,55.6 A1.4,1.4 0 0 1 46.6,57 L38.4,57 A1.4,1.4 0 0 1 37,55.6 L37,52.4 A1.4,1.4 0 0 1 38.4,51 Z" fill="#7E6448"/><path d="M50.4,51 L58.6,51 A1.4,1.4 0 0 1 60,52.4 L60,55.6 A1.4,1.4 0 0 1 58.6,57 L50.4,57 A1.4,1.4 0 0 1 49,55.6 L49,52.4 A1.4,1.4 0 0 1 50.4,51 Z" fill="#937A5C"/><path d="M62.4,51 L70.6,51 A1.4,1.4 0 0 1 72,52.4 L72,55.6 A1.4,1.4 0 0 1 70.6,57 L62.4,57 A1.4,1.4 0 0 1 61,55.6 L61,52.4 A1.4,1.4 0 0 1 62.4,51 Z" fill="#9A7E60"/><path d="M74.4,51 L82.6,51 A1.4,1.4 0 0 1 84,52.4 L84,55.6 A1.4,1.4 0 0 1 82.6,57 L74.4,57 A1.4,1.4 0 0 1 73,55.6 L73,52.4 A1.4,1.4 0 0 1 74.4,51 Z" fill="#8A6E52"/><path d="M20.4,58 L28.6,58 A1.4,1.4 0 0 1 30,59.4 L30,62.6 A1.4,1.4 0 0 1 28.6,64 L20.4,64 A1.4,1.4 0 0 1 19,62.6 L19,59.4 A1.4,1.4 0 0 1 20.4,58 Z" fill="#A88B69"/><path d="M32.4,58 L40.6,58 A1.4,1.4 0 0 1 42,59.4 L42,62.6 A1.4,1.4 0 0 1 40.6,64 L32.4,64 A1.4,1.4 0 0 1 31,62.6 L31,59.4 A1.4,1.4 0 0 1 32.4,58 Z" fill="#7E6448"/><path d="M68.4,58 L76.6,58 A1.4,1.4 0 0 1 78,59.4 L78,62.6 A1.4,1.4 0 0 1 76.6,64 L68.4,64 A1.4,1.4 0 0 1 67,62.6 L67,59.4 A1.4,1.4 0 0 1 68.4,58 Z" fill="#937A5C"/><path d="M80.4,58 L88.6,58 A1.4,1.4 0 0 1 90,59.4 L90,62.6 A1.4,1.4 0 0 1 88.6,64 L80.4,64 A1.4,1.4 0 0 1 79,62.6 L79,59.4 A1.4,1.4 0 0 1 80.4,58 Z" fill="#9A7E60"/><path d="M26.4,65 L34.6,65 A1.4,1.4 0 0 1 36,66.4 L36,69.6 A1.4,1.4 0 0 1 34.6,71 L26.4,71 A1.4,1.4 0 0 1 25,69.6 L25,66.4 A1.4,1.4 0 0 1 26.4,65 Z" fill="#8A6E52"/><path d="M74.4,65 L82.6,65 A1.4,1.4 0 0 1 84,66.4 L84,69.6 A1.4,1.4 0 0 1 82.6,71 L74.4,71 A1.4,1.4 0 0 1 73,69.6 L73,66.4 A1.4,1.4 0 0 1 74.4,65 Z" fill="#A88B69"/><path d="M20.4,72 L28.6,72 A1.4,1.4 0 0 1 30,73.4 L30,76.6 A1.4,1.4 0 0 1 28.6,78 L20.4,78 A1.4,1.4 0 0 1 19,76.6 L19,73.4 A1.4,1.4 0 0 1 20.4,72 Z" fill="#7E6448"/><path d="M32.4,72 L40.6,72 A1.4,1.4 0 0 1 42,73.4 L42,76.6 A1.4,1.4 0 0 1 40.6,78 L32.4,78 A1.4,1.4 0 0 1 31,76.6 L31,73.4 A1.4,1.4 0 0 1 32.4,72 Z" fill="#937A5C"/><path d="M68.4,72 L76.6,72 A1.4,1.4 0 0 1 78,73.4 L78,76.6 A1.4,1.4 0 0 1 76.6,78 L68.4,78 A1.4,1.4 0 0 1 67,76.6 L67,73.4 A1.4,1.4 0 0 1 68.4,72 Z" fill="#9A7E60"/><path d="M80.4,72 L88.6,72 A1.4,1.4 0 0 1 90,73.4 L90,76.6 A1.4,1.4 0 0 1 88.6,78 L80.4,78 A1.4,1.4 0 0 1 79,76.6 L79,73.4 A1.4,1.4 0 0 1 80.4,72 Z" fill="#8A6E52"/><path d="M28,22 L80,22 L80,44 L28,44 Z" fill="#120A06" fill-opacity="0.3"/><path d="M28,62 L80,62 L80,82 L28,82 Z" fill="#FFB861" fill-opacity="0.14"/><path d="M30,56 A24,19 0 1 0 78,56 A24,19 0 1 0 30,56 Z" fill="#120A06" fill-opacity="0.22"/><path d="M37,52 A17,14 0 1 0 71,52 A17,14 0 1 0 37,52 Z" fill="#120A06" fill-opacity="0.2"/></g><path d="M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 L66,80 L66,58.4 Q66,52 54,52 Q42,52 42,58.4 L42,80 Z" fill="#D6A96F" fill-opacity="0.5"/><path d="M30,78 L78,78 L73,85 L35,85 Z" fill="#7E6448"/><path d="M30,78 L78,78 L76.6,80 L31.4,80 Z" fill="#AD8E6A"/><path d="M32,82 A22,4.2 0 1 0 76,82 A22,4.2 0 1 0 32,82 Z" fill="#FFB861" fill-opacity="0.26"/><path d="M45.2,75.2 L62.8,75.2 A2.2,2.2 0 0 1 65,77.4 L65,77.4 A2.2,2.2 0 0 1 62.8,79.6 L45.2,79.6 A2.2,2.2 0 0 1 43,77.4 L43,77.4 A2.2,2.2 0 0 1 45.2,75.2 Z" fill="#FF7A2E"/><path d="M45.1,77.4 A0.9,0.9 0 1 0 46.9,77.4 A0.9,0.9 0 1 0 45.1,77.4 Z" fill="#FFC46A"/><path d="M50.3,78.2 A0.7,0.7 0 1 0 51.7,78.2 A0.7,0.7 0 1 0 50.3,78.2 Z" fill="#FFC46A"/><path d="M56.2,77.2 A0.8,0.8 0 1 0 57.8,77.2 A0.8,0.8 0 1 0 56.2,77.2 Z" fill="#FFC46A"/><path d="M61.3,78 A0.7,0.7 0 1 0 62.7,78 A0.7,0.7 0 1 0 61.3,78 Z" fill="#FFC46A"/><g transform="rotate(-8 54 73.7)"><path d="M43.2,71 L64.8,71 A2.7,2.7 0 0 1 67.5,73.7 L67.5,73.7 A2.7,2.7 0 0 1 64.8,76.4 L43.2,76.4 A2.7,2.7 0 0 1 40.5,73.7 L40.5,73.7 A2.7,2.7 0 0 1 43.2,71 Z" fill="#5B3B26"/><path d="M39.4,74.4 A1.8,2.7 0 1 0 43,74.4 A1.8,2.7 0 1 0 39.4,74.4 Z" fill="#8A6442"/></g><g transform="rotate(7 54 76)"><path d="M44.1,73.4 L64.9,73.4 A2.6,2.6 0 0 1 67.5,76 L67.5,76 A2.6,2.6 0 0 1 64.9,78.6 L44.1,78.6 A2.6,2.6 0 0 1 41.5,76 L41.5,76 A2.6,2.6 0 0 1 44.1,73.4 Z" fill="#47301F"/><path d="M64.7,76 A1.7,2.6 0 1 0 68.1,76 A1.7,2.6 0 1 0 64.7,76 Z" fill="#79573A"/></g><path d="M46,74.6 C50,74.2 54,74.6 58,74.2" fill="none" stroke="#FF7A2E" stroke-width="0.8" stroke-linecap="round"/><path d="M24,36 L84,36 L84,43.6 L81.6,46 L26.4,46 L24,43.6 Z" fill="#5A3A24"/><path d="M24,36 L84,36 L84,38.2 L24,38.2 Z" fill="#8A5F3C"/><path d="M28,41 L46,41" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M50,43.2 L72,43.2" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M58,40.2 L80,40.2" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M33.2,36 L35,36 A0.6,0.6 0 0 1 35.6,36.6 L35.6,45.4 A0.6,0.6 0 0 1 35,46 L33.2,46 A0.6,0.6 0 0 1 32.6,45.4 L32.6,36.6 A0.6,0.6 0 0 1 33.2,36 Z" fill="#241D18"/><path d="M73,36 L74.8,36 A0.6,0.6 0 0 1 75.4,36.6 L75.4,45.4 A0.6,0.6 0 0 1 74.8,46 L73,46 A0.6,0.6 0 0 1 72.4,45.4 L72.4,36.6 A0.6,0.6 0 0 1 73,36 Z" fill="#241D18"/><path d="M33.3,38.6 A0.8,0.8 0 1 0 34.9,38.6 A0.8,0.8 0 1 0 33.3,38.6 Z" fill="#5E544B"/><path d="M33.3,43.4 A0.8,0.8 0 1 0 34.9,43.4 A0.8,0.8 0 1 0 33.3,43.4 Z" fill="#5E544B"/><path d="M73.1,38.6 A0.8,0.8 0 1 0 74.7,38.6 A0.8,0.8 0 1 0 73.1,38.6 Z" fill="#5E544B"/><path d="M73.1,43.4 A0.8,0.8 0 1 0 74.7,43.4 A0.8,0.8 0 1 0 73.1,43.4 Z" fill="#5E544B"/><path d="M29.8,35.2 A4.2,1.5 0 1 0 38.2,35.2 A4.2,1.5 0 1 0 29.8,35.2 Z" fill="#6E6159"/><path d="M31.8,35.2 A2.2,1.8 0 0 1 36.2,35.2 Z" fill="#5E544B"/><path d="M33.7,27.6 L34.3,27.6 A1,1 0 0 1 35.3,28.6 L35.3,34.6 A1,1 0 0 1 34.3,35.6 L33.7,35.6 A1,1 0 0 1 32.7,34.6 L32.7,28.6 A1,1 0 0 1 33.7,27.6 Z" fill="#F0E2C2"/><path d="M32.7,31 C33.5,32.4 32.9,33.6 32.7,34.6 L31.6,34.6 C31.6,33.2 31.9,32 32.7,31 Z" fill="#D8C8A4"/><path d="M34,23.6 C35.5,25.6 35.9,26.4 35.9,27.4 C35.9,28.8 35.1,29.7 34,29.7 C32.9,29.7 32.1,28.8 32.1,27.4 C32.1,26.4 32.5,25.6 34,23.6 Z" fill="#FFD276"/><path d="M34,26.4 C34.7,27.4 34.9,27.9 34.9,28.4 C34.9,29.1 34.5,29.5 34,29.5 C33.5,29.5 33.1,29.1 33.1,28.4 C33.1,27.9 33.3,27.4 34,26.4 Z" fill="#FFF6DC"/><path d="M78.4,30.2 A2.5,2.5 0 0 1 78.4,34.6" fill="none" stroke="#8C8475" stroke-width="1.7"/><path d="M71.1,28.2 L77.3,28.2 A1.3,1.3 0 0 1 78.6,29.5 L78.6,34.7 A1.3,1.3 0 0 1 77.3,36 L71.1,36 A1.3,1.3 0 0 1 69.8,34.7 L69.8,29.5 A1.3,1.3 0 0 1 71.1,28.2 Z" fill="#8C8475"/><path d="M69.8,30.4 L78.6,30.4 L78.6,31.5 L69.8,31.5 Z" fill="#B9B2A2" fill-opacity="0.7"/><path d="M69.8,33.6 L78.6,33.6 L78.6,34.7 L69.8,34.7 Z" fill="#B9B2A2" fill-opacity="0.55"/><path d="M69.6,28.2 A4.6,1.8 0 1 0 78.8,28.2 A4.6,1.8 0 1 0 69.6,28.2 Z" fill="#EFE7D4"/>`;
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
