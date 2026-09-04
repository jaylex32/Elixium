/*
 * Starts the engine with its output somewhere visible.
 *
 * nodejs-mobile routes stderr to logcat but not stdout, so everything the
 * engine reports on the way up — including the reason it gives before exiting —
 * was being written into a void. Routing stdout to stderr costs nothing on a
 * phone, where neither is a terminal, and turns a silent exit into a message.
 */

const asError = console.error.bind(console);
console.log = asError;
console.info = asError;
console.warn = asError;

process.on('uncaughtException', (error) => {
  asError('elixium: uncaught exception', error && error.stack ? error.stack : error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  asError('elixium: unhandled rejection', reason);
});

process.on('exit', (code) => {
  asError('elixium: process exiting with code ' + code);
});

asError('elixium: bootstrap starting, cwd ' + process.cwd());
asError('elixium: argv ' + JSON.stringify(process.argv));

require('./server/elixium.js');
