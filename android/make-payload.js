'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- build script, CommonJS. */

/**
 * Packs the engine into a single asset the app unpacks on first launch.
 *
 * What goes in is not decided here. The desktop build already works out which
 * of node_modules the engine actually needs — production dependencies only, no
 * type declarations, no command-line shims — and getting a different answer on
 * Android would mean an app that runs a different program from the desktop one.
 * So the same configuration is read, and whatever it ships is what this ships.
 *
 * One archive rather than loose files because assets are copied out one at a
 * time on first run, and a few thousand of them takes long enough that the app
 * looks hung. A single zip unpacks in a couple of seconds.
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const androidDir = __dirname;
const repoRoot = path.join(androidDir, '..');
const assetsDir = path.join(androidDir, 'app', 'src', 'main', 'assets');
const archivePath = path.join(assetsDir, 'engine.zip');

const desktopConfig = require(path.join(repoRoot, 'desktop', 'electron-builder.cjs'));
const moduleFilter = desktopConfig.extraResources.find((entry) => entry.to === 'server/node_modules').filter;

/** Whole packages the desktop build leaves out. */
const droppedPackages = new Set(
  moduleFilter
    .filter((pattern) => pattern.startsWith('!') && pattern.endsWith('/**/*') && !pattern.includes('*.'))
    .map((pattern) => pattern.slice(1, -5)),
);

/** Files that are never loaded at runtime, whichever package they belong to. */
const isDeadWeight = (file) =>
  file.endsWith('.d.ts') ||
  file.endsWith('.map') ||
  file.endsWith('.md') ||
  file.includes(`${path.sep}.bin${path.sep}`);

/**
 * Rewrite the one regular expression the mobile runtime cannot compile.
 *
 * nodejs-mobile is built --without-intl, so it carries no ICU data and any
 * Unicode property escape — \p{...} — is a syntax error rather than a missing
 * feature. path-to-regexp uses two of them to decide which characters may
 * appear in a route parameter name, and the engine dies loading Express before
 * it can serve anything.
 *
 * Exactly one file in the shipped set uses these escapes, checked rather than
 * assumed, so this is a single known substitution rather than a general
 * transformation. The replacements are the ASCII half of the same character
 * classes, which is all a route like /tracks/:id was ever going to use; a
 * parameter named in another script would be rejected on Android and accepted
 * everywhere else, and nothing in Elixium names one.
 *
 * The desktop and server builds are untouched — they run a Node with ICU.
 */
const shimForNoIcu = (zipPath, contents) => {
  if (!zipPath.endsWith('path-to-regexp/dist/index.js')) return contents;

  const source = contents.toString('utf8');
  const patched = source
    .replace('/^[$_\\p{ID_Start}]$/u', '/^[$_A-Za-z]$/')
    .replace('/^[$\\u200c\\u200d\\p{ID_Continue}]$/u', '/^[$\\u200c\\u200d0-9A-Za-z_]$/');

  if (patched === source) {
    console.error('path-to-regexp no longer matches the expected pattern; review the ICU shim.');
    process.exit(1);
  }
  console.log('  shimmed path-to-regexp for a runtime without ICU');
  return Buffer.from(patched, 'utf8');
};

const engineEntry = path.join(repoRoot, 'dist', 'src', 'elixium.js');
if (!fs.existsSync(engineEntry)) {
  console.error('The engine is not built. Run `npx tsc` in the repository root first.');
  process.exit(1);
}

const zip = new AdmZip();
let fileCount = 0;

/** Add a directory, skipping anything the engine will not read. */
const add = (sourceDir, zipPath) => {
  for (const entry of fs.readdirSync(sourceDir, {withFileTypes: true})) {
    const source = path.join(sourceDir, entry.name);
    const inside = zipPath ? `${zipPath}/${entry.name}` : entry.name;

    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === '.bin') continue;
      add(source, inside);
      continue;
    }
    if (isDeadWeight(source)) continue;

    zip.addFile(inside, shimForNoIcu(inside, fs.readFileSync(source)));
    fileCount += 1;
  }
};

console.log('Packing the engine...');
add(path.join(repoRoot, 'dist', 'src'), 'server');

/*
 * elixium.js reads `../package.json` for its own version, so the manifest has
 * to sit one level above the engine — which is exactly where the desktop build
 * puts it. Without it the engine dies on its first require with "Cannot find
 * module '../package.json'".
 */
zip.addFile('package.json', fs.readFileSync(path.join(repoRoot, 'package.json')));
fileCount += 1;

/* Starts the engine with its output routed somewhere the phone can show it. */
zip.addFile('bootstrap.js', fs.readFileSync(path.join(androidDir, 'bootstrap.js')));
fileCount += 1;

const modulesRoot = path.join(repoRoot, 'node_modules');
for (const entry of fs.readdirSync(modulesRoot)) {
  if (entry.startsWith('.')) continue;

  const names = entry.startsWith('@')
    ? fs.readdirSync(path.join(modulesRoot, entry)).map((scoped) => `${entry}/${scoped}`)
    : [entry];

  for (const name of names) {
    if (droppedPackages.has(name)) continue;
    if (name.startsWith('@types/')) continue;
    add(path.join(modulesRoot, ...name.split('/')), `server/node_modules/${name}`);
  }
}

fs.mkdirSync(assetsDir, {recursive: true});
zip.writeZip(archivePath);

const megabytes = (fs.statSync(archivePath).size / (1024 * 1024)).toFixed(1);
console.log(`Wrote ${path.relative(repoRoot, archivePath)}: ${fileCount} files, ${megabytes} MB`);
