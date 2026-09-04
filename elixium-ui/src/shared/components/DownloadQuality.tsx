import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {useState} from 'react';
import {Check, Download, ChevronDown} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useSettingsStore} from '@/store/settings-store';
import type {Service} from '@/types';
import {qualityChoicesFor, defaultQualityFor} from '@/shared/lib/download-quality';

/**
 * Choosing a quality for one download without changing the default.
 *
 * Wanting a lossless copy of a single album while the library stays at 320 is
 * an ordinary thing to want, and the alternative was a trip to Settings before
 * and after — easy to forget on the way back, which is how a library ends up
 * half one thing and half another.
 *
 * The affordance is deliberately quiet. A grid of album covers already carries
 * play, download and sometimes watch on its hover overlay; a fourth control
 * there would crowd the artwork it sits on. So the choice lives where per-item
 * choices already live — the overflow menu on a row, a right-click on a card,
 * a caret beside a labelled button in a header — and the plain click keeps
 * doing what it always did, at the configured quality, with no extra step.
 */

const itemClass =
  'flex cursor-pointer select-none items-center justify-between gap-3 rounded-xs px-2.5 py-2 text-sm text-text-secondary outline-none ' +
  'data-[highlighted]:bg-surface-bg data-[highlighted]:text-text-primary';

/**
 * The quality rows themselves, for embedding in a menu that already exists.
 *
 * Rendered as plain items rather than a submenu: a submenu adds a hover step
 * to a list that is only ever three or four lines long.
 */
export function DownloadQualityItems({
  service,
  onPick,
}: {
  service: Service;
  onPick: (quality: string) => void;
}) {
  const {settings} = useSettingsStore();
  const current = defaultQualityFor(service, settings);

  return (
    <>
      <DropdownMenu.Label className="px-2.5 pb-1 pt-2 text-[11px] uppercase tracking-wide text-text-muted">
        Download as
      </DropdownMenu.Label>
      {qualityChoicesFor(service).map((choice) => (
        <DropdownMenu.Item
          key={choice.value}
          className={itemClass}
          onSelect={(event) => {
            event.preventDefault();
            onPick(choice.value);
          }}
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-text-primary">{choice.label}</span>
            <span className="truncate text-[11px] text-text-muted">{choice.note}</span>
          </span>
          {/* The configured default is marked rather than hidden, so it is
              clear what a plain click would have done. */}
          {choice.value === current && <Check size={14} className="shrink-0 text-accent" />}
        </DropdownMenu.Item>
      ))}
    </>
  );
}

const contentClass =
  'z-modal min-w-[13rem] rounded-lg border border-border bg-card-bg p-1 shadow-xl animate-fade-in';

/**
 * Download, with the qualities behind a caret on its right edge.
 *
 * One control rather than two: a separate bordered square beside the button
 * read as a stray piece of furniture, because it did not belong to anything.
 * Joined to the button by a divider it reads as what it is — the same action,
 * with a choice attached.
 *
 * The left side keeps doing exactly what it did: one click, configured
 * quality, no menu.
 */
export function DownloadSplitButton({
  service,
  onDownload,
  label = 'Download',
  className,
}: {
  service: Service;
  onDownload: (quality?: string) => void;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-md bg-accent text-white shadow-sm',
        'transition-colors hover:bg-accent/90',
        className,
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDownload();
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
      >
        <Download size={14} />
        {label}
      </button>

      {/* The divider is what makes the two halves read as one control. */}
      <span aria-hidden className="my-1.5 w-px bg-white/25" />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Choose a download quality"
            title="Choose a download quality"
            onClick={(event) => event.stopPropagation()}
            className="flex items-center px-2 transition-colors hover:bg-black/10"
          >
            <ChevronDown size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={6} className={contentClass}>
            <DownloadQualityItems service={service} onPick={(quality) => onDownload(quality)} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </span>
  );
}

/**
 * Right-click anywhere on a card to choose a quality.
 *
 * A card's overlay is already full, and its artwork is the point of the grid —
 * so this adds nothing visible at all. The download button's tooltip is what
 * says the option exists; without that this would be a feature only its author
 * knows about.
 */
export function DownloadQualityContext({
  service,
  onPick,
  children,
  className,
}: {
  service: Service;
  onPick: (quality: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({x: 0, y: 0});

  return (
    <>
      {/*
        `contents` keeps this out of layout entirely.
        A card is often a grid cell or a fixed-width item in a scrolling row,
        and an ordinary wrapper would become that cell instead — taking the
        sizing with it and leaving the card to size itself to its contents.
        The element still exists, so it still receives the bubbled right-click.
      */}
      <div
        className={cn('contents', className)}
        onContextMenu={(event) => {
          event.preventDefault();
          setAt({x: event.clientX, y: event.clientY});
          setOpen(true);
        }}
      >
        {children}
      </div>

      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        {/* Anchored to the pointer: a menu opened by right-click belongs where
            the pointer is, not where some trigger happens to sit. */}
        <DropdownMenu.Trigger asChild>
          <span aria-hidden className="pointer-events-none fixed" style={{left: at.x, top: at.y}} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={2} className={contentClass}>
            <DownloadQualityItems service={service} onPick={onPick} />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
