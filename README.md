# Elixium

Elixium is a web-first music downloader and discovery app focused on Deezer and Qobuz, with conversion flows into Qobuz for supported services.

## What is included

- Web UI for search, downloads, playlists, watchlist, genres, and player
- CLI entrypoint via `elixium`
- Windows standalone packaging through `pkg`

## Local development

```bash
npm install
npm run build
npm test
```

Run the app:

```bash
npm start
```

For development:

```bash
npm run dev
```

## Windows binary

Build the standalone executable:

```bash
npx pkg . --targets node16-win-x64 --output binaries/elixium.exe
```

## Project structure

- `src/` application and service logic
- `public/` web UI assets
- `test/` automated tests
- `binaries/` local packaged builds

## Release notes

This repo is prepared for an initial GitHub source release. Local caches, temp files, binaries, runtime state, and generated output are ignored.
