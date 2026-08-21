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

## Qobuz on a fresh install

Qobuz was completely dead on any new installation. Elixium reads Qobuz's app
id out of their web player when it first runs, and Qobuz had restructured that
file — the old `app_id` entry does not exist in it any more. Reading it
produced nothing, that nothing was saved to the configuration and then used,
and the result was an internal error rather than anything a person could act
on.

Elixium now reads the current layout, where the credentials sit in a map keyed
by environment, and deliberately takes the **production** entry — the first
match in that file belongs to a staging environment that real accounts cannot
authenticate against. The previous layout is still understood, and there is a
last-resort pattern behind both.

A working app id already stored is never replaced. Qobuz ties each account
token to the app id it was created with, so re-detecting and overwriting the id
would sign existing users out with no explanation.

Qobuz also publishes its signing secret openly now, so that one is tried first
and the reconstructed ones are kept as a fallback. Reading secrets from a file
that contained none used to throw outright; it no longer does.

## The two services are independent

Verified rather than assumed, on a profile with no credentials of any kind:
Deezer search, genres, charts, new releases and playlists all work while Qobuz
is unavailable. With Qobuz credentials present, both services work.

Qobuz now requires an account for **browsing** as well as downloading — every
Qobuz endpoint refuses an anonymous request, which is their change, not ours.
Elixium says so directly instead of failing anonymously, and it distinguishes
the cases that used to look identical:

- **Needs an account** — no Qobuz Token has been entered.
- **Rejected** — the token has expired, or does not match the App ID.
- **Offline** — nothing could reach Qobuz.
- **Timeout** — Qobuz answered too slowly.

Previously all four reported "Couldn't find any valid app secrets", which sent
people to re-enter details that were fine.
