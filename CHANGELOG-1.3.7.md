# Elixium 1.3.7

Qobuz charts actually reach the tabs 1.3.6 promised, artist cards stop
swallowing clicks, and a stale Deezer session no longer silently downgrades
playback to a thirty-second preview.

## Qobuz charts, for real this time

1.3.6 rebuilt the Qobuz chart endpoints so that artists, tracks and playlists
each had a source, and said so in its release notes. The interface never asked
for them. A guard left over from when Qobuz genuinely was albums-only still sat
in front of the grid, so three of the four tabs rendered "Qobuz publishes album
charts only" and no request was ever made.

The server had been answering correctly the whole time. The guard is gone, and
all four tabs now fill: tracks and playlists from the editorial feed, artists
from the artists charting, albums as before. Deezer's four tabs were re-checked
alongside and are unchanged.

## Artist cards

1.3.6 moved Play and Download into a single overlay in the middle of the card,
matching every other card in the app. That overlay covered the whole card and
accepted pointer events — and unlike an album card, whose overlay sits inside
the clickable card and lets clicks through, an artist card's overlay is a
sibling of its button. Every click on an artist card went into the overlay and
stopped there. The card could not be opened at all.

The overlay no longer takes pointer events; the two controls opt back in
individually. Clicking the card opens the artist from anywhere on it, including
dead centre, and the buttons still work.

## Artist names on album cards

Album cards in Genres, Charts and Search now carry the same clickable artist
name that Home cards got in 1.3.6 — it had only been wired into some of the
grids.

## Playback falling back to previews

Opening the app and pressing play sometimes gave a thirty-second preview, while
restarting the app and playing the same track gave the full file. A Deezer
session that had gone stale while the app sat idle failed to produce a stream
URL, and the failure path went straight to the preview without ever trying to
recover.

It now re-establishes the session once and retries before falling back, so an
idle session costs a moment rather than the track. Concurrent plays share a
single login rather than each starting their own.

## Known issue

Qobuz does not work on a **fresh install**. Qobuz changed the layout of their
web bundle, so the app id Elixium scrapes at first run comes back empty and
Qobuz initialisation fails outright. Existing installs are unaffected — they
hold a working app id from a previous run — and Deezer is unaffected either
way. A fix is in progress.
