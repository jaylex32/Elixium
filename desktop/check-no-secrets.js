/* eslint-disable @typescript-eslint/no-var-requires -- build script, CommonJS. */
'use strict';

/**
 * Fail the build if personal state made it into the packaged app.
 *
 * The engine writes elixium.config.json, elixium.watchlist.json and logs next
 * to its working directory. Running it even once inside the build folder
 * leaves those behind, and the next package would ship someone's ARL, Qobuz
 * token and Spotify cookie to everyone who downloads the installer.
 *
 * Exclusion filters in package.json are the first line of defence; this is the
 * check that they worked, because a filter that silently stops matching is
 * exactly the kind of failure nobody notices until it is public.
 */

const fs = require('fs');
const path = require('path');

const FORBIDDEN = ['elixium.config.json', 'elixium.watchlist.json', '.env', 'engine.log'];

const walk = (dir, hits = []) => {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return hits;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // node_modules is huge and cannot contain our state files.
      if (entry.name === 'node_modules') continue;
      walk(full, hits);
    } else if (FORBIDDEN.includes(entry.name)) {
      hits.push(full);
    }
  }
  return hits;
};

const root = path.join(__dirname, 'out');
if (!fs.existsSync(root)) {
  console.log('no build output to check');
  process.exit(0);
}

const hits = walk(root);
if (hits.length > 0) {
  console.error('Refusing to ship: personal state found inside the build output.');
  for (const hit of hits) console.error('  ' + path.relative(__dirname, hit));
  console.error('\nDelete these and rebuild. They are created when the engine runs');
  console.error('with its working directory inside the build folder.');
  process.exit(1);
}

console.log('clean: no config, watchlist, .env or logs in the build output');
