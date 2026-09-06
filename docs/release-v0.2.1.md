# Hearth v0.2.1 — pre-release

A week of use by other people, and what it turned up. Mostly fixes, one new
thing, and two bugs that were quietly destroying work.

Install over v0.2.0; nothing needs migrating.

---

## New: somewhere to start on a description

An empty box with "Description" over it is the hardest part of this program.
There is an optional **"Fill it in step by step"** toggle on the character and
persona dialogs now: headed fields with a line of help each, showing the kind
of thing that goes there.

Name, Gender, Age, Personality, Appearance, Background, Ego, Emotional
maturity, Speech pattern, Quirks and mannerisms, Important relationships,
Likes, Dislikes, Scent — and **sections you add yourself**, kept so they travel
to your phone and into a backup.

It reads what people already write. A card headed `**Physical Appearance:**`,
`**Speech Pattern:**`, `**Quirks & Mannerisms:**` or `### Background` splits
without anyone reformatting anything; whatever it does not recognise is offered
as a section rather than swallowed. The description text stays exactly what is
saved and sent — the fields compose into it, so the toggle is safe to turn off
half way through.

---

## Fixed

**Editing an imported character emptied it.** The worst bug in this list. The
cast list carries what a list draws, and the edit dialog was handed a row from
it — so personality, the scene and the greeting showed as blank. Saving then
wrote those blanks back over the real ones. A character was gutted by somebody
opening it to fix a typo, and looked fine in the list afterwards.

**The prompt inspector described the wrong character in a group.** It never
told the server whose turn it was, so the server fell back to whoever had been
quietest and built the prompt for them. Replies were always correct; only the
panel you open to check them was wrong, which is the worst way round. It says
whose prompt it is drawing now.

**Selection did nothing if you tapped the checkbox.** A checkbox is toggled by
the browser before the click event arrives, and the handler toggled it straight
back. Tapping the row worked, which is why it went unnoticed on a mouse and
looked completely broken on a phone.

**"From a memory book" could not see your memory books.** The table is a
separate world and the picker only listed books already at it — so the one
feature meant for starting a game inside a world you have written offered a
choice between the table's own note-books, and hid entirely when there were
none. It lists everything now and brings the chosen book over.

**Swiping back sat on the loading screen for ever.** `boot.html` has no server
behind it and was the entry before the app in the WebView's history. Back now
closes what is open, or leaves a chat for the shelf.

**The message buttons stacked down the margin in page mode.** The row layout
was set for banner and portrait only.

---

## Downloads

| | |
|---|---|
| `HearthSetup.exe` | Windows installer, tunnel included |
| `Hearth.exe` | Windows, portable — nothing installed |
| `hearth-v0.2.1.apk` | Android |

681 tests. Still crunchy.
