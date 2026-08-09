import {cn} from '@/shared/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({className}: SkeletonProps) {
  return <div className={cn('skeleton rounded-lg', className)} />;
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-square w-full rounded-xl" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function TrackRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-3 w-10" />
    </div>
  );
}
