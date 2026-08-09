import {clsx, type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Coerce a duration into seconds.
 *
 * The catalog API returns durations as pre-formatted strings ("05m 45s"), not
 * numbers. Call sites were doing parseInt on that, which yields 5 — so every
 * track in the app displayed as "0:05". Handles the formatted form, a bare
 * numeric string, "m:ss", and an actual number.
 */
export function toSeconds(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : 0;
  if (typeof value !== 'string') return 0;

  const text = value.trim();
  if (!text) return 0;

  // "05m 45s" / "1h 02m 03s"
  const parts = text.match(/(\d+)\s*h|(\d+)\s*m|(\d+)\s*s/gi);
  if (parts && /[hms]/i.test(text)) {
    let total = 0;
    for (const part of parts) {
      const n = parseInt(part, 10) || 0;
      if (/h/i.test(part)) total += n * 3600;
      else if (/m/i.test(part)) total += n * 60;
      else total += n;
    }
    return total;
  }

  // "3:45" or "1:02:03"
  if (text.includes(':')) {
    const segments = text.split(':').map((n) => parseInt(n, 10) || 0);
    return segments.reduce((acc, n) => acc * 60 + n, 0);
  }

  const numeric = parseInt(text, 10);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => unknown>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
