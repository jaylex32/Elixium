# Changelog

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
