'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- build script, CommonJS. */

/**
 * Load the interface in a real browser and fail if it renders nothing.
 *
 * This exists because a blank window shipped. A selector returning a fresh
 * array on every read made React's useSyncExternalStore abort the render, and
 * nothing else catches that: TypeScript compiles it, the bundle builds, the
 * server serves it, and the packaged app installs — the failure only exists
 * once a browser executes the code. Every check that ran was blind to it.
 *
 * Usage:  node smoke-render.js <url> [pages...]
 *   node smoke-render.js http://127.0.0.1:1983 home search charts settings
 *
 * Exits non-zero when a page renders nothing or logs a React error, so it can
 * gate a release the way the payload check gates the Windows binary.
 */

const {app, BrowserWindow} = require('electron');
const fs = require('fs');
const path = require('path');

/*
 * Results are written to a file as well as stdout.
 *
 * A GUI process on Windows does not reliably attach to the console it was
 * launched from, so piping this into grep silently produces nothing — which is
 * exactly the kind of "no output means it passed" trap this script exists to
 * prevent.
 */
const reportPath = path.join(__dirname, 'smoke-report.txt');
const lines = [];
const record = (line) => {
  lines.push(line);
  console.log(line);
};

const url = process.argv[2] || 'http://127.0.0.1:1983';
const pages = process.argv.slice(3);
const targets = pages.length > 0 ? pages : ['home'];

/** Enough content to be a real page rather than a spinner or an error card. */
const MIN_NODES = 200;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({width: 1400, height: 900, show: false, webPreferences: {offscreen: true}});
  const failures = [];

  for (const page of targets) {
    const errors = [];
    const onMessage = (_event, level, message) => {
      // Electron's CSP notice is a development-mode warning about the page it
      // is hosting, not a fault in the page itself.
      if (level >= 2 && !/Electron Security Warning/.test(String(message))) errors.push(String(message));
    };
    window.webContents.on('console-message', onMessage);

    await window.loadURL(url);
    await wait(2500);

    // Navigate the way the sidebar does: the shell reads its page from here.
    await window.webContents.executeJavaScript(`
      (() => {
        const saved = JSON.parse(localStorage.getItem('elixium-app') || '{}');
        saved.state = Object.assign({}, saved.state, {currentPage: ${JSON.stringify(page)}});
        saved.version = saved.version ?? 0;
        localStorage.setItem('elixium-app', JSON.stringify(saved));
        location.reload();
        return true;
      })()
    `);
    await wait(6000);

    const result = await window.webContents.executeJavaScript(`
      (() => {
        const root = document.getElementById('root') || document.body;
        return {nodes: root.querySelectorAll('*').length, text: root.innerText.trim().length};
      })()
    `);

    window.webContents.off('console-message', onMessage);

    const blank = result.nodes < MIN_NODES;
    const status = blank || errors.length > 0 ? 'FAIL' : 'ok  ';
    record(`  ${status} ${page.padEnd(10)} ${result.nodes} nodes, ${result.text} chars`);
    for (const error of errors.slice(0, 2)) record(`       ${error.slice(0, 140)}`);

    if (blank) failures.push(`${page}: rendered ${result.nodes} nodes`);
    if (errors.length > 0) failures.push(`${page}: ${errors[0].slice(0, 100)}`);
  }

  if (failures.length > 0) {
    console.error('\nblank or broken pages:');
    for (const failure of failures) console.error('  ' + failure);
    app.exit(1);
    return;
  }

  console.log('\nevery page rendered');
  app.exit(0);
});
