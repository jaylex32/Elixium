# Elixium 1.4.0-beta.5

Deezer downloads were coming out at the wrong quality, and they were slower
than they needed to be. Both are fixed, and you can now pick a quality for one
album without changing your default.

## Your quality setting is used again

This is the big one. **Deezer downloads ignored the quality you picked.**

Choosing FLAC gave you a 320kbps MP3. Choosing anything at all gave you the
same thing, because the setting never reached the part of the app that does the
downloading — it was sent, and then read from the wrong place. And when the
Deezer session was in a bad state, that 320 dropped again to 128, which is why
some of you were getting 128kbps files on a paid account.

It now downloads exactly what you asked for:

| you pick | you get |
|---|---|
| FLAC | a real lossless file, around 25 MB for a 4-minute track |
| MP3 320 | 320kbps |
| MP3 128 | 128kbps |

If you downloaded anything since the last few builds, it is worth checking. A
FLAC that came out as a `.mp3` was never lossless, and downloading it again is
the only way to get the real thing.

## A second reason paid accounts got 128kbps

Elixium asks Deezer what your account is allowed to stream, and it only asked
once, when it started. If that happened a moment before you were signed in — for
example if you pressed play straight after opening the app — it got the answer
for a signed-out visitor: no 320, no lossless. It then believed that for as long
as the app stayed open, so everything came down at 128.

It now checks again whenever your session changes, so signing in, or pasting a
new ARL, is picked up immediately instead of after a restart.

## Pick a quality for one album

You no longer have to change your default and change it back. Want one album in
FLAC while the rest of your library stays at 320? Now you can.

- **On an album or playlist tile** — right-click it.
- **On a track** — it is in the `⋮` menu, under the usual Download.
- **In an album or artist window** — the small arrow next to the Download
  button.

A normal click still downloads straight away at your usual quality, with no
extra step. The menu marks which one that is, so you can see what a plain click
would have done.

Deezer offers lossless, 320 and 128 — those three are everything it actually
serves. Qobuz has its own list, and YouTube Music offers its two formats.

## Downloads are faster

Downloads ran one track at a time, no matter what your concurrency setting said,
because nothing was reading it. It now downloads several at once, up to four.

A 14-track album went from **36 seconds to 16** in testing — a bit over twice as
quick. Most of the old wait was not the music downloading; it was everything
around each track happening one after another.

Four is the ceiling on purpose. More than that and Deezer starts refusing
requests, and a slow download is better than a failed one.

Playlists still come out in the right order — the tracks finish whenever they
finish, but the `.m3u8` is written in playlist order, not finishing order.

## Notes

- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
- The command line was never affected by the quality problem — it takes a
  different route and already downloaded several tracks at once.
- Qobuz downloads still run one at a time. The change is the same, but it could
  not be tested against a live Qobuz account for this build, so it was left
  alone rather than shipped untested.
- The portable `.exe` unpacks itself every time you open it, which is why it is
  slow to start. That is how the single-file format works and it is unchanged
  here — the installer version does not do it.
