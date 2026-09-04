'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- build script, CommonJS. */

/**
 * Every local module the shell requires must actually be packaged.
 *
 * electron-builder ships only what `build.files` lists, so adding a file next
 * to main.js and requiring it is not enough — the packaged app.asar simply will
 * not contain it, and the app dies on launch with "Cannot find module" before
 * any of its own error handling exists to say so.
 *
 * That shipped once. It is exactly the kind of mistake that is invisible in
 * development, where the files are all present on disk, and total in a build.
 */

const fs = require('fs');
const path = require('path');

const here = __dirname;
/*
 * The build configuration lives in electron-builder.js, not
 * package.json, because it computes which of node_modules to ship rather than
 * listing it. This check reads it from there so it keeps checking the list
 * that is actually used — reading a `build` block that no longer exists would
 * have left it silently passing on an empty list.
 */
const config = require('./electron-builder.js');
const listed = config.files || [];

/** The entry points electron actually loads, and anything they pull in. */
const ROOTS = ['main.js', 'preload.js'];

const localRequires = (file) => {
  const source = fs.readFileSync(path.join(here, file), 'utf8');
  const found = new Set();
  // require('./x') and require('../x') — the ones that resolve to our own files.
  const pattern = /require\(\s*'(\.[^']+)'\s*\)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) found.add(match[1]);
  return [...found];
};

const failures = [];
const seen = new Set();
const queue = [...ROOTS];

while (queue.length > 0) {
  const file = queue.shift();
  if (seen.has(file)) continue;
  seen.add(file);

  if (!fs.existsSync(path.join(here, file))) {
    failures.push(`${file} is required but does not exist`);
    continue;
  }

  for (const request of localRequires(file)) {
    // Node resolves an extensionless request to .js; mirror that.
    const target = request.endsWith('.js') ? request : `${request}.js`;
    const normalised = path.posix.normalize(target.replace(/^\.\//, ''));

    if (!listed.includes(normalised)) {
      failures.push(`${file} requires ${request}, which build.files does not include ("${normalised}")`);
    }
    queue.push(normalised);
  }
}

if (failures.length > 0) {
  console.error('Packaging would produce an app that cannot start:\n');
  for (const failure of failures) console.error('  - ' + failure);
  console.error('\nAdd the missing entries to build.files in desktop/package.json.');
  process.exit(1);
}

console.log(`packaging check: ${seen.size} shell modules, all listed in the build config`);
