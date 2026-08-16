import {useEffect, useRef} from 'react';
import {motion, AnimatePresence} from 'framer-motion';
import {X, Music2, Trash2, ChevronUp, ChevronDown, ListMusic, Play, Pause, Download} from 'lucide-react';
import {cn, formatDuration} from '@/shared/lib/utils';
import {usePlayerStore} from '@/store/player-store';
import {Button} from '@/shared/components/ui/Button';
import {useDownload} from '@/shared/hooks/useDownload';
import {toast} from 'sonner';

interface QueuePanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The play queue.
 *
 * Renders as a bottom sheet on phones and a right-hand panel from lg up. Rows
 * move with explicit up/down buttons rather than drag-and-drop: dragging
 * inside an already-scrolling sheet on touch is ambiguous, and buttons stay
 * operable by keyboard and screen reader.
 */
export function QueuePanel({open, onClose}: QueuePanelProps) {
  const {download} = useDownload();

  /* The queue is a list someone has already curated by hand, so grabbing the
     whole thing is the action most likely to be wanted here. */
  const downloadQueue = () => {
    for (const track of queue) {
      download({
        id: track.id,
        type: 'track',
        title: track.title,
        artist: track.artist,
        cover: track.cover,
        service: track.service,
      });
    }
    toast.success(`Queued ${queue.length} track${queue.length === 1 ? '' : 's'} for download`);
  };

  const {queue, queueIndex, currentTrack, isPlaying, playAt, removeFromQueue, moveInQueue, clearQueue, pause, resume} =
    usePlayerStore();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const previousOverflow = document.body.style.overflow;
    window.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  const upcoming = queue.length - queueIndex - 1;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            transition={{duration: 0.18}}
            onClick={onClose}
            className="fixed inset-0 z-overlay bg-black/60 backdrop-blur-sm"
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Play queue"
            initial={{y: '100%'}}
            animate={{y: 0}}
            exit={{y: '100%'}}
            transition={{type: 'spring', stiffness: 360, damping: 38}}
            className="fixed inset-x-0 bottom-0 z-modal flex max-h-[85dvh] flex-col rounded-t-xl border border-border bg-card-bg pb-safe shadow-xl
                       lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:w-[400px] lg:rounded-none lg:rounded-l-xl lg:pb-0"
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border lg:hidden" aria-hidden />

            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
              <div className="flex min-w-0 items-center gap-2">
                <ListMusic size={17} className="shrink-0 text-accent" />
                <h2 className="truncate text-sm font-semibold text-text-primary">Queue</h2>
                <span className="shrink-0 text-xs text-text-muted">
                  {upcoming > 0 ? `${upcoming} up next` : 'end of queue'}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {queue.length > 0 && (
                  <>
                  <Button variant="ghost" size="sm" onClick={downloadQueue} className="text-text-secondary">
                    <Download size={13} />
                    Download all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={clearQueue} className="text-text-muted">
                    Clear
                  </Button>
                  </>
                )}
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close queue">
                  <X size={17} />
                </Button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-20 text-center text-text-muted">
                  <ListMusic size={40} className="opacity-30" />
                  <p className="mt-4 font-medium text-text-secondary">Queue is empty</p>
                  <p className="mt-1 text-sm">Play an album or playlist to fill it.</p>
                </div>
              ) : (
                <ol>
                  {queue.map((track, index) => {
                    const isCurrent = index === queueIndex;
                    const isPast = index < queueIndex;

                    return (
                      <li
                        key={`${track.id}-${index}`}
                        className={cn(
                          'rows-queue group flex items-center gap-2 px-3 py-2 transition-colors hover:bg-surface-bg',
                          isCurrent && 'bg-accent/10',
                          isPast && 'opacity-45',
                        )}
                      >
                        <button
                          onClick={() => {
                            if (isCurrent) {
                              if (isPlaying) pause();
                              else resume();
                            } else {
                              playAt(index);
                            }
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          aria-label={isCurrent ? (isPlaying ? 'Pause' : 'Resume') : `Play ${track.title}`}
                        >
                          <span className="relative h-10 w-10 shrink-0">
                            {track.cover ? (
                              <img src={track.cover} alt="" loading="lazy" className="h-10 w-10 rounded-xs object-cover" />
                            ) : (
                              <span className="flex h-10 w-10 items-center justify-center rounded-xs bg-surface-bg">
                                <Music2 size={15} className="text-text-muted" />
                              </span>
                            )}
                            {isCurrent && (
                              <span className="absolute inset-0 flex items-center justify-center rounded-xs bg-black/50">
                                {isPlaying ? (
                                  <Pause size={13} className="text-white" />
                                ) : (
                                  <Play size={13} className="text-white" />
                                )}
                              </span>
                            )}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                'block truncate text-sm font-medium',
                                isCurrent ? 'text-accent' : 'text-text-primary',
                              )}
                            >
                              {track.title}
                            </span>
                            <span className="block truncate text-xs text-text-muted">{track.artist}</span>
                          </span>

                          {track.duration ? (
                            <span className="shrink-0 text-xs tabular-nums text-text-muted">
                              {formatDuration(track.duration)}
                            </span>
                          ) : null}
                        </button>

                        {/* Reorder + remove. Always visible on touch, revealed on
                            hover with a pointer, since there is no hover on a phone. */}
                        <span className="flex shrink-0 items-center gap-0.5 lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Download ${track.title}`}
                            title="Download this track"
                            onClick={() =>
                              download({
                                id: track.id,
                                type: 'track',
                                title: track.title,
                                artist: track.artist,
                                cover: track.cover,
                                service: track.service,
                              })
                            }
                          >
                            <Download size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move up"
                            disabled={index === 0}
                            onClick={() => moveInQueue(index, index - 1)}
                          >
                            <ChevronUp size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Move down"
                            disabled={index === queue.length - 1}
                            onClick={() => moveInQueue(index, index + 1)}
                          >
                            <ChevronDown size={15} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${track.title} from queue`}
                            className="text-text-muted hover:text-danger"
                            onClick={() => removeFromQueue(index)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>

            {currentTrack && (
              <footer className="shrink-0 border-t border-border px-4 py-2.5 text-xs text-text-muted">
                Playing {queueIndex + 1} of {queue.length}
              </footer>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
