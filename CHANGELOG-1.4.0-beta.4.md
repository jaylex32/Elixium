# Elixium 1.4.0-beta.4

A fix for one bug in beta.3, and the check that should have caught it.

## Settings opens again

The Settings page did not render at all in beta.3. It showed "Settings failed to
render — `Tooltip` must be used within `TooltipProvider`", and there was no way
past it: no download folders, no credentials, no format or service settings.

The ⓘ beside "YouTube Music format" was added in beta.3. A tooltip needs a
provider above it, and the only one on that page wrapped the YouTube session
block — the ⓘ sits elsewhere, so it had none and threw on sight. React unmounts
the whole page when a component throws during render, which is why one small
hint took the entire screen with it.

Fixed in two places, so it cannot come back the same way:

- The hint carries its own provider, making the page self-sufficient.
- A provider now sits at the root of the app, so any tooltip added anywhere in
  future has one above it.

Nothing else changed. Everything in beta.3 — the playback stalls, the artist and
album links, play buttons on every card, album audio instead of music-video
audio — is unchanged.

## The check that was missing

This shipped because nothing ever rendered the page. TypeScript compiled it,
eslint passed it, vite built it and the engine served it — a component that
throws while React executes the tree is invisible to every one of those.

`npm run render-check` now renders all twelve pages plus the sidebar, player bar
and queue in Node, and fails if any of them throws. It is deliberately stricter
than the real app: pages are rendered bare, with none of the providers the app
wraps them in, so a tooltip with nothing above it is caught rather than masked.

It was verified against the actual bug — with the fix removed it reports the
failure, with the fix in place all fifteen render.

## Notes

- **macOS** builds are unsigned; Apple Silicon requires a first-run bypass.
- If you installed beta.3 and could not open Settings, this build restores it;
  no settings were lost, the page simply could not draw itself.
