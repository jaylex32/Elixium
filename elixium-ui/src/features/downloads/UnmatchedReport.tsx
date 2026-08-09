import {useState} from 'react';
import {SearchX, ChevronDown, ChevronRight, Search, Copy, X} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {useDownloadStore, type ConversionReport} from '@/store/download-store';
import {useAppStore} from '@/store/app-store';
import {Button} from '@/shared/components/ui/Button';

/**
 * Tracks a cross-service conversion could not match.
 *
 * These were counted server-side and mentioned only as a total ("12 not
 * found") inside a progress string, so a playlist arrived short with no way to
 * tell which tracks were missing. Each one now carries its title, artist, ISRC
 * and the reason the match failed.
 */
function ReportBlock({report, onDismiss}: {report: ConversionReport; onDismiss: () => void}) {
  const [open, setOpen] = useState(false);
  const setPage = useAppStore((s) => s.setPage);

  const copyList = async () => {
    const text = report.unmatched
      .map((t) => `${t.artist} — ${t.title}${t.isrc ? ` (ISRC ${t.isrc})` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${report.unmatched.length} tracks`);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  const total = report.matched + report.unmatched.length;

  return (
    <div className="overflow-hidden rounded-md border border-warning/30 bg-warning/6">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-warning/8"
      >
        <SearchX size={17} className="shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary">
            {report.unmatched.length} of {total} tracks had no match
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {report.matched} downloaded · {new Date(report.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
          </p>
        </div>
        {open ? (
          <ChevronDown size={15} className="shrink-0 text-text-muted" />
        ) : (
          <ChevronRight size={15} className="shrink-0 text-text-muted" />
        )}
      </button>

      {open && (
        <div className="border-t border-warning/20">
          <ul className="max-h-72 overflow-y-auto">
            {report.unmatched.map((track, index) => (
              <li
                key={`${track.title}-${index}`}
                className="rows-track flex items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{track.title}</p>
                  <p className="truncate text-xs text-text-muted">
                    {track.artist}
                    {track.album ? ` · ${track.album}` : ''}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-warning">{track.reason}</p>
                </div>

                {/*
                  Re-running the same automatic match would fail the same way,
                  so the useful action is a manual search with the track's
                  details already filled in.
                */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Search for ${track.title}`}
                  title="Search manually"
                  onClick={() => {
                    useAppStore.setState({pendingSearch: `${track.artist} ${track.title}`.trim()});
                    setPage('search');
                  }}
                  className="shrink-0"
                >
                  <Search size={14} />
                </Button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2 border-t border-warning/20 p-3">
            <Button variant="secondary" size="sm" onClick={copyList}>
              <Copy size={13} />
              Copy list
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismiss} className="text-text-muted">
              <X size={13} />
              Dismiss
            </Button>
            <p className="ml-auto text-[11px] text-text-muted">
              Usually the track is absent from the target service, or released under a different title.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function UnmatchedReports({className}: {className?: string}) {
  const reports = useDownloadStore((s) => s.reports);
  const dismissReport = useDownloadStore((s) => s.dismissReport);

  if (reports.length === 0) return null;

  return (
    <section className={cn('space-y-2', className)}>
      {reports.map((report) => (
        <ReportBlock key={report.itemId} report={report} onDismiss={() => dismissReport(report.itemId)} />
      ))}
    </section>
  );
}
