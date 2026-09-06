# Hearth v0.2.0

49 commits since v0.1.0, over two days. The short version: **you can play with
people who are not in the room**, the tabletop became something you can write
your own game into, and the app stopped hiding half of itself behind a gear
icon.

Windows installer, Android APK. Your chats stay on your machine.

---

## Playing together

The big one, and as far as anyone can tell the only native long-distance
multiplayer in this corner of the hobby.

- **Open a chat to other people.** They get a link, they get a seat. No
  accounts, nothing to sign up for, and no server of ours in the middle of your
  conversation — there is not going to be one.
- **Over any distance.** A Cloudflare quick tunnel, driven from a button, and
  **the tunnel binary now ships inside the installer** so neither you nor your
  friends have to go and install anything first. Pinned to a version and
  hash-checked at build time.
- **On your own network** too, if everyone is in the same house — including
  from a phone, which can host a game.
- **A guest is a player, not a spectator.** Their own character, their own
  sheet, their own dice.
- **A passport** so somebody keeps their seat across sessions.
- **Live** — messages arrive as they are written, and recover when a phone
  wakes up.
- **Capability-based**: an invitation grants exactly one table and nothing else
  on your machine. Tested as an attacker rather than as a user, because the
  failure mode is silent.

## The tabletop grew a lot

Sheets, fights and the narrator's dice were already in 0.1.0. What is new is
the half that made it somebody's game rather than one game:

- **Classes and races you write yourself.** The ones that ship are ordinary
  rows: edit them, delete them, export them, import somebody else's. Editing a
  built-in makes it yours.
- **Three difficulties** — Hearthlight, Fair Count, Hard Winter — which change
  the number a roll has to beat and what failure costs, not an adjective in a
  prompt.
- **Rolls with a name on them.** `[[Attack: 1d20+3]]` used to survive as an
  unanswered question; ability checks printed as raw brackets on the page.
  Both settle properly now, and anything left over is drawn quietly rather than
  leaking markup.
- **Dice in story mode too**, not only at the table.

## Anywhere to talk to

- **Custom endpoints**, with the wire format as its own choice: OpenAI-compatible
  `/chat/completions`, Anthropic `/messages`, or OpenAI `/responses`. A relay can
  speak a standard dialect without being a standard service, so those are two
  separate questions.
- **Anything local** — one click fills in KoboldCpp, Ollama, LM Studio,
  llama.cpp or text-generation-webui, and no API key is demanded for an address
  on your own machine.

## Reaching this Hearth

Running it on a headless box and using it from your phone used to load the app
and refuse every request, with nothing on screen to say why. Being on the same
wifi is not proof of being the owner, so the answer is a key rather than
trusting the network: printed on startup, written to `data/host-key.txt`, and
now shown **inside the app** under Connection — because the installed build
hides its console and a phone has never had one.

## Worldbuilding and the rest

- A **campaign written from a few words**, or built out of a lorebook you
  already have.
- **Auto-lore**: the app offers to write the entry rather than making you keep
  the wiki by hand.
- **The room can follow the story** — the narrator writes `[[scene: the bridge
  at dusk]]` and Hearth picks a wallpaper and ambience from what you own. Off by
  default; it changes what you are looking at, so it asks first.
- **A face maker.** Layered, tintable, saves an ordinary PNG with the recipe
  inside it so it stays editable. Art arrives as packs — see the note below.
- **Ctrl+K** finds anything, including the text of every message you have sent.
- **Faces in page mode**, as a switch, for people who want the full column width
  and to see who is speaking.

## Fixes worth naming

- **Every d20 of ten or more displayed as its last digit.** `[[1d20: 18]]` drew
  as an 8. Nothing threw and nothing logged; the number on screen was simply
  wrong, in a game that turns on what the dice say.
- **The character's greeting was never sent to the model.** Getting the turn
  order to start on a user turn was done by dropping assistant turns off the
  front, and in an ordinary chat the greeting is the first row.
- **The gate was open on the network while its own tests said shut**, and later
  open through a tunnel for the same reason: a tunnel connects to localhost, and
  localhost meant "the owner".
- Ability checks printing as raw brackets; labelled rolls never rolling; the
  narrator reading four players as one person with inconsistent handwriting.

---

## Honest notes

- **The face maker ships without faces.** The engine, layering, tinting, pack
  format and extension hook all work; what is built in is gear — cloaks,
  pauldrons, horns, wings — plus a plain silhouette head. Faces and hair come
  from art packs, and the first pack has not been drawn yet. There is a drawing
  template in the app for anyone who wants to make one.
- **English only.** Translations are wanted, not started.
- **No sandbox for extensions**, by design. One runs with Hearth's own powers.
  Install one the way you would run any other program: because you trust where
  it came from.
- API keys are stored unencrypted in `data/hearth.db`, and a backup archive
  contains that database. Treat a backup zip as secret.

## Numbers

| | |
|---|---|
| Server code | ~17,900 lines |
| Frontend | ~17,900 lines |
| Tests | 639 |
| Providers | 4 named, plus any endpoint you point it at |

---

## Downloads

- **`HearthSetup.exe`** (41 MB) — Windows. One installer, one executable, the
  tunnel included.
- **`hearth-v0.2.0.apk`** (21 MB) — Android.
