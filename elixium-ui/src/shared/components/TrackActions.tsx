import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {MoreVertical, ListPlus, ListEnd, Download, Play} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {usePlayerStore} from '@/store/player-store';
import type {Track} from '@/types';

interface TrackActionsProps {
  track: Track;
  onDownload?: () => void;
  onPlay?: () => void;
  className?: string;
}

const itemClass =
  'flex cursor-pointer select-none items-center gap-2.5 rounded-xs px-2.5 py-2 text-sm text-text-secondary outline-none ' +
  'data-[highlighted]:bg-surface-bg data-[highlighted]:text-text-primary';

/**
 * Per-track overflow menu.
 *
 * The player store has supported playNext and addToQueue since the queue panel
 * landed, but nothing in the UI ever called them — so a user could only ever
 * replace the queue by playing something, never build one up. A menu keeps
 * these available without adding a third and fourth icon to every row.
 */
export function TrackActions({track, onDownload, onPlay, className}: TrackActionsProps) {
  const playNext = usePlayerStore((s) => s.playNext);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const queueLength = usePlayerStore((s) => s.queue.length);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={`More actions for ${track.title}`}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-text-muted transition-colors',
            'hover:bg-surface-bg hover:text-text-primary data-[state=open]:bg-surface-bg data-[state=open]:text-text-primary',
            'lg:h-7 lg:w-7',
            className,
          )}
        >
          <MoreVertical size={15} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          onClick={(e) => e.stopPropagation()}
          className="z-modal min-w-[190px] rounded-sm border border-border bg-card-bg p-1 shadow-lg animate-fade-in"
        >
          {onPlay && (
            <DropdownMenu.Item className={itemClass} onSelect={onPlay}>
              <Play size={14} />
              Play now
            </DropdownMenu.Item>
          )}

          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => {
              playNext(track);
              toast.success('Playing next', {description: track.title, duration: 1800});
            }}
          >
            <ListPlus size={14} />
            Play next
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => {
              addToQueue(track);
              toast.success('Added to queue', {
                description: `${track.title} · position ${queueLength + 1}`,
                duration: 1800,
              });
            }}
          >
            <ListEnd size={14} />
            Add to queue
          </DropdownMenu.Item>

          {onDownload && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item className={itemClass} onSelect={onDownload}>
                <Download size={14} />
                Download
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
