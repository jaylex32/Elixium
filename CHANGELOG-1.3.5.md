# Elixium 1.3.5

**1.3.4 does not start. Please use this release instead.**

## What happened

1.3.4 added a small module for reading the engine's log, so that a desktop app
which fails to start could say why. The module was never added to the list of
files the installer packages, so the app it shipped required something that was
not there:

```
Error: Cannot find module './engine-log'
```

That is fatal and immediate, on every platform, before any of the app's own
error handling exists to report it. The irony is not lost: the file added to
make failures explainable is the file that made the app unable to open.

## The fix

The module is packaged. More usefully, the build now refuses to produce an app
that cannot start: it walks every local `require` in the desktop shell and fails
if any of them is missing from the packaged file list, with the name of the
offending module. Removing the entry again reproduces exactly the error above —
at build time, where it costs nothing.

The check runs for every platform, including the macOS job, which invokes the
packager directly and would otherwise skip it.

## Everything else from 1.3.4

Unchanged and included here:

- **Top Tracks** on Home opens again rather than reporting "Could not load
  tracks — check your credentials". That row returns tracks and its cards were
  treating them as albums, so the click carried a track's id to the album view.
  Its checkbox and download button had the same fault.
- **Desktop startup failures now say why**, quoting the engine's own last words
  and offering the folder that holds the log; a boot failure is reported when it
  happens rather than after the timeout; and a first launch is given two minutes
  rather than one, because macOS scans a freshly downloaded app before its
  child process may run.
- **macOS code signing** is done inside-out — each framework and helper signed
  whole, the app itself signed last — rather than with `--deep`, which seals the
  outer bundle before the code inside it and leaves the process the app spawns
  to be killed for a signature that does not verify.
