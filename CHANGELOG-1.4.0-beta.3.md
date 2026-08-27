# Elixium 1.4.0-beta.3

The third YouTube Music beta, and mostly about two things: **playback that does
not stall**, and **names you can click wherever they appear**. One of the fixes
below is the largest single performance problem the app has had.

## Playing a queue no longer stalls

Playback stopped every few tracks and came back seconds — sometimes a minute —
later, with pages elsewhere in the app refusing to load until it recovered.

The cause was a single missing case. The app probes each track with a `HEAD`
request to learn whether it is the real thing or a 30-second preview. The
engine had no handling for `HEAD` at all, so it answered by opening the stream
with no range and **downloading the entire track from the CDN**, then throwing
it away — because HTTP forbids sending a body on a `HEAD`. Playing a queue
downloaded every track twice: once to hear it, and once to read one header.

Measured, four tracks starting at once:

| | before | after |
|---|---|---|
| four tracks resolving together | 70–202 seconds | 2.0–2.7 seconds |
| twelve tracks played in order | 2.5s each, plus a hidden download each | 1.9s each, nothing hidden |

Three smaller fixes came with it:

- **The probe now runs only for Deezer.** YouTube Music and Qobuz always serve
  the real track or fail outright, so probing them resolved every track a
  second time to be told what was already known.
- **Request pacing actually paces.** It chained only the waiting — callers were
  spaced 150ms apart at the moment they *started* and then all ran at once.
- **Two callers for one track now share one resolve.** Pressing play asks
  twice at the same instant, and neither had finished when the other began.

The queue panel also stopped re-rendering four times a second. It read the
whole player store, so seventy rows were rebuilt on every tick of the playing
position — a number that panel does not display.

## Artist and album names are links, everywhere

Applies to Deezer, Qobuz and YouTube Music alike.

**An album's tracks name their artist.** They showed nothing at all, because
the row hid the artist whenever it matched the album's. On an album that is
every row.

**Featured artists are credited, and each name is its own link.** Only the
headline artist was ever read, so a song made with somebody else named one of
them and silently dropped the rest:

```
Talkin' 2 Myself      Eminem, Kobe
Won't Back Down       Eminem, P!nk
No Love               Eminem, Lil Wayne
```

Every one of those used to read "Eminem". Deezer names each guest with their
own id, so clicking P!nk opens P!nk.

The same line is now drawn the same way in every list that has one: albums,
playlists, artist pages, charts, genres, search, favourites, the queue, the
player bar and the fullscreen player.

Two Qobuz bugs turned up on the way and are fixed: an album card could not
open its artist, and an album link on a track could open a window on the track
id rather than the album.

## Play from any card

The play button existed on the home rows only. Everywhere else a card offered
a download and nothing else — genres, charts, search, favourites, playlists and
artist pages all now play in place, without opening the card first. A playlist
belonging to another service still shows download only: it has to be converted
before anything can play it.

## YouTube Music takes the album audio, not the video's

A YouTube Music playlist is mostly music videos — 90 of 100 tracks in the
home page's own '80s and R&B playlists. A music video's audio is not the
record: it carries label idents, applause, an intro, a different mix, and a
length that disagrees with the release.

YouTube marks every row with which it is, so this is read rather than guessed.
A download now takes the album master in its place, and the names and artwork
go with it — a file tagged "(Official Video)" would describe the upload rather
than the song. Measured on real playlists: 8 of 8 on one, 17 of 18 on another,
with no wrong matches.

Two settings, under Audio Quality:

- **Prefer album audio over music videos** — on by default.
- **Skip tracks with no album version** — off by default. Some songs exist only
  as a video; off keeps the video, on refuses it.

## A different recording is no longer accepted as a match

"Walk This Way" matched "Walk This Way (Instrumental)" with high confidence:
every word of the title overlaps, the artist matches, and the length can too.
A version qualifier on one side and not the other — instrumental, karaoke,
live, remix, sped up, extended — is now refused outright. There is no
confidence at which an instrumental is the right answer.

This also protects Spotify and TIDAL conversion, which had the same hole.

## Also

- **Lyrics are written into YouTube Music downloads.** The setting existed;
  YouTube Music's tagger simply never read it. Synced timings produce a `.lrc`
  beside the file, as on the other services.
- **A track already on disk is skipped**, matching Deezer. Both formats are
  checked, so changing format does not re-download a library.
- **Transient failures are retried** — a dropped connection, a 503, a 429 —
  three attempts with backoff, honouring `Retry-After`. A refusal still fails
  at once. Previously one blip mid-playlist ended that track for good.
- **Favourites remember where they came from**, so a starred track can still
  reach its artist and album long after the page it was starred from is gone.
- **The YouTube Music format picker** reads like the two above it. The
  compatibility note moved behind the ⓘ.

## Notes

- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
- A Deezer 30-second preview means Deezer refused the full track — usually a
  missing or expired ARL, sometimes a free account's licence. The player says
  so when it happens.
- Browsing a YouTube Music playlist still shows YouTube's own rows, video
  artwork included, until a track is downloaded. The album master is what
  reaches your library.
- YouTube Music audio is lossy at source. For lossless, use Deezer or Qobuz.
