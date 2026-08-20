# Elixium 1.3.3

Everything connects to everything: a track leads to its album, an album to its
artist, and Back retraces every step. Genres finally show the genre.

## Getting around

**Back** now works everywhere. It unwinds detail views first — from an album
opened inside an artist it returns to the artist, not to the page behind both —
and then walks back through the pages you visited, so an artist reached from
Charts returns to Charts.

Every page used to hold its own idea of "the thing that is open" and could show
exactly one, which is why stepping sideways lost where you came from. There is
now a single stack, and albums and artists open onto it from anywhere.

## Everything is a link

- The artist under a track opens that artist.
- The album beside it opens that album.
- The artist of an album, and any guest artist on a track, do the same.

Rows carried the ids needed to do this all along and never used them, so a
track named its album in plain text with no way to reach it.

The **⋯ menu** on a track gained **Go to album**, **Go to artist** and **Copy
link**. Where a row genuinely has no id — some converted and playlist results —
the text stays plain rather than looking clickable and refusing to work.

## Genres, rebuilt

Pick a genre, then browse it: a full-width wall of artwork, and one press opens
its **Albums, Tracks, Playlists and Artists** with a Back to the picker.

The content is now the genre's own. Deezer's per-genre artist endpoints ignore
the genre and return the global top artists — asking for Reggae answered with
Taylor Swift and Drake — and its per-genre album chart holds about four
records. Genres are now assembled from the sources that do respect them: the
genre's radio stations, its editorial selection and its chart, with artists
taken from the music itself. Every genre now fills a page. Reggaeton needed its
own path, because Deezer runs no radio for it at all; its editorial playlists
stand in.

## Recommendations

Home has a **Because you searched** shelf, built from your own recent searches
and interleaved so one artist cannot fill it. It appears once there is
something to go on, and never before.

## Explicit markers

The **[E]** badge now shows on tracks inside an album. A Deezer track carries
that flag under one name in search results and a different one when it arrives
inside an album, so the same track was marked in one place and not the other.

## Watchlist

The watchlist page showed nothing at all until the server answered, with no
loading state, no empty state and nothing to retry — and if the connection
dropped it stayed blank indefinitely. It now shows its shape while loading,
asks again after a reconnect, and offers a retry if the wait gets long.

Opening it no longer waits on a Qobuz round trip first, and reading the
watchlist no longer copies the whole file once per watched artist.

## Also fixed

- Settings never read the download quality back from the server, so it showed
  its own default and wrote that default over your setting on the next save.
  Opening Settings for something unrelated could quietly change your quality.
- An artist opened from a track or album row showed an empty circle where the
  photograph belongs; those rows carry a name and an id but no artwork.
- Album cards in an artist's view show a track count.
