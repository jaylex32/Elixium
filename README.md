# Elixium

Elixium is a Deezer and Qobuz downloader based on d-fi, offering interactive CLI, headless automation, and a full web interface.

Elixium keeps both sides of the project intact:

- the original CLI downloader workflow
- a full web UI/server interface

This is not a web-first rewrite and it is not CLI-only either. Elixium can be used interactively in the terminal, in headless automation mode, or through the browser-based server UI.

## Core capabilities

- Deezer and Qobuz search, browsing, and download flows
- CLI modes:
  - interactive
  - headless
  - web
- Web UI pages:
  - Home
  - Search
  - Downloads
  - Watchlist
  - Genres
  - URL Download
  - Playlists
  - Player
  - Settings
- Qobuz watchlist system:
  - artist monitoring
  - playlist monitoring
  - schedule-based scans
  - review queue
  - history
- Qobuz discovery features:
  - genres page
  - home discovery sections
  - watched artists and playlist monitoring
- Cross-service conversion into Qobuz where supported:
  - Deezer -> Qobuz
  - TIDAL -> Qobuz
  - YouTube -> Qobuz
  - Spotify -> Qobuz where supported
- Local playlist management in the web UI
- Packaged binaries for Windows, macOS Intel, macOS Apple Silicon, and Linux x64

## Interfaces

### CLI

The CLI keeps the original `d-fi` style workflow for terminal users:

- interactive prompts
- direct URL downloads
- headless automation
- web server startup from the same binary

### Web UI/server

The web interface adds a full browser workflow on top of the downloader core:

- search and browse services visually
- review and manage queue activity
- monitor artists and playlists
- run scheduled watchlist scans
- manage local playlists and direct URL downloads

## Screenshots

### Web UI

![Elixium WebUI Home](Screenshots/Ellixium%20WebUI.png)
![Elixium WebUI Search](Screenshots/Elixium%20WebUI_Search.png)
![Elixium WebUI Watchlist](Screenshots/Elixium%20WebUI_Watchlist.png)

### CLI

![Elixium CLI](Screenshots/Elixium%20cli.png)
![Elixium CLI Alternate](Screenshots/Elixium%20cli_2.png)

## CLI arguments

All CLI flags currently exposed by the app:

| Flag | Description |
| --- | --- |
| `-q, --quality <quality>` | Download quality. Deezer: `128`, `320`, `flac`. Qobuz: `320kbps`, `44khz`, `96khz`, `192khz`. |
| `-o, --output <template>` | Output filename template. |
| `-u, --url <url>` | Deezer or Qobuz album, artist, playlist, or track URL. |
| `-i, --input-file <file>` | Download all URLs listed in a text file. |
| `-c, --concurrency <number>` | Download concurrency for albums, artists, and playlists. |
| `-a, --set-arl <string>` | Set the Deezer `arl` cookie. |
| `-d, --headless` | Run in headless automation mode. |
| `-conf, --config-file <file>` | Custom path to the config file. |
| `-rfp, --resolve-full-path` | Use absolute paths for playlists. |
| `-cp, --create-playlist` | Force playlist file creation even for non-playlist downloads. |
| `-b, --qobuz` | Enable Qobuz mode. |
| `-w, --web` | Start the web interface. |
| `-p, --port <port>` | Web interface port. |
| `-U, --update` | Check update status for packaged builds. |

## Usage examples

```bash
# interactive mode
elixium

# web UI/server
elixium --web --port 3000

# headless Deezer/Qobuz URL download
elixium --headless --url https://www.deezer.com/track/3135556 --quality flac

# Qobuz headless mode
elixium --qobuz --headless --quality 96khz --url https://play.qobuz.com/album/...
```

## Local development

```bash
npm install
npm run build
npm test
```

Run from source:

```bash
npm start
```

Development mode:

```bash
npm run dev
```

## Packaging

Windows:

```bash
npx pkg . --targets node16-win-x64 --output binaries/elixium.exe
```

Cross-target examples:

```bash
npx pkg . --targets node16-linux-x64 --output binaries/elixium-linux-x64
npx pkg . --targets node16-macos-x64 --output binaries/elixium-macos-x64
npx pkg . --targets node16-macos-arm64 --output binaries/elixium-macos-arm64
```

## Project layout

- `src/` application logic
- `public/` web UI assets
- `test/` automated tests
- `Screenshots/` release screenshots
- `binaries/` local packaged builds

## Notes

-This project is intended to be a full public fork of d-fi with both CLI and web UI support, packaged releases, and ongoing feature development around Deezer and Qobuz workflows.
