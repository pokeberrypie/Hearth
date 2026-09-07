# Waiting for the next release

What is on `main` and not in the newest tag. Everything here is finished,
tested and running — it simply has not been cut into a release and uploaded
yet, so nobody who downloaded Hearth has it.

**Last release: `v0.2.1`.** Next one is `v0.2.2`.

---

## In v0.2.2, when it is cut

The first three came from nerb, a week into using the Android build: two dead
controls and a piece of the game the app knew and would not say out loud. The
rest came from walking the app afterwards, and from playing at a table.

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

### Taking it in turns

Four people at one table, all typing at once, is a transcript nobody can
follow. There was a soft pause between turns and no way to say whose go it
actually was, and the request was for the smallest possible version of that: a
glowing border, so you can see it from across the room.

A rotation you can switch on, off by default. When it is on, the strip at the
top of a guest's screen glows around whoever holds the turn, everyone else's
writing box is closed and says *"Waiting on Ana…"*, and speaking hands the
turn to the next seat.

The seating order is arrival order — the same order the names are already
drawn in, so the turn visibly goes round the table rather than hopping about.

**The host is not in the rotation.** They are running the game rather than
playing in it: they hand the turn out, they can take it back, and they are
never stopped from speaking. A narrator who has to wait their turn cannot
answer the person whose turn it is.

**The turn moves when the words are written down**, not when the narrator has
finished answering. Otherwise the whole table waits out a generation with
nothing to do — and if the host's copy is closed, waits forever. This way the
next person can be writing while the reply arrives.

**Anybody may pass, not only whoever is holding the turn.** Every table that
has ever tried an enforced order has found the same failure: one person goes to
make tea and the evening stops. The person who has wandered off is precisely
the one who cannot press "pass", so everyone else gets *"Nudge it on"*. The
turn also refuses to sit with somebody who has closed their tab — their row is
gone, so it moves to the first seat still filled rather than blocking the table
on a person who is not there.

The refusal is on the server, not only in the browser. A closed writing box is
a courtesy; a 409 is the rule, and the browser is the one machine at this table
that belongs to the person being checked. A turn taken out of order is not
written down at all.

The host's side is in **Together**: a switch, a sentence saying whose go it is,
and an arrow on each name to hand them the turn directly — for when the order
and the room have come apart, which they do, constantly, at a real table.

The names scroll and the pass button does not, so a table of nine on a phone
still has both the glow and the button on screen. Whoever holds the turn is
scrolled into view: a glow nobody can see is not an indicator.

### Deleting messages moved to where the messages are

It was the last row of the chat menu: open the menu, scroll past eight rows
about settings and documents, press the ninth. Everything else in that menu is
a setting or a document; this is an action on the thing you are looking at, and
it was the wrong distance away from it.

It is a bin in the tray the plus opens, beside continue and impersonate. Last
in the row and set apart by a gap, because everything to its left is pressed
constantly and this one throws messages away. Off in a chat with nothing in it.

The same handler, not a copy — the click listener already took actions from
inside that tray — so the menu version is gone rather than duplicated.

### Summing up, and carrying on

Every turn resends the whole conversation, so an evening that has run long
costs more per message than the same evening did at the start — for a
transcript whose early half nobody is thinking about any more. The standing
advice is "start a new chat sometimes", and nobody does, because doing it by
hand means losing the thread.

When a chat gets long a line appears by the writing box saying how big it has
got and offering to sum up. It is a sentence and two links, on the composer's
own line — not a dialog over the story. **Not now** makes it go away for that
chat, and taking the offer stops it coming back on the old one too.

What comes across:

- **A recap of the recent events**, written into the chat's memory book as an
  entry that is always in the prompt. That is what a memory book is for, so it
  is applied by the ordinary lore machinery rather than by anything new. A chat
  that never picked a book gets one made for it.
- **The last thing that was said, word for word** — copied as a message rather
  than quoted into the recap, so it keeps its speaker and draws as whoever
  actually said it, and so the recap does not spend its budget repeating it.
- **The cast.** `character_id` is only whoever the chat was started with; in a
  group the room lives in `chat_members`, and dropping it would open a scene
  with everybody but one person missing — hardest to notice in exactly the
  chats this is for, since a long evening is usually a full one.
- The pinned books, the author's note and its depth, the scene, the persona,
  the wallpaper, the accent and ambience, the campaign, and any fight in
  progress. It is filed as a child of the old chat, so the story still reads as
  one story in the fork view.

**Nothing is deleted.** The old chat is left exactly as it was, which is the
only thing that makes this safe to press. And the recap is written *before*
anything is created — a half-made chat with no recap in it looks exactly like a
successful carry-on until you read it, so a model that will not answer leaves
the library untouched and says so.

Three controls in Behaviour: whether to offer at all, the size a chat has to
reach, and how long the recap should be. The far end of the threshold slider
is "never", so it has an off position of its own.

Two details that are not obvious and both matter. The length is asked for in
words as well as tokens, because a model told "300 tokens" will cheerfully
write nine hundred — it has no sense of its own tokeniser and does have a sense
of how long a paragraph is. And there is still a ceiling, so an overshoot gets
stopped mid-clause; the half-sentence is then dropped, because this text goes
into *every* prompt of the new chat, and a model handed a hanging "and the
missing" will oblige by finishing it.

### Two found by pressing that button

**Opening a chat that would not open pointed the app at it anyway.**
`openChat` set the current chat id from its argument and read the response on
the next line, so a request that answered `{ error }` — an id deleted in
another tab, a fork whose creation half failed — left every button afterwards
acting on a chat that is not there. It threw, which was the visible half; the
silent half was worse. It now leaves everything as it was and says so.

**The new sliders were hidden on every load.** They are drawn from the switch
above them, by a function that runs before the loop that puts the switches into
the state they were stored in. So it read an unticked box, hid two controls
that should have been showing, and nothing looked again until some other slider
was moved. The same shape of bug as the dice checkbox above, one layer along.

### A migration that was never applied on new copies

Found by the above, and older and worse than it.

Additive migrations ran between the first `CREATE TABLE` batch and the rest of
them. Every migration so far happened to touch a table in that first batch, so
the ordering had never mattered and nothing said it had to hold. The first one
that did not — a column on `shares` — threw on a fresh install because the
table did not exist yet, and the throw is swallowed on purpose, because that is
how "already applied" is detected.

So the column was simply missing, on new installs only, silently. Upgrades were
fine, which is the worst version of this: it works everywhere it is tested and
is broken for everybody arriving for the first time. Migrations run after every
create now, and there is a test that reads the columns back out of a database
built from nothing.

### A guest on a phone

Everything above was checked at 375px as well as on a desktop, but three of
these are specifically about somebody who tapped a link in a message on an
iPhone.

**Reading remembered settings could stop a guest sitting down.** Every write to
local storage in the app was already wrapped, because storage can be full or
switched off; the reads were not. In private browsing on iOS — which is where a
lot of guests will open a link somebody sent them — reading it throws outright,
and an unguarded read in a boot path does not degrade, it stops the boot. One
of them sat in the guest's, immediately before the box that asks their name.

**Your seat is a cookie, and cookies go.** A private tab closed, history
cleared, ninety days, a new phone. Anybody coming back to the address without
one got the *host's* app — every route behind it refused, the library empty —
which reads as a broken program rather than as "ask for the link again". The
page could not tell "you are the owner and there is nothing here" from "you are
a visitor and your seat is gone", so the gate now says which side of the door
it refused on, and the second case gets a sentence instead of an empty shelf.

**Giving your name did not redraw the strip.** The server announces it to the
table and this copy is at that table, so in principle the announcement comes
back. In practice the socket is often still opening when somebody types their
name into the first thing they are shown — so the one person who had just given
their name was the one still labelled "A player".

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
