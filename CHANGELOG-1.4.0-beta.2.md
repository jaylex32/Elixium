# Elixium 1.4.0-beta.2

The second YouTube Music beta. Everything here makes YouTube Music behave the
way Deezer and Qobuz already do — pasted links, explicit tags, clickable artist
and album names, playlist files. Deezer and Qobuz are unchanged except where a
fix applies to all three.

## Pasted links now go where you asked

Pasting a link downloads from **the service you have selected**, in both
directions:

| selected | pasted link | result |
|---|---|---|
| YouTube Music | Deezer, Spotify, Qobuz, TIDAL | converted, downloaded from YouTube Music |
| Deezer | YouTube link | converted, downloaded from Deezer |
| Qobuz | YouTube link | converted, downloaded from Qobuz |

Reading a link always stays with whoever owns it — only Deezer can say what is
in a Deezer playlist — but the download follows your selection. Previously a
YouTube link was handed to Qobuz regardless, which failed outright for anyone
whose Qobuz token had expired, reporting a Qobuz credentials error for a link
that had nothing to do with Qobuz.

Album links shared from YouTube Music (`playlist?list=OLAK5uy_…`) resolve too;
they arrive in a different layout with no title, artist or artwork of their own,
and are now rebuilt from their tracks.

## Explicit tags, and names you can click

YouTube Music marks explicit tracks the same way the other services do, and even
distinguishes a clean edit of the same song. That badge was being discarded; it
now shows everywhere the others do, including inside an album.

Artist and album names are links again. Every row carried the ids all along —
they were read as plain text — so clicking an artist opens their page and
clicking an album opens it, exactly as on Deezer and Qobuz. An album page names
its artist once in its header rather than on every row, so its tracks inherit
that link.

## Also

- **Playlist files.** A YouTube Music playlist download now writes its `.m3u8`,
  like every other service.
- **Turn services off.** Settings → Services hides any service you do not use
  from the sidebar and the command palette. One has to stay on.
- **A fuller home page.** 12 rows instead of 6, taken from YouTube Music's own
  shelves as it loads them.
- **Search suggestions** appear on YouTube Music's home page.
- **Genre pages** show YouTube Music's own genres. They were showing Deezer's
  catalogue under YouTube's genre names.
- **Artist pages** show 21 tracks, 21 playlists and 50 albums, up from 5, none
  and 20.
- **Search** pages past its first twenty results.
- **Covers load reliably.** A grid asked for full-size artwork for every card —
  fifty-six at once on a long discography, which the image host throttled into
  blank squares. Cards now request a card-sized image; downloads and album pages
  keep full resolution.

## Fixed for every service

- A playlist spanning folders whose names share a prefix — "Justin Quiles" and
  "Justin Quiles & Lenny Tavárez" — wrote its playlist file to a folder that had
  never been created, and failed. It now resolves to a real folder.
- A Spotify link waited on Qobuz before handing itself to Deezer, so an expired
  Qobuz token broke Spotify links for people not using Qobuz. Spotify's own code
  is untouched.
- Spotify errors said `[object Object]`. They now say what happened.

## Notes

- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
- TIDAL and Qobuz links can only be *read* through Qobuz, so converting one to
  YouTube Music still needs a working Qobuz token. Deezer and Spotify links do
  not.
- YouTube Music audio is lossy at source. For lossless, use Deezer or Qobuz.
