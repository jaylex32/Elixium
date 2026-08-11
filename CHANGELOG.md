# Changelog

## v1.1.1 - 2026-08-11

### Fixed

- The server could die silently, leaving a reverse proxy returning 502 and needing a manual restart. Nothing installed an `unhandledRejection` handler, and Node has terminated the process on an unhandled rejection since v15, so any rejection anywhere killed it with no message. Two specific paths reached that: the watchlist scan handlers destructured a payload that could be absent, so a single malformed message took the server down, and the watchlist scheduler discarded its promise on a 60-second timer, which killed the process unattended. Errors are now logged and the server keeps serving.
- The mobile navigation drawer opened underneath its own backdrop. The blurred layer covered the sidebar, so it showed through the blur and every tap landed on the backdrop instead of a menu item.
- The Library, Quality profile and API access panels sent no API token, so they returned 401 on any device other than the machine running Elixium — the reason Library failed only on a phone.
- Packaged binaries served a placeholder page instead of the interface when started from any directory without a `public/` folder beside them, because the web assets were never bundled into the executable.
- `dist` accumulated every previously built asset, inflating the binaries with hundreds of unused files.

## v1.1.0 - 2026-08-09

### Breaking

- The API now requires a token from anything that is not loopback. Requests from another device return `401` until it is paired. The token is shown under **Settings → API access** on the machine running Elixium; browsers are prompted for it automatically, and other clients send it as an `Authorization: Bearer` header, an `X-Elixium-Token` header, or a `?token=` query parameter. A browser on the same machine is unaffected and needs no token. The requirement can be turned off in the same panel.

### Added

- Rebuilt the web interface as a React + Vite + Tailwind application, with a mobile layout, a play queue, shuffle and repeat, a fullscreen player, Media Session support for lock-screen controls, search history and a command palette.
- Versioned REST API at `/api/v1` for external clients, with a consistent response envelope, Range-aware audio streaming, and a `/health` endpoint for validating a server address.
- API authentication: a per-install token, a browser pairing screen, an origin allowlist replacing the previous open CORS policy, and matching authentication on the realtime socket.
- Lyrics from LRCLIB, embedded into tags and optionally saved as a synced `.lrc` beside the audio. Available to the CLI as well as the web interface.
- Quality profiles with an upgrade cutoff: releases already in the library below the chosen tier are re-fetched when the service can do better. Existing quality is read from the files, so it works on a library built before this release.
- Library view showing each watched artist's catalogue against what is actually on disk, with owned, missing and upgradable counts.
- Watchlist gained release-type filtering, scheduled and on-demand scans, edition-aware deduplication, and unattended downloading.
- Download manager gained a report of tracks a cross-service conversion could not match, persistent history, filtering, and per-track manual search.
- Per-service path templates for Deezer and Qobuz, which use different placeholder vocabularies.
- Credential verification that exercises stored credentials rather than reporting whether a value is present.

### Fixed

- Deezer downloads and playback failed on Node 17 and newer with `ERR_OSSL_EVP_UNSUPPORTED`. Deezer streams are Blowfish-encrypted, and OpenSSL 3 moved that cipher behind the legacy provider; the previous workaround set `NODE_OPTIONS` from inside the running process, which Node reads only at startup.
- Playlist tracks would not play on accounts without a lossless licence. The stream endpoint requested a single format and fell back to a 30-second preview when it was refused, instead of stepping down through the qualities as downloads already did.
- Cover art ignored the configured size. A single value was written over a per-quality structure, Qobuz always used its 600px image, and embedded Qobuz art could never exceed 600px.
- ReplayGain, release version, ISRC, disc number and publisher were missing from written tags. On Qobuz the compilation flag was written into the credits frame and the record label into the copyright field.
- Playlists showed no artwork, and their tracks were all given the playlist's image instead of their own album art.
- Watchlist reported albums as missing when they were already on disk, because the folder name includes the artist prefix while the release title does not. The duplicate check used the same index and had the same blind spot.
- Settings failed to load for anyone upgrading from an earlier version, and a stored credential could not be cleared once set.
- Downloads appeared to hang at complete, and single downloads could produce duplicate rows.
- Artists expanded as albums, listing unrelated tracks.
- Spotify playlist conversion built a Qobuz URL from a Spotify id, and rate limiting was reported as a generic failure.

## v1.0.3 - 2026-04-15

- Enhanced Spotify playlist converter.
- Fixed Spotify and TIDAL watchlist playlist covers in the web UI.
- Improved watchlist card layouts for artists and playlists.
- Added a collapsible Downloads overview section with the grid area prioritized by default.

## v1.0.2 - 2026-04-12

- Fixed the packaged Spotify playlist conversion path so release binaries use the updated track-page parser reliably.
- Hardened Spotify track-page metadata extraction with more tolerant meta parsing and JSON-LD fallback.

## v1.0.1 - 2026-04-12

- Fixed Spotify playlist conversion reliability for Qobuz and Deezer.
- Improved Qobuz fallback matching for Spotify tracks with missing ISRCs, remixes, mixed versions, and multi-artist metadata.
- Re-enabled Spotify playlist support in the web UI for direct downloads, playlist editing, and watched playlists.
- Fixed Spotify playlist watchlist status so it shows as live instead of coming soon.
