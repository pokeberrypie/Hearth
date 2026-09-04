# Hearth

A self-hosted roleplay frontend. Bun + SQLite + plain HTML. Built mobile-first,
runs in Termux, no build step.

## Run it

**Windows**

Get `Hearth.exe` and double-click it. That is the whole application — the
server, the runtime and every file the frontend needs are inside it, so it can
sit on your Desktop or anywhere else and needs nothing beside it. It starts the
server and opens your browser.

Your chats live in `%LOCALAPPDATA%\Hearth\data`, not next to the executable, so
they survive replacing it with a newer one.

Or run **`HearthSetup.exe`**, which is the same thing as an ordinary
installation wizard: it asks where to put it, makes the shortcuts, and
registers an uninstaller with Settings > Apps. Uninstalling leaves your chats
alone.

To build either from this checkout:

```bash
bun run scripts/build-desktop.ts     # -> dist/desktop/Hearth.exe   (the app)
bun run scripts/build-installer.ts   # -> dist/HearthSetup.exe      (the wizard)
```

The wizard needs Inno Setup, once: `winget install --id JRSoftware.InnoSetup`

**Desktop (macOS / Linux)**

```bash
chmod +x start.sh
./start.sh
```

**Termux (Android)** — Bun needs a glibc wrapper on Android. Once, ever:

```bash
pkg install git curl clang make glibc-repo python
pkg install glibc-runner
touch ~/.bashrc
curl -fsSL https://bun.sh/install | bash
git clone https://github.com/Happ1ness-dev/bun-termux.git ~/.bun-termux
cd ~/.bun-termux && make && make install
```

Then `./start.sh` and open **http://localhost:7870** in Chrome.
Menu → *Add to Home screen* installs it as a fullscreen app with its own icon.

Pull down the Termux notification and tap **Acquire wakelock**, or Android kills
the server when the screen sleeps. Also exempt Termux from battery optimisation.

## First run

Open the drawer → **Settings** → pick a provider, paste a key, set a model.

| Provider | Model string looks like |
|---|---|
| OpenRouter | `anthropic/claude-sonnet-4.5` |
| NanoGPT | `deepseek-ai/DeepSeek-V3` |
| Google AI Studio | `gemini-2.5-pro` |
| Anthropic | `claude-sonnet-4-5-20250929` |

Then **Cast** → *Add a character* → tap them to start a chat.

## Layout

```
src/
  index.ts       Hono routes, the streaming endpoint, assemble()
  db.ts          SQLite schema, settings
  providers.ts   OpenRouter / NanoGPT / Google / Anthropic adapters
  prompt.ts      System prompt pieces, {{char}} / {{user}} macros
  lore.ts        Lorebook activation
  cards.ts       Character card PNG read and write
  *.test.ts      bun test
public/
  index.html     App shell
  style.css      Theme — token names mirror Lumiverse
  app.js         Client
data/            Created on first run. Back this folder up.
```

Config is env: `PORT` (default 7870), `DATA_DIR` (default `./data`),
`HOST` (default `127.0.0.1`).

## A note on security

Hearth has **no login**. It binds to loopback only, so nothing outside your own
machine can reach it. If you set `HOST=0.0.0.0` to use it from your phone, be
aware that anyone on the same network can then read your chats and spend your
API credit — put it behind Tailscale rather than opening it to a café wifi.

API keys are stored **unencrypted** in `data/hearth.db`. The export archive
includes that database and your `.env`, so treat a backup zip as secret.

## Theme

Colour tokens use Lumiverse's variable names (`--lumiverse-primary`,
`--lumiverse-prose-dialogue`, `--lcs-glass-bg`, and so on), so a Lumiverse theme
can be pasted into `:root` in `style.css` without translation.

## Extensions

Settings → Extensions. Paste a GitHub address and it is fetched, read and kept
in your library — there is no folder to manage, which is what lets a phone
install one.

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
way arrives named rather than blank — but ST extensions are written against
that program's internals and will not run here.

**An extension runs with Hearth's own powers. There is no sandbox**, in the
page or on the server, and none is implied by any of the above. Install one the
way you would run any other program: because you trust where it came from.

## Not built yet

- Group chats

## Working on it

```bash
bun test                      # unit and route tests
bun run typecheck
```

