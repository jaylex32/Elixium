# Elixium 1.3.9

Sign in with your email address and password instead of hunting for a cookie.

## Signing in

Settings → Authentication now has a **Sign in** block. Pick Deezer or Qobuz,
enter the email address and password you already use, and Elixium fetches the
credential itself and fills in the field below.

Until now both services were configured by pasting a long opaque string — a
Deezer ARL cookie, or a Qobuz user auth token — which meant opening browser
developer tools and knowing which value to copy. That is the single most
common reason downloads do not work for somebody who has a perfectly good
account.

Your password is used for the one request that exchanges it and is never
written anywhere. Only what the service hands back is saved.

Whatever you signed in to is re-initialised straight away, so it works
immediately rather than after a restart.

### When it cannot work

Neither service offers a supported way to do this, so some accounts genuinely
cannot use it, and Elixium says which case you are in rather than blaming your
password:

- An account that signs in through **Google, Facebook or Apple** has no
  password to give.
- Deezer sometimes answers with a **captcha**, which cannot be answered here.
- A **Qobuz account with no streaming subscription** signs in fine and can
  browse, but will never download — better said now than discovered one failed
  download at a time.

In each case the manual field is still there and still works.

While implementing this it turned out the existing Qobuz login helper sent the
password in plain text. Qobuz expects an MD5 digest and rejects anything else,
so that path could never have worked. Both services now hash before sending.

A refusal from Deezer or Qobuz was also being reported in the interface as
`auth_required` — the internal signal for "this Elixium server wants an API
token", which is a different thing entirely and told the reader nothing. A
rejected sign-in now says so in words.

## Home

The **Because you searched** row gained a Play button beside Download, matching
every other row, and the artist under each card is now a link to that artist.
Clicking the card itself still opens the album.
