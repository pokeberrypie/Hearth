# Waiting for the next release

What is on `main` and not in the newest tag. Everything here is finished,
tested and running — it simply has not been cut into a release and uploaded
yet, so nobody who downloaded Hearth has it.

**Last release: `v0.2.0`.** Next one is `v0.2.1`.

---

## In v0.2.1, when it is cut

### A guided way to fill in a description — `bba8f21`

An optional **"Fill it in step by step"** toggle under Description, on both the
character and persona dialogs. Headed fields with a line of help each, so an
empty box stops being the hardest part of the program.

- Character: Name, Gender, Personality, Appearance, Background, Ego, Emotional
  maturity, Speech pattern, Quirks and mannerisms, Important relationships,
  Likes, Dislikes, Scent, Anything else.
- Persona gets a shorter set — it mostly answers "what do they see and how do I
  come across".
- **Sections you add yourself**, kept on the server so they travel to the phone
  and into a backup.
- Headings are matched by what they are commonly called, so a sheet written
  elsewhere — "Physical Appearance", "Speech Pattern", "Quirks & Mannerisms",
  "Key Relationships" — splits without anyone reformatting anything. Whatever
  is still unrecognised is offered as a section rather than swallowed.
- The description text remains exactly what is saved and sent. The fields
  compose into it; guided is a way of typing, not a way of storing.

- Headings written in markdown are understood, which is how cards are actually
  traded: `**Appearance:** 6'3"`, `**Name: Abel**`, `### Background`,
  `- **Likes:** wine`. Matching only bare `Appearance:` left most downloaded
  cards sitting unsplit in the block at the top.

New setting keys: `guided_persona`, `guided_character`.

### "From a memory book" could not see your memory books

The table is a separate world and things come over when you ask — but the
picker that starts a campaign from a book only listed books already at the
table, and a new table has none. So the one feature whose whole purpose is
"start a game inside a world you have already written" offered a choice
between the note-books the table had written for itself, and hid altogether
when there were none. It read exactly like the feature being missing.

It lists every book now, marks the ones not at the table yet, and brings the
chosen one over on the way through — choosing it *is* the asking. The book
ends up in both worlds, so it stays on the story shelf too.

`/api/lorebooks/elsewhere` now reports `entry_count`, so an empty book is not
offered from either side.

### Three from nerb, and one from the back gesture

**Editing an imported character emptied it.** The cast list carries what a
list draws — id, name, avatar, description — and the edit dialog was handed a
row from it, so personality, the scene and the greeting showed as blank. The
reported half. The unreported half is that saving writes all five fields, so
those blanks went back over the real ones: a character was gutted by somebody
opening it to fix a typo, and looked fine in the list afterwards. There is a
`GET /characters/:id` now and the editor fetches whole records.

**Selection did nothing when you tapped the checkbox.** A checkbox is toggled
by the browser before the click event is dispatched, so the handler's
`checked = !checked` put it straight back. Tapping the row worked, because
there is no activation there to undo — which is why it went unnoticed on a
mouse and looked completely broken on a phone.

**The message buttons stacked vertically in page mode.** `display: flex` was
set on the banner and portrait rules only, so page style reverted to a block
and the four icons ran down the left margin of every message.

**Swiping back landed on the loading screen for ever.** `boot.html` is a
static file with nothing behind it and it sat in the WebView's history as the
entry before the app, so back went to it and stayed. It is cleared once the
app has loaded, and back now asks the page: it closes what is open, or leaves
a chat for the shelf, and only means "leave" when there is nothing left to
close.

### The inspector described the wrong character in a group

Reported from a real game: Joffrey was the one talking and the Character
section was Olenna's.

The page posted mode, guide and content to /inspect and no speaker at all, so
the server fell back to "whoever has been quietest" and built the prompt for
them. A full tie is broken at random, so two openings of the same panel could
disagree with each other. The panel exists to show what will actually be sent,
which makes this the one thing it must not get wrong.

It sends the chosen speaker now, and shows whose prompt it is drawing —
without that, a wrong Character section looks exactly like a right one.

Note: package.json is on 0.2.1 and the Android versionCode on 45 from a
release that was started and stopped. Both are correct for the next cut.

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
