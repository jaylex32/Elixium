# Elixium 1.3.4

A small release: the Top Tracks row on Home, and making the desktop app say
what is wrong when it will not start.

## Top Tracks on Home

Clicking anything in that row reported **"Could not load tracks — check your
credentials in Settings"**. Credentials were never involved.

The row returns tracks, and the cards were treating them as albums: the click
opened the album view with the *track's* id, which resolves to nothing. A
track's own payload names the album it came from, so the click opens that now.

The same mistake affected the rest of that card — its checkbox selected the
track as an album, and its download button queued an album with a track id, so
downloading from Top Tracks would have failed too. Both now treat it as a
track.

## When the desktop app will not start

The failure dialog said "The Elixium engine did not start in time" and nothing
else, which left nobody — reader or maintainer — with anything to act on. It
now shows the engine's own last words and offers to open the folder holding the
log and config.

An engine that dies while starting is reported the moment it happens, with its
exit code, rather than after the full timeout. And the timeout is now two
minutes rather than one: on macOS the first launch waits on Gatekeeper scanning
the whole app before its child process may run, and that alone can take longer
than a minute.

## macOS code signing

The Mac app is ad-hoc signed, and was signed with `codesign --deep`. Apple
deprecates that flag because it signs in the wrong order — the outer bundle is
sealed before the frameworks and helpers inside it, so their signatures no
longer match what the app seals. The app still launches, and then the process
it starts, which is the same binary re-executed, is killed by the kernel for a
signature that does not verify.

It is now signed inside-out — frameworks, helpers and native modules first,
then the bundle — which is what Apple prescribes, and the build fails outright
if a strict verification of the nested code does not pass.

This is a genuine defect in how the app was signed and it matches the reported
symptom exactly, but it was found by reading rather than by reproducing: these
releases are built on Windows and Linux runners, and the failure only appears
on a Mac. If a Mac still refuses to start, the dialog now carries the reason.
