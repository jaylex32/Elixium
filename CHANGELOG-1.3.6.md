# Elixium 1.3.6

Qobuz browsing finally shows Qobuz's own catalogue, Home gained play controls
and links, and an artist's releases can be sorted.

## Qobuz genres

The Genres page was being handed Qobuz's five featured **types** — Best
Sellers, Most Streamed, Press Awards, Editor Picks, New Releases — as though
they were genres, so it asked the catalogue for "the best-sellers genre" and
got what you would expect.

Qobuz publishes fourteen real genres and filters both its featured albums and
its editorial playlists by them. Each now fills a page:

- **Albums** from four featured lists combined, since each holds fifty.
- **Artists** the artists making those records, in that order.
- **Tracks** from the genre's own editorial playlists — Qobuz has no track
  chart of any kind, and its editors' playlists for a genre are made of that
  genre's music.
- **Playlists** the genre's editorial selection.

Classical returns Beethoven, Mozart and Midori; Hip-Hop returns Lil Peep and
Open Mike Eagle.

## Qobuz charts

Charts answered "albums only" and handed back an empty grid for the other three
tabs. Artists now come from the artists charting, and tracks and playlists from
Qobuz's editorial feed. Albums and artists differ per featured type; playlists
and tracks do not, because Qobuz publishes a single editorial feed rather than
one per type.

## Home rows

Every card now carries **Play** beside Download. Playing an album or playlist
queues the whole thing rather than one track; a track plays immediately, since
its payload is already enough and a round trip in front of the most immediate
action in the app is not worth the tidiness.

Artist names under cards open that artist, and a track card's album name opens
the album. Clicking the card itself still opens it, exactly as before — the two
ways in sit alongside each other rather than one replacing the other.

On artist cards, Play sits at the foot of the card and Download stays at the
top: the corner over someone's face is the wrong place for the control people
reach for most.

Those overlay buttons also had no accessible name at all — a screen reader
announced "button" — and now say what they do.

## Sorting an artist's releases

An artist's Albums and Playlists tabs can be ordered **Newest**, **Oldest** or
**A–Z**, and start at newest. A discography arrives in whatever order the
service felt like, which for a long career means the record someone came for
can be anywhere in a list of eighty.

The Tracks tab deliberately has no sort: it arrives ordered by popularity, and
re-ordering it by date would throw away the only ranking it has.

## Phones

The sort strip in Search ran off the right edge — three controls do not fit one
phone line — and now wraps, scrolling within its own line if even that is too
narrow. The genre tabs overhung by two pixels for the same class of reason: the
strip could scroll, but its container would not shrink to let it.

Every page and every state that carries a toolbar was measured at 390px rather
than looked at: results with a sort strip, selection mode, album and artist
views, an open genre, and charts.
