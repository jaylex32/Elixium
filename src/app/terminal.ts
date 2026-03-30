import cliui from 'cliui';
import pc from 'picocolors';
import {APP_BRAND, APP_COMMAND, DEFAULT_CONFIG_FILE} from './brand';

type KeyValue = {
  label: string;
  value: string;
};

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const stripAnsi = (value: string) => value.replace(ansiPattern, '');
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const noPadding = [0, 0, 0, 0] as [number, number, number, number];

export const terminalWidth = () => clamp(process.stdout.columns || 88, 72, 100);

export const terminalRule = (width = terminalWidth()) => pc.dim('─'.repeat(width));
const visibleLength = (value: string) => stripAnsi(value).length;
const frameTop = (width = terminalWidth()) => `${pc.dim('┌')}${pc.dim('─'.repeat(width - 2))}${pc.dim('┐')}`;
const frameMiddle = (width = terminalWidth()) => `${pc.dim('├')}${pc.dim('─'.repeat(width - 2))}${pc.dim('┤')}`;
const frameBottom = (width = terminalWidth()) => `${pc.dim('└')}${pc.dim('─'.repeat(width - 2))}${pc.dim('┘')}`;

const createUi = (width = terminalWidth(), wrap = false) => cliui({width, wrap});

const framedLine = (content = '', width = terminalWidth(), align: 'left' | 'center' = 'left') => {
  const innerWidth = width - 2;
  const visible = visibleLength(content);
  const safeVisible = Math.min(visible, innerWidth);
  const remaining = Math.max(innerWidth - safeVisible, 0);

  if (align === 'center') {
    const leftPad = Math.floor(remaining / 2);
    const rightPad = remaining - leftPad;
    return `${pc.dim('│')}${' '.repeat(leftPad)}${content}${' '.repeat(rightPad)}${pc.dim('│')}`;
  }

  return `${pc.dim('│')} ${content}${' '.repeat(Math.max(innerWidth - safeVisible - 1, 0))}${pc.dim('│')}`;
};

const keyValueGrid = (entries: KeyValue[], width = terminalWidth()) => {
  const ui = createUi(width, false);
  const labelWidth = 12;

  for (const entry of entries) {
    ui.div(
      {
        text: pc.bold(pc.white(entry.label.toUpperCase().padEnd(labelWidth))),
        width: labelWidth + 2,
        padding: [0, 0, 0, 2],
      },
      {text: entry.value, width: width - labelWidth - 2, padding: noPadding},
    );
  }

  return ui.toString().trimEnd();
};

const commandGrid = (
  rows: Array<{
    flags: string;
    value: string;
  }>,
  width = terminalWidth(),
) => {
  const ui = createUi(width, false);

  for (const row of rows) {
    ui.div(
      {text: pc.cyan(`  ${APP_COMMAND}`), width: 12, padding: noPadding},
      {text: pc.dim(row.flags), width: 40, padding: noPadding},
      {text: row.value, width: width - 52, padding: [0, 0, 0, 1]},
    );
  }

  return ui.toString().trimEnd();
};

const bulletGrid = (title: string, lines: string[], width = terminalWidth()) => {
  const ui = createUi(width, true);
  ui.div(pc.bold(pc.white(title)));

  for (const line of lines) {
    ui.div({text: pc.cyan('  ●'), width: 4, padding: noPadding}, {text: line, width: width - 4, padding: [0, 0, 0, 1]});
  }

  return ui.toString().trimEnd();
};

export const formatBanner = (version: string) => {
  const width = terminalWidth();
  const laneStrip = [
    pc.black(pc.bgCyan(' SEARCH ')),
    pc.black(pc.bgYellow(' EXPLORE ')),
    pc.black(pc.bgGreen(' DOWNLOAD ')),
    pc.black(pc.bgMagenta(' WEB ')),
  ].join('  ');
  const title = `${pc.bold(pc.cyan(APP_BRAND))} ${pc.dim('// COMMAND DECK')}`;
  const versionChip = pc.black(pc.bgWhite(` VERSION ${version} `));
  const infoLines = [
    {label: 'COMMAND', value: pc.bold(pc.white(APP_COMMAND))},
    {label: 'CONFIG', value: pc.cyan(DEFAULT_CONFIG_FILE)},
    {label: 'FLOW', value: pc.white('query -> result type -> album or playlist -> tracks')},
    {label: 'MODES', value: pc.white('interactive | headless | web')},
    {label: 'FOCUS', value: pc.dim('stronger explorer, cleaner routing, stability-first runtime')},
  ].map(({label, value}) => `${pc.bold(pc.white(label.padEnd(8)))} ${pc.dim('::')} ${value}`);

  return [
    frameTop(width),
    framedLine('', width),
    framedLine(title, width, 'center'),
    framedLine(versionChip, width, 'center'),
    framedLine('', width),
    frameMiddle(width),
    framedLine('', width),
    framedLine(pc.white('Search anything, explore artists and albums, then route straight into downloads.'), width),
    framedLine('', width),
    framedLine(laneStrip, width, 'center'),
    framedLine('', width),
    frameMiddle(width),
    ...infoLines.map((line) => framedLine(line, width)),
    frameBottom(width),
  ].join('\n');
};

export const terminalExamples = () =>
  [
    pc.bold(pc.white('Launch Patterns')),
    commandGrid([
      {flags: '--url', value: 'https://www.deezer.com/track/3135556'},
      {flags: '--web --port', value: '3000'},
      {flags: '--qobuz --headless --quality 96khz', value: '--url https://play.qobuz.com/album/...'},
    ]),
  ].join('\n');

export const terminalNotes = () =>
  [
    bulletGrid('Operating Notes', [
      `Skip ${pc.cyan('--url')} to enter the interactive flow.`,
      `Use ${pc.cyan('--web')} for the browser interface and ${pc.cyan('--headless')} for automation.`,
      `Settings are stored in ${pc.cyan(DEFAULT_CONFIG_FILE)} and loaded on startup.`,
    ]),
  ].join('\n');

export const formatCliError = (value: string) => {
  const trimmed = value.trimEnd();
  const lines = trimmed.split('\n');
  const formatted = lines.map((line, index) => {
    if (!line.trim()) {
      return line;
    }

    if (index === 0) {
      return `${pc.black(pc.bgRed(' FAIL '))} ${pc.redBright(line)}`;
    }

    return `       ${pc.dim(stripAnsi(line))}`;
  });

  return formatted.join('\n') + '\n';
};
