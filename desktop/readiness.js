/*
 * The launcher's startup decisions, separated from Electron so they can be
 * tested.
 *
 * These rules are the reason a slow provider no longer stops Elixium opening,
 * and they are exactly the kind of thing that quietly rots: the readiness
 * contract lived inside an Electron main process that no test could load, so
 * every regression in it was found by a user instead. Nothing here imports
 * electron, and every input is injected.
 */
'use strict';

/**
 * Lifecycles that mean the engine is serving.
 *
 * `degraded` is included on purpose: it means the core is up and some optional
 * provider is not. Waiting for `fully_ready` would reintroduce the original
 * failure — an optional provider deciding whether the window opens.
 */
const CORE_READY_LIFECYCLES = new Set(['core_ready', 'degraded', 'fully_ready']);

/**
 * Read a /health response into a verdict.
 *
 * 'ready'   — stop waiting, show the window.
 * 'failed'  — stop waiting, report the cause; more waiting will not help.
 * 'pending' — keep waiting.
 *
 * An engine built before `lifecycle` existed answers 200 without it. For those
 * builds, answering at all is core readiness, so a missing field is 'ready'
 * rather than a wait that can only end in the deadline.
 */
const interpretHealthBody = (body) => {
  let health = null;
  try {
    const payload = JSON.parse(body);
    health = payload && payload.data ? payload.data : null;
  } catch {
    return {verdict: 'ready', health: null, lifecycle: undefined};
  }

  const lifecycle = health ? health.lifecycle : undefined;
  if (!lifecycle) return {verdict: 'ready', health, lifecycle};
  if (CORE_READY_LIFECYCLES.has(lifecycle)) return {verdict: 'ready', health, lifecycle};
  if (lifecycle === 'failed') return {verdict: 'failed', health, lifecycle};
  return {verdict: 'pending', health, lifecycle};
};

/** Explain a `failed` lifecycle in terms of the component that caused it. */
const describeFailedLifecycle = (health) => {
  const broken = ((health && health.providers) || []).filter(
    (provider) => provider && provider.state === 'failed' && provider.optional === false,
  );
  if (broken.length === 0) return 'The Elixium engine reported that it could not start.';
  const lines = broken.map((provider) => {
    const failure = provider.failure || {};
    return `  ${provider.name}: ${failure.kind || 'error'} — ${failure.message || 'no detail reported'}`;
  });
  return `The Elixium engine could not start because a required component failed:\n${lines.join('\n')}`;
};

/**
 * The message shown when the deadline passes.
 *
 * It names the stage reached. "Did not start in time" alone sent people
 * hunting through logs for something the launcher already knew.
 */
const describeTimeout = ({tail, lastHealth}) => {
  const stage = lastHealth
    ? `The engine answered but never reached core readiness (last reported stage: ${
        lastHealth.lifecycle || 'unknown'
      }).`
    : 'The engine never began serving its local interface, so it never reached core readiness.';

  return tail
    ? `The Elixium engine did not start in time.\n\n${stage}\n\nIts last words were:\n${tail}`
    : `The Elixium engine did not start in time, and wrote no log at all.\n\n${stage}`;
};

/** The message shown when the engine process exits before it is ready. */
const describeEarlyExit = ({code, tail}) =>
  tail
    ? `The engine stopped with exit code ${code}.\n\nIts last words were:\n${tail}`
    : `The engine stopped with exit code ${code} without writing a log.`;

/**
 * Wait for core readiness, or explain why it never came.
 *
 * Everything it depends on is injected: `probe` performs one health request,
 * `getExit` reports whether the engine has already died, `getTail` supplies
 * the log, and `sleep`/`now` carry the clock. That is what lets the timeout
 * path be tested in milliseconds instead of two minutes.
 *
 * Resolves once ready; rejects with a described reason otherwise.
 */
const waitForCoreReady = async ({probe, getExit, getTail, timeoutMs, intervalMs = 300, now = Date.now, sleep}) => {
  const deadline = now() + timeoutMs;
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastHealth = null;

  for (;;) {
    /*
     * An engine that has already died is never going to answer. Waiting out
     * the full deadline for a process that exited in its first second told the
     * reader it was slow rather than that it had failed, and why.
     */
    const exit = getExit ? getExit() : null;
    if (exit) throw new Error(describeEarlyExit({code: exit.code, tail: exit.tail}));

    let response = null;
    try {
      response = await probe();
    } catch {
      response = null;
    }

    if (response && response.statusCode === 200) {
      const {verdict, health} = interpretHealthBody(response.body);
      if (health) lastHealth = health;
      if (verdict === 'ready') return {lastHealth};
      if (verdict === 'failed') throw new Error(describeFailedLifecycle(health));
    }

    if (now() >= deadline) {
      const tail = getTail ? getTail() : '';
      throw new Error(describeTimeout({tail, lastHealth}));
    }

    await wait(intervalMs);
  }
};

/**
 * Terminate the engine process.
 *
 * Windows needs the tree killed by pid — the engine spawns its own children,
 * and SIGTERM to the parent alone leaves them holding the port, which the next
 * launch then cannot bind. Returns what it did so a test can assert on it.
 */
const terminateChild = (child, {platform, spawn}) => {
  if (!child) return {action: 'none'};
  try {
    if (platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
      return {action: 'taskkill', pid: child.pid};
    }
    child.kill('SIGTERM');
    return {action: 'sigterm', pid: child.pid};
  } catch {
    // Already gone. Nothing useful left to do, and throwing during quit would
    // only replace a clean exit with a crash dialog.
    return {action: 'already-gone', pid: child.pid};
  }
};

module.exports = {
  CORE_READY_LIFECYCLES,
  interpretHealthBody,
  describeFailedLifecycle,
  describeTimeout,
  describeEarlyExit,
  waitForCoreReady,
  terminateChild,
};
