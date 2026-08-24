/**
 * Keeping a YouTube session alive as Google rotates it.
 *
 * An exported cookies.txt is a snapshot, and Google does not treat a session as
 * a constant. It reissues the short-lived halves of it continuously, handing
 * new values back in `Set-Cookie` on ordinary responses, and expects the client
 * to store them. A browser does. Anything that keeps replaying the values it
 * was first given is running on a session that Google has already moved on
 * from, and it stops working within the hour.
 *
 * That is exactly what happened here, and it looked like something else
 * entirely: an export authenticated, downloads worked, and then every request
 * started coming back `UNPLAYABLE` with "the page needs to be reloaded" —
 * indistinguishable from rate limiting, and blamed on it for the best part of
 * an hour. What settled it was re-probing the session directly: the same file
 * that read `LOGGED_IN: true` read `false` later, while browsing still worked.
 * Nothing was blocked; the session had simply expired out from under us.
 *
 * So rotations are merged back in and persisted. Only the cookies Google
 * actually rotates are taken, and a signed-out response is never allowed to
 * clear the session — see `mergeSetCookie` for why that distinction matters.
 */

/**
 * The cookies Google reissues during a session.
 *
 * Deliberately narrow. These are the short-lived halves — timestamps and
 * per-session counters — and taking only them means a response that is trying
 * to sign us out cannot overwrite the credentials themselves.
 */
export const ROTATING_COOKIES = [
  '__Secure-1PSIDTS',
  '__Secure-3PSIDTS',
  'SIDCC',
  '__Secure-1PSIDCC',
  '__Secure-3PSIDCC',
];

/** Parse a Cookie header into name/value pairs. */
export const parseCookieHeader = (header: string): Map<string, string> => {
  const jar = new Map<string, string>();
  for (const part of (header || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return jar;
};

/** Render name/value pairs back into a Cookie header. */
export const renderCookieHeader = (jar: Map<string, string>): string =>
  [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');

/** One `Set-Cookie` line's name and value, ignoring its attributes. */
const parseSetCookie = (line: string): {name: string; value: string} | null => {
  const first = (line || '').split(';')[0]?.trim();
  if (!first) return null;
  const eq = first.indexOf('=');
  if (eq <= 0) return null;
  return {name: first.slice(0, eq), value: first.slice(eq + 1)};
};

/**
 * Merge rotated cookies from a response into the stored session.
 *
 * Returns the updated header, or null when nothing worth persisting changed —
 * so a caller can avoid rewriting its configuration on every single request.
 *
 * Two things are deliberately refused:
 *
 *  - Cookies outside `ROTATING_COOKIES`. A signed-out response reissues the
 *    core session cookies as empty or throwaway values, and honouring that
 *    would destroy a working session on the strength of one bad reply.
 *  - Empty values, for the same reason. A rotation always carries a value; a
 *    deletion is what an expiry looks like.
 */
export const mergeSetCookie = (cookieHeader: string, setCookie: string[] | undefined): string | null => {
  if (!setCookie || setCookie.length === 0) return null;
  const jar = parseCookieHeader(cookieHeader);
  let changed = false;

  for (const line of setCookie) {
    const parsed = parseSetCookie(line);
    if (!parsed) continue;
    if (!ROTATING_COOKIES.includes(parsed.name)) continue;
    if (!parsed.value || parsed.value === 'EXPIRED') continue;
    if (jar.get(parsed.name) === parsed.value) continue;
    jar.set(parsed.name, parsed.value);
    changed = true;
  }

  return changed ? renderCookieHeader(jar) : null;
};
