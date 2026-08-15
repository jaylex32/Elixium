import {useEffect, useRef, useState} from 'react';
import {ScrollText, Trash2, Pause, Play, Search} from 'lucide-react';
import {useQueryClient} from '@tanstack/react-query';
import {useLogBacklog, useClearLogs, type LogEntry} from '@/shared/lib/api';
import {getSocket} from '@/shared/lib/socket';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';
import {EmptyState} from '@/shared/components/States';

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  info: 'text-text-secondary',
  warn: 'text-warning',
  error: 'text-danger',
};

const LEVEL_LABEL: Record<LogEntry['level'], string> = {info: 'INFO', warn: 'WARN', error: 'ERR '};

/** Cap the rendered list; the server keeps its own ring buffer at 500. */
const MAX_RENDERED = 500;

/**
 * What the engine is doing, as it does it.
 *
 * Everything here already goes to stdout, which nobody sees when Elixium runs
 * as a desktop app or on another machine — the usual case. Diagnosing a stalled
 * download previously meant finding engine.log on the host.
 */
export function LogsPage() {
  const queryClient = useQueryClient();
  const {data: backlog = []} = useLogBacklog();
  const clearLogs = useClearLogs();

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Seed from the backlog once it arrives, keeping anything the socket
  // delivered first — the connection can beat the HTTP response.
  useEffect(() => {
    if (backlog.length === 0) return;
    setEntries((current) => {
      const seen = new Set(current.map((e) => e.seq));
      return [...backlog.filter((e) => !seen.has(e.seq)), ...current].sort((a, b) => a.seq - b.seq);
    });
  }, [backlog]);

  useEffect(() => {
    const socket = getSocket();
    const onLine = (entry: LogEntry) => {
      // Paused stops the view updating, not the server logging; resuming
      // refetches so nothing is silently missing from the middle.
      if (paused) return;
      setEntries((current) => {
        if (current.some((e) => e.seq === entry.seq)) return current;
        const next = [...current, entry];
        return next.length > MAX_RENDERED ? next.slice(-MAX_RENDERED) : next;
      });
    };

    socket.on('logLine', onLine);
    return () => {
      socket.off('logLine', onLine);
    };
  }, [paused]);

  const visible = entries.filter((entry) => !filter.trim() || entry.message.toLowerCase().includes(filter.toLowerCase()));

  // Follow the tail unless the user paused or is filtering, when jumping to
  // the bottom would fight what they are reading.
  useEffect(() => {
    if (paused || filter.trim()) return;
    bottomRef.current?.scrollIntoView({block: 'end'});
  }, [visible.length, paused, filter]);

  return (
    <div className="mx-auto flex h-full max-w-content animate-fade-in flex-col px-4 pb-8 pt-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-lg font-bold text-text-primary">
          <ScrollText size={18} className="text-accent" />
          Logs
        </h1>
        <span className="text-xs text-text-muted">{entries.length} lines</span>

        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter lines…"
            aria-label="Filter log lines"
            className="h-9 pl-9"
          />
        </div>

        <Button variant="secondary" size="sm" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={13} /> : <Pause size={13} />}
          {paused ? 'Resume' : 'Pause'}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="text-text-muted"
          onClick={() =>
            clearLogs.mutate(undefined, {
              onSuccess: () => {
                setEntries([]);
                queryClient.invalidateQueries({queryKey: ['logs']});
              },
            })
          }
        >
          <Trash2 size={13} />
          Clear
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={filter.trim() ? 'No lines match that filter' : 'Nothing logged yet'}
          hint={filter.trim() ? undefined : 'Activity appears here as the engine works.'}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-secondary-bg p-3">
          {/* Monospace and pre-wrap: these are terminal lines, and tables and
              paths in them only line up in a fixed-width font. */}
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
            {visible.map((entry) => (
              <div key={entry.seq} className="flex gap-2 py-px">
                <span className="shrink-0 select-none text-text-muted/70">
                  {new Date(entry.at).toLocaleTimeString([], {hour12: false})}
                </span>
                <span className={cn('shrink-0 select-none font-semibold', LEVEL_STYLE[entry.level])}>
                  {LEVEL_LABEL[entry.level]}
                </span>
                <span className={LEVEL_STYLE[entry.level]}>{entry.message}</span>
              </div>
            ))}
          </pre>
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
