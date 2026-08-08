import {Download, CheckCircle2, AlertCircle, Loader2, X, Trash2, Music2} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {Progress} from '@/shared/components/ui/Progress';
import {useDownloadStore, type ActiveDownload} from '@/store/download-store';

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
        <div className="shrink-0 relative h-12 w-12 rounded-xl overflow-hidden bg-surface-bg">
          {d.cover ? (
            <img src={d.cover} alt={d.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music2 size={20} className="text-text-muted" />
            </div>
          )}
          {isActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 size={16} className="animate-spin text-white" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-text-primary truncate">{d.title}</p>
          </div>
          {d.artist && <p className="text-xs text-text-muted truncate">{d.artist}</p>}

          {/* Progress */}
          {isActive && (
            <div className="mt-2 space-y-1.5">
              <Progress value={d.percentage} className="h-1.5" />
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-muted truncate max-w-[70%]">{d.currentTrack ?? cfg.label}</p>
                <div className="flex items-center gap-2 shrink-0">
                  {d.total > 1 && (
                    <span className="text-xs text-text-muted">
                      {d.current}/{d.total}
                    </span>
                  )}
                  <span className={cn('text-xs font-medium tabular-nums', cfg.color)}>{d.percentage}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {d.status === 'error' && d.error && <p className="mt-1 text-xs text-danger truncate">{d.error}</p>}

          {/* Done */}
          {d.status === 'done' && (
            <p className="mt-1 text-xs text-success">
              {d.total > 1 ? `${d.total} tracks downloaded` : 'Download complete'}
            </p>
          )}
        </div>

        {/* Status + close */}
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          <div className={cn('flex items-center gap-1 text-xs font-medium', cfg.color)}>
            <Icon size={14} className={cfg.spin ? 'animate-spin' : ''} />
            {!isActive && <span>{cfg.label}</span>}
          </div>
          {!isActive && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClear}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-danger"
            >
              <X size={13} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DownloadsPage() {
  const {active, history, clear, clearDone} = useDownloadStore();

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
