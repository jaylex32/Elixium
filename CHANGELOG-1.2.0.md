# Elixium 1.2.0

A desktop app, four new sections, and a set of fixes for things that had been
quietly wrong — several of them wrong in ways that looked like they worked.

## Downloads

**Deezer downloads work on a free account.** Requesting a quality the account
cannot stream threw a licence error that was rethrown before it could reach the
quality ladder written for exactly that case — so a track that *played* at
128 kbps refused to *download*. It now steps down and reports what it used.

Free accounts are capped at MP3 128 by Deezer, not by Elixium: every higher
format returns 403 against a free licence, and the track payload advertises no
other size. 320 needs Premium, FLAC needs HiFi.

## New sections

- **Charts** — ranked per genre, plus **48 country charts**. Those are
  discovered by search rather than hardcoded: a hand-checked list of ids was
  already wrong, three of nine pointing at the wrong country.
- **Favorites** — starred tracks, albums, artists and playlists, stored on the
  server so the same list appears on every device rather than per browser.
- **Logs** — live server output. Everything went to stdout, which nobody sees
  when Elixium runs as a desktop app or on another machine.
- **Playlist search across services** — Deezer, Qobuz and Spotify. Nothing is
  fetched from Spotify; the converter resolves its playlists to Deezer or Qobuz
  tracks. Needs a free Spotify developer app (Settings), because Spotify
  rate-limits the web-player token off its search endpoint.

## Browsing

- Search **loads more as you scroll**. Deezer's paged search endpoint ignored
  the offset it was given and returned page one every time, so results stopped
  dead at 50 no matter what the interface asked for.
- **Artists** have Albums, Tracks and Playlists tabs. Previously top tracks
  only, with no route to a discography the server could already serve.
- **Genres** return the genre. They ran a text search for the name, so Pop
  returned every album *called* Pop — U2, Queen — rather than pop music.
- **Newest** sort, backed by full release dates rather than a year.
- Watch a playlist from anywhere it appears, including Spotify and Tidal links.

## Desktop app

Windows, macOS and Linux, as installers and portable builds. Runs the same
engine locally — no terminal, no port to pick.

**It no longer forgets everything on restart.** The window loads
`http://127.0.0.1:<port>` and the port was chosen fresh each launch; browser
storage is scoped per origin, so every restart began with empty storage. That
one bug explained the theme resetting, download history vanishing, and searches
disappearing. The port is now reused.

Your first launch after upgrading still starts blank — the old state lives
under the old origin and cannot be migrated.

## Player

Restores the queue, track and position, paused. `isPlaying` deliberately is not
restored: no audio element exists on first paint, so a running progress bar over
silence would be worse than a paused one.

## Fixes

- The seek bar froze at 0:00 after the first restore (regression in this cycle).
- Downloads filter did nothing — history carried no status, and a job that
  saved nothing was recorded as a success.
- Charts crashed on open (an empty Select value, which Radix rejects).
- Long dropdowns ran off the bottom of the screen with no way to scroll.
- Chart playlists showed no artwork: the CDN answers a playlist hash under the
  album path with a placeholder and HTTP 200, so nothing appeared broken.
- Every binary and installer now carries the Elixium icon.

## Known limits

- **Qobuz genre rows still search by name.** Qobuz publishes no genre chart;
  only the Deezer half could be fixed with what the services offer.
- **Deezer has no new-releases feed.** Its endpoint returns an empty list and
  the fallback behind it searched for the string "2025". Deezer now shows
  Trending, which is real; Qobuz keeps New Releases, which is genuine.
- **macOS and Linux builds are ad-hoc signed only.** They run, but Gatekeeper
  still warns — clearing that needs a paid Apple certificate.
