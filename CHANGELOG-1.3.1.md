# Elixium 1.3.1

Bulk selection that works inside album and artist windows, and a download
manager that shows each download's real folder.

## Selecting inside an album or artist window

The bar with **Download selected** was drawn on top of an open window and was
completely unclickable. Anything opened as a window — an album, an artist —
holds the pointer for as long as it is open, and the bar sat outside it, so it
looked available and did nothing. It now takes clicks while a window is open,
and pressing it no longer closes the window underneath.

An artist's view only had **Select all**, which meant the one thing it could
not do was pick a few albums out of a discography. It now has **Select**, on
all three tabs, and the Tracks tab has checkboxes at all — previously it had
none, so individual songs could not be chosen at all.

**Select** now turns the mode on without ticking anything. It used to select
the first item for you, which is the opposite of choosing.

## Selecting on every page

Charts, Favorites, Genres, Playlists and Discover carried checkboxes that only
appeared on hover, with no way to turn selection on — unreachable on a
touchscreen and invisible on a desktop. Each of those pages now has the same
**Select** control as Search. Chart tracks and saved tracks show a checkbox in
place of their position while selecting, rather than shifting every row.

## Download manager paths

Every finished download now shows the folder its files actually landed in.

Completion was reported for the whole queue rather than per item, so the first
download to finish claimed every row still running and stamped its own folder
on them — an album by one artist showed another artist's path — and the rows
that finished individually showed no path at all. Each item now reports its own
folder as it finishes, and a folder that arrives late still corrects a row that
was already filed.

## Also fixed

- Pasting several URLs and pressing **Download all ready** produced a single
  history row: every download started in the same millisecond shared an id.
- A pasted track URL was listed as "Unknown Content" — a single track carries
  its name on the track, not in the link's information.
- Albums opened from an artist's view were filed under "Unknown Artist"; a
  discography listing implies the artist rather than repeating it, so the
  artist whose view it is now fills that in.
