/**
 * Startup dependency lifecycle.
 *
 * The desktop launcher decides the engine is alive by polling
 * `GET /api/v1/health`, which cannot answer until `server.listen()` has run.
 * For several releases `listen()` sat behind `await initQobuzForSearch()`, and
 * that call reaches the network with no bound on how long it may take. A
 * provider that stalls therefore did not degrade Qobuz — it prevented the
 * application from opening at all, and the only symptom anybody saw was the
 * launcher's own timeout. Raising that timeout (60s to 120s in 1.3.4) treated
 * the clock rather than the wait, so the failure returned.
 *
 * The rule this module exists to enforce: an optional dependency may be slow,
 * broken, unreachable or absent, and none of that may delay core readiness.
 *
 * Two guarantees make that true.
 *
 *  1. Every registered initialisation is bounded. `withTimeout` always settles,
 *     so a hung provider becomes a state rather than an open promise. The
 *     underlying socket is not cancellable here — providers own their own
 *     client timeouts for that — but readiness stops depending on it.
 *
 *  2. Failure is a recorded state, not an exception that escapes. `start`
 *     never rejects, so the background warm-up cannot take the process with
 *     it, and `snapshot()` can explain what happened to a human.
 */

/** Where a single dependency currently is. */
export type ProviderState =
  /** Registered, not yet attempted. */
  | 'idle'
  /** An attempt is in flight. */
  | 'starting'
  /** Usable. */
  | 'ready'
  /** Optional and not usable; the app runs without it and may retry. */
  | 'unavailable'
  /** Critical and not usable; the app cannot serve its core purpose. */
  | 'failed';

/** Where the engine as a whole is. */
export type EngineLifecycle = 'starting' | 'core_ready' | 'degraded' | 'fully_ready' | 'shutting_down' | 'failed';

/**
 * Why an attempt did not succeed, in terms a message can be written from.
 *
 * The distinction matters to the reader: "offline" invites retry, "auth"
 * invites checking credentials, and conflating them produces the sort of
 * advice that wastes someone's afternoon.
 */
export type ProviderFailureKind = 'timeout' | 'offline' | 'auth' | 'config' | 'unknown';

export interface ProviderStatus {
  name: string;
  optional: boolean;
  state: ProviderState;
  /** Attempts made, including the current one. */
  attempts: number;
  /** How long the last completed attempt took. */
  durationMs?: number;
  startedAt?: string;
  settledAt?: string;
  failure?: {
    kind: ProviderFailureKind;
    message: string;
    /** The bound that was exceeded, when the attempt timed out. */
    timeoutMs?: number;
  };
}

export interface ProviderDefinition {
  name: string;
  /**
   * Optional dependencies never block core readiness and may be retried.
   * A critical one failing puts the engine in `failed`.
   */
  optional: boolean;
  /** Upper bound for one attempt. Exceeding it settles the attempt. */
  timeoutMs: number;
  init: () => Promise<unknown>;
}

export class ProviderTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(name: string, timeoutMs: number) {
    super(`${name} did not initialise within ${timeoutMs}ms`);
    this.name = 'ProviderTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Resolve `task`, or reject with ProviderTimeoutError once `timeoutMs` passes.
 *
 * The timer is always cleared when the task settles first, so nothing lingers.
 * It is deliberately *not* unref'd: when a provider hangs, this timer is the
 * only pending work left, and an unref'd timer in that position lets the loop
 * drain without ever firing — which is precisely the hang this exists to end.
 */
export const withTimeout = <T>(task: Promise<T>, timeoutMs: number, name: string): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return task;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ProviderTimeoutError(name, timeoutMs));
    }, timeoutMs);

    task.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

/** Network-level codes that mean "there is no route to this service right now". */
const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNABORTED',
]);

/** Read an error into something a message can be written from. */
export const classifyFailure = (error: unknown): ProviderFailureKind => {
  if (error instanceof ProviderTimeoutError) return 'timeout';

  const err = error as {code?: string; response?: {status?: number}; message?: string};
  const code = typeof err?.code === 'string' ? err.code.toUpperCase() : '';
  if (code && OFFLINE_CODES.has(code)) return code === 'ETIMEDOUT' || code === 'ECONNABORTED' ? 'timeout' : 'offline';

  const status = err?.response?.status;
  if (status === 401 || status === 403) return 'auth';

  const message = String(err?.message ?? '').toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'timeout';
  if (message.includes('getaddrinfo') || message.includes('dns') || message.includes('network')) return 'offline';
  if (message.includes('unauthor') || message.includes('auth') || message.includes('credential')) return 'auth';
  if (message.includes('token') || message.includes('secret') || message.includes('app id')) return 'config';
  if (message.includes('required') || message.includes('not set') || message.includes('missing')) return 'config';

  return 'unknown';
};

interface ProviderRecord extends ProviderDefinition {
  state: ProviderState;
  attempts: number;
  durationMs?: number;
  startedAt?: number;
  settledAt?: number;
  failure?: ProviderStatus['failure'];
  /** The attempt currently in flight, so concurrent callers share one. */
  inFlight: Promise<void> | null;
}

export interface ProviderRegistryOptions {
  /** Injected so tests need no wall clock and logs stay quiet. */
  now?: () => number;
  onEvent?: (event: {provider: string; state: ProviderState; failure?: ProviderStatus['failure']}) => void;
}

/**
 * Tracks dependencies and their readiness.
 *
 * Nothing here reaches the network itself; providers supply their own `init`.
 * That is what makes the whole startup path testable without a provider.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderRecord>();
  private readonly now: () => number;
  private readonly onEvent?: ProviderRegistryOptions['onEvent'];
  private lifecycle: EngineLifecycle = 'starting';

  constructor(options: ProviderRegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
  }

  register(definition: ProviderDefinition): void {
    this.providers.set(definition.name, {
      ...definition,
      state: 'idle',
      attempts: 0,
      inFlight: null,
    });
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** The engine's own state, derived from its dependencies. */
  getLifecycle(): EngineLifecycle {
    return this.lifecycle;
  }

  /**
   * Core is up: the HTTP listener is bound and serving.
   *
   * Called the moment `listen` reports back, deliberately before any optional
   * provider has been attempted — that ordering is the fix.
   */
  markCoreReady(): void {
    if (this.lifecycle === 'shutting_down' || this.lifecycle === 'failed') return;
    this.lifecycle = 'core_ready';
    this.refreshLifecycle();
  }

  markShuttingDown(): void {
    this.lifecycle = 'shutting_down';
  }

  markFailed(): void {
    this.lifecycle = 'failed';
  }

  /**
   * Attempt a provider, at most once concurrently. Never rejects.
   *
   * The background warm-up uses this: a provider that cannot start must not
   * produce an unhandled rejection and must not stop the others.
   */
  async start(name: string): Promise<ProviderStatus> {
    const record = this.providers.get(name);
    if (!record) throw new Error(`Unknown provider: ${name}`);
    if (record.state === 'ready') return this.statusOf(record);
    if (record.inFlight) {
      await record.inFlight;
      return this.statusOf(record);
    }

    record.state = 'starting';
    record.attempts += 1;
    record.startedAt = this.now();
    record.failure = undefined;
    this.emit(record);

    const attempt = withTimeout(
      Promise.resolve().then(() => record.init()),
      record.timeoutMs,
      record.name,
    ).then(
      () => {
        record.state = 'ready';
        record.settledAt = this.now();
        record.durationMs = record.settledAt - (record.startedAt ?? record.settledAt);
        record.failure = undefined;
      },
      (error: unknown) => {
        const kind = classifyFailure(error);
        record.state = record.optional ? 'unavailable' : 'failed';
        record.settledAt = this.now();
        record.durationMs = record.settledAt - (record.startedAt ?? record.settledAt);
        record.failure = {
          kind,
          message: String((error as Error)?.message ?? error ?? 'unknown error'),
          ...(error instanceof ProviderTimeoutError ? {timeoutMs: error.timeoutMs} : {}),
        };
      },
    );

    record.inFlight = attempt.finally(() => {
      record.inFlight = null;
    });

    await record.inFlight;
    this.emit(record);
    this.refreshLifecycle();
    return this.statusOf(record);
  }

  /**
   * Ready-or-explain, for request paths that genuinely need the provider.
   *
   * Throws rather than returning a status because callers are route handlers
   * that already turn a thrown error into a response. The difference from
   * before is that it throws *promptly* — an unreachable provider used to
   * leave the request hanging as long as the socket did.
   */
  async ensure(name: string): Promise<void> {
    const status = await this.start(name);
    if (status.state === 'ready') return;

    const failure = status.failure;
    const reason = failure ? `${failure.message}` : 'initialisation did not succeed';
    const error = new Error(`${name} is unavailable: ${reason}`) as Error & {
      providerName: string;
      providerFailure?: ProviderStatus['failure'];
    };
    error.providerName = name;
    error.providerFailure = failure;
    throw error;
  }

  /**
   * Try again from scratch, whatever state the provider is in.
   *
   * A provider that failed at boot because the machine was offline must be
   * recoverable without restarting the engine — that is the whole point of
   * treating it as optional rather than fatal.
   */
  async retry(name: string): Promise<ProviderStatus> {
    const record = this.providers.get(name);
    if (!record) throw new Error(`Unknown provider: ${name}`);

    if (record.inFlight) {
      await record.inFlight;
      if (record.state === 'ready') return this.statusOf(record);
    }

    record.state = 'idle';
    record.failure = undefined;
    return this.start(name);
  }

  /** Kick off every optional provider without waiting for any of them. */
  warmUpOptional(): void {
    for (const record of this.providers.values()) {
      if (!record.optional || record.state !== 'idle') continue;
      // Deliberately not awaited: this runs after core readiness.
      void this.start(record.name);
    }
  }

  statuses(): ProviderStatus[] {
    return [...this.providers.values()].map((record) => this.statusOf(record));
  }

  snapshot(): {lifecycle: EngineLifecycle; providers: ProviderStatus[]} {
    return {lifecycle: this.getLifecycle(), providers: this.statuses()};
  }

  private statusOf(record: ProviderRecord): ProviderStatus {
    return {
      name: record.name,
      optional: record.optional,
      state: record.state,
      attempts: record.attempts,
      ...(record.durationMs != null ? {durationMs: record.durationMs} : {}),
      ...(record.startedAt != null ? {startedAt: new Date(record.startedAt).toISOString()} : {}),
      ...(record.settledAt != null ? {settledAt: new Date(record.settledAt).toISOString()} : {}),
      ...(record.failure ? {failure: record.failure} : {}),
    };
  }

  private emit(record: ProviderRecord): void {
    this.onEvent?.({provider: record.name, state: record.state, failure: record.failure});
  }

  /**
   * Derive the engine state from its dependencies.
   *
   * Only ever runs once core is up, so it cannot promote a starting engine.
   */
  private refreshLifecycle(): void {
    if (this.lifecycle === 'starting' || this.lifecycle === 'shutting_down' || this.lifecycle === 'failed') return;

    const all = [...this.providers.values()];
    if (all.some((record) => !record.optional && record.state === 'failed')) {
      this.lifecycle = 'failed';
      return;
    }

    const optional = all.filter((record) => record.optional);
    const settled = optional.every((record) => record.state === 'ready' || record.state === 'unavailable');
    if (!settled) {
      this.lifecycle = 'core_ready';
      return;
    }

    this.lifecycle = optional.every((record) => record.state === 'ready') ? 'fully_ready' : 'degraded';
  }
}
