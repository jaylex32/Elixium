'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- desktop shell, CommonJS. */

const fs = require('fs');
const path = require('path');

/**
 * The tail of the engine's own log, in a form fit to show someone.
 *
 * "The Elixium engine did not start in time" says nothing about why, which
 * leaves the reader — and anyone trying to help them — with no evidence at
 * all. The engine records its own reason as it boots: a config it cannot
 * parse, a port already taken, a service refusing a login, a crash. That is
 * what belongs in front of somebody whose app will not open.
 *
 * Colour codes are stripped because the engine writes for a terminal, and a
 * dialog renders those as unreadable bracket noise.
 */
/*
 * Every control sequence, not only the colour ones.
 *
 * The engine redraws progress lines in place, so its log is full of cursor
 * moves and line erases as well as colours. Stripping only colours left rows
 * of "[2K[1A[G" in the middle of the message.
 */
const ESCAPE = String.fromCharCode(27);
const CONTROL_CODES = new RegExp(ESCAPE + '\\[[0-9;?]*[ -/]*[@-~]', 'g');

function engineLogTail(dataDir, lines = 14) {
  try {
    const text = fs.readFileSync(path.join(dataDir, 'engine.log'), 'utf8');
    return text
      .replace(CONTROL_CODES, '')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-lines)
      .join('\n');
  } catch {
    // No log yet means the engine never got far enough to write one, which is
    // itself worth reporting rather than hiding behind an empty string.
    return '';
  }
}

module.exports = {engineLogTail};
