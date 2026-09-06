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
