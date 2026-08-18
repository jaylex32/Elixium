# Elixium 1.3.2

An artist's albums carry the artist's name and their track count, and every
naming template shows what it will actually produce.

## "Unknown Artist" in an artist's own view

Every album in a discography was labelled **Unknown Artist**, including in the
one place where the artist is never in doubt.

Neither service repeats the artist on each album of a discography — it is
implied by the request — so the server filled the gap with that literal text.
Because it is text rather than an empty value, later attempts to fall back to
the artist's name never took effect: there was always something there. The
name now travels with the request and fills the field, and the interface
treats the placeholder as the absence it stands for.

This affects the albums, tracks and playlists tabs, on both services and on
both the REST and socket routes.

## Track counts on album cards

Album cards in an artist's view now read **2023 · 18 tracks**.

Deezer's discography listing does not include a track count at all — the field
is simply not in the response — so it is fetched once per artist from the
endpoint that does report it and matched onto the listing. If that lookup
fails the cards lose a count and nothing else changes. Qobuz reports the count
in the listing itself.

## Live preview for file naming

Each naming template in Settings now shows the path it produces, updating as
it is typed, for Deezer and Qobuz and for all four kinds — single track,
album, artist and playlist.

Folders are dimmed and the filename is not, so the shape of the tree reads at
a glance, and the extension follows the quality you picked. The preview
applies the same rules the downloader does, including the two that are
invisible in the text itself:

- `{NO_TRACK_NUMBER}` inserts nothing **and** turns off the automatic `04 - `
  prefix. It looks like a field and is really an instruction.
- `{TRACK_NUMBER}` inserts the padded number and turns the automatic prefix
  off as well, so the number is never doubled.

A placeholder the service does not recognise is left as written, so a template
carrying a token from the other service is visible as such rather than
silently resolving to nothing.

## Also

- The download manager keeps the folder each item reported even when several
  downloads finish close together.
