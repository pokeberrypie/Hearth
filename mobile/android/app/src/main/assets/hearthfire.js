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
 * writes it from gen_icon.py), without the icon's little static flame: the
 * fire here is real. Particles rise from the grate, each cooling as it goes —
 * white-gold, amber, orange, a deep red, then smoke — swaying, drawn in toward
 * the flame's middle so they lick into tongues, and added together so where
 * they crowd they burn brightest. It grows out of the firebox until it has
 * the whole screen; when the app is ready, the fire itself splits down the
 * middle and draws apart, and the app is there in the gap.
 *
 *   HearthFire.light(el, { lit })   start it; lit = already at full height
 *   HearthFire.part()               split it open; resolves when it is gone
 */
(function () {
  "use strict";

  const HEARTH = `<defs><clipPath id="bh0"><path d="M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z"/></clipPath></defs><path d="M40,22 L68,22 L72,32 L80,42 L80,74 L77,80 L31,80 L28,74 L28,42 L36,32 Z" fill="#3F3124"/><g clip-path="url(#bh0)"><path d="M26.4,23 L34.6,23 A1.4,1.4 0 0 1 36,24.4 L36,27.6 A1.4,1.4 0 0 1 34.6,29 L26.4,29 A1.4,1.4 0 0 1 25,27.6 L25,24.4 A1.4,1.4 0 0 1 26.4,23 Z" fill="#9A7E60"/><path d="M38.4,23 L46.6,23 A1.4,1.4 0 0 1 48,24.4 L48,27.6 A1.4,1.4 0 0 1 46.6,29 L38.4,29 A1.4,1.4 0 0 1 37,27.6 L37,24.4 A1.4,1.4 0 0 1 38.4,23 Z" fill="#8A6E52"/><path d="M50.4,23 L58.6,23 A1.4,1.4 0 0 1 60,24.4 L60,27.6 A1.4,1.4 0 0 1 58.6,29 L50.4,29 A1.4,1.4 0 0 1 49,27.6 L49,24.4 A1.4,1.4 0 0 1 50.4,23 Z" fill="#A88B69"/><path d="M62.4,23 L70.6,23 A1.4,1.4 0 0 1 72,24.4 L72,27.6 A1.4,1.4 0 0 1 70.6,29 L62.4,29 A1.4,1.4 0 0 1 61,27.6 L61,24.4 A1.4,1.4 0 0 1 62.4,23 Z" fill="#7E6448"/><path d="M74.4,23 L82.6,23 A1.4,1.4 0 0 1 84,24.4 L84,27.6 A1.4,1.4 0 0 1 82.6,29 L74.4,29 A1.4,1.4 0 0 1 73,27.6 L73,24.4 A1.4,1.4 0 0 1 74.4,23 Z" fill="#937A5C"/><path d="M20.4,30 L28.6,30 A1.4,1.4 0 0 1 30,31.4 L30,34.6 A1.4,1.4 0 0 1 28.6,36 L20.4,36 A1.4,1.4 0 0 1 19,34.6 L19,31.4 A1.4,1.4 0 0 1 20.4,30 Z" fill="#9A7E60"/><path d="M32.4,30 L40.6,30 A1.4,1.4 0 0 1 42,31.4 L42,34.6 A1.4,1.4 0 0 1 40.6,36 L32.4,36 A1.4,1.4 0 0 1 31,34.6 L31,31.4 A1.4,1.4 0 0 1 32.4,30 Z" fill="#8A6E52"/><path d="M44.4,30 L52.6,30 A1.4,1.4 0 0 1 54,31.4 L54,34.6 A1.4,1.4 0 0 1 52.6,36 L44.4,36 A1.4,1.4 0 0 1 43,34.6 L43,31.4 A1.4,1.4 0 0 1 44.4,30 Z" fill="#A88B69"/><path d="M56.4,30 L64.6,30 A1.4,1.4 0 0 1 66,31.4 L66,34.6 A1.4,1.4 0 0 1 64.6,36 L56.4,36 A1.4,1.4 0 0 1 55,34.6 L55,31.4 A1.4,1.4 0 0 1 56.4,30 Z" fill="#7E6448"/><path d="M68.4,30 L76.6,30 A1.4,1.4 0 0 1 78,31.4 L78,34.6 A1.4,1.4 0 0 1 76.6,36 L68.4,36 A1.4,1.4 0 0 1 67,34.6 L67,31.4 A1.4,1.4 0 0 1 68.4,30 Z" fill="#937A5C"/><path d="M80.4,30 L88.6,30 A1.4,1.4 0 0 1 90,31.4 L90,34.6 A1.4,1.4 0 0 1 88.6,36 L80.4,36 A1.4,1.4 0 0 1 79,34.6 L79,31.4 A1.4,1.4 0 0 1 80.4,30 Z" fill="#9A7E60"/><path d="M26.4,37 L34.6,37 A1.4,1.4 0 0 1 36,38.4 L36,41.6 A1.4,1.4 0 0 1 34.6,43 L26.4,43 A1.4,1.4 0 0 1 25,41.6 L25,38.4 A1.4,1.4 0 0 1 26.4,37 Z" fill="#8A6E52"/><path d="M38.4,37 L46.6,37 A1.4,1.4 0 0 1 48,38.4 L48,41.6 A1.4,1.4 0 0 1 46.6,43 L38.4,43 A1.4,1.4 0 0 1 37,41.6 L37,38.4 A1.4,1.4 0 0 1 38.4,37 Z" fill="#A88B69"/><path d="M50.4,37 L58.6,37 A1.4,1.4 0 0 1 60,38.4 L60,41.6 A1.4,1.4 0 0 1 58.6,43 L50.4,43 A1.4,1.4 0 0 1 49,41.6 L49,38.4 A1.4,1.4 0 0 1 50.4,37 Z" fill="#7E6448"/><path d="M62.4,37 L70.6,37 A1.4,1.4 0 0 1 72,38.4 L72,41.6 A1.4,1.4 0 0 1 70.6,43 L62.4,43 A1.4,1.4 0 0 1 61,41.6 L61,38.4 A1.4,1.4 0 0 1 62.4,37 Z" fill="#937A5C"/><path d="M74.4,37 L82.6,37 A1.4,1.4 0 0 1 84,38.4 L84,41.6 A1.4,1.4 0 0 1 82.6,43 L74.4,43 A1.4,1.4 0 0 1 73,41.6 L73,38.4 A1.4,1.4 0 0 1 74.4,37 Z" fill="#9A7E60"/><path d="M20.4,44 L28.6,44 A1.4,1.4 0 0 1 30,45.4 L30,48.6 A1.4,1.4 0 0 1 28.6,50 L20.4,50 A1.4,1.4 0 0 1 19,48.6 L19,45.4 A1.4,1.4 0 0 1 20.4,44 Z" fill="#8A6E52"/><path d="M32.4,44 L40.6,44 A1.4,1.4 0 0 1 42,45.4 L42,48.6 A1.4,1.4 0 0 1 40.6,50 L32.4,50 A1.4,1.4 0 0 1 31,48.6 L31,45.4 A1.4,1.4 0 0 1 32.4,44 Z" fill="#A88B69"/><path d="M44.4,44 L52.6,44 A1.4,1.4 0 0 1 54,45.4 L54,48.6 A1.4,1.4 0 0 1 52.6,50 L44.4,50 A1.4,1.4 0 0 1 43,48.6 L43,45.4 A1.4,1.4 0 0 1 44.4,44 Z" fill="#7E6448"/><path d="M56.4,44 L64.6,44 A1.4,1.4 0 0 1 66,45.4 L66,48.6 A1.4,1.4 0 0 1 64.6,50 L56.4,50 A1.4,1.4 0 0 1 55,48.6 L55,45.4 A1.4,1.4 0 0 1 56.4,44 Z" fill="#937A5C"/><path d="M68.4,44 L76.6,44 A1.4,1.4 0 0 1 78,45.4 L78,48.6 A1.4,1.4 0 0 1 76.6,50 L68.4,50 A1.4,1.4 0 0 1 67,48.6 L67,45.4 A1.4,1.4 0 0 1 68.4,44 Z" fill="#9A7E60"/><path d="M80.4,44 L88.6,44 A1.4,1.4 0 0 1 90,45.4 L90,48.6 A1.4,1.4 0 0 1 88.6,50 L80.4,50 A1.4,1.4 0 0 1 79,48.6 L79,45.4 A1.4,1.4 0 0 1 80.4,44 Z" fill="#8A6E52"/><path d="M26.4,51 L34.6,51 A1.4,1.4 0 0 1 36,52.4 L36,55.6 A1.4,1.4 0 0 1 34.6,57 L26.4,57 A1.4,1.4 0 0 1 25,55.6 L25,52.4 A1.4,1.4 0 0 1 26.4,51 Z" fill="#A88B69"/><path d="M38.4,51 L46.6,51 A1.4,1.4 0 0 1 48,52.4 L48,55.6 A1.4,1.4 0 0 1 46.6,57 L38.4,57 A1.4,1.4 0 0 1 37,55.6 L37,52.4 A1.4,1.4 0 0 1 38.4,51 Z" fill="#7E6448"/><path d="M50.4,51 L58.6,51 A1.4,1.4 0 0 1 60,52.4 L60,55.6 A1.4,1.4 0 0 1 58.6,57 L50.4,57 A1.4,1.4 0 0 1 49,55.6 L49,52.4 A1.4,1.4 0 0 1 50.4,51 Z" fill="#937A5C"/><path d="M62.4,51 L70.6,51 A1.4,1.4 0 0 1 72,52.4 L72,55.6 A1.4,1.4 0 0 1 70.6,57 L62.4,57 A1.4,1.4 0 0 1 61,55.6 L61,52.4 A1.4,1.4 0 0 1 62.4,51 Z" fill="#9A7E60"/><path d="M74.4,51 L82.6,51 A1.4,1.4 0 0 1 84,52.4 L84,55.6 A1.4,1.4 0 0 1 82.6,57 L74.4,57 A1.4,1.4 0 0 1 73,55.6 L73,52.4 A1.4,1.4 0 0 1 74.4,51 Z" fill="#8A6E52"/><path d="M20.4,58 L28.6,58 A1.4,1.4 0 0 1 30,59.4 L30,62.6 A1.4,1.4 0 0 1 28.6,64 L20.4,64 A1.4,1.4 0 0 1 19,62.6 L19,59.4 A1.4,1.4 0 0 1 20.4,58 Z" fill="#A88B69"/><path d="M32.4,58 L40.6,58 A1.4,1.4 0 0 1 42,59.4 L42,62.6 A1.4,1.4 0 0 1 40.6,64 L32.4,64 A1.4,1.4 0 0 1 31,62.6 L31,59.4 A1.4,1.4 0 0 1 32.4,58 Z" fill="#7E6448"/><path d="M68.4,58 L76.6,58 A1.4,1.4 0 0 1 78,59.4 L78,62.6 A1.4,1.4 0 0 1 76.6,64 L68.4,64 A1.4,1.4 0 0 1 67,62.6 L67,59.4 A1.4,1.4 0 0 1 68.4,58 Z" fill="#937A5C"/><path d="M80.4,58 L88.6,58 A1.4,1.4 0 0 1 90,59.4 L90,62.6 A1.4,1.4 0 0 1 88.6,64 L80.4,64 A1.4,1.4 0 0 1 79,62.6 L79,59.4 A1.4,1.4 0 0 1 80.4,58 Z" fill="#9A7E60"/><path d="M26.4,65 L34.6,65 A1.4,1.4 0 0 1 36,66.4 L36,69.6 A1.4,1.4 0 0 1 34.6,71 L26.4,71 A1.4,1.4 0 0 1 25,69.6 L25,66.4 A1.4,1.4 0 0 1 26.4,65 Z" fill="#8A6E52"/><path d="M74.4,65 L82.6,65 A1.4,1.4 0 0 1 84,66.4 L84,69.6 A1.4,1.4 0 0 1 82.6,71 L74.4,71 A1.4,1.4 0 0 1 73,69.6 L73,66.4 A1.4,1.4 0 0 1 74.4,65 Z" fill="#A88B69"/><path d="M20.4,72 L28.6,72 A1.4,1.4 0 0 1 30,73.4 L30,76.6 A1.4,1.4 0 0 1 28.6,78 L20.4,78 A1.4,1.4 0 0 1 19,76.6 L19,73.4 A1.4,1.4 0 0 1 20.4,72 Z" fill="#7E6448"/><path d="M32.4,72 L40.6,72 A1.4,1.4 0 0 1 42,73.4 L42,76.6 A1.4,1.4 0 0 1 40.6,78 L32.4,78 A1.4,1.4 0 0 1 31,76.6 L31,73.4 A1.4,1.4 0 0 1 32.4,72 Z" fill="#937A5C"/><path d="M68.4,72 L76.6,72 A1.4,1.4 0 0 1 78,73.4 L78,76.6 A1.4,1.4 0 0 1 76.6,78 L68.4,78 A1.4,1.4 0 0 1 67,76.6 L67,73.4 A1.4,1.4 0 0 1 68.4,72 Z" fill="#9A7E60"/><path d="M80.4,72 L88.6,72 A1.4,1.4 0 0 1 90,73.4 L90,76.6 A1.4,1.4 0 0 1 88.6,78 L80.4,78 A1.4,1.4 0 0 1 79,76.6 L79,73.4 A1.4,1.4 0 0 1 80.4,72 Z" fill="#8A6E52"/><path d="M28,22 L80,22 L80,44 L28,44 Z" fill="#120A06" fill-opacity="0.3"/><path d="M28,62 L80,62 L80,82 L28,82 Z" fill="#FFB861" fill-opacity="0.14"/><path d="M30,56 A24,19 0 1 0 78,56 A24,19 0 1 0 30,56 Z" fill="#120A06" fill-opacity="0.22"/><path d="M37,52 A17,14 0 1 0 71,52 A17,14 0 1 0 37,52 Z" fill="#120A06" fill-opacity="0.2"/></g><path d="M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 Z" fill="#190C07"/><path d="M40,72 A14,10 0 1 0 68,72 A14,10 0 1 0 40,72 Z" fill="#7A2F10" fill-opacity="0.6"/><path d="M40,80 L40,58 Q40,50 54,50 Q68,50 68,58 L68,80 L66,80 L66,58.4 Q66,52 54,52 Q42,52 42,58.4 L42,80 Z" fill="#D6A96F" fill-opacity="0.5"/><path d="M30,78 L78,78 L73,85 L35,85 Z" fill="#7E6448"/><path d="M30,78 L78,78 L76.6,80 L31.4,80 Z" fill="#AD8E6A"/><path d="M32,82 A22,4.2 0 1 0 76,82 A22,4.2 0 1 0 32,82 Z" fill="#FFB861" fill-opacity="0.26"/><path d="M45.2,75.2 L62.8,75.2 A2.2,2.2 0 0 1 65,77.4 L65,77.4 A2.2,2.2 0 0 1 62.8,79.6 L45.2,79.6 A2.2,2.2 0 0 1 43,77.4 L43,77.4 A2.2,2.2 0 0 1 45.2,75.2 Z" fill="#FF7A2E"/><path d="M45.1,77.4 A0.9,0.9 0 1 0 46.9,77.4 A0.9,0.9 0 1 0 45.1,77.4 Z" fill="#FFC46A"/><path d="M50.3,78.2 A0.7,0.7 0 1 0 51.7,78.2 A0.7,0.7 0 1 0 50.3,78.2 Z" fill="#FFC46A"/><path d="M56.2,77.2 A0.8,0.8 0 1 0 57.8,77.2 A0.8,0.8 0 1 0 56.2,77.2 Z" fill="#FFC46A"/><path d="M61.3,78 A0.7,0.7 0 1 0 62.7,78 A0.7,0.7 0 1 0 61.3,78 Z" fill="#FFC46A"/><g transform="rotate(-8 54 73.7)"><path d="M43.2,71 L64.8,71 A2.7,2.7 0 0 1 67.5,73.7 L67.5,73.7 A2.7,2.7 0 0 1 64.8,76.4 L43.2,76.4 A2.7,2.7 0 0 1 40.5,73.7 L40.5,73.7 A2.7,2.7 0 0 1 43.2,71 Z" fill="#5B3B26"/><path d="M39.4,74.4 A1.8,2.7 0 1 0 43,74.4 A1.8,2.7 0 1 0 39.4,74.4 Z" fill="#8A6442"/></g><g transform="rotate(7 54 76)"><path d="M44.1,73.4 L64.9,73.4 A2.6,2.6 0 0 1 67.5,76 L67.5,76 A2.6,2.6 0 0 1 64.9,78.6 L44.1,78.6 A2.6,2.6 0 0 1 41.5,76 L41.5,76 A2.6,2.6 0 0 1 44.1,73.4 Z" fill="#47301F"/><path d="M64.7,76 A1.7,2.6 0 1 0 68.1,76 A1.7,2.6 0 1 0 64.7,76 Z" fill="#79573A"/></g><path d="M46,74.6 C50,74.2 54,74.6 58,74.2" fill="none" stroke="#FF7A2E" stroke-width="0.8" stroke-linecap="round"/><path d="M24,36 L84,36 L84,43.6 L81.6,46 L26.4,46 L24,43.6 Z" fill="#5A3A24"/><path d="M24,36 L84,36 L84,38.2 L24,38.2 Z" fill="#8A5F3C"/><path d="M28,41 L46,41" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M50,43.2 L72,43.2" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M58,40.2 L80,40.2" fill="none" stroke="#3A2214" stroke-width="0.6" stroke-linecap="round"/><path d="M33.2,36 L35,36 A0.6,0.6 0 0 1 35.6,36.6 L35.6,45.4 A0.6,0.6 0 0 1 35,46 L33.2,46 A0.6,0.6 0 0 1 32.6,45.4 L32.6,36.6 A0.6,0.6 0 0 1 33.2,36 Z" fill="#241D18"/><path d="M73,36 L74.8,36 A0.6,0.6 0 0 1 75.4,36.6 L75.4,45.4 A0.6,0.6 0 0 1 74.8,46 L73,46 A0.6,0.6 0 0 1 72.4,45.4 L72.4,36.6 A0.6,0.6 0 0 1 73,36 Z" fill="#241D18"/><path d="M33.3,38.6 A0.8,0.8 0 1 0 34.9,38.6 A0.8,0.8 0 1 0 33.3,38.6 Z" fill="#5E544B"/><path d="M33.3,43.4 A0.8,0.8 0 1 0 34.9,43.4 A0.8,0.8 0 1 0 33.3,43.4 Z" fill="#5E544B"/><path d="M73.1,38.6 A0.8,0.8 0 1 0 74.7,38.6 A0.8,0.8 0 1 0 73.1,38.6 Z" fill="#5E544B"/><path d="M73.1,43.4 A0.8,0.8 0 1 0 74.7,43.4 A0.8,0.8 0 1 0 73.1,43.4 Z" fill="#5E544B"/><path d="M29.8,35.2 A4.2,1.5 0 1 0 38.2,35.2 A4.2,1.5 0 1 0 29.8,35.2 Z" fill="#6E6159"/><path d="M31.8,35.2 A2.2,1.8 0 0 1 36.2,35.2 Z" fill="#5E544B"/><path d="M33.7,27.6 L34.3,27.6 A1,1 0 0 1 35.3,28.6 L35.3,34.6 A1,1 0 0 1 34.3,35.6 L33.7,35.6 A1,1 0 0 1 32.7,34.6 L32.7,28.6 A1,1 0 0 1 33.7,27.6 Z" fill="#F0E2C2"/><path d="M32.7,31 C33.5,32.4 32.9,33.6 32.7,34.6 L31.6,34.6 C31.6,33.2 31.9,32 32.7,31 Z" fill="#D8C8A4"/><path d="M34,23.6 C35.5,25.6 35.9,26.4 35.9,27.4 C35.9,28.8 35.1,29.7 34,29.7 C32.9,29.7 32.1,28.8 32.1,27.4 C32.1,26.4 32.5,25.6 34,23.6 Z" fill="#FFD276"/><path d="M34,26.4 C34.7,27.4 34.9,27.9 34.9,28.4 C34.9,29.1 34.5,29.5 34,29.5 C33.5,29.5 33.1,29.1 33.1,28.4 C33.1,27.9 33.3,27.4 34,26.4 Z" fill="#FFF6DC"/><path d="M78.4,30.2 A2.5,2.5 0 0 1 78.4,34.6" fill="none" stroke="#8C8475" stroke-width="1.7"/><path d="M71.1,28.2 L77.3,28.2 A1.3,1.3 0 0 1 78.6,29.5 L78.6,34.7 A1.3,1.3 0 0 1 77.3,36 L71.1,36 A1.3,1.3 0 0 1 69.8,34.7 L69.8,29.5 A1.3,1.3 0 0 1 71.1,28.2 Z" fill="#8C8475"/><path d="M69.8,30.4 L78.6,30.4 L78.6,31.5 L69.8,31.5 Z" fill="#B9B2A2" fill-opacity="0.7"/><path d="M69.8,33.6 L78.6,33.6 L78.6,34.7 L69.8,34.7 Z" fill="#B9B2A2" fill-opacity="0.55"/><path d="M69.6,28.2 A4.6,1.8 0 1 0 78.8,28.2 A4.6,1.8 0 1 0 69.6,28.2 Z" fill="#EFE7D4"/>`;
  // Where the fire sits in the drawing: the grate, in the icon's 108-unit viewBox.
  const GRATE = { x: 54, y: 77, half: 10 };
  const RISE_MS = 2600;
  const PART_MS = 1700;

  // The colour a flame is at each point of its short life, hottest first.
  const RAMP = [
    [0.00, 255, 238, 196, 0.85],
    [0.12, 255, 206, 120, 0.80],
    [0.30, 255, 150, 52, 0.70],
    [0.52, 226, 92, 28, 0.52],
    [0.74, 150, 42, 20, 0.30],
    [0.90, 60, 26, 20, 0.12],
    [1.00, 30, 20, 18, 0.00],
  ];
  const SPRITES = 28;

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function colourAt(t) {
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        const a = RAMP[i - 1], b = RAMP[i], k = (t - a[0]) / (b[0] - a[0]);
        return [lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k), lerp(a[4], b[4], k)];
      }
    }
    return RAMP[RAMP.length - 1].slice(1);
  }

  /** A soft round glow for each step of the ramp, drawn once: blitting these is far cheaper than a gradient per particle. */
  function sprites() {
    const out = [];
    for (let i = 0; i < SPRITES; i++) {
      const [r, g, b, a] = colourAt(i / (SPRITES - 1));
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const x = c.getContext("2d");
      const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      // Faint on its own: added together, only where the flame is thickest does it burn to white-gold.
      grad.addColorStop(0, `rgba(${r | 0},${g | 0},${b | 0},${a * 0.34})`);
      grad.addColorStop(0.45, `rgba(${r | 0},${g | 0},${b | 0},${a * 0.17})`);
      grad.addColorStop(1, `rgba(${r | 0},${g | 0},${b | 0},0)`);
      x.fillStyle = grad;
      x.fillRect(0, 0, 64, 64);
      out.push(c);
    }
    return out;
  }

  let state = null;

  /** Its own look, carried with it, so the phone's boot.html and the app draw the same thing from the same file. */
  const CSS = `
#boot.hf { position: fixed; inset: 0; z-index: 999; pointer-events: none; overflow: hidden; background: #120c09; }
#boot.hf .hf-room { position: absolute; inset: 0;
  background: radial-gradient(75% 55% at 50% 82%, #3a2014 0%, #1e120c 45%, #0e0907 100%); }
#boot.hf svg { fill: initial; stroke: none; stroke-width: 0; }
#boot.hf .hf-hearth { position: absolute; left: 50%; bottom: 4vh; transform: translateX(-50%);
  width: min(88vw, 64vh); height: auto; aspect-ratio: 80 / 74; overflow: visible;
  filter: brightness(calc(0.55 + var(--heat, 0) * 0.6)); }
#boot.hf .hf-fire { position: absolute; inset: 0; width: 100%; height: 100%; }
#boot.hf .hf-light { position: absolute; inset: 0; mix-blend-mode: screen;
  background: radial-gradient(70% 55% at 50% 80%, rgba(255, 190, 110, .35), rgba(194, 90, 30, .12) 55%, transparent 80%);
  opacity: calc(0.25 + var(--heat, 0) * 0.75); }
@media (prefers-reduced-motion: reduce) { #boot.hf .hf-light { opacity: .9; } }`;

  function light(root, opts = {}) {
    if (!root || state) return;
    const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.getElementById("hf-style")) {
      const st = document.createElement("style");
      st.id = "hf-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    root.classList.add("hf");
    root.innerHTML = `<div class="hf-room"></div>
      <svg class="hf-hearth" viewBox="14 16 80 74" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${HEARTH}</svg>
      <canvas class="hf-fire"></canvas><div class="hf-light"></div>`;
    const svg = root.querySelector(".hf-hearth");
    const canvas = root.querySelector(".hf-fire");
    const ctx = canvas.getContext("2d");
    const glowEl = root.querySelector(".hf-light");
    const s = {
      root, svg, canvas, ctx, glowEl, still,
      sprites: still ? null : sprites(),
      parts: [], sparks: [],
      start: performance.now() - (opts.lit ? RISE_MS : 0),
      split: 0, splitStart: 0, last: performance.now(), raf: 0, done: null,
      w: 0, h: 0, dpr: 1, grate: { x: 0, y: 0, half: 10 },
    };
    state = s;
    const size = () => {
      s.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      s.w = window.innerWidth; s.h = window.innerHeight;
      canvas.width = Math.round(s.w * s.dpr); canvas.height = Math.round(s.h * s.dpr);
      // The grate, wherever the drawing has been fitted to the screen.
      const m = svg.getScreenCTM();
      if (m) {
        const p = svg.createSVGPoint();
        p.x = GRATE.x; p.y = GRATE.y;
        const at = p.matrixTransform(m);
        p.x = GRATE.x + GRATE.half;
        const edge = p.matrixTransform(m);
        s.grate = { x: at.x, y: at.y, half: Math.max(6, edge.x - at.x) };
      } else {
        s.grate = { x: s.w / 2, y: s.h * 0.8, half: s.w * 0.06 };
      }
    };
    size();
    s.onResize = size;
    window.addEventListener("resize", size);
    if (still) { root.style.setProperty("--heat", "1"); return; }
    s.raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    const s = state;
    if (!s) return;
    const dt = Math.min(0.05, (now - s.last) / 1000);
    s.last = now;
    const heat = ease(clamp((now - s.start) / RISE_MS, 0, 1));
    // Slow to start, as the flames lean apart, then quick: the gap widens as if pushed.
    if (s.splitStart) s.split = Math.pow(clamp((now - s.splitStart) / PART_MS, 0, 1), 1.7);
    const { ctx, w, h, dpr, grate } = s;
    s.root.style.setProperty("--heat", heat.toFixed(3));

    // Where the fire burns from: the grate at first, then wider and lower until its base is the bottom of
    // the screen and it is as wide as the screen; split, it burns from two places drawing apart.
    const half = lerp(grate.half, w * 0.75, Math.pow(heat, 1.6));
    const baseY = lerp(grate.y, h + h * 0.08, Math.pow(heat, 2.2));
    const gap = s.split * w * 1.2;
    const reach = lerp(grate.half * 9, h * 1.15, Math.pow(heat, 1.3));      // how high a flame climbs
    const lick = lerp(4.2, 1.2, heat);                                        // how hard it is drawn into a tongue
    const rate = lerp(90, 520, heat) * (1 - s.split * 0.45);                  // particles a second
    const big = lerp(grate.half * 0.95, Math.min(w, h) * 0.24, Math.pow(heat, 1.4));

    let want = rate * dt;
    while (want > 0) {
      if (Math.random() > want) break;
      want -= 1;
      // Hotter in the middle of the grate: more particles there, so the flame has a body and not a fringe.
      const u = (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
      let x = grate.x + u * half;
      if (gap) {
        // Split, most of the fire gathers on the two edges of the gap and burns there as they draw apart.
        const side = Math.random() < 0.5 ? -1 : 1;
        x = Math.random() < 0.65 ? grate.x + side * (gap * 0.5 + Math.abs(u) * big * 0.8) : x + (x < grate.x ? -1 : 1) * gap * 0.5;
      }
      const life = lerp(0.55, 1.25, Math.random()) * lerp(1, 1.35, heat);
      s.parts.push({
        x, y: baseY - Math.random() * big * 0.3,
        vx: (Math.random() - 0.5) * big * 0.6,
        vy: -(reach / life) * lerp(0.75, 1.15, Math.random()),
        age: 0, life, size: big * lerp(0.6, 1.25, Math.random()), seed: Math.random() * 100,
        home: x,
      });
      if (Math.random() < 0.05 + heat * 0.05) {
        s.sparks.push({ x, y: baseY - big * 0.2, vx: (Math.random() - 0.5) * 40, vy: -lerp(60, 260, Math.random()) * lerp(1, 2.4, heat),
          age: 0, life: lerp(0.8, 2.2, Math.random()), seed: Math.random() * 100 });
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // At full height the fire is the whole room: a deep burning ground under the flames, so nothing behind shows.
    if (heat > 0.25) {
      const g = ctx.createLinearGradient(0, h, 0, 0);
      const k = Math.pow((heat - 0.25) / 0.75, 1.6);
      g.addColorStop(0, `rgba(150,52,16,${0.95 * k})`);
      g.addColorStop(0.55, `rgba(92,30,12,${0.94 * k})`);
      g.addColorStop(1, `rgba(40,16,10,${0.93 * k})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "lighter";
    // A bigger fire is more of them, not brighter ones: without this the full blaze summed to flat white.
    ctx.globalAlpha = lerp(1, 0.5, heat) * (1 - s.split * 0.25);
    const t = now / 1000;
    const keep = [];
    for (const p of s.parts) {
      p.age += dt;
      const f = p.age / p.life;
      if (f >= 1) continue;
      // Sway, and the pull in toward the middle of the flame that makes it lick to a point.
      p.vx += (Math.sin(t * 5.3 + p.seed + p.y * 0.012) * big * 1.6 - (p.x - p.home) * lick * 0.6) * dt;
      if (s.split) p.vx += (p.x < grate.x ? -1 : 1) * w * 2.4 * s.split * dt;
      p.vx *= 1 - 1.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt * (1 - f * 0.35);
      const r = p.size * (1 - f * 0.55);
      const img = s.sprites[Math.min(SPRITES - 1, Math.floor(f * SPRITES))];
      // Taller than wide: a tongue, not a ball.
      ctx.drawImage(img, p.x - r * 0.8, p.y - r * 1.5, r * 1.6, r * 3);
      keep.push(p);
    }
    s.parts = keep;
    const sparks = [];
    for (const k of s.sparks) {
      k.age += dt;
      const f = k.age / k.life;
      if (f >= 1) continue;
      k.vx += Math.sin(t * 3 + k.seed) * 30 * dt;
      if (s.split) k.vx += (k.x < grate.x ? -1 : 1) * w * 1.5 * s.split * dt;
      k.x += k.vx * dt; k.y += k.vy * dt;
      const a = (1 - f) * 0.9;
      ctx.fillStyle = `rgba(255,${(200 - f * 90) | 0},${(120 - f * 80) | 0},${a})`;
      ctx.fillRect(k.x, k.y, 1.6 + (1 - f) * 1.4, 1.6 + (1 - f) * 1.4);
      sparks.push(k);
    }
    s.sparks = sparks;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    // The split: the whole scene, cut down the middle along a soft, burning edge that widens.
    if (s.split > 0) {
      // The gap does not appear as a cut: it thins in first, through the middle of the flames, then opens.
      const g = s.split * 60, f = 14;
      const thin = `rgba(0,0,0,${(1 - Math.min(1, s.split * 5)).toFixed(3)})`;
      const m = `linear-gradient(90deg, #000 ${50 - g - f}%, ${thin} ${50 - g}%, ${thin} ${50 + g}%, #000 ${50 + g + f}%)`;
      s.root.style.webkitMaskImage = m;
      s.root.style.maskImage = m;
    }
    if (s.split >= 1) { finish(); return; }
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

  /** The fire splits and draws apart. Resolves once it is gone; the caller removes the element. */
  function part() {
    const s = state;
    if (!s) return Promise.resolve();
    if (s.still) {
      s.root.style.transition = "opacity .35s linear";
      s.root.style.opacity = "0";
      return new Promise((r) => setTimeout(() => { state = null; r(); }, 380));
    }
    if (s.splitStart) return new Promise((r) => { const prev = s.done; s.done = () => { prev && prev(); r(); }; });
    s.splitStart = performance.now();
    return new Promise((r) => { s.done = r; });
  }

  window.HearthFire = { light, part, RISE_MS };
})();
