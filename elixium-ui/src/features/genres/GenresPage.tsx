import { useState } from 'react'
import { Music2 } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useSearchPages, useCharts } from '@/shared/lib/api'
import { InfiniteSentinel } from '@/shared/components/InfiniteSentinel'
import { extractCover } from '@/shared/lib/cover'
import { isExplicit } from '@/shared/lib/explicit'
import { useAppStore } from '@/store/app-store'
import { useDownload } from '@/shared/hooks/useDownload'
import { AlbumCard, type AlbumCardData } from '@/shared/components/AlbumCard'
import { AlbumModal } from '@/shared/components/AlbumModal'
import { CardSkeleton } from '@/shared/components/ui/Skeleton'
import type { Service } from '@/types'

/*
 * Deezer genre ids, not search terms.
 *
 * These rows used to run a text search for the genre name, so "Pop" returned
 * every album *called* Pop — U2, Queen, a Katzenjammer record — rather than
 * pop music. Deezer's chart endpoint takes a genre id and returns the actual
 * genre chart.
 */
const GENRES = [
  { id: 'pop',        label: 'Pop',         color: '#e879f9', icon: '🎵', query: 'pop'          , deezerGenreId: '132' },
  { id: 'rock',       label: 'Rock',         color: '#fb923c', icon: '🎸', query: 'rock'         , deezerGenreId: '152' },
  { id: 'hiphop',     label: 'Hip-Hop',      color: '#facc15', icon: '🎤', query: 'hip hop'      , deezerGenreId: '116' },
  { id: 'electronic', label: 'Electronic',   color: '#38bdf8', icon: '🎛️', query: 'electronic'   , deezerGenreId: '106' },
  { id: 'jazz',       label: 'Jazz',         color: '#4ade80', icon: '🎷', query: 'jazz'         , deezerGenreId: '129' },
  { id: 'classical',  label: 'Classical',    color: '#c084fc', icon: '🎻', query: 'classical'    , deezerGenreId: '98' },
  { id: 'rnb',        label: 'R&B / Soul',   color: '#f87171', icon: '🎶', query: 'r&b soul'     , deezerGenreId: '165' },
  { id: 'country',    label: 'Country',      color: '#fbbf24', icon: '🤠', query: 'country'      , deezerGenreId: '84' },
  { id: 'latin',      label: 'Latin',        color: '#34d399', icon: '💃', query: 'latin'        , deezerGenreId: '197' },
  { id: 'metal',      label: 'Metal',        color: '#94a3b8', icon: '🤘', query: 'metal'        , deezerGenreId: '464' },
  { id: 'blues',      label: 'Blues',        color: '#60a5fa', icon: '🎹', query: 'blues'        , deezerGenreId: '153' },
  { id: 'folk',       label: 'Folk',         color: '#a3e635', icon: '🪕', query: 'folk acoustic' , deezerGenreId: '466' },
]

function GenreResults({
  genre,
  service,
}: {
  genre: (typeof GENRES)[number]
  service: Service
}) {
  /*
   * Deezer has a real genre chart; Qobuz exposes none, so it keeps the name
   * search. Only one of these can be right, and treating a genre as a search
   * term is what produced a "Pop" row full of albums *titled* Pop.
   */
  const useChart = service === 'deezer' && Boolean(genre.deezerGenreId)

  const chart = useCharts(service, genre.deezerGenreId ?? '0', 'albums')
  const search = useSearchPages(genre.query, service, 'album')
  const source = useChart ? chart : search

  const {isLoading, fetchNextPage, hasNextPage, isFetchingNextPage} = source
  const data = source.data?.pages.flat() ?? []
  const { download } = useDownload()
  const [selectedAlbum, setSelectedAlbum] = useState<(AlbumCardData & { service: Service }) | null>(null)

  return (
    <div className="mt-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{genre.icon}</span>
        <h3 className="font-semibold text-text-primary">{genre.label} · Top Albums</h3>
        <span className="text-xs text-text-muted ml-1 capitalize">{service}</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : data.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-text-muted gap-2">
          <Music2 size={24} className="opacity-40" />
          <span className="text-sm">No results — check credentials in Settings</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {data.map((r) => {
            const album: AlbumCardData = {
              id: r.id,
              title: r.title,
              artist: r.artist,
              cover: extractCover(r.rawData, service),
              year: r.year ?? undefined,
              type: r.type,
              explicit: isExplicit(r.rawData),
            }
            return (
              <AlbumCard
                key={r.id}
                album={album}
                onClick={() => setSelectedAlbum({ ...album, service })}
                selectable={{ id: r.id, type: 'album', service, title: r.title, artist: r.artist, cover: album.cover }}
                onDownload={() =>
                  download({ id: r.id, type: 'album', title: r.title, artist: r.artist, cover: album.cover, service })
                }
              />
            )
          })}
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <InfiniteSentinel
          hasMore={Boolean(hasNextPage)}
          loading={isFetchingNextPage}
          onLoadMore={fetchNextPage}
        />
      )}

      {selectedAlbum && (
        <AlbumModal album={selectedAlbum} open onClose={() => setSelectedAlbum(null)} />
      )}
    </div>
  )
}

export function GenresPage() {
  const [selected, setSelected] = useState<string | null>(null)
  const { service } = useAppStore()
  const selectedGenre = GENRES.find((g) => g.id === selected)

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <p className="text-sm text-text-muted">Browse music by genre — click a category to explore</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {GENRES.map((genre) => {
          const isSelected = selected === genre.id
          return (
            <button
              key={genre.id}
              onClick={() => setSelected(isSelected ? null : genre.id)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-2 rounded-2xl p-5 aspect-square',
                'border transition-all duration-200 hover:scale-105 active:scale-95 overflow-hidden',
                isSelected ? 'border-white/30 scale-[1.03]' : 'border-transparent hover:border-white/10',
              )}
              style={{
                background: `linear-gradient(135deg, ${genre.color}33 0%, ${genre.color}11 100%)`,
                boxShadow: isSelected ? `0 0 28px ${genre.color}50, 0 0 0 2px ${genre.color}40` : undefined,
              }}
            >
              <span
                className="absolute inset-0 rounded-2xl opacity-10 transition-opacity"
                style={{ background: genre.color, opacity: isSelected ? 0.25 : 0.1 }}
              />
              <span className="relative text-3xl select-none">{genre.icon}</span>
              <span
                className="relative text-xs font-bold tracking-wide uppercase"
                style={{ color: genre.color }}
              >
                {genre.label}
              </span>
            </button>
          )
        })}
      </div>

      {selectedGenre && (
        <GenreResults key={`${selectedGenre.id}-${service}`} genre={selectedGenre} service={service} />
      )}
    </div>
  )
}
