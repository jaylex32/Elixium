'use strict';

/**
 * Render every page in Node and fail if any of them throws.
 *
 * This exists because the Settings page shipped broken: a tooltip placed
 * outside its provider throws the moment React executes the tree, and nothing
 * before that point can see it. TypeScript compiled it, eslint passed it, vite
 * built it, and the engine served it — the crash existed only for the person
 * who opened the page.
 *
 * A page is only known to work once something renders it. That is all this
 * does: bundle the pages for Node, render each one to a string inside the same
 * providers App wraps them in, and report which ones threw.
 *
 * It is not a test of behaviour. A page that renders can still be wrong. But a
 * page that throws is wrong for certain, and that is worth knowing before a
 * release rather than after one.
 *
 * Pages are rendered bare, with none of the providers App wraps them in. That
 * is stricter than the real tree on purpose: the crash this was written for was
 * a tooltip with no provider above it anywhere, and a harness that supplies one
 * cannot see that. The cost is that a page legitimately relying on a root
 * provider would be reported here — worth the trade for catching a page that
 * genuinely throws.
 */

const {execFileSync} = require('child_process');
const path = require('path');
const fs = require('fs');

const here = __dirname;
const bundle = path.join(here, 'node_modules', '.cache', 'render-check.cjs');

fs.mkdirSync(path.dirname(bundle), {recursive: true});

/*
 * Bundled through esbuild's own API rather than its command line: the path to
 * this project contains spaces, and a Windows shell splits those into separate
 * arguments however they are quoted.
 */
require('esbuild').buildSync({
  entryPoints: [path.join(here, 'render-check.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: bundle,
  jsx: 'automatic',
  alias: {'@': path.join(here, 'src')},
  /* Styles are irrelevant here and want a real document to attach to. */
  loader: {'.css': 'empty'},
  logLevel: 'error',
});

/*
 * Enough of a browser for module-level code to load.
 *
 * Deliberately thin: anything a page needs beyond this is a dependency on the
 * browser at import time, which is worth knowing about rather than papering
 * over.
 */
const storage = {getItem: () => null, setItem: () => {}, removeItem: () => {}};
const node = () => ({
  appendChild() {},
  setAttribute() {},
  removeAttribute() {},
  style: {},
  classList: {add() {}, remove() {}, toggle() {}},
  sheet: {insertRule() {}},
  firstChild: null,
});

globalThis.localStorage = storage;
globalThis.window = {
  localStorage: storage,
  location: {origin: 'http://localhost', href: 'http://localhost/'},
  matchMedia: () => ({matches: false, addEventListener() {}, removeEventListener() {}}),
  addEventListener() {},
  removeEventListener() {},
};
globalThis.navigator = {userAgent: 'node'};
globalThis.document = {
  documentElement: node(),
  head: node(),
  body: node(),
  addEventListener() {},
  removeEventListener() {},
  createElement: () => node(),
  createTextNode: () => node(),
  getElementsByTagName: () => [node()],
  querySelector: () => null,
  querySelectorAll: () => [],
};

require(bundle);

/*
 * Leave rather than linger.
 *
 * Rendering opens a socket client, which holds the event loop open forever;
 * the answer is already printed by the time this runs.
 */
process.exit(process.exitCode ?? 0);
