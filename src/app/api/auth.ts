import {randomBytes, createHash, timingSafeEqual} from 'crypto';
import type {Request, Response, NextFunction} from 'express';

/**
 * Access control for the HTTP API and the Socket.IO channel.
 *
 * The server binds every interface and had no authentication at all, so any
 * device on the network could rewrite settings, queue downloads and stream the
 * library. CORS was `origin: '*'`, which made it worse than a LAN problem: any
 * website open in a browser on the same machine could drive the API silently,
 * because the browser would attach the request and hand back the response.
 *
 * The model is "local is trusted, remote is not":
 *
 *  - Requests from loopback are exempt. The web UI is served from the same
 *    origin, so opening Elixium in a browser on the host keeps working with no
 *    token and no login screen.
 *  - Everything else — phones, tablets, another desktop, the Android app —
 *    must present the token.
 *
 * That makes remote access safe by default without breaking the setup that
 * already works, which matters because an auth change that locks someone out
 * of their own tool tends to get switched off entirely.
 */

/** Header clients should use. `Authorization: Bearer <token>` also works. */
export const TOKEN_HEADER = 'x-elixium-token';

/** Query fallback for URLs a browser loads directly. */
export const TOKEN_QUERY = 'token';

/** Routes reachable without a token, relative to the API base. */
const PUBLIC_PATHS = new Set(['/health']);

/** Exported so the Socket.IO handshake can apply the same rule. */
export const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Whether the request came from this machine.
 *
 * `req.ip` is used rather than X-Forwarded-For: behind a reverse proxy that
 * header is attacker-controlled unless `trust proxy` is configured, and
 * trusting it would let any remote client claim to be loopback.
 */
export const isLoopback = (req: Request): boolean => {
  const address = req.socket?.remoteAddress ?? '';
  return LOOPBACK_ADDRESSES.has(address);
};

/** Constant-time compare that tolerates unequal lengths. */
const tokensMatch = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  // Hashing first keeps both buffers the same length, so timingSafeEqual can
  // never throw and the comparison leaks nothing about the token's length.
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
};

/** Read the presented token from any of the accepted locations. */
export const extractToken = (req: Request): string => {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === 'string' && header.trim()) return header.trim();

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }

  /*
   * Query fallback exists for <audio src> and download links: a browser media
   * element cannot attach headers, so a stream URL has no other way to carry
   * credentials. It is accepted everywhere for consistency, but clients that
   * can set headers should, since URLs leak into logs and history.
   */
  const query = req.query?.[TOKEN_QUERY];
  if (typeof query === 'string' && query.trim()) return query.trim();

  return '';
};

/**
 * The API token, generated and persisted on first use.
 *
 * 32 bytes of CSPRNG output, base64url so it survives a URL, a QR code and a
 * copy-paste into a phone without escaping.
 */
export const getOrCreateToken = (conf: any): string => {
  const existing = conf.get('auth.token');
  if (typeof existing === 'string' && existing.length >= 32) return existing;

  const token = randomBytes(32).toString('base64url');
  conf.set('auth.token', token);
  return token;
};

/** Replace the token, invalidating every client that holds the old one. */
export const rotateToken = (conf: any): string => {
  const token = randomBytes(32).toString('base64url');
  conf.set('auth.token', token);
  return token;
};

/** Whether remote requests are required to authenticate. */
export const isAuthEnabled = (conf: any): boolean => conf.get('auth.enabled') !== false;

export interface AuthDecision {
  ok: boolean;
  reason?: 'missing_token' | 'invalid_token';
}

/** Shared by the HTTP middleware and the Socket.IO handshake. */
export const authorize = (conf: any, presented: string, loopback: boolean): AuthDecision => {
  if (!isAuthEnabled(conf)) return {ok: true};
  if (loopback) return {ok: true};

  const expected = getOrCreateToken(conf);
  if (!presented) return {ok: false, reason: 'missing_token'};
  if (!tokensMatch(presented, expected)) return {ok: false, reason: 'invalid_token'};
  return {ok: true};
};

/**
 * Express middleware guarding the versioned API.
 *
 * `/health` stays open so a client can validate an address the user typed
 * before it has any credentials to offer — it reports reachability and which
 * services are configured, never data or secrets.
 */
export const createAuthMiddleware = (conf: any, basePath: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const relative = req.path.startsWith(basePath) ? req.path.slice(basePath.length) : req.path;
    if (PUBLIC_PATHS.has(relative)) {
      next();
      return;
    }

    const decision = authorize(conf, extractToken(req), isLoopback(req));
    if (decision.ok) {
      next();
      return;
    }

    res.status(401).json({
      ok: false,
      error: {
        code: 'unauthorized',
        message:
          decision.reason === 'missing_token'
            ? 'This request needs an API token. Send it as an Authorization: Bearer header, an X-Elixium-Token header, or a ?token= query parameter.'
            : 'The API token is not valid. It may have been rotated in Settings.',
      },
    });
  };
};

/**
 * Origins allowed to make browser requests.
 *
 * An explicit list replaces `origin: '*'`. Anything not listed gets no CORS
 * headers, so a browser refuses to hand the response back to a foreign page —
 * which is what stops a random website from driving a local Elixium. Native
 * clients are unaffected: CORS is a browser policy, and the token is what
 * actually authenticates them.
 */
export const readAllowedOrigins = (conf: any): string[] => {
  const raw = conf.get('auth.allowedOrigins');
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.trim().length > 0);
};

export const buildCorsOptions = (conf: any) => ({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // No Origin header: a native client, curl, or a same-origin navigation.
    // These are not subject to CORS and are authenticated by token instead.
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowed = readAllowedOrigins(conf);
    if (allowed.includes('*') || allowed.includes(origin)) {
      callback(null, true);
      return;
    }

    // Any localhost origin, on any port, so a separate dev server works.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) {
      callback(null, true);
      return;
    }

    callback(null, false);
  },
  credentials: true,
});
