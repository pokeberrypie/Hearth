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

  const HEARTH = `<defs><clipPath id="bh0"><path clip-rule="evenodd" d="M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z"/></clipPath></defs><path d="M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z" fill-rule="evenodd" fill="#3F3124"/><g clip-path="url(#bh0)"><path d="M26.4,23 L34.6,23 A1.4,1.4 0 0 1 36,24.4 L36,27.6 A1.4,1.4 0 0 1 34.6,29 L26.4,29 A1.4,1.4 0 0 1 25,27.6 L25,24.4 A1.4,1.4 0 0 1 26.4,23 Z" fill="#9A7E60"/><path d="M38.4,23 L46.6,23 A1.4,1.4 0 0 1 48,24.4 L48,27.6 A1.4,1.4 0 0 1 46.6,29 L38.4,29 A1.4,1.4 0 0 1 37,27.6 L37,24.4 A1.4,1.4 0 0 1 38.4,23 Z" fill="#8A6E52"/><path d="M50.4,23 L58.6,23 A1.4,1.4 0 0 1 60,24.4 L60,27.6 A1.4,1.4 0 0 1 58.6,29 L50.4,29 A1.4,1.4 0 0 1 49,27.6 L49,24.4 A1.4,1.4 0 0 1 50.4,23 Z" fill="#A88B69"/><path d="M62.4,23 L70.6,23 A1.4,1.4 0 0 1 72,24.4 L72,27.6 A1.4,1.4 0 0 1 70.6,29 L62.4,29 A1.4,1.4 0 0 1 61,27.6 L61,24.4 A1.4,1.4 0 0 1 62.4,23 Z" fill="#7E6448"/><path d="M74.4,23 L82.6,23 A1.4,1.4 0 0 1 84,24.4 L84,27.6 A1.4,1.4 0 0 1 82.6,29 L74.4,29 A1.4,1.4 0 0 1 73,27.6 L73,24.4 A1.4,1.4 0 0 1 74.4,23 Z" fill="#937A5C"/><path d="M20.4,30 L28.6,30 A1.4,1.4 0 0 1 30,31.4 L30,34.6 A1.4,1.4 0 0 1 28.6,36 L20.4,36 A1.4,1.4 0 0 1 19,34.6 L19,31.4 A1.4,1.4 0 0 1 20.4,30 Z" fill="#9A7E60"/><path d="M32.4,30 L40.6,30 A1.4,1.4 0 0 1 42,31.4 L42,34.6 A1.4,1.4 0 0 1 40.6,36 L32.4,36 A1.4,1.4 0 0 1 31,34.6 L31,31.4 A1.4,1.4 0 0 1 32.4,30 Z" fill="#8A6E52"/><path d="M44.4,30 L52.6,30 A1.4,1.4 0 0 1 54,31.4 L54,34.6 A1.4,1.4 0 0 1 52.6,36 L44.4,36 A1.4,1.4 0 0 1 43,34.6 L43,31.4 A1.4,1.4 0 0 1 44.4,30 Z" fill="#A88B69"/><path d="M56.4,30 L64.6,30 A1.4,1.4 0 0 1 66,31.4 L66,34.6 A1.4,1.4 0 0 1 64.6,36 L56.4,36 A1.4,1.4 0 0 1 55,34.6 L55,31.4 A1.4,1.4 0 0 1 56.4,30 Z" fill="#7E6448"/><path d="M68.4,30 L76.6,30 A1.4,1.4 0 0 1 78,31.4 L78,34.6 A1.4,1.4 0 0 1 76.6,36 L68.4,36 A1.4,1.4 0 0 1 67,34.6 L67,31.4 A1.4,1.4 0 0 1 68.4,30 Z" fill="#937A5C"/><path d="M80.4,30 L88.6,30 A1.4,1.4 0 0 1 90,31.4 L90,34.6 A1.4,1.4 0 0 1 88.6,36 L80.4,36 A1.4,1.4 0 0 1 79,34.6 L79,31.4 A1.4,1.4 0 0 1 80.4,30 Z" fill="#9A7E60"/><path d="M26.4,37 L34.6,37 A1.4,1.4 0 0 1 36,38.4 L36,41.6 A1.4,1.4 0 0 1 34.6,43 L26.4,43 A1.4,1.4 0 0 1 25,41.6 L25,38.4 A1.4,1.4 0 0 1 26.4,37 Z" fill="#8A6E52"/><path d="M38.4,37 L46.6,37 A1.4,1.4 0 0 1 48,38.4 L48,41.6 A1.4,1.4 0 0 1 46.6,43 L38.4,43 A1.4,1.4 0 0 1 37,41.6 L37,38.4 A1.4,1.4 0 0 1 38.4,37 Z" fill="#A88B69"/><path d="M50.4,37 L58.6,37 A1.4,1.4 0 0 1 60,38.4 L60,41.6 A1.4,1.4 0 0 1 58.6,43 L50.4,43 A1.4,1.4 0 0 1 49,41.6 L49,38.4 A1.4,1.4 0 0 1 50.4,37 Z" fill="#7E6448"/><path d="M62.4,37 L70.6,37 A1.4,1.4 0 0 1 72,38.4 L72,41.6 A1.4,1.4 0 0 1 70.6,43 L62.4,43 A1.4,1.4 0 0 1 61,41.6 L61,38.4 A1.4,1.4 0 0 1 62.4,37 Z" fill="#937A5C"/><path d="M74.4,37 L82.6,37 A1.4,1.4 0 0 1 84,38.4 L84,41.6 A1.4,1.4 0 0 1 82.6,43 L74.4,43 A1.4,1.4 0 0 1 73,41.6 L73,38.4 A1.4,1.4 0 0 1 74.4,37 Z" fill="#9A7E60"/><path d="M20.4,44 L28.6,44 A1.4,1.4 0 0 1 30,45.4 L30,48.6 A1.4,1.4 0 0 1 28.6,50 L20.4,50 A1.4,1.4 0 0 1 19,48.6 L19,45.4 A1.4,1.4 0 0 1 20.4,44 Z" fill="#8A6E52"/><path d="M32.4,44 L40.6,44 A1.4,1.4 0 0 1 42,45.4 L42,48.6 A1.4,1.4 0 0 1 40.6,50 L32.4,50 A1.4,1.4 0 0 1 31,48.6 L31,45.4 A1.4,1.4 0 0 1 32.4,44 Z" fill="#A88B69"/><path d="M44.4,44 L52.6,44 A1.4,1.4 0 0 1 54,45.4 L54,48.6 A1.4,1.4 0 0 1 52.6,50 L44.4,50 A1.4,1.4 0 0 1 43,48.6 L43,45.4 A1.4,1.4 0 0 1 44.4,44 Z" fill="#7E6448"/><path d="M56.4,44 L64.6,44 A1.4,1.4 0 0 1 66,45.4 L66,48.6 A1.4,1.4 0 0 1 64.6,50 L56.4,50 A1.4,1.4 0 0 1 55,48.6 L55,45.4 A1.4,1.4 0 0 1 56.4,44 Z" fill="#937A5C"/><path d="M68.4,44 L76.6,44 A1.4,1.4 0 0 1 78,45.4 L78,48.6 A1.4,1.4 0 0 1 76.6,50 L68.4,50 A1.4,1.4 0 0 1 67,48.6 L67,45.4 A1.4,1.4 0 0 1 68.4,44 Z" fill="#9A7E60"/><path d="M80.4,44 L88.6,44 A1.4,1.4 0 0 1 90,45.4 L90,48.6 A1.4,1.4 0 0 1 88.6,50 L80.4,50 A1.4,1.4 0 0 1 79,48.6 L79,45.4 A1.4,1.4 0 0 1 80.4,44 Z" fill="#8A6E52"/><path d="M26.4,51 L34.6,51 A1.4,1.4 0 0 1 36,52.4 L36,55.6 A1.4,1.4 0 0 1 34.6,57 L26.4,57 A1.4,1.4 0 0 1 25,55.6 L25,52.4 A1.4,1.4 0 0 1 26.4,51 Z" fill="#A88B69"/><path d="M38.4,51 L46.6,51 A1.4,1.4 0 0 1 48,52.4 L48,55.6 A1.4,1.4 0 0 1 46.6,57 L38.4,57 A1.4,1.4 0 0 1 37,55.6 L37,52.4 A1.4,1.4 0 0 1 38.4,51 Z" fill="#7E6448"/><path d="M50.4,51 L58.6,51 A1.4,1.4 0 0 1 60,52.4 L60,55.6 A1.4,1.4 0 0 1 58.6,57 L50.4,57 A1.4,1.4 0 0 1 49,55.6 L49,52.4 A1.4,1.4 0 0 1 50.4,51 Z" fill="#937A5C"/><path d="M62.4,51 L70.6,51 A1.4,1.4 0 0 1 72,52.4 L72,55.6 A1.4,1.4 0 0 1 70.6,57 L62.4,57 A1.4,1.4 0 0 1 61,55.6 L61,52.4 A1.4,1.4 0 0 1 62.4,51 Z" fill="#9A7E60"/><path d="M74.4,51 L82.6,51 A1.4,1.4 0 0 1 84,52.4 L84,55.6 A1.4,1.4 0 0 1 82.6,57 L74.4,57 A1.4,1.4 0 0 1 73,55.6 L73,52.4 A1.4,1.4 0 0 1 74.4,51 Z" fill="#8A6E52"/><path d="M20.4,58 L28.6,58 A1.4,1.4 0 0 1 30,59.4 L30,62.6 A1.4,1.4 0 0 1 28.6,64 L20.4,64 A1.4,1.4 0 0 1 19,62.6 L19,59.4 A1.4,1.4 0 0 1 20.4,58 Z" fill="#A88B69"/><path d="M32.4,58 L40.6,58 A1.4,1.4 0 0 1 42,59.4 L42,62.6 A1.4,1.4 0 0 1 40.6,64 L32.4,64 A1.4,1.4 0 0 1 31,62.6 L31,59.4 A1.4,1.4 0 0 1 32.4,58 Z" fill="#7E6448"/><path d="M68.4,58 L76.6,58 A1.4,1.4 0 0 1 78,59.4 L78,62.6 A1.4,1.4 0 0 1 76.6,64 L68.4,64 A1.4,1.4 0 0 1 67,62.6 L67,59.4 A1.4,1.4 0 0 1 68.4,58 Z" fill="#937A5C"/><path d="M80.4,58 L88.6,58 A1.4,1.4 0 0 1 90,59.4 L90,62.6 A1.4,1.4 0 0 1 88.6,64 L80.4,64 A1.4,1.4 0 0 1 79,62.6 L79,59.4 A1.4,1.4 0 0 1 80.4,58 Z" fill="#9A7E60"/><path d="M26.4,65 L34.6,65 A1.4,1.4 0 0 1 36,66.4 L36,69.6 A1.4,1.4 0 0 1 34.6,71 L26.4,71 A1.4,1.4 0 0 1 25,69.6 L25,66.4 A1.4,1.4 0 0 1 26.4,65 Z" fill="#8A6E52"/><path d="M74.4,65 L82.6,65 A1.4,1.4 0 0 1 84,66.4 L84,69.6 A1.4,1.4 0 0 1 82.6,71 L74.4,71 A1.4,1.4 0 0 1 73,69.6 L73,66.4 A1.4,1.4 0 0 1 74.4,65 Z" fill="#A88B69"/><path d="M20.4,72 L28.6,72 A1.4,1.4 0 0 1 30,73.4 L30,76.6 A1.4,1.4 0 0 1 28.6,78 L20.4,78 A1.4,1.4 0 0 1 19,76.6 L19,73.4 A1.4,1.4 0 0 1 20.4,72 Z" fill="#7E6448"/><path d="M32.4,72 L40.6,72 A1.4,1.4 0 0 1 42,73.4 L42,76.6 A1.4,1.4 0 0 1 40.6,78 L32.4,78 A1.4,1.4 0 0 1 31,76.6 L31,73.4 A1.4,1.4 0 0 1 32.4,72 Z" fill="#937A5C"/><path d="M68.4,72 L76.6,72 A1.4,1.4 0 0 1 78,73.4 L78,76.6 A1.4,1.4 0 0 1 76.6,78 L68.4,78 A1.4,1.4 0 0 1 67,76.6 L67,73.4 A1.4,1.4 0 0 1 68.4,72 Z" fill="#9A7E60"/><path d="M80.4,72 L88.6,72 A1.4,1.4 0 0 1 90,73.4 L90,76.6 A1.4,1.4 0 0 1 88.6,78 L80.4,78 A1.4,1.4 0 0 1 79,76.6 L79,73.4 A1.4,1.4 0 0 1 80.4,72 Z" fill="#8A6E52"/><path d="M28,22 L80,22 L80,44 L28,44 Z" fill="#120A06" fill-opacity="0.3"/><path d="M28,62 L80,62 L80,82 L28,82 Z" fill="#FFB861" fill-opacity="0.14"/><path d="M30,56 A24,19 0 1 0 78,56 A24,19 0 1 0 30,56 Z" fill="#120A06" fill-opacity="0.22"/><path d="M37,52 A17,14 0 1 0 71,52 A17,14 0 1 0 37,52 Z" fill="#120A06" fill-opacity="0.2"/></g><path d="M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 L66,80 L66,58.4 Q66,52 54,52 Q42,52 42,58.4 L42,80 Z" fill="#D6A96F" fill-opacity="0.5"/><path d="M30,78 L78,78 L73,85 L35,85 Z" fill="#7E6448"/><path d="M30,78 L78,78 L76.6,80 L31.4,80 Z" fill="#AD8E6A"/><path d="M32,82 A22,4.2 0 1 0 76,82 A22,4.2 0 1 0 32,82 Z" fill="#FFB861" fill-opacity="0.26"/><path d="M24,36 L84,36 L84,43.6 L81.6,46 L26.4,46 L24,43.6 Z" fill="#5A3A24"/><path d="M24,36 L84,36 L84,38.2 L24,38.2 Z" fill="#8A5F3C"/><path d="M28,41 L46,41" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M50,43.2 L72,43.2" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M58,40.2 L80,40.2" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M33.2,36 L35,36 A0.6,0.6 0 0 1 35.6,36.6 L35.6,45.4 A0.6,0.6 0 0 1 35,46 L33.2,46 A0.6,0.6 0 0 1 32.6,45.4 L32.6,36.6 A0.6,0.6 0 0 1 33.2,36 Z" fill="#241D18"/><path d="M73,36 L74.8,36 A0.6,0.6 0 0 1 75.4,36.6 L75.4,45.4 A0.6,0.6 0 0 1 74.8,46 L73,46 A0.6,0.6 0 0 1 72.4,45.4 L72.4,36.6 A0.6,0.6 0 0 1 73,36 Z" fill="#241D18"/><path d="M33.3,38.6 A0.8,0.8 0 1 0 34.9,38.6 A0.8,0.8 0 1 0 33.3,38.6 Z" fill="#5E544B"/><path d="M33.3,43.4 A0.8,0.8 0 1 0 34.9,43.4 A0.8,0.8 0 1 0 33.3,43.4 Z" fill="#5E544B"/><path d="M73.1,38.6 A0.8,0.8 0 1 0 74.7,38.6 A0.8,0.8 0 1 0 73.1,38.6 Z" fill="#5E544B"/><path d="M73.1,43.4 A0.8,0.8 0 1 0 74.7,43.4 A0.8,0.8 0 1 0 73.1,43.4 Z" fill="#5E544B"/><path d="M29.8,35.2 A4.2,1.5 0 1 0 38.2,35.2 A4.2,1.5 0 1 0 29.8,35.2 Z" fill="#6E6159"/><path d="M31.8,35.2 A2.2,1.8 0 0 1 36.2,35.2 Z" fill="#5E544B"/><path d="M33.7,27.6 L34.3,27.6 A1,1 0 0 1 35.3,28.6 L35.3,34.6 A1,1 0 0 1 34.3,35.6 L33.7,35.6 A1,1 0 0 1 32.7,34.6 L32.7,28.6 A1,1 0 0 1 33.7,27.6 Z" fill="#F0E2C2"/><path d="M32.7,31 C33.5,32.4 32.9,33.6 32.7,34.6 L31.6,34.6 C31.6,33.2 31.9,32 32.7,31 Z" fill="#D8C8A4"/><path d="M34,23.6 C35.5,25.6 35.9,26.4 35.9,27.4 C35.9,28.8 35.1,29.7 34,29.7 C32.9,29.7 32.1,28.8 32.1,27.4 C32.1,26.4 32.5,25.6 34,23.6 Z" fill="#FFD276"/><path d="M34,26.4 C34.7,27.4 34.9,27.9 34.9,28.4 C34.9,29.1 34.5,29.5 34,29.5 C33.5,29.5 33.1,29.1 33.1,28.4 C33.1,27.9 33.3,27.4 34,26.4 Z" fill="#FFF6DC"/><path d="M78.4,30.2 A2.5,2.5 0 0 1 78.4,34.6" fill="none" stroke="#8C8475" stroke-width="1.7"/><path d="M71.1,28.2 L77.3,28.2 A1.3,1.3 0 0 1 78.6,29.5 L78.6,34.7 A1.3,1.3 0 0 1 77.3,36 L71.1,36 A1.3,1.3 0 0 1 69.8,34.7 L69.8,29.5 A1.3,1.3 0 0 1 71.1,28.2 Z" fill="#8C8475"/><path d="M69.8,30.4 L78.6,30.4 L78.6,31.5 L69.8,31.5 Z" fill="#B9B2A2" fill-opacity="0.7"/><path d="M69.8,33.6 L78.6,33.6 L78.6,34.7 L69.8,34.7 Z" fill="#B9B2A2" fill-opacity="0.55"/><path d="M69.6,28.2 A4.6,1.8 0 1 0 78.8,28.2 A4.6,1.8 0 1 0 69.6,28.2 Z" fill="#EFE7D4"/>`;
  // The logs and embers, drawn over the fire so it burns in the grate.
  const GRATE_ART = `<defs><clipPath id="bh0"><path clip-rule="evenodd" d="M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z"/></clipPath></defs><path d="M45.2,75.2 L62.8,75.2 A2.2,2.2 0 0 1 65,77.4 L65,77.4 A2.2,2.2 0 0 1 62.8,79.6 L45.2,79.6 A2.2,2.2 0 0 1 43,77.4 L43,77.4 A2.2,2.2 0 0 1 45.2,75.2 Z" fill="#FF7A2E"/><path d="M45.1,77.4 A0.9,0.9 0 1 0 46.9,77.4 A0.9,0.9 0 1 0 45.1,77.4 Z" fill="#FFC46A"/><path d="M50.3,78.2 A0.7,0.7 0 1 0 51.7,78.2 A0.7,0.7 0 1 0 50.3,78.2 Z" fill="#FFC46A"/><path d="M56.2,77.2 A0.8,0.8 0 1 0 57.8,77.2 A0.8,0.8 0 1 0 56.2,77.2 Z" fill="#FFC46A"/><path d="M61.3,78 A0.7,0.7 0 1 0 62.7,78 A0.7,0.7 0 1 0 61.3,78 Z" fill="#FFC46A"/><g transform="rotate(-8 54 73.7)"><path d="M43.2,71 L64.8,71 A2.7,2.7 0 0 1 67.5,73.7 L67.5,73.7 A2.7,2.7 0 0 1 64.8,76.4 L43.2,76.4 A2.7,2.7 0 0 1 40.5,73.7 L40.5,73.7 A2.7,2.7 0 0 1 43.2,71 Z" fill="#5B3B26"/><path d="M39.4,74.4 A1.8,2.7 0 1 0 43,74.4 A1.8,2.7 0 1 0 39.4,74.4 Z" fill="#8A6442"/></g><g transform="rotate(7 54 76)"><path d="M44.1,73.4 L64.9,73.4 A2.6,2.6 0 0 1 67.5,76 L67.5,76 A2.6,2.6 0 0 1 64.9,78.6 L44.1,78.6 A2.6,2.6 0 0 1 41.5,76 L41.5,76 A2.6,2.6 0 0 1 44.1,73.4 Z" fill="#47301F"/><path d="M64.7,76 A1.7,2.6 0 1 0 68.1,76 A1.7,2.6 0 1 0 64.7,76 Z" fill="#79573A"/></g><path d="M46,74.6 C50,74.2 54,74.6 58,74.2" fill="none" stroke="#FF7A2E" stroke-width="0.8" stroke-linecap="round"/>`;
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
#boot.hf .hf-logs { filter: none; }`;

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
      <canvas class="hf-fire hf-front"></canvas>
      <svg class="hf-hearth hf-logs" viewBox="14 16 80 74" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${GRATE_ART}</svg>
      <div class="hf-light"></div>`;
    const svg = root.querySelector(".hf-hearth");
    const logs = root.querySelector(".hf-logs");
    const canvas = root.querySelector(".hf-front");
    const back = root.querySelector(".hf-back");
    const s = {
      root, svg, logs, canvas, ctx: canvas.getContext("2d"), back, bctx: back.getContext("2d"), still,
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
      const tallIn = (grate.y - archTop) * lerp(0.8, 1.6, clamp(heat / 0.14, 0, 1));
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
    const archAt = (dx) => {
      const k = Math.min(1, dx / mouth);
      return k < 0.97 ? grate.y + u0 : archTop + 8 * u0 + 0.6 * u0;
    };
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
          // Beyond the mouth the foot lifts away from it — more for the inner, brighter colours — so the
          // flames leave the arch and climb the stone rather than sit on it.
          const lift = dx <= mouth ? 0 : Math.pow((dx - mouth) / Math.max(1, half - mouth), 1.6) * tall * lerp(0.62, 0.3, out) * (1 + li * 0.18);
          const wave = (Math.sin(x * 0.045 + t * 3.1 + li) * 1.2 + Math.sin(x * 0.11 - t * 4.7 + li * 2) * 0.8) * u0 * Math.min(1, dx / mouth);
          const low = archAt(dx) - lift + wave;
          // Inside the mouth the brighter colours sit lower, and rise out of it as tongues.
          const sink = dx < mouth ? (grate.y - archTop) * 0.22 * li * (1 - out) : 0;
          const top = Math.min(low, archTop + sink - tall * heightAt(li, u, t, out) + (1 - out) * 4 * u0);
          tops.push([x, top]); lows.push([x, low]);
        }
        ctx.beginPath();
        ctx.moveTo(lows[0][0], lows[0][1]);
        for (const [x, y] of tops) ctx.lineTo(x, y);
        for (let i = lows.length - 1; i >= 0; i--) ctx.lineTo(lows[i][0], lows[i][1]);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    // And the room's, climbing from below the bottom of the screen over everything — the hearth and its
    // fire — until it is the whole screen.
    if (floorTall > 0) {
      for (let li = 0; li < LAYERS.length; li++) {
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
    s.svg.style.opacity = s.logs.style.opacity = String(1 - gone * gone * (3 - 2 * gone));
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
