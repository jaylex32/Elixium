'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- build config, CommonJS. */

/**
 * Build configuration, in a file rather than package.json so it can compute
 * what to ship instead of listing it.
 *
 * The extension is .cjs and must stay .cjs. Windows resolves a bare command
 * against the current directory first, using PATHEXT — which includes .JS — so
 * with this file named electron-builder.js the `electron-builder` in the dist
 * script found *this file* instead of the CLI and ran it under Windows Script
 * Host: no output, exit code 0, nothing built. macOS and Linux have no PATHEXT
 * and were unaffected, so it broke exactly one platform, silently. .CJS is not
 * in PATHEXT, and electron-builder looks for the .cjs form when it searches for
 * a config.
 *
 * The thing being computed is which of node_modules the engine actually needs.
 * `extraResources` copied the whole folder, so every build carried the entire
 * development toolchain into the finished app: the TypeScript compiler at 64
 * MB, prettier, eslint and its plugins, ts-node, rcedit — 97 MB of the 146 MB
 * payload, none of which any running copy of Elixium has ever loaded.
 *
 * On the installed build that is wasted disk. On the portable build it is
 * wasted time on every single launch, because the portable format wipes its
 * temporary folder and re-extracts the entire application each time it starts
 * — measured at 52.7 seconds before this change, most of it spent unpacking
 * compiler source the app will never open.
 *
 * Computed rather than hand-listed on purpose. A fixed list of things to
 * exclude goes stale silently: a dependency that moves from devDependencies to
 * dependencies would keep being excluded, and the app would fail at runtime in
 * a packaged build only. Walking the real dependency graph instead means the
 * answer stays correct as dependencies change, and errs toward including too
 * much rather than too little.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const modulesDir = path.join(repoRoot, 'node_modules');

/** Read a package.json, or null if it is missing or unparseable. */
const readManifest = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
};

/**
 * Find an installed package the way Node would: nested first, then upward.
 *
 * npm hoists almost everything to the top level, but not when two packages
 * need different versions of the same thing — so the nested copy has to be
 * followed, or its own dependencies are missed.
 */
const resolvePackage = (name, fromDir) => {
  let current = fromDir;
  for (;;) {
    const candidate = path.join(current, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current || current === repoRoot) return null;
    current = parent;
  }
};

/**
 * Every package reachable from the engine's runtime dependencies.
 *
 * Optional and peer dependencies are followed as well as ordinary ones.
 * Neither is guaranteed to be needed, but a package that requires its peer at
 * runtime and cannot find it fails in exactly the way this change must not
 * cause, and including a few megabytes too many is the cheaper mistake.
 */
const productionClosure = () => {
  const root = readManifest(repoRoot) || {};
  const keep = new Set();
  const queue = Object.keys(root.dependencies || {}).map((name) => ({name, from: repoRoot}));

  while (queue.length > 0) {
    const {name, from} = queue.shift();
    const dir = resolvePackage(name, from);
    if (!dir) continue;

    /* Record the top-level folder name, which is what the filter matches on. */
    const relative = path.relative(modulesDir, dir).split(path.sep).join('/');
    if (relative && !relative.startsWith('..')) keep.add(relative);
    if (keep.has(name) === false) keep.add(name);

    const manifest = readManifest(dir);
    if (!manifest) continue;
    const next = {
      ...(manifest.dependencies || {}),
      ...(manifest.optionalDependencies || {}),
      ...(manifest.peerDependencies || {}),
    };
    for (const dependency of Object.keys(next)) {
      if (!keep.has(dependency)) queue.push({name: dependency, from: dir});
    }
  }
  return keep;
};

/** Top-level entries in node_modules, with scopes expanded to scope/name. */
const installedPackages = () => {
  const names = [];
  for (const entry of fs.readdirSync(modulesDir)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join(modulesDir, entry))) {
        names.push(`${entry}/${scoped}`);
      }
    } else {
      names.push(entry);
    }
  }
  return names;
};

/**
 * What to leave out of the packaged node_modules.
 *
 * Two kinds of thing: whole packages nothing at runtime can reach, and files
 * inside the kept ones that Node never loads — type declarations, source maps
 * and documentation. Licences are deliberately kept.
 */
const nodeModulesFilter = () => {
  const keep = productionClosure();
  const dropped = installedPackages().filter((name) => !keep.has(name));

  return [
    '**/*',
    ...dropped.map((name) => `!${name}/**/*`),
    /*
     * .bin holds the command-line shims, and it must go with them.
     *
     * npm writes these as symlinks into the package folders on macOS and
     * Linux, so dropping a package leaves its shim pointing at nothing. A
     * dangling symlink inside an .app is not a tidiness problem: codesign
     * walks the bundle and fails outright on it, which is what broke both
     * macOS builds of 1.4.0 while Windows — where npm writes .cmd files
     * instead of symlinks — packaged happily.
     *
     * Nothing needs them at runtime. The engine is started by path, as
     * `<electron> .../elixium.js`, never through a shim.
     */
    '!.bin/**/*',
    '!**/.bin/**/*',
    /*
     * Type declarations describe code to the compiler; Node cannot execute
     * them, and @types packages contain nothing else at all.
     */
    '!@types/**/*',
    '!**/*.d.ts',
    '!**/*.map',
    '!**/*.md',
    '!**/elixium.config.json',
    '!**/elixium.watchlist.json',
    '!**/.env',
    '!**/*.log',
  ];
};

module.exports = {
  appId: 'com.elixium.desktop',
  productName: 'Elixium',
  files: [
    'main.js',
    'preload.js',
    'engine-log.js',
    'readiness.js',
    'package.json',
    'assets/icon.png',
    /*
     * The shell carries no dependencies, so nothing from node_modules belongs
     * in the asar. main.js, preload.js, engine-log.js and readiness.js require
     * Node built-ins and electron, and electron comes from the runtime rather
     * than from here.
     *
     * Stated explicitly because CI installs desktop's dependencies as
     * `npm install --prefix desktop` from the repository root, which makes npm
     * install the repository itself as a dependency of the shell. electron-
     * builder then packed the whole checkout — changelogs, dist, public — into
     * app.asar: 296 MB on the runner against 48 KB locally, which is why every
     * release so far has been roughly twice the size it needed to be.
     */
    '!node_modules/**/*',
    '!**/elixium.config.json',
    '!**/elixium.watchlist.json',
    '!**/.env',
    '!**/*.log',
  ],
  extraResources: [
    {
      from: '../dist/src',
      to: 'server',
      filter: ['**/*', '!**/elixium.config.json', '!**/elixium.watchlist.json', '!**/.env', '!**/*.log'],
    },
    {
      from: '../node_modules',
      to: 'server/node_modules',
      filter: nodeModulesFilter(),
    },
    {from: '../package.json', to: 'package.json'},
  ],
  directories: {output: 'out'},
  win: {
    icon: 'build/icon.ico',
    target: [
      {target: 'nsis', arch: ['x64']},
      {target: 'portable', arch: ['x64']},
    ],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico',
    installerHeaderIcon: 'build/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  mac: {
    icon: 'build/icon.icns',
    target: [
      {target: 'dmg', arch: ['x64', 'arm64']},
      {target: 'zip', arch: ['x64', 'arm64']},
    ],
    category: 'public.app-category.music',
  },
  dmg: {icon: 'build/icon.icns'},
  linux: {
    icon: 'build/icons',
    target: [
      {target: 'AppImage', arch: ['x64']},
      {target: 'tar.gz', arch: ['x64']},
    ],
    category: 'Audio',
  },
  portable: {artifactName: 'Elixium-Portable-${version}.${ext}'},
};
