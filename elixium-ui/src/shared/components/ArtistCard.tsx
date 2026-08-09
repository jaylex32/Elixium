import {useState} from 'react';
import {User} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {ArtistModal} from './ArtistModal';
import type {Artist} from '@/types';

interface ArtistCardProps {
  artist: Artist;
  className?: string;
}

export function ArtistCard({artist, className}: ArtistCardProps) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={cn(
          'group flex flex-col items-center gap-3 rounded-2xl p-4 border border-border bg-card-bg',
          'hover:border-accent/40 hover:bg-surface-bg transition-all duration-200 text-left w-full',
          className,
        )}
      >
        <div className="relative">
          <div className="h-20 w-20 rounded-full overflow-hidden bg-surface-bg shrink-0">
            {artist.picture ? (
              <img
                src={artist.picture}
                alt={artist.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User size={28} className="text-text-muted" />
              </div>
            )}
          </div>
        </div>
        <div className="text-center min-w-0 w-full">
          <p className="text-sm font-semibold text-text-primary truncate">{artist.name}</p>
          {artist.fans != null && <p className="text-xs text-text-muted mt-0.5">{artist.fans.toLocaleString()} fans</p>}
        </div>
      </button>

      <ArtistModal artist={artist} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
