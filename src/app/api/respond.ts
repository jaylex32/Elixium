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
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  unsupported_service: 400,
  service_unavailable: 503,
  upstream_error: 502,
  not_configured: 409,
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

/** Send a failure envelope, inferring the HTTP status from the error code. */
export const sendError = (res: Response, error: unknown): Response => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      ok: false,
      error: {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})},
    });
  }

  const message = error instanceof Error ? error.message : 'Internal error';
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
