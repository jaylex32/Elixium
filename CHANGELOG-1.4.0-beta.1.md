# Elixium 1.4.0-beta.1

**YouTube Music is now a full download service**, alongside Deezer and Qobuz —
browse, search, play, and download with complete tags and artwork.

This is a beta. YouTube Music is new and large; Deezer and Qobuz are unchanged.

## YouTube Music

**Downloads work without signing in.** Most tracks need no cookie at all. Where
YouTube does insist on a session, Settings takes a `cookies.txt` export from any
browser and tells you immediately whether it is accepted, rather than letting a
download fail later to deliver the news.

**Two formats, both fully tagged:**

| | bitrate | plays on |
|---|---|---|
| AAC · `.m4a` | ~131 kbps | everything, Apple included |
| Opus · `.opus` | ~147 kbps | everything except Apple's stock apps |

Opus is the better codec at the higher bitrate. YouTube ships it inside WebM,
which has no tag writer, so it used to arrive with no title, artist or cover —
it is now rewrapped into Ogg on the way to disk, which carries tags and artwork
and leaves every audio byte untouched. Nothing is re-encoded.

**Everything else you would expect:**

- Its own download folder and file-naming template, with a live preview
  (`{title} {artist} {album} {album_artist} {year} {track_number}
  {total_tracks} {no_track_number} {video_id}`)
- Full metadata and embedded artwork on every track
- Lyrics from YouTube Music's own licensed source, with LRCLIB as a fallback
- Playback, with seeking
- Home rows taken from YouTube Music's own shelves, under their own titles
- Genres, artist pages and search, paged rather than capped at the first twenty

## Fixed

- **Downloads ran at 32 KB/s.** YouTube throttles a stream whose `n` parameter
  has not been transformed. Transforming it — by running YouTube's own player —
  takes the same track from 32 KB/s to over 5 MB/s.
- **Starting a track took eleven seconds.** Ten of them were a deliberate pause
  between client attempts, added on a misdiagnosis. Now under two seconds cold
  and instant for a track already resolved.
- **Most of an album downloaded untagged.** A bug in the tagging library means
  it cannot add a metadata box to a file that has none, and YouTube's audio has
  none — so thirteen of seventeen tracks arrived with no title or cover. The box
  is now written first: seventeen of seventeen.
- **An imported session died within the hour.** Google reissues part of a
  session continuously and expects the new values to be kept; they are now
  stored as they arrive.
- **Genre pages showed the wrong music.** The genre list came from YouTube Music
  and the contents came from Deezer, because the shared endpoint had no branch
  for YouTube Music.
- **An artist showed five tracks, no playlists, and ten albums.** Now 21, 21 and
  50 — the shelves behind YouTube's "more" links are followed, and every card is
  classified by what it actually is rather than assumed to be an album.
- **Search stopped at twenty results.** It now pages properly.
- **The engine failed to start** when YouTube Music was unreachable at launch.

## Elsewhere

- The player bar no longer covers the sidebar's collapse button, and clearing
  the queue dismisses the player instead of leaving it on screen.
- The command palette lists all three services and marks the current one.

## Notes

- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
- YouTube Music audio is lossy at source. For lossless, use Deezer or Qobuz.
- If a download is refused, add a YouTube session in Settings — the ⓘ beside it
  explains how to export one that lasts.
