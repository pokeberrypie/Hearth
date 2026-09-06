# What's in Hearth

Written 6 September 2026, against `main`. Two parts: something short enough to
post, and the full list underneath for anyone who asks "wait, it does what?"

Everything below is checked against the code, not remembered. Where a thing is
half-finished it says so — a feature list that oversells is one nobody trusts
the second time.

---

## The short version (fits in one Discord post)

> **Hearth v0.1 — it's crunchy but it's HUGE**
>
> Local-first roleplay app. Your chats live on your machine in one SQLite file.
> Windows installer, Android APK, or run it from source.
>
> **The big one: native long-distance multiplayer.** Not a fork, not a plugin —
> it's built in. You host, your friends get a link, everyone plays in the same
> chat with their own characters and their own dice. Works across countries.
> The tunnel binary ships in the installer so hosting is a button, not a
> tutorial.
>
> **A whole tabletop system.** Character sheets, classes and races you can write
> yourself, ability checks, dice the narrator can actually roll, initiative and
> fights, three difficulty levels. The AI asks for a roll and Hearth settles it.
>
> **Plus:** SillyTavern character cards (V2/V3 PNG + JSON), personas, group
> chats with turn-taking, lorebooks with auto-added entries, sampling presets,
> regex scripts, extensions you can write, wallpapers that follow the scene,
> campaign generation from a lorebook, and an avatar maker.
>
> **Providers:** OpenRouter, NanoGPT, Google AI Studio, Anthropic — or any
> custom endpoint (OpenAI-compatible, Anthropic messages, or OpenAI responses),
> including KoboldCpp / Ollama / LM Studio / llama.cpp running on your own box.
>
> ~35k lines, 611 tests. Rough edges everywhere. Go break it.

---

## The full list

### Chats and characters

- **Character cards** — imports SillyTavern V2 and V3, as PNG or JSON. Exports
  back out as a real card PNG with the data embedded, so it works anywhere else.
- **Personas** — who *you* are in the scene. Imports from a SillyTavern
  `settings.json`, pictures included.
- **Group chats** — several characters in one room, with a face strip for
  handing out the next turn. Tap the one already speaking and it goes to
  whoever has been quietest.
- **NPCs** — minor characters the narrator invents, kept per chat.
- **Swipes** — regenerate a reply and page between the versions.
- **Continue** — the model picks up mid-sentence rather than starting again.
- **Editing and branching** — edit any message; branch a chat from any point.
- **Search** across every chat.
- **A bin** — deletes are soft, with undo, until you purge.

### The tabletop

- **Character sheets** — six abilities, hit points, skills, kit.
- **Classes and races you write yourself.** Six classes and five races ship;
  all of them are ordinary rows you can edit, delete, export as a file, or
  import from somebody else. Editing a built-in makes it yours.
- **Dice that actually roll.** The narrator writes `[[2d6+3]]` and Hearth
  settles it before the message is saved — so the number is real, not invented
  by a model that cannot count.
- **Ability checks** — `[[Dexterity check]]` resolves against the sheet.
- **Fights** — initiative order, hit points, turn tracking.
- **Difficulty** — Hearthlight, Fair Count, Hard Winter. Changes the number a
  roll has to beat and what failure costs, not just an adjective in the prompt.
- **Verbs** — the narrator can ask Hearth to *keep* something, not just settle
  it: name an NPC, remember a fact, move the scene.
- **A table preset** that pushes the model toward running a game rather than
  writing a beautiful paragraph about a door.

### Multiplayer

This is the part nothing comparable ships natively.

- **Host a game** and hand out an invitation link. No accounts, no server of
  ours in the middle, nothing to sign up for.
- **Over any distance** — a Cloudflare quick tunnel, driven from a button.
  The binary is bundled in the installer now, so guests are not asked to
  install anything and neither are you.
- **On the local network** too, if everyone is in the same house.
- **Guests get a seat**, not a spectator view: their own character, their own
  sheet, their own dice.
- **A passport** so a player keeps their seat across sessions.
- **Live feed** — messages arrive as they are written, and recover if a phone
  goes to sleep.
- **Capability-based**, so an invitation grants exactly one table and nothing
  else on your machine.

### Worldbuilding

- **Lorebooks** — entries injected when their keywords come up. Imports and
  exports SillyTavern books.
- **Auto-lore** — the app notices what the story established and offers to
  write the entry, rather than making you keep the wiki by hand.
- **Campaigns from a few words** — type "haunted lighthouse, nobody believes
  the keeper" and get a written campaign.
- **Campaigns from a lorebook** — point it at a book you already have and it
  builds the story out of what is in there.
- **Wallpapers**, and a room that follows the scene: the narrator writes
  `[[scene: the bridge at dusk]]` and Hearth picks a matching picture and
  ambience from what you already own. Off by default — it changes what you are
  looking at, so it asks first.

### Making it yours

- **Extensions.** Client-side and server-side hooks. Write one in the app, or
  install one straight from a git repository. A broken extension costs you that
  extension, not your chat.
- **Regex scripts** — SillyTavern-compatible find/replace, with separate
  switches for what the model is sent and what you see.
- **Sampling presets** — save, switch, import, export.
- **Themes** — every colour is a token you can change, plus custom CSS.
- **Three message styles** — banner, portrait, and page.
- **An avatar maker** — layered, tintable, saves an ordinary PNG with the
  recipe inside it so it stays editable. See the honesty section below.

### Providers

- OpenRouter, NanoGPT, Google AI Studio, Anthropic.
- **Any custom endpoint**, with the wire format as a separate choice:
  OpenAI-compatible (`/chat/completions`), Anthropic messages (`/messages`),
  or OpenAI responses (`/responses`). Relays and proxies speak a standard wire
  without being a standard service, so those are two different questions.
- **Anything local** — one click fills in KoboldCpp, Ollama, LM Studio,
  llama.cpp or text-generation-webui. No API key demanded for an address on
  your own machine.
- Model lists with pricing, streaming, reasoning-effort control.

### Where it runs

- **Windows** — one installer, one executable. No folder of files beside it.
- **Android** — a real APK. Same server code, running on nodejs-mobile.
- **From source** — Bun, one command.
- **Your data is yours**: one SQLite file plus an uploads folder. Full backup
  export and import. Nothing phones home.

---

## Honesty section

Worth saying out loud, because a list like the one above invites
disappointment otherwise.

- **The avatar maker has no faces yet.** The engine, the layering, the tinting,
  the pack format and the extension hook are all done and working. What ships
  built in is gear — cloaks, pauldrons, horns, wings, backgrounds — plus a
  plain silhouette head. Faces, hair and expressions come from art packs, and
  the first pack has not been drawn. There is a drawing template in the app for
  anyone who wants to make one.
- **Release binaries are not uploaded yet.** The README download links are dead
  until they are. Build from source or wait.
- **No translations.** English only so far.
- **It is a week old.** Things will be wrong.

---

## Numbers

| | |
|---|---|
| Server code | ~17,700 lines across 37 modules |
| Frontend | ~17,600 lines |
| Tests | 611, across 31 files |
| Panels | 13 |
| API routes | ~120 |
| Providers | 4 named, plus any endpoint you point it at |
