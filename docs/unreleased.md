# Waiting for the next release

What is on `main` and not in the newest tag. Everything here is finished,
tested and running — it simply has not been cut into a release and uploaded
yet, so nobody who downloaded Hearth has it.

**Last release: `v0.2.1`.** Next one is `v0.2.2`.

---

## In v0.2.2, when it is cut

All three of these came from nerb, a week into using the Android build. Two
are dead controls and one is a piece of the game the app knew and would not
say out loud.

### The sign over the door is the door now

Hearth is two apps sharing a shelf, and which one you are in is the largest
thing on the screen: the bar reads **HEARTH** or **HEARTH: TABLETOP**. But the
only way to change it was a card most of the way down the menu — so people
played in story mode without ever learning there was a table, or found the
table once and could not find the way back out.

Tapping the title on the shelf walks you through the doors, the same as the
card does. The card stays; a second way in is not a replacement.

Only on the shelf. Once a chat is open the bar holds the name of whoever you
are sitting with, and a tap there that changed worlds would be far worse than
a switch that was hard to find — so it is disarmed when a chat opens, *and*
the handler checks again before it fires. Guests never get it: they have no
menu and no say in the mode.

The affordance is a rule under the title rather than a chevron beside it,
because `fitBarTitle` sizes the name by how far it overflows the bar — on a
narrow phone anything that takes width takes it from the name. It is drawn
with a box shadow, not `text-decoration`: the title is gradient-filled text,
and a browser clips text decoration to the glyphs along with the rest of that
layer, so the first attempt computed correctly and drew nothing.

### "Start again with a different character" did nothing

Not slowly, not with an error — nothing. The sheet card draws that button with
id `csReroll` and the code wiring it asked for an id the app has never drawn,
so `$()` returned null and the `if` guarding it took the other branch. From
outside there is no difference between a control that does nothing and one
that was never finished, which is what it was taken for.

Fixing it uncovered a second bug hidden behind the first: `ask()` takes a
title and nothing else, and the sentence written for this question was being
passed as a second argument and dropped. So it would have come up under the
stock "This cannot be undone" — true, but silent about what is being thrown
away. It now says the sheet is replaced and the persona is not, and it still
honours the setting for people who have turned confirmations off.

### A name in the story opens onto the person

The narrator writes `[[npc: Andres Vega — thirty, works for someone, has the
folder]]` mid-sentence. At the table the server settles that: Andres gets a
card, and the message keeps `[[npc: Andres Vega]]`.

Which left the pill in the prose a dead end — a gold name that looked like a
control, could not be pressed, and stood for a description filed somewhere the
reader had no reason to know about. *"Is this supposed to expand, or is it
intentionally mysterious like this."*

It expands now, in the chat, where they were named: the description follows
the name as a parenthesised aside, and tapping again folds it away. It is
found on the pill, then among the cards already loaded, then from the server —
that last one matters, because the panel it would otherwise have come from is
tabletop-only and lives behind the drawer.

And it drew three different ways depending on where you were. Verbs are only
resolved in tabletop mode, so a story-mode chat still has the whole bracket
inline — where the old pattern capped the payload at sixty characters, so a
short description was drawn *inside* the pill and a long one was not drawn as
a pill at all. Andres fitted; Theo did not; same narrator, same message. The
split happens in the renderer now, so all three roads end at the same place,
and the browser splits names with the same rule the server does — there is a
test that fails if those two ever drift.

---

## Cutting the release

Notes for whoever does it, because the last one had three near-misses and each
of them looked like success at the time.

```bash
bun test && bun run typecheck

# package.json is the only place the version is written. Bump it there;
# the desktop build, the installer and the APK all read it from there.
# mobile/android/app/build.gradle still needs versionCode bumping by hand —
# Android requires it to only ever go up.

bun run scripts/build-installer.ts        # -> dist/HearthSetup.exe + Hearth.exe

cd mobile && node build.mjs
rm -rf android/app/src/main/assets/nodejs-project
cp -r dist/nodejs-project android/app/src/main/assets/nodejs-project   # NOT a symlink
cd android && ./gradlew assembleDebug
```

Then **check the artefacts rather than the build output**, because:

- The mobile bundler writes to `mobile/dist` and reports success whether or not
  the Android assets were re-staged. Miss the copy and the APK ships yesterday's
  frontend, quietly.
- `strings` cannot see inside either the installer or `Hearth.exe` — both
  compress what they carry. To check the desktop binary, run it against a
  throwaway `DATA_DIR` and fetch `/style.css` and `/app.js` from it.
- Read the APK's version back with `aapt2 dump badging`, not from the gradle
  file. It once said `0.1.0` while the filename said `0.2.0`.
- The installer must be around 41 MB. Much smaller means cloudflared did not go
  in — there is a size floor in the build script that now stops this, and a
  deliberately broken path aborts the build rather than skipping the file.

Tag last, once the artefacts are verified, so the tag marks what was actually
built.

Uploading is `gh release create <tag> ...` **from the repo directory** — the
asset paths are relative to it, and running it from the home directory gives
`no matches found` for every file while looking like an auth problem.
