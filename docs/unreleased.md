# Waiting for the next release

What is on `main` and not in the newest tag. Everything here is finished,
tested and running — it simply has not been cut into a release and uploaded
yet, so nobody who downloaded Hearth has it.

**Last release: `v0.2.2`.** Next one is `v0.2.3`.

---

## In v0.2.3, when it is cut

Three faults in playing together, reported as one thing — "his turns aren't
registering and he has to refresh every round". They are not one bug, and the
one in the middle only ever shows up on somebody else's phone.

### The narrator was told the wrong person had gone quiet

The host's copy is what answers at a shared table: a guest's turn arrives, and
the browser that owns the chat generates the reply. It did that in `silent`
mode, on reasoning that was sound — the guest's turn is already written down,
so there is nothing to send, and `silent` is the mode that sends nothing.

But `silent` does not mean "no message attached". It means *the person whose
persona this is has chosen not to speak*, and it says so in the system prompt,
by name. So every time somebody else took a turn, the narrator was told the
**host** had stayed quiet, and wrote the scene accordingly:

> Bing Us has said nothing. The Gamekeeper fills the silence.

— with the guest's actual message sitting right there in the history,
unanswered. From their side that is indistinguishable from the app never
registering that they had typed at all, which is exactly how it was reported.

It answers with `reply` and an empty body now, which writes no message down and
adds no framing of its own. The genuine silent turn — send an empty message and
let the scene move on without you — is untouched, and there is a test that
fails if it ever stops saying so.

### The narrator did not know the other people existed

There is a "Who is playing" block that names everyone at the table. Two things
were wrong with it.

It was **tabletop-only**. A shared *story* chat had nothing at all: the guests
were invisible, and the narrator answered the host for every turn anybody took.
A story told by three people is as shared as a game played by three.

And it listed the guests and **not the host**. The seats belong to the share;
the person running it has a persona instead, described further up under a
heading of its own. So the narrator was told "more than one person is playing"
and then handed exactly one name — which reads as one player and one narrator,
not two players. Whoever owns the chat is at the table too, and goes first,
because theirs are the turns that arrive unsigned.

### And the guest's screen quietly stopped keeping up

The reply does reach a guest live — the frames go out to the table as they are
generated, and always did. What broke is the connection carrying them.

The heartbeat was an SSE comment, `: keep-alive`. That keeps a socket warm and
is **invisible to the page**: the EventSource parser eats comment lines without
firing anything. So a guest had no way at all to tell a quiet table from a dead
one — and on iOS that is the entire problem, because Safari reaps these
connections on its own schedule and leaves behind a `readyState` that still
says OPEN. Nothing errors, nothing reconnects, and the scene simply never moves
again until you pull down to refresh.

Now the pulse is a real event the page can time, and forty seconds of complete
silence — no reply, no roll, no ping — is treated as a dead line however
healthy it claims to be: reconnect, and re-read the whole table, since a fresh
socket only carries what happens next.

The same test replaced the one in the wake-up path, which used to reconnect
only when the browser *admitted* the socket was closed. Coming back to the tab
would re-read the table once, so you saw what you had missed — and left you on
the same dead line, to be stranded again by the very next reply.

A hidden tab is still left alone; its timers are throttled anyway, and coming
back to it does all of this.

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
