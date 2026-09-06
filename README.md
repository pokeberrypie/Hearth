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

**Android** — download the `.apk` from Releases and install it. It runs its
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

**1. Tell it who to call.** Open the menu — the three lines, top right — and
pick **Connection**. Choose a provider and paste a key.

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

**Playing together, over any distance.** Open a chat to other people and they
get a link and a seat: their own character, their own sheet, their own dice,
and the evening happening in front of both of you as it is written. No account,
nothing to sign up for, and no server of ours in the middle of your conversation
— there is not going to be one. It works across countries through a Cloudflare
tunnel opened from a button, and the tunnel is bundled in the installer so
nobody has to go and fetch it first. A phone can host a game. An invitation is
one table and nothing else on your machine; see the security note below.

---

## Tabletop

There is a door on the menu. Walking through it shuts a pair of them across
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
Behavior if you disagree.

---

## Where things are

```
src/
  index.ts        Routes, the streaming endpoint, and assemble()
  providers.ts    OpenRouter / NanoGPT / Google / Anthropic, or any endpoint
  prompt.ts       System prompt pieces, {{char}} and {{user}}
  lore.ts         Lorebook activation
  cards.ts        Character card PNG read and write
  dice.ts         Dice, and the [[2d6]] notation
  tabletop.ts     Sheets, classes, ability checks
  fight.ts        Initiative, hit points, whose turn it is
  verbs.ts        The marks a narrator writes into its prose
  campaigns.ts    The three, and the one it dreams up
  share.ts        Invitations, seats, and who may touch what
  hosting.ts      Answering the network; door.ts opens the tunnel
  passport.ts     A character carried by the player, not the host
  kits.ts         Classes and races people write themselves
  difficulty.ts   How hard the table is
  scenery.ts      Matching a scene to a wallpaper and a sound
  avatar.ts       Art packs for the face maker
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
machine can reach it, and the gate trusts this machine and nothing else.

If you set `HOST=0.0.0.0` to reach it from your phone — running it on a
headless box, say — the app will load for anyone on that network but every API
call is refused, because being on the same wifi is not proof of being you. To
use it yourself, open the link Hearth prints on startup once:

```
http://<that machine>:7870/host/<key>
```

It is also written to `data/host-key.txt`. Reading either means you already
have the machine, which is the only thing that counts as proof here. That one
visit exchanges the key for a cookie and the device is yours from then on.

Anyone else you want to play with gets an **invitation** instead, which seats
them at one shared table and grants nothing else — not your library, not your
settings, not your keys.

For a machine genuinely exposed to the internet, still put it behind Tailscale
or a tunnel rather than opening a port to café wifi.

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
bun test                             # the whole suite
bun run typecheck

bun run scripts/build-desktop.ts     # -> dist/desktop/Hearth.exe
bun run scripts/build-installer.ts   # -> dist/HearthSetup.exe
```

Building the installer — not running it — needs Inno Setup once:
`winget install --id JRSoftware.InnoSetup`. Nobody downloading `HearthSetup.exe`
needs it, or anything else; it is a self-contained wizard.

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

---

## Licence

MIT. Do what you like with it — use it, change it, ship it, sell it — as long
as the copyright notice comes along. See [LICENSE](LICENSE).
