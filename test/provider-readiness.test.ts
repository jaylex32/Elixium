/*
 * Startup readiness.
 *
 * These cover the failure that shipped repeatedly: an optional provider whose
 * initialisation never returned prevented the engine from serving at all, so
 * the desktop app could not open and the only symptom was the launcher's own
 * timeout. The rule being protected is that *nothing* optional can hold up
 * core readiness, whatever it does — hang, throw, time out, or fail to
 * resolve DNS.
 *
 * Everything is injected. No test here reaches a real provider or the network.
 */
import test from 'ava';
import {ProviderRegistry, withTimeout, classifyFailure, ProviderTimeoutError} from '../src/app/provider-readiness';

/** A promise that never settles — the shape of the original bug. */
const never = () => new Promise<void>(() => undefined);

/** Resolves after `ms`, used to let background work run. */
const tick = (ms = 10) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An error carrying a Node network code, as axios surfaces them. */
const networkError = (code: string) => Object.assign(new Error(`connect ${code} play.qobuz.com:443`), {code});

const registryWith = (init: () => Promise<unknown>, timeoutMs = 50, optional = true) => {
  const registry = new ProviderRegistry();
  registry.register({name: 'qobuz-search', optional, timeoutMs, init});
  return registry;
};

// ── 1. the happy path ──────────────────────────────────────────────────────

test('a provider that initialises is reported ready', async (t) => {
  const registry = registryWith(async () => undefined);
  registry.markCoreReady();

  const status = await registry.start('qobuz-search');

  t.is(status.state, 'ready');
  t.is(status.attempts, 1);
  t.falsy(status.failure);
  t.is(registry.getLifecycle(), 'fully_ready');
});

// ── 2. the original bug: initialisation that never resolves ───────────────

test('core readiness does not wait for a provider that never resolves', async (t) => {
  const registry = registryWith(never, 50);

  // Core comes up first, exactly as the engine now orders it.
  registry.markCoreReady();
  registry.warmUpOptional();

  t.is(registry.getLifecycle(), 'core_ready', 'core must be ready while the provider is still starting');
  t.is(registry.statuses()[0].state, 'starting');

  // And the hang still ends, rather than staying pending forever.
  await tick(120);
  t.is(registry.statuses()[0].state, 'unavailable');
  t.is(registry.getLifecycle(), 'degraded', 'the engine runs degraded, it does not fail');
});

test('a provider that never resolves settles as a timeout, not a pending promise', async (t) => {
  const registry = registryWith(never, 40);

  const status = await registry.start('qobuz-search');

  t.is(status.state, 'unavailable');
  t.is(status.failure?.kind, 'timeout');
  t.is(status.failure?.timeoutMs, 40);
});

// ── 3. explicit timeout ───────────────────────────────────────────────────

test('withTimeout rejects with ProviderTimeoutError once the bound passes', async (t) => {
  const error = await t.throwsAsync(withTimeout(never(), 25, 'qobuz-search'));
  t.true(error instanceof ProviderTimeoutError);
  t.is((error as ProviderTimeoutError).timeoutMs, 25);
});

test('withTimeout passes a value through when the task wins', async (t) => {
  t.is(await withTimeout(Promise.resolve('ok'), 1000, 'qobuz-search'), 'ok');
});

test('a slow provider that finishes inside its bound is ready, not unavailable', async (t) => {
  const registry = registryWith(() => tick(20), 200);
  const status = await registry.start('qobuz-search');
  t.is(status.state, 'ready', 'slow is a working case; only unbounded is a broken one');
});

// ── 4. initialisation that throws ─────────────────────────────────────────

test('a provider that throws is recorded, and does not escape as a rejection', async (t) => {
  const registry = registryWith(async () => {
    throw new Error('bundle parse failed');
  });
  registry.markCoreReady();

  const status = await registry.start('qobuz-search');

  t.is(status.state, 'unavailable');
  t.is(status.failure?.message, 'bundle parse failed');
  t.is(registry.getLifecycle(), 'degraded');
});

test('a provider that throws synchronously is caught too', async (t) => {
  const registry = registryWith((() => {
    throw new Error('thrown before any await');
  }) as () => Promise<unknown>);

  const status = await registry.start('qobuz-search');
  t.is(status.state, 'unavailable');
  t.is(status.failure?.message, 'thrown before any await');
});

// ── 5. offline / DNS failure ──────────────────────────────────────────────

test('DNS and connection failures are classified as offline', (t) => {
  t.is(classifyFailure(networkError('ENOTFOUND')), 'offline');
  t.is(classifyFailure(networkError('EAI_AGAIN')), 'offline');
  t.is(classifyFailure(networkError('ECONNREFUSED')), 'offline');
  t.is(classifyFailure(networkError('ENETUNREACH')), 'offline');
  t.is(classifyFailure(new Error('getaddrinfo failed for play.qobuz.com')), 'offline');
});

test('an offline machine leaves the engine degraded and still serving', async (t) => {
  const registry = registryWith(async () => {
    throw networkError('ENOTFOUND');
  });
  registry.markCoreReady();

  const status = await registry.start('qobuz-search');

  t.is(status.state, 'unavailable');
  t.is(status.failure?.kind, 'offline');
  t.is(registry.getLifecycle(), 'degraded');
});

// ── 6. missing or invalid credentials / configuration ─────────────────────

test('authentication failures are classified as auth, not offline', (t) => {
  t.is(classifyFailure(Object.assign(new Error('Request failed'), {response: {status: 401}})), 'auth');
  t.is(classifyFailure(Object.assign(new Error('Request failed'), {response: {status: 403}})), 'auth');
  t.is(classifyFailure(new Error('Invalid credentials supplied')), 'auth');
});

test('missing configuration is classified as config', (t) => {
  t.is(classifyFailure(new Error("Couldn't find any valid app secrets")), 'config');
  t.is(classifyFailure(new Error('Qobuz token required for downloads')), 'config');
});

test('a misconfigured provider reports an actionable failure and does not block core', async (t) => {
  const registry = registryWith(async () => {
    throw new Error('Qobuz token required for downloads');
  });
  registry.markCoreReady();

  const status = await registry.start('qobuz-search');

  t.is(status.state, 'unavailable');
  t.is(status.failure?.kind, 'config');
  t.regex(status.failure?.message ?? '', /token required/);
  t.is(registry.getLifecycle(), 'degraded');
});

// ── 7. a second optional provider hanging ─────────────────────────────────

test('one hanging provider does not delay another, nor core readiness', async (t) => {
  const registry = new ProviderRegistry();
  registry.register({name: 'qobuz-search', optional: true, timeoutMs: 400, init: never});
  registry.register({name: 'spotify', optional: true, timeoutMs: 400, init: never});
  registry.register({name: 'deezer-download', optional: true, timeoutMs: 30, init: async () => undefined});

  registry.markCoreReady();
  registry.warmUpOptional();

  await tick(60);

  const byName = Object.fromEntries(registry.statuses().map((status) => [status.name, status]));
  t.is(byName['deezer-download'].state, 'ready', 'a fast provider finishes while others hang');
  t.is(byName['qobuz-search'].state, 'starting');
  t.is(byName.spotify.state, 'starting');
  t.is(registry.getLifecycle(), 'core_ready', 'core stayed ready throughout');
});

// ── 8. a critical dependency failing ──────────────────────────────────────

test('a failing critical dependency puts the engine in failed, unlike an optional one', async (t) => {
  const registry = new ProviderRegistry();
  registry.register({
    name: 'core-storage',
    optional: false,
    timeoutMs: 50,
    init: async () => {
      throw new Error('data directory is not writable');
    },
  });
  registry.markCoreReady();

  const status = await registry.start('core-storage');

  t.is(status.state, 'failed');
  t.is(registry.getLifecycle(), 'failed');
  t.regex(status.failure?.message ?? '', /not writable/);
});

// ── 11. retry without restarting the engine ───────────────────────────────

test('a provider that failed can be retried and succeed, without a restart', async (t) => {
  let attempts = 0;
  const registry = registryWith(async () => {
    attempts += 1;
    if (attempts === 1) throw networkError('ENOTFOUND');
  });
  registry.markCoreReady();

  const first = await registry.start('qobuz-search');
  t.is(first.state, 'unavailable');
  t.is(registry.getLifecycle(), 'degraded');

  const second = await registry.retry('qobuz-search');
  t.is(second.state, 'ready');
  t.is(second.attempts, 2);
  t.is(registry.getLifecycle(), 'fully_ready', 'the engine recovers in place');
});

test('a request path re-attempts an unavailable provider rather than caching the failure', async (t) => {
  let attempts = 0;
  const registry = registryWith(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('still down');
  });

  await t.throwsAsync(registry.ensure('qobuz-search'), {message: /qobuz-search is unavailable: still down/});
  await t.throwsAsync(registry.ensure('qobuz-search'));
  await registry.ensure('qobuz-search');

  t.is(attempts, 3, 'each request tries again, so fixing credentials does not need a restart');
});

test('ensure resolves immediately once ready and does not re-initialise', async (t) => {
  let attempts = 0;
  const registry = registryWith(async () => {
    attempts += 1;
  });

  await registry.ensure('qobuz-search');
  await registry.ensure('qobuz-search');
  await registry.ensure('qobuz-search');

  t.is(attempts, 1);
});

test('concurrent callers share one initialisation attempt', async (t) => {
  let attempts = 0;
  const registry = registryWith(async () => {
    attempts += 1;
    await tick(20);
  }, 500);

  await Promise.all([
    registry.ensure('qobuz-search'),
    registry.ensure('qobuz-search'),
    registry.ensure('qobuz-search'),
  ]);

  t.is(attempts, 1, 'three simultaneous requests must not each log in');
});

test('ensure surfaces the provider name and failure detail to the caller', async (t) => {
  const registry = registryWith(async () => {
    throw networkError('ENOTFOUND');
  });

  const error = (await t.throwsAsync(registry.ensure('qobuz-search'))) as Error & {
    providerName?: string;
    providerFailure?: {kind?: string};
  };

  t.is(error.providerName, 'qobuz-search');
  t.is(error.providerFailure?.kind, 'offline');
});

// ── the readiness snapshot the launcher and UI read ───────────────────────

test('the snapshot reports lifecycle and every provider state', async (t) => {
  const registry = new ProviderRegistry();
  registry.register({name: 'qobuz-search', optional: true, timeoutMs: 30, init: never});
  registry.register({name: 'deezer-download', optional: true, timeoutMs: 30, init: async () => undefined});
  registry.markCoreReady();

  await registry.start('deezer-download');
  await registry.start('qobuz-search');

  const snapshot = registry.snapshot();
  t.is(snapshot.lifecycle, 'degraded');
  t.is(snapshot.providers.length, 2);

  const qobuz = snapshot.providers.find((provider) => provider.name === 'qobuz-search');
  t.is(qobuz?.state, 'unavailable');
  t.is(qobuz?.failure?.kind, 'timeout');
  t.truthy(qobuz?.startedAt);
  t.truthy(qobuz?.settledAt);
  t.true(typeof qobuz?.durationMs === 'number');
});

test('lifecycle stays core_ready until every optional provider has settled', async (t) => {
  const registry = new ProviderRegistry();
  registry.register({name: 'fast', optional: true, timeoutMs: 200, init: async () => undefined});
  registry.register({name: 'slow', optional: true, timeoutMs: 200, init: () => tick(60)});
  registry.markCoreReady();

  const slow = registry.start('slow');
  await registry.start('fast');
  t.is(registry.getLifecycle(), 'core_ready', 'one provider still starting');

  await slow;
  t.is(registry.getLifecycle(), 'fully_ready');
});

test('markCoreReady cannot promote an engine that already failed', (t) => {
  const registry = new ProviderRegistry();
  registry.markFailed();
  registry.markCoreReady();
  t.is(registry.getLifecycle(), 'failed');
});

test('an unregistered provider is an explicit error, not a silent no-op', async (t) => {
  const registry = new ProviderRegistry();
  await t.throwsAsync(registry.start('nope'), {message: /Unknown provider: nope/});
  await t.throwsAsync(registry.retry('nope'), {message: /Unknown provider: nope/});
});
