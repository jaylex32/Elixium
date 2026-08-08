import {Download, CheckCircle2, AlertCircle, Loader2, X, Trash2, Music2, Ban} from 'lucide-react';
import {socketSend} from '@/shared/lib/socket-client';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {Progress} from '@/shared/components/ui/Progress';
import {useDownloadStore, type ActiveDownload} from '@/store/download-store';
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

export function DownloadsPage() {
  const {active, history, clear, clearDone} = useDownloadStore();
  const isRunning = useDownloadStore((s) => s.isRunning);
  useElapsedTick(isRunning);

  const downloads = Object.values(active).sort((a, b) => {
    const order = {downloading: 0, converting: 1, starting: 2, error: 3, done: 4};
    return (order[a.status] ?? 5) - (order[b.status] ?? 5) || b.startedAt - a.startedAt;
  });

  const doneCount = downloads.filter((d) => d.status === 'done').length;
  const errorCount = downloads.filter((d) => d.status === 'error').length;
  const activeCount = downloads.filter((d) => d.status !== 'done' && d.status !== 'error').length;

  if (downloads.length === 0 && history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-96 text-text-muted">
        <Download size={48} className="mb-4 opacity-30" />
        <p className="text-text-secondary font-semibold text-lg">No downloads yet</p>
        <p className="text-sm mt-1">Search for music or paste a URL to start downloading</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl animate-fade-in space-y-5 p-4 sm:space-y-6 sm:p-6">
      {/* Stats bar */}
      {downloads.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          {activeCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-accent font-medium">
              <Loader2 size={14} className="animate-spin" />
              {activeCount} downloading
            </div>
          )}
          {doneCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 size={14} />
              {doneCount} done
            </div>
          )}
          {errorCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-danger">
              <AlertCircle size={14} />
              {errorCount} failed
            </div>
          )}
          <div className="ml-auto flex gap-2">
            {doneCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearDone}>
                <Trash2 size={13} />
                Clear done
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Active downloads */}
      {downloads.length > 0 && (
        <div className="space-y-3">
          {downloads.map((d) => (
            <DownloadCard key={d.itemId} d={d} onClear={() => clear(d.itemId)} />
          ))}
        </div>
      )}

      {/* History */}
      {history.length > 0 && downloads.length === 0 && (
        <div>
          <p className="text-sm font-medium text-text-secondary mb-3">Recent downloads</p>
          <div className="space-y-2">
            {history.slice(0, 20).map((h) => (
              <div key={h.id} className="flex items-center gap-3 rounded-xl border border-border bg-card-bg px-4 py-3">
                <CheckCircle2 size={16} className="text-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{h.title}</p>
                  <p className="text-xs text-text-muted">
                    {h.count} track{h.count > 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-xs text-text-muted shrink-0">
                  {new Date(h.completedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
