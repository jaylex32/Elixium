# Elixium 1.3.12

The email-and-password sign-in added in 1.3.9 is removed. Deezer and Qobuz are
configured the way they were before it: an ARL cookie and a Qobuz token, in
Settings.

## Why it is gone

Signing in with a password cannot work for Deezer any more, and three releases
were spent discovering that one step at a time. Tested against a real account,
every route from a password to an ARL is closed:

- The web login endpoint refuses programmatic requests outright. It wants a
  captcha, and warming it with real browser cookies first makes no difference.
- An OAuth access token can be obtained — the credentials are accepted and the
  account identified — but it cannot authenticate the private session an ARL
  belongs to. That session stays anonymous no matter how the token is
  presented.
- Every published mobile gateway key is rejected.

None of that is something a client can work around, so the feature was a
button that could only ever fail. Removing it is better than leaving it there
looking like it should work.

Qobuz sign-in did function, but a login form that works for one service and
not the other is worse than no login form: the failure looks like a bug in the
program rather than a decision by Deezer.

## What is back

Settings → Authentication is exactly as it was in 1.3.8:

- **Deezer ARL** — from your browser cookies on deezer.com
- **Qobuz App ID**, **Qobuz Token**, **Qobuz Secrets**

Nothing else changed. The startup fix from 1.3.8, Qobuz working on a fresh
install, and the Play button and artist links in the *Because you searched*
row are all unaffected — verified with both services live before release.

If downloads have stopped working with `NEED_USER_AUTH_REQUIRED`, the ARL has
expired; a fresh one in the field above fixes it.
