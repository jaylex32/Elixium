/*
 * Cancelling a download.
 *
 * The button had always sent `cancelDownload`, and the handler had always
 * looked the job up — in a map that downloads started from a button were never
 * added to. Pressing cancel four seconds into a fourteen-track album left it
 * downloading all fourteen, with no acknowledgement of any kind. Verified
 * against the live service before and after: it now stops, and the partial
 * files it was writing are gone.
 */
import test from 'ava';
import {mkdtempSync, writeFileSync, existsSync, rmSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {
  beginJob,
  endJob,
  getJob,
  cancelJob,
  pauseJob,
  resumableRequest,
  discardPartials,
} from '../src/app/download-cancellation';

test.serial('a running job can be found and cancelled', (t) => {
  const job = beginJob('job-1');
  t.false(job.cancelled);

  t.true(cancelJob('job-1'), 'the job was found');
  t.true(getJob('job-1')?.cancelled, 'and marked');

  endJob('job-1');
  t.is(getJob('job-1'), undefined);
});

test.serial('cancelling something that is not running says so', (t) => {
  /* This is the case that used to pass silently, leaving the row at
     "downloading" while the files kept arriving. */
  t.false(cancelJob('never-started'));
});

test.serial('cancelling stops the transfer in flight', (t) => {
  const job = beginJob('job-2');
  let aborted = false;
  job.abort = () => {
    aborted = true;
  };

  cancelJob('job-2');
  t.true(aborted, 'the current track is stopped, not just the ones after it');
  endJob('job-2');
});

test.serial('a transfer that already ended does not break the cancel', (t) => {
  const job = beginJob('job-3');
  job.abort = () => {
    throw new Error('already closed');
  };

  t.true(cancelJob('job-3'), 'still reports the job as cancelled');
  t.true(getJob('job-3')?.cancelled);
  endJob('job-3');
});

test.serial('cancelling removes the half-finished files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'elixium-cancel-'));
  const partial = join(dir, 'elixium_3_123_abc');
  const other = join(dir, 'elixium_3_456_def');
  writeFileSync(partial, 'half a track');
  writeFileSync(other, 'half another');

  const job = beginJob('job-4');
  job.partials.add(partial);
  job.partials.add(other);

  t.is(discardPartials(job), 2);
  t.false(existsSync(partial), 'a partial file is not playable and is not kept');
  t.false(existsSync(other));
  t.is(job.partials.size, 0);

  endJob('job-4');
  rmSync(dir, {recursive: true, force: true});
});

test.serial('a partial that is already gone is not an error', (t) => {
  const job = beginJob('job-5');
  job.partials.add(join(tmpdir(), 'elixium-does-not-exist-' + Date.now()));

  t.is(discardPartials(job), 0, 'nothing removed, nothing thrown');
  endJob('job-5');
});

test.serial('starting a job twice under one id does not keep the old one', (t) => {
  const first = beginJob('job-6');
  first.cancelled = true;

  const second = beginJob('job-6');
  t.false(second.cancelled, 'a fresh job is not born cancelled');
  endJob('job-6');
});

/*
 * Pausing.
 *
 * The same abort as a cancel, differing in one respect: the half-finished
 * files are kept, because resuming continues them from the byte they reached.
 * Verified against the live service — a pause 400ms into a 25MB FLAC leaves
 * the part-file on disk, and a cancel at the same moment removes it.
 */

test.serial('pausing stops the transfer without discarding anything', (t) => {
  const job = beginJob('pause-1', {url: 'https://example/album'});
  let aborted = false;
  job.abort = () => {
    aborted = true;
  };
  job.partials.add('some-half-written-file');

  t.true(pauseJob('pause-1'));
  t.true(aborted, 'the transfer in flight is stopped');
  t.true(getJob('pause-1')?.paused);
  t.is(getJob('pause-1')?.partials.size, 1, 'and what it had is kept');
  endJob('pause-1');
});

test.serial('a paused job remembers what it needs to start again', (t) => {
  const request = {url: 'https://example/album', itemId: 'pause-2'};
  beginJob('pause-2', request);

  t.is(resumableRequest('pause-2'), null, 'nothing to resume while it is running');
  pauseJob('pause-2');
  t.is(resumableRequest('pause-2'), request, 'the original request, replayed as-is');
  endJob('pause-2');
});

test.serial('resuming under the same id keeps the request', (t) => {
  const request = {url: 'https://example/album'};
  beginJob('pause-3', request);
  pauseJob('pause-3');

  /* The resumed run registers again; it must not lose what it was started
     with, or a second pause would have nothing to resume from. */
  const resumed = beginJob('pause-3');
  t.false(resumed.paused, 'running again, not still paused');
  t.is(resumed.request, request);
  endJob('pause-3');
});

test.serial('a cancelled job cannot then be paused', (t) => {
  beginJob('pause-4', {url: 'x'});
  cancelJob('pause-4');
  t.false(pauseJob('pause-4'), 'cancelling is final');
  endJob('pause-4');
});

test.serial('nothing to pause is reported rather than passed over', (t) => {
  t.false(pauseJob('never-existed'));
  t.is(resumableRequest('never-existed'), null);
});
