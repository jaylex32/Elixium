/**
 * Re-export of the shared lyrics provider.
 *
 * The implementation lives in src/lib so the download pipeline can use it too
 * without reaching into the web-API layer.
 */
export {parseLrc, fetchLrclib, type SyncedLine, type LyricsResult, type LyricsQuery} from '../../lib/lyrics-provider';
