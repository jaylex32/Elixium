/*
 * The desktop launcher's side of startup.
 *
 * These rules used to live inside the Electron main process, where no test
 * could reach them — which is why every regression in them was found by a
 * user. `desktop/readiness.js` holds them now, with every dependency injected,
 * so the timeout path can be exercised in milliseconds instead of two minutes.
 */
import test from 'ava';
import {createServer, type Server} from 'http';
import type {AddressInfo} from 'net';

/* eslint-disable @typescript-eslint/no-var-requires */
const readiness = require('../desktop/readiness.js') as {
  interpretHealthBody: (body: string) => {verdict: string; health: any; lifecycle?: string};
  describeFailedLifecycle: (health: any) => string;
  describeTimeout: (input: {tail: string; lastHealth: any}) => string;
  describeEarlyExit: (input: {code: number; tail: string}) => string;
  waitForCoreReady: (options: any) => Promise<{lastHealth: any}>;
  terminateChild: (child: any, env: {platform: string; spawn: any}) => {action: string; pid?: number};
};

const health = (body: unknown) => JSON.stringify({ok: true, data: body});

/** ava types the thrown error as possibly undefined; this keeps assertions readable. */
const messageOf = (error: Error | undefined) => String(error?.message ?? '');

/** A probe that walks through a scripted list of responses. */
const scriptedProbe = (responses: Array<{statusCode: number; body: string} | null>) => {
  let index = 0;
  return async () => responses[Math.min(index++, responses.length - 1)];
};

const noSleep = async () => undefined;

// ── 9. the launcher receives the correct readiness signal ─────────────────

test('core_ready is the signal to open the window', (t) => {
  const result = readiness.interpretHealthBody(health({lifecycle: 'core_ready', providers: []}));
  t.is(result.verdict, 'ready');
});

test('degraded also opens the window — an optional provider must not gate it', (t) => {
  const result = readiness.interpretHealthBody(
    health({lifecycle: 'degraded', providers: [{name: 'qobuz-search', optional: true, state: 'unavailable'}]}),
  );
  t.is(result.verdict, 'ready', 'this is the whole point: Qobuz down still opens Elixium');
});

test('fully_ready opens the window', (t) => {
  t.is(readiness.interpretHealthBody(health({lifecycle: 'fully_ready', providers: []})).verdict, 'ready');
});

test('starting keeps the launcher waiting', (t) => {
  t.is(readiness.interpretHealthBody(health({lifecycle: 'starting', providers: []})).verdict, 'pending');
});

test('failed stops the wait immediately rather than burning the deadline', (t) => {
  t.is(readiness.interpretHealthBody(health({lifecycle: 'failed', providers: []})).verdict, 'failed');
});

test('an engine with no lifecycle field is treated as ready', (t) => {
  // Older engines answer 200 without the field; for them, answering is ready.
  t.is(readiness.interpretHealthBody(health({status: 'ok'})).verdict, 'ready');
  t.is(readiness.interpretHealthBody('not json at all').verdict, 'ready');
});

test('the launcher opens against a real server reporting degraded', async (t) => {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(
      health({
        lifecycle: 'degraded',
        providers: [{name: 'qobuz-search', optional: true, state: 'unavailable', failure: {kind: 'timeout'}}],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;

  try {
    const http = require('http');
    const probe = () =>
      new Promise((resolve) => {
        http.get({host: '127.0.0.1', port, path: '/api/v1/health', timeout: 2000}, (response: any) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => (body += chunk));
          response.on('end', () => resolve({statusCode: response.statusCode, body}));
        });
      });

    const result = await readiness.waitForCoreReady({probe, timeoutMs: 5000, intervalMs: 10, sleep: noSleep});
    t.is(result.lastHealth.lifecycle, 'degraded');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('the launcher keeps polling until the engine reports core readiness', async (t) => {
  const probe = scriptedProbe([
    null,
    null,
    {statusCode: 200, body: health({lifecycle: 'starting', providers: []})},
    {statusCode: 200, body: health({lifecycle: 'core_ready', providers: []})},
  ]);

  const result = await readiness.waitForCoreReady({probe, timeoutMs: 5000, intervalMs: 1, sleep: noSleep});
  t.is(result.lastHealth.lifecycle, 'core_ready');
});

// ── 10. the deadline fires only when core readiness truly fails ───────────

test('a provider stuck starting does not trip the deadline once core is ready', async (t) => {
  // Core ready, Qobuz still starting: the launcher must return, not wait.
  const probe = scriptedProbe([
    {
      statusCode: 200,
      body: health({lifecycle: 'core_ready', providers: [{name: 'qobuz-search', optional: true, state: 'starting'}]}),
    },
  ]);

  const result = await readiness.waitForCoreReady({probe, timeoutMs: 50, intervalMs: 1, sleep: noSleep});
  t.is(result.lastHealth.lifecycle, 'core_ready');
});

test('the deadline fires when nothing ever listens, and names the stage', async (t) => {
  const probe = async () => null; // nothing answering at all
  let elapsed = 0;
  const now = () => elapsed;

  const error = await t.throwsAsync(
    readiness.waitForCoreReady({
      probe,
      timeoutMs: 30,
      intervalMs: 10,
      now: () => {
        elapsed += 20;
        return elapsed;
      },
      sleep: noSleep,
      getTail: () => 'WAIT Loading Qobuz API for search...',
    }),
  );

  t.regex(messageOf(error), /did not start in time/);
  t.regex(messageOf(error), /never began serving its local interface/, 'the stage must be named');
  t.regex(messageOf(error), /Loading Qobuz API/, 'the log tail must be preserved');
  t.true(now() > 0);
});

test('the deadline message names the last stage the engine reported', async (t) => {
  const probe = scriptedProbe([{statusCode: 200, body: health({lifecycle: 'starting', providers: []})}]);
  let elapsed = 0;

  const error = await t.throwsAsync(
    readiness.waitForCoreReady({
      probe,
      timeoutMs: 30,
      intervalMs: 5,
      now: () => {
        elapsed += 20;
        return elapsed;
      },
      sleep: noSleep,
      getTail: () => '',
    }),
  );

  t.regex(messageOf(error), /last reported stage: starting/);
});

test('a failed lifecycle reports the component, not just the clock', (t) => {
  const message = readiness.describeFailedLifecycle({
    lifecycle: 'failed',
    providers: [
      {name: 'core-storage', optional: false, state: 'failed', failure: {kind: 'config', message: 'not writable'}},
      {name: 'qobuz-search', optional: true, state: 'unavailable', failure: {kind: 'timeout', message: 'slow'}},
    ],
  });

  t.regex(message, /core-storage/);
  t.regex(message, /not writable/);
  t.notRegex(message, /qobuz-search/, 'an optional provider is not why the engine failed');
});

test('an engine that exits early is reported as an exit, not a timeout', async (t) => {
  const error = await t.throwsAsync(
    readiness.waitForCoreReady({
      probe: async () => null,
      timeoutMs: 60_000,
      intervalMs: 1,
      sleep: noSleep,
      getExit: () => ({code: 3, tail: 'Error: cannot find module'}),
    }),
  );

  t.regex(messageOf(error), /exit code 3/);
  t.regex(messageOf(error), /cannot find module/);
  t.notRegex(messageOf(error), /did not start in time/, 'a dead process must not be described as slow');
});

// ── 12. child processes are cleaned up after a genuine startup failure ────

test('the engine process is terminated on POSIX with SIGTERM', (t) => {
  const signals: string[] = [];
  const child = {pid: 4242, kill: (signal: string) => signals.push(signal)};

  const result = readiness.terminateChild(child, {platform: 'darwin', spawn: () => t.fail('spawn on darwin')});

  t.is(result.action, 'sigterm');
  t.deepEqual(signals, ['SIGTERM']);
});

test('the whole process tree is killed on Windows, so the port is released', (t) => {
  const calls: Array<{command: string; args: string[]}> = [];
  const child = {pid: 4242, kill: () => t.fail('kill() on win32 leaves grandchildren holding the port')};

  const result = readiness.terminateChild(child, {
    platform: 'win32',
    spawn: (command: string, args: string[]) => calls.push({command, args}),
  });

  t.is(result.action, 'taskkill');
  t.is(calls.length, 1);
  t.is(calls[0].command, 'taskkill');
  t.deepEqual(calls[0].args, ['/pid', '4242', '/f', '/t']);
});

test('terminating an already-dead process does not throw during quit', (t) => {
  const child = {
    pid: 7,
    kill: () => {
      throw Object.assign(new Error('ESRCH'), {code: 'ESRCH'});
    },
  };

  const result = readiness.terminateChild(child, {platform: 'linux', spawn: () => undefined});
  t.is(result.action, 'already-gone');
});

test('terminating when no engine was ever spawned is a no-op', (t) => {
  t.is(readiness.terminateChild(null, {platform: 'darwin', spawn: () => undefined}).action, 'none');
});
