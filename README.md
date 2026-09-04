# Hearth

A roleplay frontend that runs on your own machine, and a tabletop that runs on
the same one. Bun and SQLite on the desktop, a real Node runtime on Android,
plain HTML in front of both. No build step, no account, no server but yours.

Your characters, your chats and your API key live in a folder you can copy to a
USB stick. Nothing leaves the machine except the prompt, and that goes straight
to whichever provider you chose.

---

## Getting it

**Windows** — download `HearthSetup.exe` from
[Releases](https://github.com/pokeberrypie/Hearth/releases) and run it. It asks
where to put it, makes the shortcuts, and registers an uninstaller with
Settings → Apps. Uninstalling leaves your chats alone.

If you would rather not install anything, `Hearth.exe` is the whole application
in one file — the server, the runtime and every asset are inside it. Put it on
your Desktop and double-click. Your library lives in `%LOCALAPPDATA%\Hearth\data`
either way, so replacing the executable with a newer one keeps everything.

**Android** — download `Hearth.apk` from Releases and install it. It runs its
own copy of the server on the phone, with its own database. No PC has to be on
and no network is involved.

**macOS and Linux**

```bash
chmod +x start.sh
./start.sh
```

Then open <http://localhost:7870>.

---

## Your first evening

**1. Tell it who to call.** Open the drawer, go to **Settings → Connection**,
pick a provider and paste a key.

| Provider | A model string looks like |
|---|---|
| OpenRouter | `anthropic/claude-sonnet-4.5` |
| NanoGPT | `deepseek-ai/DeepSeek-V3` |
| Google AI Studio | `gemini-2.5-pro` |
| Anthropic | `claude-sonnet-4-5-20250929` |

**2. Say who you are.** **You → New persona.** A name is enough; a couple of
lines about yourself is better. This is what `{{user}}` means in a card.

**3. Find somebody to talk to.** A fresh copy comes with one character — a
narrator called the Gamekeeper, who will run whatever you are in the mood for.
Beyond that: **Cast → Import character cards** takes the PNG cards everybody
trades, several at once, or **Write one by hand** if you would rather.

**4. Talk.** Tap a face. Type. Send an empty message to let the scene move on
without you.

Everything after that is optional.

---

## What is in it

**Chats that remember.** Swipe for another take on a reply, continue one that
stopped early, branch a conversation at any message and keep both, and see the
whole shape of a story on its own page as a tree. Import a SillyTavern backup
and your characters, chats, lorebooks, personas and presets come with it.

**Lorebooks, on a shelf.** Keyword-triggered notes that fire when they are
mentioned, bound to everything, to one character, or to one chat. Optionally
Hearth keeps its own: every so many messages it writes down what changed and
files it, so a long story stops forgetting its own middle.

**Presets.** The whole prompt as an ordered list of blocks you can rearrange,
switch off and import from SillyTavern.

**Regex scripts.** Find and replace over what is sent, what is shown, or both.
SillyTavern's format is read directly.

**Personas.** Several of you, with faces, and a default per character.

**A room you can decorate.** Wallpapers, four message layouts, portrait sizes,
type scale, every colour, and a box to paste your own CSS into.

**Extensions.** Paste a GitHub address and it is fetched and kept in your
library — there is no folder to manage, which is what lets a phone install one.

---

## Tabletop

There is a door in the settings. Walking through it shuts a pair of them across
the screen, changes the sign overhead, and opens on the same app arranged as a
game.

**It is a separate room.** Your seven hundred characters are not standing in it.
The table starts with the narrator and nobody else, and characters, personas and
lorebooks come over one at a time when you ask — and stay in your library while
they do, with every chat you already have with them intact.

**A new game asks what it is about.** Three campaigns are already written, or
there is a page where you build your own: the situation, how it should feel, how
long it should run, which books it draws on, and a list of things that may be
out there. There is a die on that page if you would rather be handed one, and a
button that takes a few words — *"haunted lighthouse, nobody believes me"* — and
writes the rest out properly.

**You have a character sheet.** Pick a class and roll for it, or take the even
spread. Six abilities, hit points, skills, a kit. It sits in the sidebar and
pulls out full-size, and every ability is a button that rolls it.

**The dice are real.** Press the die and Hearth works out what the moment calls
for — an attack if you are in a fight, whatever the narrator just asked for
otherwise — then throws a large gold one across the screen and shows you the
working. The narrator rolls the same dice by writing them into its own prose;
what the chat keeps is the answer, never a promise of one.

**The narrator can change the world, not only describe it.** It writes small
marks inside its prose that Hearth acts on. You never type them and you never
see the brackets:

| What it writes | What happens |
|---|---|
| `[[npc: Marla — innkeeper, tired, lying]]` | Marla exists, with a card, and is still herself tomorrow |
| `[[scene: the taproom of the Blackthorn]]` | Where you are is recorded, and read back into every prompt after |
| `[[fight: two wolves and a bandit captain]]` | Initiative is rolled, including yours, off your sheet |
| `[[hit: Wolf 1, 5]]` | Five comes off, and stays off |
| `[[check: dex]]` | A d20 against the dexterity your sheet says, not the one it remembers |

**Fights get a tracker.** It pulls up from the bottom of the screen, everyone
rolls where you can watch, the row sorts itself as the dice land, and the card
of whoever is up lifts and takes a gold frame. Damage dealt to you comes off
your sheet, because it is the same number.

**And the table has manners.** It runs on its own preset — short turns, real
consequences, nothing spoken on your behalf — rather than whichever of yours
asks for four hundred words of cinematic prose. Swipes are rationed, three by
default, because rerolling until it goes your way is the same as not rolling.
And you cannot rewrite or delete a turn, because a game where the bad outcome
can be quietly deleted is not a game you can lose. All three are switches in
Behaviour if you disagree.

---

## Where things are

```
src/
  index.ts        Routes, the streaming endpoint, and assemble()
  providers.ts    OpenRouter / NanoGPT / Google / Anthropic
  prompt.ts       System prompt pieces, {{char}} and {{user}}
  lore.ts         Lorebook activation
  cards.ts        Character card PNG read and write
  dice.ts         Dice, and the [[2d6]] notation
  tabletop.ts     Sheets, classes, ability checks
  fight.ts        Initiative, hit points, whose turn it is
  verbs.ts        The marks a narrator writes into its prose
  campaigns.ts    The three, and the one it dreams up
  *.test.ts       bun test
public/           The whole frontend: one HTML file, one stylesheet, one script
mobile/           The Android app. See mobile/README.md.
installer/        The Windows wizard.
data/             Created on first run. This is your library — back it up.
```

Config is environment: `PORT` (7870), `DATA_DIR` (`./data`), `HOST`
(`127.0.0.1`).

---

## A note on security

Hearth has **no login**. It binds to loopback, so nothing outside your own
machine can reach it. If you set `HOST=0.0.0.0` to use it from your phone,
anyone on that network can then read your chats and spend your API credit — put
it behind Tailscale rather than opening it to café wifi.

API keys are stored **unencrypted** in `data/hearth.db`, and a backup archive
includes that database. Treat a backup zip as secret.

**An extension runs with Hearth's own powers, in the page and on the server.
There is no sandbox.** Install one the way you would run any other program:
because you trust where it came from.

---

## Building it

```bash
bun install
bun run start                        # http://localhost:7870
bun test                             # 440-odd unit and route tests
bun run typecheck

bun run scripts/build-desktop.ts     # -> dist/desktop/Hearth.exe
bun run scripts/build-installer.ts   # -> dist/HearthSetup.exe
```

The installer needs Inno Setup once: `winget install --id JRSoftware.InnoSetup`

The Android app is its own thing — `mobile/README.md` has it, and the embedded
Node runtime is checked in, so a clone builds without hunting for anything.

---

## Writing an extension

A repository needs a `hearth.json` at its root:

```json
{
  "name": "Dice",
  "version": "1.0.0",
  "description": "Rolls dice from the composer.",
  "client": "client.js",
  "server": "server.js"
}
```

Both halves are optional. The client half runs in the page:

```js
hearth.on("ready", () => hearth.log("here"));
hearth.on("message:render", (el, msg) => { /* el is the message element */ });
hearth.on("send:before", (text) => text.replace(/^\/shrug$/, "¯\_(ツ)_/¯"));
hearth.addButton("Roll", () => { /* adds a button to the composer */ });
hearth.css(".plate { border-radius: 0 }");
```

The server half runs around the prompt:

```js
hearth.on("prompt:before", (p) => ({ ...p, system: p.system + " Be brief." }));
hearth.on("reply:after", (text) => text.replace(/  +/g, " "));
```

A hook may change what it is given, return a replacement, or return nothing.
One that throws is skipped and reported; one that returns the wrong shape is
ignored. A broken extension costs you that extension, not your chat.

SillyTavern's `manifest.json` field names are read too, so a repo shaped that
way arrives named rather than blank — but ST extensions are written against that
program's internals and will not run here.

---

## Theme

Colour tokens use Lumiverse's variable names (`--lumiverse-primary`,
`--lumiverse-prose-dialogue`, and so on), so a Lumiverse theme can be pasted
into `:root` in `style.css` without translation.
