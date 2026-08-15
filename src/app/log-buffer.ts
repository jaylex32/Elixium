import type {Server as SocketIOServer} from 'socket.io';

/**
 * Keep recent server output so the interface can show what the backend is doing.
 *
 * Everything the engine reports already goes to stdout, which is invisible to
 * anyone running it as a desktop app, a service, or on another machine — the
 * usual case here. Diagnosing a stalled download meant finding engine.log on
 * the host. This keeps the same lines in memory and streams them to connected
 * clients as they happen.
 *
 * A ring buffer, not a growing array: a long-running server logs continuously,
 * and an unbounded list is a slow memory leak that eventually takes the process
 * down — the kind of failure that looks like "it crashed overnight".
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  /** Monotonic within a run; lets a client resume without duplicating lines. */
  seq: number;
  at: number;
  level: LogLevel;
  message: string;
}

const MAX_ENTRIES = 500;

/** ANSI colour codes from signale et al. render as noise in a browser. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

const entries: LogEntry[] = [];
let sequence = 0;
let broadcast: ((entry: LogEntry) => void) | null = null;
let installed = false;

const record = (level: LogLevel, args: unknown[]) => {
  const message = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.stack || arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ')
    .replace(ANSI, '')
    .trimEnd();

  if (!message) return;

  const entry: LogEntry = {seq: ++sequence, at: Date.now(), level, message};
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  // Never let a listener's failure propagate into the console call that
  // produced it, or one bad socket write turns every log line into a crash.
  try {
    broadcast?.(entry);
  } catch {
    /* nothing useful to do here */
  }
};

/**
 * Tee console output into the buffer.
 *
 * The original methods are still called, so the terminal and engine.log are
 * unchanged — this observes, it does not replace.
 */
export const installLogCapture = () => {
  if (installed) return;
  installed = true;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    record('info', args);
    original.log(...args);
  };
  console.info = (...args: unknown[]) => {
    record('info', args);
    original.info(...args);
  };
  console.warn = (...args: unknown[]) => {
    record('warn', args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    record('error', args);
    original.error(...args);
  };
};

/** Push new lines to every connected client. */
export const attachLogBroadcast = (io: SocketIOServer) => {
  broadcast = (entry) => io.emit('logLine', entry);
};

/** Recent lines, oldest first. `since` returns only what a client has not seen. */
export const getLogEntries = (since = 0, limit = MAX_ENTRIES): LogEntry[] => {
  const selected = since > 0 ? entries.filter((entry) => entry.seq > since) : entries;
  return selected.slice(-limit);
};

export const clearLogEntries = () => {
  entries.length = 0;
};
