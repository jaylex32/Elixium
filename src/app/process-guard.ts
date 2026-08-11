import signale from '../lib/signale';

/**
 * Keep the server process alive through errors that would otherwise kill it.
 *
 * Node has terminated the process on an unhandled promise rejection since v15.
 * Nothing here installed a handler, so a single rejection anywhere — a Qobuz
 * request failing mid-scan, a filesystem error, an upstream socket resetting —
 * took the whole server down with no message. From the outside that looks like
 * "it lost connection and I have to restart it"; behind a reverse proxy it
 * surfaces as a 502, because the origin is simply gone.
 *
 * The scheduled watchlist scan made this worse: it runs on a timer every
 * minute via `void schedulerTick()`, so a rejection there killed the server
 * with nobody touching it.
 *
 * Staying alive after an uncaught exception is a real trade-off — the process
 * may be in an inconsistent state. It is still the right call here: this is a
 * self-hosted media server whose failure mode is currently silent death
 * requiring a manual restart. A loud log and a live server beats a dead one,
 * and anything genuinely unrecoverable will fail again visibly on the next
 * request rather than disappearing.
 */

export interface ProcessGuardOptions {
  /** Called for each swallowed error, so callers can surface it in the UI. */
  onError?: (kind: 'rejection' | 'exception', error: unknown) => void;
}

const describe = (error: unknown): string => {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
};

let installed = false;

export const installProcessGuard = ({onError}: ProcessGuardOptions = {}): void => {
  // Guard against double-install: the CLI relaunches itself for OpenSSL, and
  // duplicate listeners would print every error twice.
  if (installed) return;
  installed = true;

  /*
   * A rejection is logged and survived, unlike an exception above.
   *
   * These come overwhelmingly from background work — the watchlist scheduler,
   * a scan, a stray upstream call — where nothing is waiting on a response, so
   * there is no request left hanging. Killing the server for one is what made
   * a scheduled scan able to take the whole thing down unattended.
   */
  process.on('unhandledRejection', (reason) => {
    console.error(signale.error('Unhandled promise rejection — logged, the server keeps running'));
    console.error(signale.note(describe(reason)));
    onError?.('rejection', reason);
  });

  /*
   * An uncaught exception exits, deliberately.
   *
   * Swallowing it and carrying on was worse than the crash it replaced. When
   * one is thrown while a request is in flight, Express has already returned
   * and nothing will ever send that response — so the request hangs instead of
   * failing. Each hung request holds its socket, and behind a reverse proxy
   * the origin connection pool fills until every endpoint times out, while the
   * process sits at near-zero CPU looking healthy. Measured directly: with the
   * handler the request never answered; without it the client got an immediate
   * reset.
   *
   * Exiting restores a fast, honest failure. The original complaint was not
   * that the process died, it was that it died *silently* — so the fix is the
   * log line above the exit, not staying alive in an unknown state.
   */
  process.on('uncaughtException', (error) => {
    console.error(signale.error('Uncaught exception — exiting so the process does not serve from a broken state'));
    console.error(signale.note(describe(error)));
    onError?.('exception', error);
    // Give stderr a tick to flush before the process goes away.
    setTimeout(() => process.exit(1), 100).unref();
  });

  /*
   * A client disconnecting mid-stream surfaces as ECONNRESET/EPIPE on the
   * response socket. Those are normal for audio streaming — a phone locking
   * its screen does it — and must not be treated as a fault worth reporting.
   */
  process.on('warning', (warning) => {
    if (warning.name === 'MaxListenersExceededWarning') {
      console.warn(signale.warn(`${warning.name}: ${warning.message}`));
    }
  });
};

/** Whether a socket error is just a client hanging up rather than a real fault. */
export const isClientDisconnect = (error: unknown): boolean => {
  const code = (error as {code?: string} | null)?.code;
  return code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE';
};
