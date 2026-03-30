import test from 'ava';
import {mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {spawnSync} from 'child_process';
import Config from '../src/lib/config';

test('Config defaults to elixium config file', (t) => {
  const conf = new Config();
  t.is((conf as any).configFile, 'elixium.config.json');
});

test('Config writes elixium config on save', (t) => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'elixium-config-'));
  const tsNodeRegister = join(process.cwd(), 'node_modules', 'ts-node', 'register');

  try {
    const script = `
      const Config = require(${JSON.stringify(join(process.cwd(), 'src/lib/config'))}).default;
      const conf = new Config();
      if (conf.userConfigLocation !== null) {
        throw new Error('unexpected preloaded config');
      }
      conf.set('concurrency', 7);
      conf.set('fallbackTrack', false);
    `;
    const result = spawnSync(process.execPath, ['-r', tsNodeRegister, '-e', script], {
      cwd: tempRoot,
      env: process.env,
      encoding: 'utf8',
    });

    t.is(result.status, 0, result.stderr || result.stdout);
    t.true(existsSync(join(tempRoot, 'elixium.config.json')));
    const saved = JSON.parse(readFileSync(join(tempRoot, 'elixium.config.json'), 'utf8'));
    t.is(saved.concurrency, 7);
    t.false(saved.fallbackTrack);
  } finally {
    rmSync(tempRoot, {recursive: true, force: true});
  }
});
