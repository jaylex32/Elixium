import {useEffect, useState} from 'react';
import {Disc3, Disc, Radio, Mic, Layers, Check} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {useSocketEvent, socketSend} from '@/shared/lib/socket-client';

type ReleaseType = 'album' | 'ep' | 'single' | 'live' | 'compilation';

const TYPES: {id: ReleaseType; label: string; hint: string; icon: React.ElementType}[] = [
  {id: 'album', label: 'Albums', hint: 'Full-length releases', icon: Disc3},
  {id: 'ep', label: 'EPs', hint: 'Short releases, roughly 3–6 tracks', icon: Disc},
  {id: 'single', label: 'Singles', hint: 'One or two tracks', icon: Radio},
  {id: 'live', label: 'Live', hint: 'Concert and session recordings', icon: Mic},
  {id: 'compilation', label: 'Compilations', hint: 'Hits collections, various artists', icon: Layers},
];

/**
 * Which release kinds the watchlist collects — the equivalent of a Lidarr
 * metadata profile.
 *
 * Without it every single and compilation an artist appears on counts as a
 * wanted release, which buries the albums under noise.
 */
export function ReleaseTypeFilter() {
  const [selected, setSelected] = useState<ReleaseType[]>(['album', 'ep']);
  const [loaded, setLoaded] = useState(false);

  useSocketEvent<{types?: ReleaseType[]}>('releaseTypes', (data) => {
    if (Array.isArray(data?.types)) setSelected(data.types);
    setLoaded(true);
  });

  useEffect(() => {
    socketSend('getReleaseTypes');
  }, []);

  const toggle = (id: ReleaseType) => {
    // The server refuses an empty selection (it would silently collect
    // nothing); mirror that here so the UI never shows an impossible state.
    const next = selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id];
    if (next.length === 0) {
      toast.error('Keep at least one release type', {description: 'Otherwise scans would collect nothing.'});
      return;
    }
    setSelected(next);
    socketSend('saveReleaseTypes', {types: next});
  };

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-text-primary">Release types</h3>
        <p className="text-xs text-text-muted">
          Only these are collected by a scan. Everything else is still recorded, just never queued.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {TYPES.map(({id, label, hint, icon: Icon}) => {
          const on = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              disabled={!loaded}
              onClick={() => toggle(id)}
              className={cn(
                'group flex items-start gap-3 rounded-md border p-3 text-left transition-all duration-fast',
                on
                  ? 'border-accent/40 bg-accent/8'
                  : 'border-border bg-card-bg hover:border-accent/25 hover:bg-surface-bg',
                !loaded && 'opacity-50',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm transition-colors',
                  on ? 'bg-accent/15 text-accent' : 'bg-surface-bg text-text-muted',
                )}
              >
                <Icon size={15} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={cn('text-sm font-medium', on ? 'text-text-primary' : 'text-text-secondary')}>
                    {label}
                  </span>
                  {on && <Check size={13} className="text-accent" />}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-text-muted">
        Type is inferred from track count, duration and title — Qobuz publishes no release-type field, so an unusual
        release can be read as the wrong kind.
      </p>
    </section>
  );
}
