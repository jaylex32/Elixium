/*
 * Starts the engine, with somewhere for it to report from.
 *
 * Neither stdout nor stderr reaches logcat on this runtime — only Node's own
 * fatal handler prints — so everything the engine said on its way up went
 * nowhere, and a working start looked exactly like a silent failure. That cost
 * hours of debugging a system that was, part of the time, already running.
 *
 * Everything written through here also lands in a file next to the engine:
 *   adb shell run-as com.elixium.client cat files/elixium.log
 */

/* eslint-disable @typescript-eslint/no-var-requires -- runs under Node on the phone, CommonJS. */
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', 'elixium.log');

const record = (...parts) => {
  const line = new Date().toISOString() + ' ' + parts.map(String).join(' ') + '\n';
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    /* Logging must never be the reason the engine fails to start. */
  }
};

const asError = (...parts) => {
  record(...parts);
  console.error(...parts);
};

console.log = asError;
console.info = asError;
console.warn = asError;

process.on('uncaughtException', (error) => {
  asError('uncaught exception', error && error.stack ? error.stack : error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  asError('unhandled rejection', reason && reason.stack ? reason.stack : reason);
});

process.on('exit', (code) => {
  record('process exiting with code ' + code);
});

record('---- bootstrap starting ----');
record('cwd ' + process.cwd());
record('node ' + process.version + ', openssl ' + process.versions.openssl);
record('argv ' + JSON.stringify(process.argv));

require('./server/elixium.js');
