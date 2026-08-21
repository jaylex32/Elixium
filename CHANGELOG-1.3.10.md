# Elixium 1.3.10

Deezer sign-in works. In 1.3.9 it could not have worked for anybody.

## Signing in to Deezer

The sign-in added in 1.3.9 sent Deezer's credentials to an address that does
not exist. `auth.deezer.com/login/email` answers **404 page not found** to
every request, so the attempt failed before Deezer ever saw an email address —
and the failure was reported as "Deezer did not accept that email address and
password", which blamed the account for something that was entirely this
program's fault.

The endpoint that exists is `connect.deezer.com/oauth/user_auth.php`, and it
takes different parameter names than the ones being sent.

The signing was right. Deezer distinguishes the two failures exactly — a
malformed signature comes back as *wrong hash* and rejected account details
come back as *authenticate user failed* — and it now answers the second, which
is the correct answer to a deliberately invalid test account.

Those two cases are also no longer conflated in what Elixium shows you. A
signature Elixium built wrongly says so, and says to paste an ARL meanwhile,
rather than telling you to check a password that was never the problem.

The success response is read properly too: Deezer answers JSON when a sign-in
fails and an OAuth-style query string when it succeeds, and only the first
shape was being parsed — so even against the right address, a successful login
would have been discarded.

## Qobuz

Unchanged, and unaffected by the above: Qobuz sign-in was already reaching
Qobuz correctly.

## Note

The failing step is fixed and verified against Deezer itself — the request is
now accepted and correctly signed, with only the test account's invented
credentials refused. The remaining steps, exchanging an access token for a
session and reading the ARL from it, need a real account to exercise and have
not been. If they fail, the message will say which step, and the ARL field in
Settings still works as it always has.
