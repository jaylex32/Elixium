import cliProgress from 'cli-progress';

type ProgressStage = 'QUEUE' | 'DOWN' | 'DECRYPT' | 'TAG' | 'SAVE';
type ProgressOutcome = 'DONE' | 'SKIP' | 'FAIL';

type ProgressPayload = {
  label: string;
  artist: string;
  index: string;
  indexDisplay: string;
  titleDisplay: string;
  artistDisplay: string;
  stage: ProgressStage;
  statusDisplay: string;
};

type ProgressEntry = {
  bar: cliProgress.SingleBar;
  total: number;
  payload: ProgressPayload;
};

const truncateLabel = (value: string, max = 26) => {
  if (value.length <= max) {
    return value.padEnd(max);
  }

  return `${value.slice(0, max - 1)}…`;
};

const INDEX_WIDTH = 7;
const TITLE_WIDTH = 24;
const ARTIST_WIDTH = 20;
const STATUS_WIDTH = 10;
const BAR_SIZE = 18;

const STAGE_LABELS: Record<ProgressStage, string> = {
  QUEUE: 'Queued',
  DOWN: 'Downloading',
  DECRYPT: 'Decrypt',
  TAG: 'Tagging',
  SAVE: 'Saving',
};

const OUTCOME_LABELS: Record<ProgressOutcome, string> = {
  DONE: 'Saved',
  SKIP: 'Skipped',
  FAIL: 'Failed',
};

const renderStaticBar = (percentage: number, barsize = BAR_SIZE) => {
  const clamped = Math.max(0, Math.min(percentage, 100));
  const complete = Math.round((clamped / 100) * barsize);
  return `${'\u2588'.repeat(complete)}${'\u2591'.repeat(Math.max(0, barsize - complete))}`;
};

const formatBorder = () =>
  `+${'-'.repeat(INDEX_WIDTH + 2)}+${'-'.repeat(TITLE_WIDTH + 2)}+${'-'.repeat(ARTIST_WIDTH + 2)}+${'-'.repeat(
    BAR_SIZE + 4,
  )}+${'-'.repeat(5 + 2)}+${'-'.repeat(STATUS_WIDTH + 2)}+`;

const formatRow = (index: string, title: string, artist: string, bar: string, percentage: string, status: string) =>
  `| ${truncateLabel(index, INDEX_WIDTH)} | ${truncateLabel(title, TITLE_WIDTH)} | ${truncateLabel(
    artist,
    ARTIST_WIDTH,
  )} | [${bar}] | ${percentage.padStart(4, ' ')} | ${truncateLabel(status, STATUS_WIDTH)} |`;

const formatHeader = () => formatRow('#', 'TITLE', 'ARTIST', 'PROGRESS'.padEnd(BAR_SIZE, ' '), '%', 'STATUS');

const formatOutcomeLine = (
  outcome: ProgressOutcome,
  index: string,
  label: string,
  artist: string,
  percentage: number,
) => {
  const status = OUTCOME_LABELS[outcome];
  return formatRow(index, label, artist, renderStaticBar(percentage), `${Math.round(percentage)}%`, status);
};

const buildPayload = (
  label: string,
  artist: string,
  index = '--',
  patch: Partial<ProgressPayload> = {},
): ProgressPayload => {
  const stage = patch.stage ?? 'QUEUE';
  return {
    label,
    artist,
    index,
    indexDisplay: truncateLabel(index, INDEX_WIDTH),
    titleDisplay: truncateLabel(label, TITLE_WIDTH),
    artistDisplay: truncateLabel(artist, ARTIST_WIDTH),
    stage,
    statusDisplay: truncateLabel(patch.statusDisplay ?? STAGE_LABELS[stage], STATUS_WIDTH),
  };
};

class TerminalProgressManager {
  private multibar: cliProgress.MultiBar | null = null;
  private entries = new Map<string, ProgressEntry>();

  isEnabled() {
    return Boolean(process.stdout.isTTY) && !process.env.CI && !process.env.NO_RICH_PROGRESS;
  }

  private ensureMultiBar() {
    if (!this.multibar) {
      this.multibar = new cliProgress.MultiBar(
        {
          stream: process.stdout,
          hideCursor: true,
          clearOnComplete: false,
          stopOnComplete: false,
          barsize: BAR_SIZE,
          fps: 12,
          autopadding: true,
          forceRedraw: true,
          format: '| {indexDisplay} | {titleDisplay} | {artistDisplay} | [{bar}] | {percentage}% | {statusDisplay} |',
          barCompleteChar: '\u2588',
          barIncompleteChar: '\u2591',
        },
        cliProgress.Presets.shades_grey,
      );
      this.multibar.log(`${formatBorder()}\n`);
      this.multibar.log(`${formatHeader()}\n`);
      this.multibar.log(`${formatBorder()}\n`);
    }

    return this.multibar;
  }

  start(id: string, label: string, total: number, artist = 'Unknown Artist', index = '--') {
    if (!this.isEnabled()) {
      return;
    }

    const existing = this.entries.get(id);
    if (existing) {
      const safeTotal = Math.max(total, 1);
      existing.total = safeTotal;
      existing.payload = buildPayload(label, artist, index, existing.payload);
      existing.bar.setTotal(safeTotal);
      existing.bar.update(existing.payload);
      return;
    }

    const payload = buildPayload(label, artist, index);
    const bar = this.ensureMultiBar().create(Math.max(total, 1), 0, payload);
    this.entries.set(id, {bar, total: Math.max(total, 1), payload});
  }

  update(id: string, value: number, patch: Partial<ProgressPayload> = {}) {
    if (!this.isEnabled()) {
      return;
    }

    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    entry.payload = buildPayload(
      patch.label ?? entry.payload.label,
      patch.artist ?? entry.payload.artist,
      patch.index ?? entry.payload.index,
      {
        ...entry.payload,
        ...patch,
      },
    );
    const safeValue = Math.max(0, Math.min(value, entry.total));
    entry.bar.update(safeValue, entry.payload);
  }

  stop(id: string) {
    if (!this.isEnabled()) {
      return;
    }

    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    const multibar = this.ensureMultiBar();
    multibar.remove(entry.bar);
    this.entries.delete(id);

    if (!this.entries.size && this.multibar) {
      this.multibar.log(`${formatBorder()}\n`);
      this.multibar.stop();
      this.multibar = null;
    }
  }

  complete(id: string, outcome: ProgressOutcome) {
    if (!this.isEnabled()) {
      return;
    }

    const entry = this.entries.get(id);
    if (!entry) {
      return;
    }

    const percentage = outcome === 'DONE' ? 100 : Math.round((entry.bar.getProgress() || 0) * 100);
    this.log(formatOutcomeLine(outcome, entry.payload.index, entry.payload.label, entry.payload.artist, percentage));
    this.stop(id);
  }

  log(message: string) {
    if (this.isEnabled() && this.multibar) {
      this.multibar.log(`${message}\n`);
      return;
    }

    console.log(message);
  }
}

export const terminalProgress = new TerminalProgressManager();

export const formatTransferSpeed = (bytesPerSecond: number) => {
  if (!bytesPerSecond || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '--';
  }

  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(2)}MB/s`;
  }

  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)}KB/s`;
  }

  return `${bytesPerSecond.toFixed(0)}B/s`;
};

export const formatTransferEta = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const rounded = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(rounded / 60)
    .toString()
    .padStart(2, '0');
  const secs = (rounded % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
};
