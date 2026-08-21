# Elixium 1.3.11

The last step of Deezer sign-in, in the right order.

## "Signed in but did not open a session"

1.3.10 got the sign-in itself working — Deezer accepted the credentials and
returned an access token — and then failed on what came next, because the
three calls after it were made in the wrong order.

An access token is not an ARL, and nothing trades one for the other directly.
The account has to be attached to a session, and the session then asked for its
ARL. Elixium was calling `api.deezer.com/platform/generic/track` first and
expecting a session to come back from it. That endpoint does not create
sessions; it attaches an account to one that already exists. With no session to
attach to, nothing came back, and the sign-in stopped with the message above.

Only the private `gw-light` endpoint issues a session. The order is now:

1. Ask `gw-light` for a session.
2. Present the access token against that session, attaching the account.
3. Ask the attached session for the ARL.

Steps one and two are verified against Deezer directly: a session is issued,
and an invalid token is refused at the attach step with a 401 rather than
silently producing nothing.

## Failures that say where they happened

Each step now names itself when it fails, and the final one quotes what Deezer
actually replied instead of only "did not return an ARL". This step is the one
that cannot be exercised without a real account, so if it ever fails the report
carries enough to fix it without another round of guessing.

In every failure the ARL field in Settings still works exactly as before.
