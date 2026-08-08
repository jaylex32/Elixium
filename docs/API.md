# Elixium API v1

HTTP API for external clients. The Android app is the primary consumer: a user
enters their server's IP address or domain, and the app talks to everything
below over plain HTTP.

Base URL: `http://<host>:<port>/api/v1` (default port `3000`).

> The older unversioned `/api/*` routes still exist and still serve the bundled
> web UI. They have no response envelope and no stability guarantee. **New
> clients should use `/api/v1` exclusively.**

---

## 1. Response envelope

Every JSON response uses the same shape, so a client branches on one boolean
rather than inferring meaning from status codes.

**Success**

```json
{"ok": true, "data": <payload>, "meta": {"…": "optional context"}}
```

**Failure**

```json
{"ok": false, "error": {"code": "bad_request", "message": "Missing required field: q"}}
```

Binary responses (audio, files, ZIP archives) return raw bytes on success and
only use the envelope for errors.

### Error codes

| `code` | HTTP | Meaning |
|---|---|---|
| `bad_request` | 400 | Missing or malformed parameter |
| `unsupported_service` | 400 | `service` was not `deezer` or `qobuz` |
| `not_found` | 404 | No such track, item, or endpoint |
| `not_configured` | 409 | Server lacks the credentials for this action |
| `upstream_error` | 502 | Deezer/Qobuz failed or the stream dropped |
| `service_unavailable` | 503 | Feature disabled on this server |
| `internal_error` | 500 | Unhandled failure |

---

## 2. Connecting to a server

`GET /api/v1/health` is the handshake. It is cheap, never throws, and is what
the app should call to validate a user-entered address.

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "app": "Elixium",
    "version": "1.0.3",
    "api": {"version": 1, "base": "/api/v1"},
    "services": {
      "deezer": {"configured": true, "qualities": ["flac", "320", "128"]},
      "qobuz":  {"configured": true, "qualities": ["hires", "96khz", "44khz", "320kbps"]}
    },
    "capabilities": {
      "search": true, "discovery": true, "streaming": true,
      "rangeRequests": true, "directDownload": true,
      "archiveDownload": true, "serverSideDownload": true,
      "watchlist": true,
      "realtime": {"transport": "socket.io", "path": "/socket.io"}
    },
    "serverTime": "2026-08-08T15:44:30.306Z"
  }
}
```

Recommended client flow:

1. User types a host. Call `/health` with a short timeout (~3 s).
2. Non-200, or `ok !== true`, or missing `data.api` → not an Elixium server.
3. Store the base URL. Use `capabilities` to hide unsupported features and
   `services[x].configured` to warn before the user hits a dead path.

> **`configured` means a credential is present, not that it is valid.** An
> expired Deezer ARL still reports `configured: true`. See §4 for how to detect
> the resulting degradation at stream time.

`GET /api/v1` returns a machine-readable index of every route — handy while
building a client.

---

## 3. Catalog

### Search

```
GET /api/v1/search?service=qobuz&q=daft%20punk&type=album&limit=20&offset=0
```

| Param | Required | Notes |
|---|---|---|
| `service` | yes | `deezer` \| `qobuz` |
| `q` | yes | Query string (alias: `query`) |
| `type` | no | `track` (default) \| `album` \| `artist` \| `playlist` |
| `limit` | no | Default 50, max 200 |
| `offset` | no | Default 0 |

`meta` carries `count` and `hasMore`, so paging needs no extra call:

```json
"meta": {"service":"qobuz","type":"album","query":"daft punk",
         "limit":20,"offset":0,"count":20,"hasMore":true}
```

### Discovery

```
GET /api/v1/discovery?service=qobuz&type=<row>&limit=18
```

Editorial rows for a home screen. Valid `type` values depend on the service.

### Expanding an item

```
GET /api/v1/albums/:id/tracks?service=qobuz
GET /api/v1/artists/:id/top-tracks?service=qobuz
GET /api/v1/playlists/:id/tracks?service=qobuz
GET /api/v1/items/:itemType/:id?service=qobuz     # generic form
```

All return `{"data": {"tracks": [...], "metadata": {...}}}`.

### Resolving a share link

```
POST /api/v1/parse-url
{"url": "https://open.spotify.com/album/…", "service": "qobuz"}
```

Accepts Deezer, Qobuz, Spotify, Tidal and YouTube links. Spotify/Tidal/YouTube
links are matched onto Qobuz. `service` is optional and forces the target.

### Quality options

```
GET /api/v1/qualities?service=qobuz
```

Returns id/label/format/detail per option — render a picker without hardcoding.

| Service | Ids (best first) |
|---|---|
| Deezer | `flac`, `320`, `128` |
| Qobuz | `hires`, `96khz`, `44khz`, `320kbps` |

---

## 4. Playback

```
GET  /api/v1/tracks/:id/stream?service=qobuz&quality=44khz
HEAD /api/v1/tracks/:id/stream?service=qobuz&quality=44khz
```

Built for a progressive player (ExoPlayer, AVPlayer, `<audio>`):

- **Range requests** are supported. A `Range` header returns `206` with
  `Content-Range`; an unsatisfiable range on a buffered track returns `416`.
- **HEAD** returns headers only, so a client can probe size and type without
  downloading.
- `Accept-Ranges: bytes` and `Cache-Control: private` are always set.

### Detecting a degraded stream

When Deezer authentication is unavailable, the server **silently falls back to
a 30-second preview**. Without a signal, that is indistinguishable from a
broken track. Two response headers make it explicit:

| Header | Values |
|---|---|
| `X-Elixium-Stream` | `full` \| `preview` |
| `X-Elixium-Stream-Reason` | e.g. `deezer-auth-unavailable` |

Both are listed in `Access-Control-Expose-Headers`, so browser clients can read
them too. **Check `X-Elixium-Stream` and surface "Preview only — check server
credentials" rather than letting the track end at 0:30 unexplained.**

### Server-side caching

Deezer tracks must be downloaded and decrypted in full before any byte can be
served. The server keeps decrypted buffers in a byte-budgeted LRU (512 MB,
10-minute TTL), so a seek hits memory instead of re-downloading the track.
Qobuz streams proxy directly and are not buffered.

`GET /api/v1/cache/stats` reports `{entries, bytes, maxBytes}`.

---

## 5. Downloading

Three different things a client might mean by "download":

### One tagged file — for saving to the device

```
GET /api/v1/tracks/:id/file?service=qobuz&quality=hires
```

Returns the tagged audio with `Content-Disposition: attachment`.

### A ZIP of many tracks

```
POST /api/v1/downloads/archive
{"service":"qobuz","trackIds":["123","456"],"quality":"44khz",
 "structure":"album","zipName":"my-album","jobId":"optional"}
```

Partial failures are tolerated: tracks that fail are skipped and reported via
`X-Elixium-Tracks-Added` / `X-Elixium-Tracks-Failed`. If *every* track fails
you get `404` with the failing ids in `error.details.failed`. Passing `jobId`
emits `downloadProgress` over Socket.IO as the archive builds.

### Queue on the server — writes to the server's music folder

```
POST /api/v1/downloads              {"service":"qobuz","tracks":[…],"quality":"hires"}
GET  /api/v1/downloads              → {active: [...], queue: [...]}
```

`POST` returns as soon as the work is accepted (`status: "queued"`); progress
arrives over Socket.IO.

---

## 6. Settings

```
GET   /api/v1/settings
PATCH /api/v1/settings      # sparse — only the keys you send are written
```

**Credentials are never returned.** `GET` replaces every secret with a boolean
indicating whether it is set, plus a `configured` summary:

```json
{"cookies": {"arl": true, "sp_dc": true},
 "qobuz": {"app_id": 950096963, "secrets": true, "token": true},
 "configured": {"deezer": true, "qobuz": true, "spotify": true},
 "paths": {"deezer": "…", "qobuz": "…"},
 "quality": {"deezer": "320", "qobuz": "44khz"}}
```

`PATCH` accepts the real values. Changing a credential resets that service's
session so the next request re-authenticates.

---

## 7. Watchlist

| Method | Path |
|---|---|
| `GET` | `/watchlist` — full state |
| `GET` | `/watchlist/history` |
| `GET` | `/watchlist/schedules` |
| `POST` | `/watchlist/scan` — run now |
| `POST` / `DELETE` | `/watchlist/artists` · `/watchlist/artists/:id` |
| `POST` / `DELETE` | `/watchlist/playlists` · `/watchlist/playlists/:id` |
| `GET` / `PUT` | `/watchlist/genres` |

---

## 8. Realtime (Socket.IO)

Long-running work reports progress over Socket.IO at `/socket.io`, not HTTP.
Events a client will care about:

| Event | Payload |
|---|---|
| `downloadProgress` | `{itemId, itemStatus, itemProgress, currentTrack, current, total}` |
| `downloadComplete` | `{itemId, count, files}` |
| `downloadError` | `{itemId, message}` |
| `watchlistScanStarted` | `{kind}` |
| `watchlistScanComplete` | `{time, kind, failed?}` |
| `watchlistState` | full watchlist state |

---

## 9. Security — read before exposing to a network

The API currently has **no authentication**. Anyone who can reach the port can
read settings, queue downloads, and stream audio. That is acceptable on a
trusted LAN and **not** acceptable on the open internet.

If exposing beyond a LAN, put it behind a reverse proxy with TLS and auth
(basic auth or mTLS), or a VPN / Tailscale. CORS is currently `origin: *`.

Adding a bearer-token layer would be a contained change — a single middleware
ahead of the v1 router, plus a token field in the Android connection screen.

---

## 10. Quick reference

```
GET    /api/v1/health                       server handshake
GET    /api/v1                              route index
GET    /api/v1/search                       ?service&q&type&limit&offset
GET    /api/v1/discovery                    ?service&type&limit
GET    /api/v1/albums/:id/tracks            ?service
GET    /api/v1/artists/:id/top-tracks       ?service
GET    /api/v1/playlists/:id/tracks         ?service
GET    /api/v1/items/:itemType/:id          ?service
POST   /api/v1/parse-url                    {url, service?}
GET    /api/v1/qualities                    ?service
GET    /api/v1/genres
GET    /api/v1/tracks/:id/stream            ?service&quality   (GET + HEAD, Range)
GET    /api/v1/tracks/:id/file              ?service&quality
POST   /api/v1/downloads/archive            {service, trackIds[], quality?}
GET    /api/v1/downloads
POST   /api/v1/downloads                    {service, tracks[], quality?}
GET    /api/v1/settings
PATCH  /api/v1/settings
GET    /api/v1/watchlist
POST   /api/v1/watchlist/scan
GET    /api/v1/cache/stats
```
