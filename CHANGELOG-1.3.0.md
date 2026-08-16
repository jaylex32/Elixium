# Elixium 1.3.0

Bulk downloading, explicit markers, a native folder picker, and a watchlist
that finally works on both services.

## Bulk downloading

Select several things at once and download them together. Checkboxes appear on
albums, artists, tracks and playlists — in Search, Charts, Discover, Genres,
Playlists, Favorites and an artist's own view — with a bar showing what is
selected and a single **Download selected**.

The selection follows you between pages, so you can gather from Search, then
Charts, then an artist's discography and take the lot in one go. Ticking the
first item turns selection on, so there is no mode to enable first. **Select
all** grabs everything currently listed.

## Explicit markers

Tracks and albums carry the standard **[E]** badge on both services. The
services disagree about the field — Deezer disagrees with itself between its
public and private APIs, and Qobuz calls it something else again — so all four
spellings are read and normalised.

## Downloads reachable from where you are

- The playing track, from the player bar
- Any track in the queue, and **Download all** for the whole queue
- An artist's **entire discography**, from the artist card or their view

## Folder picker (desktop)

Settings has **Browse** and **Open** beside each download path, using a native
OS dialog. Desktop only, deliberately: the server build is routinely reached
from another machine, where a local dialog would offer folders the engine
cannot write to — and a filesystem browser served over HTTP would let anyone
on the network enumerate the host's drives.

## Watchlist

**It could only ever hold one artist.** The interface sent `artistId` while the
watchlist read `id`, so every artist keyed on the same value and each new one
overwrote the last.

**It only ever worked for Qobuz.** The service was hardcoded in the record type
and in eight separate places, so a Deezer artist was stored as a Qobuz one,
scanned against the wrong catalogue, and — once that was fixed — still had its
Deezer album ids sent to Qobuz, which answers *"No result matching given
argument"* for every one.

Artists now carry the service they came from, from the moment they are added
through to the download itself, and mixed scans split correctly. Artist images
show instead of blank avatars.

## Fixes

- **Spotify, Tidal and YouTube links ignored the selected service.** Anything
  that was not a `deezer.com` link was hardcoded to Qobuz, so choosing Deezer
  and pasting a Spotify playlist silently fetched it from Qobuz.
- **The desktop window rendered blank** — a store selector returning a fresh
  array on every read made React abort the render.
- The explicit badge was dark-on-dark and unreadable; it is outlined now and
  takes the colour of the text beside it in every theme.
- The selection checkbox was oversized, crowded the play button, and vanished
  into pale artwork.
- Tracks could not be multi-selected at all — there was no way to begin.
- The default download path would not open: relative paths were resolved
  against the wrong directory.
- The settings path box was fixed at 224px, far too small for a path with two
  buttons.

## Known limits

- **Qobuz genre rows still search by name.** Qobuz publishes no genre chart.
- **Deezer has no new-releases feed** — its endpoint returns an empty list, so
  Deezer shows Trending, which is real. Qobuz keeps New Releases.
- **macOS and Linux builds are ad-hoc signed only.** They run, but Gatekeeper
  still warns; clearing that needs a paid Apple certificate.
- Watchlist entries added before 1.2.0 may carry a wrong service. Remove and
  re-add the artist if its downloads fail.
