# Elixium 1.5.1

An Android fix. Downloads that had worked all along were being reported as
failures.

## Fixed

**Finished downloads are no longer reported as failed.** On Android every
Deezer track arrived on the phone and every one of them said it had failed —
red rows in the log, a failure notification at the end, and no way to tell what
had actually downloaded. Worse than a real failure, which at least tells you
the truth.

The cause was in writing the playlist file. Elixium looks up the casing the
filesystem really uses, because Windows and macOS accept a path in any casing
but store one, and a `.m3u8` written from the wrong casing can name a file the
player then refuses to open. That lookup lists the folders on the way to the
file — and on Android it fails, because external storage is mounted in a way
that allows writing but not listing. The track was already downloaded and
tagged by then, but the error still reached the code that marks a track as
failed.

A track that genuinely fails still reports as failed.

## Notes

- **Only Android was affected.** The desktop apps and the command line are
  unchanged in behaviour — the lookup works there and always did.
- Installs over 1.5.0. Your settings, ARL and library stay where they are.
- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
