/**
 * Byte-budgeted LRU cache for fully-materialized audio buffers.
 *
 * Deezer tracks must be downloaded and decrypted in full before any byte can be
 * served, so a naive range handler re-fetches and re-decrypts the whole file on
 * every seek. A mobile client scrubbing a 40 MB FLAC would pull it down
 * repeatedly. Caching the decrypted buffer turns each subsequent range request
 * into a memory slice.
 *
 * The cache is bounded by total bytes (not entry count) because audio buffers
 * vary from ~3 MB to ~150 MB; an entry-count cap cannot bound memory usefully.
 */

interface CacheEntry {
  key: string;
  buffer: Buffer;
  contentType: string;
  lastUsed: number;
}

export class TrackBufferCache {
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CacheEntry>();
  private totalBytes = 0;

  constructor({maxBytes = 512 * 1024 * 1024, ttlMs = 10 * 60 * 1000} = {}) {
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
  }

  private isExpired(entry: CacheEntry, now: number): boolean {
    return this.ttlMs > 0 && now - entry.lastUsed > this.ttlMs;
  }

  get(key: string): {buffer: Buffer; contentType: string} | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    const now = Date.now();
    if (this.isExpired(entry, now)) {
      this.delete(key);
      return undefined;
    }

    entry.lastUsed = now;
    return {buffer: entry.buffer, contentType: entry.contentType};
  }

  set(key: string, buffer: Buffer, contentType: string): void {
    // A single item larger than the whole budget would evict everything and
    // still not fit — skip caching it rather than thrashing.
    if (buffer.length > this.maxBytes) return;

    this.delete(key);
    this.entries.set(key, {key, buffer, contentType, lastUsed: Date.now()});
    this.totalBytes += buffer.length;
    this.evictUntilWithinBudget();
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.totalBytes -= entry.buffer.length;
    this.entries.delete(key);
  }

  private evictUntilWithinBudget(): void {
    if (this.totalBytes <= this.maxBytes) return;

    const now = Date.now();
    for (const entry of [...this.entries.values()]) {
      if (this.totalBytes <= this.maxBytes) break;
      if (this.isExpired(entry, now)) this.delete(entry.key);
    }

    // Still over budget: drop least-recently-used entries.
    const byAge = [...this.entries.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const entry of byAge) {
      if (this.totalBytes <= this.maxBytes) break;
      this.delete(entry.key);
    }
  }

  stats(): {entries: number; bytes: number; maxBytes: number} {
    return {entries: this.entries.size, bytes: this.totalBytes, maxBytes: this.maxBytes};
  }
}

/** Shared instance used by the streaming routes. */
export const trackBufferCache = new TrackBufferCache();

/**
 * Parse an HTTP Range header against a known total size.
 * Returns undefined for absent/unsatisfiable-but-ignorable headers, and `null`
 * when the range is genuinely out of bounds (caller should send 416).
 */
export const parseRange = (
  header: string | undefined,
  total: number,
): {start: number; end: number} | null | undefined => {
  if (!header) return undefined;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;

  const [, rawStart, rawEnd] = match;

  // Suffix form: "bytes=-500" means the final 500 bytes.
  if (rawStart === '') {
    if (rawEnd === '') return undefined;
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return {start: Math.max(0, total - suffix), end: total - 1};
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= total) return null;

  const end = rawEnd === '' ? total - 1 : Math.min(total - 1, Number(rawEnd));
  if (!Number.isFinite(end) || end < start) return null;

  return {start, end};
};
