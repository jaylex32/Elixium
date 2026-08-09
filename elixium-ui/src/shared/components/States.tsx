import type {ReactNode} from 'react';
import {AlertCircle, RotateCcw, SearchX} from 'lucide-react';
import {Button} from '@/shared/components/ui/Button';
import {CardSkeleton, TrackRowSkeleton} from '@/shared/components/ui/Skeleton';

/**
 * The three non-happy states every data view needs.
 *
 * These existed as bespoke markup in each page, so an empty Search looked
 * nothing like an empty Playlists and some views had no error state at all.
 * Centralizing them means a view declares which state it is in and gets a
 * consistent, accessible result.
 */

interface StateProps {
  title: string;
  hint?: string;
  icon?: ReactNode;
  action?: {label: string; onClick: () => void};
}

function StateShell({title, hint, icon, action, tone = 'muted'}: StateProps & {tone?: 'muted' | 'danger'}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      {icon && (
        <div
          className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${
            tone === 'danger' ? 'bg-danger/12 text-danger' : 'bg-surface-bg text-text-muted'
          }`}
        >
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-text-primary">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-text-muted">{hint}</p>}
      {action && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={action.onClick}>
          <RotateCcw size={14} />
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** Nothing to show, and that is expected. */
export function EmptyState(props: StateProps) {
  return <StateShell {...props} icon={props.icon ?? <SearchX size={24} />} />;
}

/** A request failed. Always offers a retry when the caller can provide one. */
export function ErrorState({
  title = 'Could not load this',
  hint = 'Check your service credentials in Settings, then try again.',
  onRetry,
}: {
  title?: string;
  hint?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert">
      <StateShell
        title={title}
        hint={hint}
        tone="danger"
        icon={<AlertCircle size={24} />}
        action={onRetry ? {label: 'Retry', onClick: onRetry} : undefined}
      />
    </div>
  );
}

/** Grid placeholder sized like the cards it replaces, so nothing jumps on load. */
export function GridSkeleton({count = 12}: {count?: number}) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({length: count}).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** List placeholder for track rows. */
export function ListSkeleton({count = 8}: {count?: number}) {
  return (
    <div className="space-y-1" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({length: count}).map((_, i) => (
        <TrackRowSkeleton key={i} />
      ))}
    </div>
  );
}
