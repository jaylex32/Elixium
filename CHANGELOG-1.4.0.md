# Elixium 1.4.0

**YouTube Music is now a full download service**, alongside Deezer and Qobuz.
This release also fixes a serious Deezer quality bug, rebuilds the download
manager, and makes the app much faster to start.

Everything from the 1.4.0 betas is included.

## New

- **YouTube Music** — browse, search, play and download, with full tags,
  artwork and lyrics. Two formats: AAC (`.m4a`, ~131 kbps) and Opus (`.opus`,
  ~147 kbps). Most tracks need no sign-in; Settings takes a `cookies.txt` if
  YouTube asks for one.
- **Pick a quality for one download** without changing your default. Right-click
  an album or playlist tile, use the `⋮` menu on a track, or the arrow next to
  the Download button. A normal click still downloads at your usual quality.
- **Pause and resume downloads.** A paused download keeps what it has and picks
  up where it left off.
- **Download history** is kept in the download manager.
- **The quality being downloaded is shown** on each row — `FLAC · 1411k`,
  `MP3 · 320k`, and so on.
- **Metadata settings** let you choose which tags get written, per service.
  Off by default; everything is tagged as before unless you turn it on.
- **Turn services off** in Settings → Services to hide ones you do not use.
- **Pasted links follow the service you have selected.** A Deezer, Spotify,
  Qobuz or TIDAL link can be downloaded from YouTube Music, and a YouTube link
  from Deezer or Qobuz.
- **Play buttons on every card**, and artist and album names are clickable
  everywhere, on all three services.

## Fixed

**Deezer quality**

- **Deezer downloads ignored the quality you picked.** Choosing FLAC gave a
  320kbps MP3. If you downloaded anything during the betas, it is worth
  downloading again.
- **Paid accounts got 128kbps.** Elixium asked once at startup what your account
  could stream, and kept the answer — so if it asked before you were signed in,
  everything came down at 128 until you restarted. It now re-checks when your
  session changes.
- **ReplayGain is no longer written by default.** It made files play quieter
  than copies from elsewhere, which sounds like worse quality but is not. You
  can turn it back on in the metadata settings.

**Playback**

- **Playback stalled every few tracks**, sometimes for a minute, and blocked the
  rest of the app while it recovered. Four tracks went from 70–202 seconds to
  2.0–2.7 seconds.
- **Playback stopped completely when one track would not load.** It now skips
  that track and carries on.

**Downloads**

- **Cancel did nothing.** Pressing cancel on a 14-track album left it
  downloading all 14. It now stops, and removes the half-finished file.
- Playlists spanning folders with similar names failed to write their playlist
  file.

**YouTube Music**

- Downloads ran at 32 KB/s; now over 5 MB/s.
- Starting a track took eleven seconds; now under two.
- Most of an album arrived with no title, artist or cover.
- Music-video audio was downloaded instead of the album version.
- An imported session stopped working within the hour.
- Genre pages showed Deezer's catalogue, artist pages showed 5 tracks instead of
  21, and search stopped at 20 results.
- Featured artists were dropped — a track with a guest showed only the headline
  artist.

**Elsewhere**

- **The Settings page would not open at all** in beta.3.
- A Spotify link waited on Qobuz first, so an expired Qobuz token broke Spotify
  links for people not using Qobuz.
- Spotify errors said `[object Object]`.
- Explicit tags were being discarded on YouTube Music.
- Album covers loaded as blank squares on long discographies.

## Faster

- **Downloads run up to four at once** instead of one at a time. A 14-track
  album went from 36 seconds to 16.
- **The portable build opens in about two seconds** after the first run, instead
  of around 50. It now unpacks once into an `Elixium-app` folder beside the
  `.exe` and reuses it. Delete that folder and it is rebuilt on the next launch.
- **Smaller download and install on every platform.** Two things were being
  shipped that nothing ever loaded: the entire development toolchain — the
  TypeScript compiler, prettier, eslint — and a complete copy of the repository
  itself, which the build had been packing in since long before this release.
  The Windows download drops from 191 MB to about 82, and the installed app
  from roughly 710 MB to 286. macOS and Linux shrink by about the same.

## Notes

- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
- YouTube Music audio is lossy at source. For lossless, use Deezer or Qobuz.
- TIDAL and Qobuz links can only be *read* through Qobuz, so converting one to
  another service still needs a working Qobuz token. Deezer and Spotify links do
  not.
- The command line is unchanged by the quality and download-manager work.
