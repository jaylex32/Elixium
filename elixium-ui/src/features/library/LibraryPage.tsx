import {useEffect, useMemo, useState} from 'react';
import {Library, Check, Download, ArrowUpCircle, Music2, ChevronDown, ChevronRight} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {apiFetch} from '@/shared/lib/auth-token';
import {useDownload} from '@/shared/hooks/useDownload';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';

type Tier = 'mp3' | 'lossless' | 'hires';

interface Release {
  id: string;
  title: string;
  year: number | null;
  image: string;
  releaseType: string;
  owned: boolean;
  quality: Tier | null;
  availableQuality: Tier;
  upgradable: boolean;
  reason: string;
}

interface ArtistSummary {
  artistId: string;
  name: string;
  image: string;
  total: number;
  owned: number;
  missing: number;
  upgradable: number;
  releases: Release[];
}

const TIER_LABEL: Record<Tier, string> = {mp3: 'MP3', lossless: 'FLAC 16', hires: 'FLAC 24'};

/** Filters are exclusive — "missing" and "owned" cannot both be meaningful. */
type Filter = 'all' | 'missing' | 'owned' | 'upgradable';

const FILTERS: Array<{id: Filter; label: string}> = [
  {id: 'all', label: 'All'},
  {id: 'missing', label: 'Missing'},
  {id: 'owned', label: 'Owned'},
  {id: 'upgradable', label: 'Upgradable'},
];

function ReleaseRow({release, artist, onDownload}: {release: Release; artist: string; onDownload: () => void}) {
  return (
    <li className="rows-track flex items-center gap-3 border-b border-border/50 px-4 py-2.5 last:border-b-0">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xs bg-surface-bg">
        {release.image ? (
          <img src={release.image} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Music2 size={14} className="text-text-muted" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary">{release.title}</p>
        <p className="truncate text-xs text-text-muted">
          {[release.year || null, release.releaseType].filter(Boolean).join(' · ')}
        </p>
      </div>

      {release.owned ? (
        <span
          className={cn(
            'shrink-0 rounded-xs px-2 py-0.5 text-[11px] font-medium',
            release.upgradable ? 'bg-warning/15 text-warning' : 'bg-success/15 text-success',
          )}
          title={release.upgradable ? `Held as ${TIER_LABEL[release.quality as Tier]}` : undefined}
        >
          {release.quality ? TIER_LABEL[release.quality] : 'Owned'}
        </span>
      ) : (
        <span className="shrink-0 rounded-xs bg-surface-bg px-2 py-0.5 text-[11px] text-text-muted">Missing</span>
      )}

      {(!release.owned || release.upgradable) && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${release.upgradable ? 'Upgrade' : 'Download'} ${release.title} by ${artist}`}
          title={release.upgradable ? 'Download a better version' : 'Download'}
          onClick={onDownload}
          className="shrink-0"
        >
          {release.upgradable ? <ArrowUpCircle size={14} /> : <Download size={14} />}
        </Button>
      )}
    </li>
  );
}

/**
 * The library seen against each watched artist's catalogue.
 *
 * The watchlist only answered "what is new since the last scan", so there was
 * no view of what an artist has released versus what is actually on disk —
 * the question Lidarr's main screen exists to answer.
 *
 * Ownership comes from the files, not from download history, so a release
 * copied in by hand counts and one whose files were deleted does not.
 */
export function LibraryPage() {
  const [artists, setArtists] = useState<ArtistSummary[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const {download} = useDownload();

  useEffect(() => {
    apiFetch('/api/v1/library')
      .then((r) => r.json())
      .then((b) => setArtists(b?.ok ? (b.data.artists ?? []) : []))
      .catch(() => setArtists([]));
  }, []);

  const visible = useMemo(() => {
    if (!artists) return [];
    const needle = query.trim().toLowerCase();
    return artists
      .filter((a) => !needle || a.name.toLowerCase().includes(needle))
      .filter((a) => (filter === 'missing' ? a.missing > 0 : filter === 'upgradable' ? a.upgradable > 0 : true));
  }, [artists, query, filter]);

  const totals = useMemo(() => {
    const source = artists ?? [];
    return source.reduce(
      (acc, a) => ({
        owned: acc.owned + a.owned,
        missing: acc.missing + a.missing,
        upgradable: acc.upgradable + a.upgradable,
      }),
      {owned: 0, missing: 0, upgradable: 0},
    );
  }, [artists]);

  const releasesFor = (artist: ArtistSummary) =>
    artist.releases.filter((r) =>
      filter === 'missing' ? !r.owned : filter === 'owned' ? r.owned : filter === 'upgradable' ? r.upgradable : true,
    );

  if (artists === null) {
    return <div className="p-6 text-sm text-text-muted">Loading library…</div>;
  }

  if (artists.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-border bg-card-bg p-10 text-center">
          <Library size={28} className="mx-auto mb-3 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">No watched artists yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-text-muted">
            Add artists to your watchlist and Elixium will track their catalogue here, showing what you have and what
            you are missing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold text-text-primary">
            <Library size={18} className="text-accent" />
            Library
          </h1>
          <p className="mt-0.5 text-xs text-text-muted">
            {totals.owned} owned · {totals.missing} missing
            {totals.upgradable > 0 && ` · ${totals.upgradable} below cutoff`}
          </p>
        </div>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter artists"
          className="w-full sm:w-56"
          aria-label="Filter artists"
        />
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-sm border border-border bg-secondary-bg p-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              'min-h-10 shrink-0 rounded-xs px-4 text-xs font-semibold transition-colors',
              filter === f.id ? 'bg-accent text-white' : 'text-text-muted hover:text-text-primary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {visible.map((artist) => {
          const open = expanded === artist.artistId;
          const releases = releasesFor(artist);
          return (
            <div key={artist.artistId} className="overflow-hidden rounded-md border border-border bg-card-bg">
              <button
                onClick={() => setExpanded(open ? null : artist.artistId)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-surface-bg"
              >
                <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-surface-bg">
                  {artist.image ? (
                    <img src={artist.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Music2 size={16} className="text-text-muted" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-primary">{artist.name}</p>
                  {/* total 0 means the artist has never been scanned, which is
                      different from owning none of a known catalogue. */}
                  <p className="mt-0.5 text-xs text-text-muted">
                    {artist.total === 0 ? (
                      <span className="text-warning">Not scanned yet — refresh this artist in Watchlist</span>
                    ) : (
                      <>
                        {artist.owned} of {artist.total} owned
                        {artist.upgradable > 0 && ` · ${artist.upgradable} upgradable`}
                      </>
                    )}
                  </p>
                </div>

                {/* Completion at a glance, without a second query. */}
                <div className="hidden w-28 shrink-0 sm:block">
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-bg">
                    <div
                      className="h-full rounded-full bg-success"
                      style={{width: `${artist.total ? (artist.owned / artist.total) * 100 : 0}%`}}
                    />
                  </div>
                </div>

                {open ? (
                  <ChevronDown size={15} className="shrink-0 text-text-muted" />
                ) : (
                  <ChevronRight size={15} className="shrink-0 text-text-muted" />
                )}
              </button>

              {open && (
                <div className="border-t border-border">
                  {releases.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-text-muted">
                      Nothing matches this filter for {artist.name}.
                    </p>
                  ) : (
                    <ul className="max-h-96 overflow-y-auto">
                      {releases.map((release) => (
                        <ReleaseRow
                          key={release.id}
                          release={release}
                          artist={artist.name}
                          onDownload={() =>
                            download({
                              id: release.id,
                              type: 'album',
                              title: release.title,
                              artist: artist.name,
                              cover: release.image,
                              service: 'qobuz',
                            })
                          }
                        />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {visible.length === 0 && (
          <div className="rounded-md border border-border bg-card-bg p-8 text-center">
            <Check size={20} className="mx-auto mb-2 text-text-muted" />
            <p className="text-sm text-text-secondary">No artists match this filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}
