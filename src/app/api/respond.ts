import type {Request, Response, NextFunction, RequestHandler} from 'express';

/**
 * Shared response contract for the versioned Elixium API.
 *
 * Every JSON response — success or failure — uses the same envelope so that
 * external clients (the Android app in particular) can branch on a single
 * boolean instead of guessing from HTTP status codes alone.
 *
 *   success -> {ok: true,  data: <payload>, meta?: <pagination/context>}
 *   failure -> {ok: false, error: {code: string, message: string, details?: unknown}}
 *
 * Binary routes (audio streaming, file downloads, ZIP archives) intentionally
 * bypass the envelope and return raw bytes; they only use it for errors.
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'unsupported_service'
  | 'service_unavailable'
  | 'upstream_error'
  | 'not_configured'
  | 'rate_limited'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  unsupported_service: 400,
  service_unavailable: 503,
  upstream_error: 502,
  not_configured: 409,
  rate_limited: 429,
  internal_error: 500,
};

/** Error type that carries an API error code, so handlers can throw instead of hand-rolling responses. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return STATUS_BY_CODE[this.code] ?? 500;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError('bad_request', message, details);
  }

  static notFound(message: string, details?: unknown): ApiError {
    return new ApiError('not_found', message, details);
  }

  static unsupportedService(service: string): ApiError {
    return new ApiError('unsupported_service', `Unsupported service: ${service || '(none)'}`, {
      supported: ['deezer', 'qobuz'],
    });
  }

  static notConfigured(message: string, details?: unknown): ApiError {
    return new ApiError('not_configured', message, details);
  }
}

export interface ApiMeta {
  [key: string]: unknown;
}

/** Send a success envelope. */
export const sendData = <T>(res: Response, data: T, meta?: ApiMeta): Response => {
  return res.json(meta ? {ok: true, data, meta} : {ok: true, data});
};

/**
 * Extract a usable message from anything that was thrown.
 *
 * Not every throw site constructs a real Error — some pass an object straight
 * to `new Error(...)`, which stringifies to the famously unhelpful
 * "[object Object]". This digs for a message before falling back to a JSON
 * rendering, so a client is never handed that string.
 */
/** spotify-web-api-node's WebapiError carries the real detail off the message. */
interface WebapiErrorLike {
  statusCode?: number;
  headers?: Record<string, string | undefined>;
  body?: {error?: {message?: string; status?: number}} | unknown;
}

/** Seconds to wait, if the upstream told us. */
export const retryAfterSeconds = (error: unknown): number | undefined => {
  const header = (error as WebapiErrorLike)?.headers?.['retry-after'];
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
};

export const upstreamStatus = (error: unknown): number | undefined => {
  const status = (error as WebapiErrorLike)?.statusCode;
  return Number.isFinite(status) ? (status as number) : undefined;
};

const toMessage = (error: unknown): string => {
  if (typeof error === 'string') return error;

  /*
   * WebapiError sets its message from the response body object, so it
   * stringifies to "[object Object]" and hides the actual cause. The status
   * code and Retry-After header are where the real information is — a 429
   * here was indistinguishable from a genuine failure.
   */
  const status = upstreamStatus(error);
  if (status) {
    const retry = retryAfterSeconds(error);
    const nested = (error as WebapiErrorLike)?.body as {error?: {message?: string}} | undefined;
    const detail = nested?.error?.message;

    if (status === 429) {
      return `Spotify is rate limiting this server${retry ? ` — retry in ${retry}s` : ''}.`;
    }
    if (status === 401 || status === 403) {
      return detail ?? 'Spotify rejected the request — the sp_dc cookie may need renewing.';
    }
    if (detail) return `Spotify error ${status}: ${detail}`;
  }

  if (error instanceof Error) {
    if (error.message && error.message !== '[object Object]') return error.message;
    // A message of "[object Object]" means the real detail is on the cause or
    // an attached payload rather than the message itself.
    const cause = (error as {cause?: unknown}).cause;
    if (cause) return toMessage(cause);
  }

  if (error && typeof error === 'object') {
    const asRecord = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'description', 'reason']) {
      const value = asRecord[key];
      // Skip the placeholder itself, or we hand back what we set out to avoid.
      if (typeof value === 'string' && value && value !== '[object Object]') return value;
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}') return json.slice(0, 300);
    } catch {
      // Circular or otherwise unserializable — fall through.
    }
  }

  return 'Internal error';
};

/**
 * Failures that are really "we looked and there is nothing", not server
 * faults. Reporting these as 500 makes an ordinary miss look like a crash.
 */
const NOT_FOUND_PATTERNS = /no match|not found|no tracks found|could not find|unavailable/i;

/** Send a failure envelope, inferring the HTTP status from the error code. */
export const sendError = (res: Response, error: unknown): Response => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      ok: false,
      error: {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})},
    });
  }

  const message = toMessage(error);

  // Surface throttling as 429 with the wait time, so a client can back off
  // instead of treating it as a hard failure.
  if (upstreamStatus(error) === 429) {
    const retry = retryAfterSeconds(error);
    if (retry) res.setHeader('Retry-After', String(retry));
    return res.status(429).json({
      ok: false,
      error: {code: 'rate_limited', message, ...(retry ? {details: {retryAfterSeconds: retry}} : {})},
    });
  }

  if (NOT_FOUND_PATTERNS.test(message)) {
    return res.status(404).json({ok: false, error: {code: 'not_found', message}});
  }

  return res.status(500).json({ok: false, error: {code: 'internal_error', message}});
};

/**
 * Wraps an async route so rejections land in `sendError` instead of an
 * unhandled rejection. Express 5 forwards async errors on its own, but routing
 * them here keeps the envelope consistent regardless of Express version.
 */
export const route = (handler: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      if (res.headersSent) return next(error);
      sendError(res, error);
    });
  };
};

// ── Request parsing helpers ──────────────────────────────────────────────────

export type ServiceName = 'deezer' | 'qobuz';

/** Normalize and validate a service name from a query param or body field. */
export const parseService = (value: unknown): ServiceName => {
  const service = String(value ?? '')
    .trim()
    .toLowerCase();
  if (service === 'deezer' || service === 'qobuz') return service;
  throw ApiError.unsupportedService(service);
};

/** Read a required non-empty string, throwing a descriptive 400 when absent. */
export const requireString = (value: unknown, field: string): string => {
  const parsed = String(value ?? '').trim();
  if (!parsed) throw ApiError.badRequest(`Missing required field: ${field}`);
  return parsed;
};

/** Read a bounded integer with a fallback, so clients cannot request unbounded pages. */
export const parseInt_ = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

/** Standard limit/offset pair used by every paginated collection route. */
export const parsePaging = (query: Record<string, unknown>, defaultLimit = 50, maxLimit = 200) => {
  return {
    limit: parseInt_(query.limit, defaultLimit, 1, maxLimit),
    offset: parseInt_(query.offset, 0, 0, 1_000_000),
  };
};
