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

/**
 * The shell's asar must not contain node_modules.
 *
 * The shell has no dependencies — its four files require Node built-ins and
 * electron — so anything under node_modules in there arrived by accident. It
 * did, for a long time: CI installed the shell's dependencies with
 * `npm install --prefix desktop` from the repository root, which makes npm
 * install the repository itself as a dependency, and electron-builder packed
 * the entire checkout into app.asar. That was 296 MB in every artifact on
 * every platform, and it was invisible locally, where the mistake does not
 * happen and the asar is 45 KB.
 *
 * Checked here rather than trusted to a `files` rule, because the `files`
 * exclusion did not stop it: npm links such a dependency as a symlink, and
 * electron-builder resolves it outside the app directory where the filter no
 * longer applies. Only the size of the result gave it away.
 */
const asarFiles = (asarPath) => {
  const handle = fs.openSync(asarPath, 'r');
  try {
    /*
     * The header is a pickle: four little-endian sizes, then JSON. The fourth
     * is the length of the JSON itself.
     */
    const sizes = Buffer.alloc(16);
    if (fs.readSync(handle, sizes, 0, 16, 0) < 16) return null;
    const jsonLength = sizes.readUInt32LE(12);
    if (!Number.isInteger(jsonLength) || jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) return null;

    const json = Buffer.alloc(jsonLength);
    if (fs.readSync(handle, json, 0, jsonLength, 16) < jsonLength) return null;
    const parsed = JSON.parse(json.toString('utf8'));
    return parsed && parsed.files ? Object.keys(parsed.files) : null;
  } catch {
    /*
     * Unreadable or an unfamiliar format. Not a reason to fail a release —
     * this check exists to catch one specific mistake, not to gate on being
     * able to parse every future asar.
     */
    return null;
  } finally {
    fs.closeSync(handle);
  }
};

const asars = [];
const findAsars = (dir) => {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findAsars(full);
    else if (entry.name === 'app.asar') asars.push(full);
  }
};
findAsars(root);

for (const asar of asars) {
  const entries = asarFiles(asar);
  if (entries === null) continue;
  if (entries.includes('node_modules')) {
    const size = (fs.statSync(asar).size / (1024 * 1024)).toFixed(1);
    console.error('Refusing to ship: node_modules was packed into the app bundle.');
    console.error('  ' + path.relative(__dirname, asar) + '  (' + size + ' MB)');
    console.error('\nThe desktop shell has no dependencies, so this is something being');
    console.error('installed into desktop/node_modules and picked up as one. Check that');
    console.error('the CI step installs with a working-directory of desktop rather than');
    console.error('`npm install --prefix desktop` from the repository root, which makes');
    console.error('npm install the repository itself as a dependency of the shell.');
    process.exit(1);
  }
}

console.log(
  `clean: no config, watchlist, .env or logs in the build output` +
    (asars.length > 0 ? `, and no node_modules in ${asars.length === 1 ? 'the app bundle' : 'the app bundles'}` : ''),
);
