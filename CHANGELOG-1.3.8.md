# Elixium 1.3.8

Elixium opens even when a music service does not.

## The startup failure, properly fixed

Some macOS users saw **"Elixium could not start — the engine did not start in
time"**, with the log ending on `WAIT Loading Qobuz API for search...`. It came
back across several releases.

The cause was an ordering mistake rather than anything to do with macOS. The
desktop app decides the engine is alive by asking it for `/api/v1/health`, and
that cannot answer until the engine is listening. The engine started listening
*after* initialising Qobuz — and Qobuz initialisation downloads Qobuz's web
bundle, about nine megabytes, over a connection that had no time limit on it at
all. If that download stalled, the engine never listened, so nothing ever
answered, so the app never opened. The only thing the user saw was the
launcher's own two-minute deadline expiring.

It had been "fixed" once before by raising that deadline from one minute to
two, which is why it returned: the wait was unbounded, and no deadline is
longer than forever.

Now the engine listens first, and services initialise behind the open port:

- **Nothing optional can delay the app opening.** Qobuz, Deezer downloads and
  anything added later start in the background once the window is already up.
- **Every initialisation has a time limit.** A service that hangs becomes a
  service marked unavailable, not a promise nobody is waiting on.
- **The engine reports what it is doing** — starting, core ready, degraded,
  fully ready — instead of the launcher guessing from console text.
- **The deadline is now a last resort**, not the thing that handles a slow
  service. It stays at two minutes because a first launch on macOS really can
  be slow while Gatekeeper scans the app.

Measured with every outbound connection deliberately hanging: the app is
serving in well under a second and settles into degraded operation, where
before it would never have opened.

## When a service is down

If Qobuz cannot be reached, Elixium opens, Deezer works normally, and Qobuz
says what is wrong rather than failing anonymously. The message distinguishes
cases that used to look identical:

- **Offline** — nothing could reach the service. Previously this was reported
  as invalid credentials, which sent people to re-enter details that were fine.
- **Configuration** — a token or app id is missing.
- **Authentication** — the credential was rejected.
- **Timeout** — the service answered too slowly.

Retrying no longer means restarting. Any Qobuz action tries again, and there is
now a `POST /api/v1/providers/:name/retry` endpoint for clients that want to
ask directly. `/api/v1/health` reports the state of every service, and a
service being down answers **503** with a retryable flag instead of 404.

## When startup genuinely fails

The error dialog now names the stage the engine reached rather than only
saying it ran out of time, and a required component failing is reported with
the component and the reason.

## Known issue

Qobuz still does not work on a **fresh install**: Qobuz changed the layout of
their web bundle, so the app id Elixium reads at first run comes back empty.
That is unchanged in this release — but it no longer prevents Elixium from
opening, and it now says exactly that instead of failing with an internal
error. Existing installs are unaffected, and Deezer is unaffected either way.
