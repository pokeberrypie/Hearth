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

### The strip above a chat, in every chat

It appeared only once a chat had two or more people in it, on the reasoning
that a solo chat has no turn to hand out and so nothing to press. True of the
one job it had, wrong about the room: you still want to fix a line in the card
you are talking to, set the scene, name the chat, or bring somebody else in.

So it is always up, and a face means the useful thing in each case.

- **In a group** a face is a turn, as before — press to hand them the next
  reply, press again to hand it back to whoever has been quietest.
- **In a solo chat** there is no turn to give, so the face is the character:
  press it and their card opens.
- **The plus** adds someone. In a solo chat that is how it becomes a group —
  something the server has always supported and nothing ever offered, because
  the only way in was a button on a strip solo chats did not draw.
- **The chat's name** sits in the strip and renames on a press. A new chat is
  named after its character and the bar above is already showing that name in
  inch-high letters, so an untouched title draws as *"Name this chat"* instead
  of saying the same word twice — which is also the answer to naming a chat as
  it opens: the offer is there from the first frame, at the cost of a press
  rather than a prompt in front of the greeting.
- **The scenario** has a button of its own. It is still at the bottom of the
  members dialog, but it is the field in there that changes mid-story, and
  reaching it meant reading past the mute switches.

Everything heavier — muting, dropping someone, auto-reply — stays behind the
plus, in a dialog with room for it. Each member row there now has an **edit**
button too, so the card of somebody standing in front of you is one press away
rather than a trip to the library. A strip that grew three buttons per face
would be unusable on the phone this is mostly read on.

The faces scroll and nothing after them does: a cast of nine used to push the
name and the scenario button off the end of the strip, where there was no
reason to think they existed. On a narrow screen the "quietest replies next"
sentence goes before anything pressable does.

Renaming a chat was three copies of the same prompt — the strip, the chat menu,
and the row for any chat in "Manage chat files" — and the copies had already
drifted: two treated a cancelled prompt and an emptied box as the same answer,
and none redrew the strip. One function now.

### The character leads the prompt now

The system prompt used to open with `main` — four lines of framing that read
identically for every card in the library — with the description third, behind
lore. The opening of a prompt is the most attended-to place in it, and it was
being spent on the one part carrying no information about this character at
all. Reported as the model "fighting" the card: a generic agreeable assistant
wearing the name.

So the description leads and the framing follows it. `worldInfoBefore` came up
with it rather than being stranded, because "before the character" is a
position — lore that sets up a world the card assumes has to arrive before the
card does. With no before-lore, which is the ordinary case, the character is
the first thing in the prompt.

It is only a default: any preset with blocks of its own is untouched, and the
blocks editor can put it back. The same order is now written in four places —
the server's assembly, the default block list, the blocks editor, and the
table's own preset — with a test that fails if they drift apart.

### The table stops pretending it is using your settings

Tabletop mode runs on a built-in preset, so some of the Presets page was being
ignored while it was on and nothing said which part. Reply length, temperature
and the preset picker are dimmed and disabled there now, with a line naming
them.

Only those three, because only those three are actually overridden: `withPreset`
copies across the fields a preset declares and leaves the rest alone, so the
context window, top-p, the penalties, streaming and thinking are all still
yours at the table. Greying them out to make a tidier block would be telling
people a settings page does not work when it does.

### From a playtest sweep

Three found by walking the app rather than by a report.

**"Let every character roll dice" was turned off by every page load.** It was
saved but never loaded, so boot left the box unticked whatever was stored — and
`loadSettings` triggered a save of its own on the way past, through
`setWallpaper`, which wrote that unticked box back over the setting. Turning
dice on lasted until the next reload. That is the sort of thing that gets
reported as "the dice are broken again" rather than as a settings bug, and it
had been reported that way.

`setWallpaper` no longer saves when it is loadSettings restoring the stored
wallpaper rather than somebody choosing one — opening the app should not write
the whole look back before anybody has touched anything.

**"Let the room follow the story" was wired to nothing at all.** Neither saved
nor loaded. The server has read `scene_follows` since it was written; there was
simply no way to switch it on. A whole feature behind a dead checkbox.

Both were hand-wired one control at a time, which is how they were missed while
the third switch on the same page worked perfectly. All three are loaded from
one list now.

**The chat menu stayed open after you left the chat.** Pressing Home hid the
button but not the sheet it opens, so it stood on the shelf offering to rename,
fork or close a chat that was no longer open — every row acting on a null id.
Nothing threw; the rows just did nothing.

Also: `closeAllMenus` runs on every click in the document and rewrote `hidden`
and `aria-expanded` on all thirteen panels whether or not any menu was open —
twenty-six attribute mutations per click, for nothing. It checks first now.
Nothing was broken by it, but extensions are handed a MutationObserver over the
same tree and were being woken twenty-six times to be told nothing.

**Not found:** every icon-only control is centred to the pixel, on desktop and
at 375px — nothing was off by even one. No horizontal overflow at phone width.
No button in any of the thirteen drawer panels that does nothing when pressed.

**Worth a look, not changed:** tap targets. The icon rail is 34×34, the
chat-list select buttons 30×30, and "Delete chat" is 28×28 — against the 44×44
both Apple and Google ask for. Small and destructive is the worst pairing of
the three. This is a visual decision rather than a bug, so it is left here
rather than done.

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
