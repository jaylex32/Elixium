# Elixium 1.5.0

**There is an Android app now**, and Elixium runs on the phone itself — not a
page pointed at your server, the whole thing.

Alongside it: better release years in your tags, downloads that no longer give
up when they should try a lower quality, playback that survives a track failing
to load, and YouTube Music playlists that file themselves properly instead of
burying everything under one artist.

## Android

The engine runs **on the phone**. Same arrangement as the desktop build, where
Elixium starts its own server and points a window at it — there is no address to
type and no machine to connect to.

- **A real player in the notification shade and on the lock screen**, with
  artwork, a seek bar, and previous, play and next. Headset and Bluetooth
  buttons work too.
- **Music goes to your Music folder**, not somewhere inside the app where
  nothing else can see it. There is a folder picker in Settings.
- **Playback keeps going with the screen off.**
- Everything the interface does on a computer, it does here: search, browse,
  download, playlists, watchlist, settings.

First launch takes half a minute or so while it unpacks itself; after that it
opens quickly. Add your ARL in Settings as usual.

The download is about 22 MB, and it is for 64-bit ARM — every phone sold in the
last several years. Install it yourself, so Android will ask you to allow
installing from wherever you opened it.

## Fixed

**Reissues are tagged with the year they were made.** Deezer reports the date a
release arrived on the service, so a 1973 record that reached streaming in 2011
was filed under 2011, beside music made four decades later. The original and
physical dates are preferred now, and a release with no real date is left
untagged rather than being called year zero.

**Downloads stop giving up when a lower quality would have worked.** Elixium
only stepped down a tier when Deezer said the account was not licensed for it —
but Deezer refuses just as often with a plain error, and a request that simply
times out looks the same. All of those ended the track. Now any failure to
resolve a download tries the next quality down, and the "Fallback quality"
setting still turns that off if you would rather have nothing than less.

**Some accounts were misread as being allowed lossless.** Deezer reports what an
account can stream inconsistently, and one of the shapes it uses was read
backwards. The result was not a wrong quality — it was a download that failed
outright instead of quietly stepping down.

**Playback no longer stops when one track will not load.** Changing track
cancelled the previous one's loading, and Elixium mistook that for the *new*
track failing — so it stopped, or swapped in the previous track's 30-second
preview over what was playing. On a computer this was rare. On a phone, where
loading takes longer, it killed queues after a few songs. A track that genuinely
will not load is now retried once, then skipped.

**YouTube Music playlists file themselves as playlists.** Downloading one put
every track under a single artist — eighty-four albums by different people
inside one folder. YouTube Music had one naming template where Deezer and Qobuz
have four, and that template began with the album artist, so a playlist could
only ever be filed as an album. It now has all four, and the playlist default
groups by the playlist:

```
Playlist/{playlist}/{artist} - {title}
```

All four are editable in Settings, and an existing setup keeps working — the new
templates fall back to the single one that came before them.

**The fullscreen player no longer draws scrollbars** over the artwork.

## Notes

- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
- The Android app keeps its own library and settings. It does not share
  anything with a server you run elsewhere — downloads land on the phone.
- Already-downloaded playlists will not reorganise themselves. Downloading one
  again files it correctly.
- The command line is unchanged.
