import {existsSync, unlinkSync} from 'fs';

/**
 * Jobs that are running, so a cancel can reach them.
 *
 * The cancel button has always sent `cancelDownload`, and the handler has
 * always looked the job up — in a map that downloads started from a button
 * were never added to. So it found nothing and returned silently: pressing
 * cancel on a fourteen-track album left it downloading all fourteen, with no
 * acknowledgement of any kind.
 *
 * This is that missing registry, and nothing more. A job registers when it
 * starts and clears when it ends; a cancel marks it, and the download loop
 * checks the mark between tracks.
 */

export interface CancellableJob {
  /** Set by a cancel; the download loop stops when it sees this. */
  cancelled: boolean;
  /**
   * Set by a pause, which stops the same way a cancel does and differs in
   * exactly one respect: the half-finished files are kept.
   *
   * That is what makes resuming cheap. A track already written is skipped
   * because the file is there, and the one that was mid-transfer picks up from
   * the byte it reached, because the downloader asks for the rest of it.
   */
  paused: boolean;
  /**
   * What started this job, kept so it can be started again.
   *
   * Resuming is re-running the same request. Nothing needs to remember which
   * tracks were done — the ones on disk are skipped and the partial one
   * continues, so replaying the request finishes exactly what was left.
   */
  request?: unknown;
  /**
   * Aborts whatever transfer is in flight.
   *
   * Set by the downloader while a track is moving, cleared when it finishes,
   * so a cancel takes effect on the current track rather than only on the next
   * one. Absent when nothing is transferring.
   */
  abort?: () => void;
  /**
   * Half-finished files this job created, by absolute path.
   *
   * A cancelled download's partial files are of no use to anybody: they are
   * not playable, and the next attempt would resume into them. They are
   * removed when the job is cancelled — unlike a pause, which is the same
   * mechanism keeping them deliberately so the transfer can continue later.
   */
  partials: Set<string>;
}

const jobs = new Map<string, CancellableJob>();

/** Begin tracking a job, replacing any stale entry under the same id. */
export const beginJob = (id: string, request?: unknown): CancellableJob => {
  /* A job resumed under the same id keeps the request it was started with. */
  const previous = jobs.get(id);
  const job: CancellableJob = {
    cancelled: false,
    paused: false,
    partials: new Set(),
    request: request ?? previous?.request,
  };
  jobs.set(id, job);
  return job;
};

/** Stop tracking a job that has finished, cancelled or not. */
export const endJob = (id: string): void => {
  jobs.delete(id);
};

export const getJob = (id: string): CancellableJob | undefined => jobs.get(id);

/**
 * Mark a job cancelled and stop whatever it is doing.
 *
 * Returns whether a job was actually found, so the caller can tell the
 * difference between cancelling something and cancelling nothing — the case
 * that used to pass silently.
 */
export const cancelJob = (id: string): boolean => {
  const job = jobs.get(id);
  if (!job) return false;

  job.cancelled = true;
  try {
    job.abort?.();
  } catch {
    /* A transfer that has already ended cannot be aborted, which is fine. */
  }
  return true;
};

/**
 * Stop a job but keep what it has downloaded so far.
 *
 * The entry stays in the registry after this, unlike a cancel: it holds the
 * request needed to start again, and the partial files it deliberately kept.
 */
export const pauseJob = (id: string): boolean => {
  const job = jobs.get(id);
  if (!job || job.cancelled) return false;

  job.paused = true;
  try {
    job.abort?.();
  } catch {
    /* Already finished transferring; nothing to stop. */
  }
  return true;
};

/** What a paused job needs to start again, or nothing if it is not paused. */
export const resumableRequest = (id: string): unknown | null => {
  const job = jobs.get(id);
  return job && job.paused && job.request ? job.request : null;
};

/**
 * Remove the half-finished files a cancelled job left behind.
 *
 * Deliberately quiet about failures: a temp file that cannot be removed is
 * untidy, not a reason to report the cancel as unsuccessful.
 */
export const discardPartials = (job: CancellableJob): number => {
  let removed = 0;
  for (const file of job.partials) {
    try {
      if (existsSync(file)) {
        unlinkSync(file);
        removed += 1;
      }
    } catch {
      /* Locked or already gone; either way there is nothing to do about it. */
    }
  }
  job.partials.clear();
  return removed;
};
