import {Download, CheckCircle2, AlertCircle, Loader2, X, Trash2, Music2, Ban, Search} from 'lucide-react';
import {socketSend} from '@/shared/lib/socket-client';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {Progress} from '@/shared/components/ui/Progress';
import {useDownloadStore, type ActiveDownload} from '@/store/download-store';
import {Input} from '@/shared/components/ui/Input';
import {UnmatchedReports} from './UnmatchedReport';
import {useEffect, useState} from 'react';

/** Compact elapsed time: 42s, 3m 07s, 1h 02m. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Ticks once a second while anything is running, so elapsed time advances. */
function useElapsedTick(enabled: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
}

const STATUS_CONFIG = {
  starting: {label: 'Starting…', color: 'text-info', icon: Loader2, spin: true},
  converting: {label: 'Converting…', color: 'text-warning', icon: Loader2, spin: true},
  downloading: {label: 'Downloading', color: 'text-accent', icon: Loader2, spin: true},
  done: {label: 'Done', color: 'text-success', icon: CheckCircle2, spin: false},
  error: {label: 'Error', color: 'text-danger', icon: AlertCircle, spin: false},
};

function DownloadCard({d, onClear}: {d: ActiveDownload; onClear: () => void}) {
  const cfg = STATUS_CONFIG[d.status];
  const Icon = cfg.icon;
  const isActive = d.status === 'starting' || d.status === 'converting' || d.status === 'downloading';

  return (
    <div
      className={cn(
        'group relative rounded-2xl border p-4 transition-all',
        d.status === 'done' && 'border-success/20 bg-success/5',
        d.status === 'error' && 'border-danger/20 bg-danger/5',
        isActive && 'border-accent/30 bg-accent/5',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Cover / icon */}
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm bg-surface-bg">
          {d.cover ? (
            <img src={d.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Music2 size={20} className="text-text-muted" />
            </div>
          )}
          {isActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/45">
              <Loader2 size={16} className="animate-spin text-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-primary">{d.title}</p>
              {d.artist && <p className="truncate text-xs text-text-muted">{d.artist}</p>}
            </div>
            <span className={cn('flex shrink-0 items-center gap-1 text-xs font-medium', cfg.color)}>
              <Icon size={13} className={cfg.spin ? 'animate-spin' : ''} />
              {cfg.label}
            </span>
          </div>

          {isActive && (
            <div className="mt-2.5 space-y-1.5">
              <Progress value={d.percentage} className="h-1.5" />

              {/* Track counter, elapsed time and percentage are each useful on
                  their own: the counter shows how much is left, elapsed shows
                  whether it is actually moving, and the bar alone showed
                  neither. */}
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <span className="truncate">{d.currentTrack ?? cfg.label}</span>
                <span className="flex shrink-0 items-center gap-2 tabular-nums">
                  {d.total > 1 && (
                    <span>
                      {d.current} of {d.total}
                    </span>
                  )}
                  <span className="text-text-muted/60">·</span>
                  <span>{formatElapsed(Date.now() - d.startedAt)}</span>
                  <span className={cn('font-medium', cfg.color)}>{d.percentage}%</span>
                </span>
              </div>
            </div>
          )}

          {d.status === 'error' && d.error && <p className="mt-1.5 text-xs text-danger">{d.error}</p>}

          {d.status === 'done' && (
            <p className="mt-1.5 text-xs text-success">
              {d.total > 1 ? `${d.total} tracks saved` : 'Saved'} in {formatElapsed(Date.now() - d.startedAt)}
            </p>
          )}
        </div>

        {/* A running download previously had no stop control at all, even
            though the server has handled cancelDownload all along. */}
        {isActive ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Cancel ${d.title}`}
            title="Cancel download"
            onClick={() => socketSend('cancelDownload', {id: d.itemId})}
            className="shrink-0 text-text-muted hover:text-danger"
          >
            <Ban size={14} />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss"
            onClick={onClear}
            className="shrink-0 text-text-muted transition-opacity hover:text-danger lg:opacity-0 lg:group-hover:opacity-100"
          >
            <X size={13} />
          </Button>
        )}
      </div>
    </div>
  );
}

type Filter = 'all' | 'active' | 'done' | 'failed';

const FILTERS: {id: Filter; label: string}[] = [
  {id: 'all', label: 'All'},
  {id: 'active', label: 'Active'},
  {id: 'done', label: 'Done'},
  {id: 'failed', label: 'Failed'},
];

export function DownloadsPage() {
  const {active, history, reports, clear, clearDone, clearHistory} = useDownloadStore();
  const isRunning = useDownloadStore((s) => s.isRunning);
  useElapsedTick(isRunning);

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const downloads = Object.values(active).sort((a, b) => {
    const order = {downloading: 0, converting: 1, starting: 2, error: 3, done: 4};
    return (order[a.status] ?? 5) - (order[b.status] ?? 5) || b.startedAt - a.startedAt;
  });

  const doneCount = downloads.filter((d) => d.status === 'done').length;
  const errorCount = downloads.filter((d) => d.status === 'error').length;
  const activeCount = downloads.filter((d) => d.status !== 'done' && d.status !== 'error').length;

  const matches = (text: string) => text.toLowerCase().includes(query.trim().toLowerCase());

  const visible = downloads.filter((d) => {
    if (filter === 'active' && (d.status === 'done' || d.status === 'error')) return false;
    if (filter === 'done' && d.status !== 'done') return false;
    if (filter === 'failed' && d.status !== 'error') return false;
    if (!query.trim()) return true;
    return matches(d.title) || matches(d.artist ?? '') || matches(d.currentTrack ?? '');
  });

  const visibleHistory = history.filter((h) => !query.trim() || matches(h.title) || matches(h.artist ?? ''));

  const nothingAtAll = downloads.length === 0 && history.length === 0 && reports.length === 0;

  if (nothingAtAll) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center text-text-muted">
        <Download size={48} className="mb-4 opacity-30" />
        <p className="text-lg font-semibold text-text-secondary">No downloads yet</p>
        <p className="mt-1 text-sm">Search for music or paste a URL to start downloading</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl animate-fade-in space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {activeCount > 0 && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-accent">
            <Loader2 size={14} className="animate-spin" />
            {activeCount} downloading
          </span>
        )}
        {doneCount > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 size={14} />
            {doneCount} done
          </span>
        )}
        {errorCount > 0 && (
          <span className="flex items-center gap-1.5 text-sm text-danger">
            <AlertCircle size={14} />
            {errorCount} failed
          </span>
        )}
        {activeCount === 0 && doneCount === 0 && errorCount === 0 && (
          <span className="text-sm text-text-muted">Nothing running</span>
        )}

        <div className="ml-auto flex gap-1">
          {doneCount + errorCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearDone} className="text-text-muted">
              <Trash2 size={13} />
              Clear finished
            </Button>
          )}
        </div>
      </div>

      {/* Surfaced above the list: a partially-successful conversion otherwise
          reads as a clean success while quietly missing tracks. */}
      <UnmatchedReports />

      {/* Only worth showing once there is enough to sift through. */}
      {downloads.length + history.length > 3 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="scroll-row flex gap-1 rounded-sm border border-border bg-secondary-bg p-1">
            {FILTERS.map((f) => {
              const count =
                f.id === 'all'
                  ? downloads.length
                  : f.id === 'active'
                    ? activeCount
                    : f.id === 'done'
                      ? doneCount
                      : errorCount;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={cn(
                    'min-h-9 shrink-0 rounded-xs px-3 text-xs font-medium transition-colors',
                    filter === f.id
                      ? 'bg-card-bg text-text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {f.label}
                  {count > 0 && <span className="ml-1.5 tabular-nums opacity-60">{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by title or artist…"
              aria-label="Filter downloads"
              className="h-10 pl-9"
            />
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="space-y-3">
          {visible.map((d) => (
            <DownloadCard key={d.itemId} d={d} onClear={() => clear(d.itemId)} />
          ))}
        </div>
      )}

      {downloads.length > 0 && visible.length === 0 && (
        <p className="py-10 text-center text-sm text-text-muted">Nothing matches this filter.</p>
      )}

      {/* History survives a reload and stays visible alongside active work,
          rather than appearing only when the list happens to be empty. */}
      {visibleHistory.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-secondary">Completed earlier</h2>
            <Button variant="ghost" size="sm" onClick={clearHistory} className="text-text-muted">
              Clear history
            </Button>
          </div>

          <div className="space-y-2">
            {visibleHistory.slice(0, 30).map((h) => (
              <div
                key={`${h.id}-${h.completedAt}`}
                className="rows-track flex items-center gap-3 rounded-md border border-border bg-card-bg px-3 py-2.5"
              >
                {h.cover ? (
                  <img src={h.cover} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-xs object-cover" />
                ) : (
                  <CheckCircle2 size={16} className="shrink-0 text-success" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{h.title}</p>
                  <p className="truncate text-xs text-text-muted">
                    {h.artist ? `${h.artist} · ` : ''}
                    {h.count} track{h.count > 1 ? 's' : ''}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-text-muted">
                  {new Date(h.completedAt).toLocaleDateString(undefined, {month: 'short', day: 'numeric'})}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
