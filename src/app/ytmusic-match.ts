/**
 * Finding the same recording on Deezer or Qobuz that YouTube Music is showing.
 *
 * YouTube Music is the better place to *browse* — its catalogue and its
 * recommendations reach further than either lossless service — but it is the
 * worse place to download from: the audio is lossy Opus, and the tags are
 * whatever an uploader typed. Matching a YouTube result back to Deezer or
 * Qobuz gives the browse experience of one and the file quality of the other.
 *
 * The matching has to be conservative. A wrong match is worse than no match:
 * it puts a file in someone's library under a name that is not what they asked
 * for, and they will not find out until they play it. Everything here is built
 * so that "not sure" is an available answer.
 */
import type {SearchResult} from './interactive-types';

/** How confident the matcher is, and why. */
export interface MatchScore {
  /** 0..1 overall. */
  score: number;
  title: number;
  artist: number;
  /** 0..1, and null when neither side reported a duration. */
  duration: number | null;
}

export interface MatchCandidate {
  result: SearchResult;
  score: MatchScore;
}

export interface MatchOutcome {
  /** The chosen result, or null when nothing cleared the bar. */
  match: SearchResult | null;
  score: MatchScore | null;
  /** Everything considered, best first — useful when a user disagrees. */
  candidates: MatchCandidate[];
  reason: 'matched' | 'low-confidence' | 'no-results';
}

/**
 * Noise that appears on one side of a match and not the other.
 *
 * YouTube titles carry production notes that a catalogue never has, and
 * catalogues carry edition suffixes that YouTube never has. Both are removed
 * before comparison so that "Get Lucky (Official Audio)" and "Get Lucky
 * (2013 Remaster)" can be recognised as the same song.
 */
const NOISE_PATTERNS = [
  /\((?:official\s+)?(?:music\s+)?video\)/gi,
  /\(official\s+audio\)/gi,
  /\(audio\)/gi,
  /\(lyrics?(?:\s+video)?\)/gi,
  /\(visualiser\)|\(visualizer\)/gi,
  /\(\d{4}\s+remaster(?:ed)?\)/gi,
  /\(remaster(?:ed)?(?:\s+\d{4})?\)/gi,
  /\[[^\]]*\]/g,
  /\bhq\b|\bhd\b|\b4k\b/gi,
];

/**
 * Words that mean "a different recording of this song".
 *
 * Noise above is removed because it says nothing about identity. These are the
 * opposite: they are the whole difference between two things that otherwise
 * share a title. "Walk This Way" and "Walk This Way (Instrumental)" overlap on
 * every word, which scored high enough to be accepted — and an instrumental is
 * not the song anybody asked for.
 *
 * Compared as a set on both sides rather than searched for on one, so a live
 * track still matches a live track and a remix still matches the same remix.
 * Read from the raw title, before the bracket stripping above erases
 * "[Instrumental]" along with the rest of the brackets.
 */
const VERSION_TAGS: Array<[string, RegExp]> = [
  ['instrumental', /\binstrumentals?\b/],
  ['karaoke', /\bkaraoke\b/],
  ['acapella', /\ba[\s-]?cappella\b|\bacapella\b/],
  ['live', /\blive\b/],
  ['remix', /\bremix(?:es)?\b|\brmx\b/],
  ['cover', /\bcover(?:ed)?\s+(?:version|by)\b|\(\s*cover\s*\)/],
  ['sped', /\bsped[\s-]?up\b|\bspeed[\s-]?up\b/],
  ['slowed', /\bslowed\b/],
  ['reverb', /\breverb\b/],
  ['nightcore', /\bnightcore\b/],
  ['eightd', /\b8d\b/],
  ['demo', /\bdemo\b/],
  ['extended', /\bextended\b/],
  ['radioedit', /\bradio\s+edit\b/],
  ['mono', /\bmono\b/],
];

/** Which of those a title declares. */
export const versionTags = (value: string): Set<string> => {
  const text = String(value ?? '').toLowerCase();
  const found = new Set<string>();
  for (const [name, pattern] of VERSION_TAGS) if (pattern.test(text)) found.add(name);
  return found;
};

/** Do two titles describe the same kind of recording? */
export const sameVersion = (a: string, b: string): boolean => {
  const left = versionTags(a);
  const right = versionTags(b);
  if (left.size !== right.size) return false;
  for (const tag of left) if (!right.has(tag)) return false;
  return true;
};

/** Featured-artist markers, which the two sides place differently. */
const FEATURE_PATTERN = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]?/gi;

/**
 * Reduce a title or name to something comparable.
 *
 * Accents are folded, punctuation dropped and whitespace collapsed, because
 * every catalogue punctuates differently and none of it carries meaning for
 * identity — "Motörhead" and "Motorhead" are one band.
 */
export const normalise = (value: string): string => {
  let text = String(value ?? '').toLowerCase();
  for (const pattern of NOISE_PATTERNS) text = text.replace(pattern, ' ');
  text = text.replace(FEATURE_PATTERN, ' ');
  text = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  text = text.replace(/[^a-z0-9]+/g, ' ');
  return text.trim().replace(/\s+/g, ' ');
};

/** Split a normalised string into word tokens. */
const tokens = (value: string): string[] => (value ? value.split(' ').filter(Boolean) : []);

/**
 * How alike two strings are, 0..1.
 *
 * Token overlap rather than edit distance: word order differs constantly
 * between catalogues ("Bowie, David" against "David Bowie") and an edit
 * distance punishes that as heavily as a wrong title, which is the opposite of
 * what is wanted.
 */
export const similarity = (a: string, b: string): number => {
  const left = tokens(normalise(a));
  const right = tokens(normalise(b));
  if (left.length === 0 || right.length === 0) return 0;

  const pool = [...right];
  let hits = 0;
  for (const token of left) {
    const index = pool.indexOf(token);
    if (index >= 0) {
      hits += 1;
      pool.splice(index, 1);
    }
  }
  // Symmetric: covering all of a short title with a long one is not a match.
  return (2 * hits) / (left.length + right.length);
};

/**
 * How close two durations are, 0..1.
 *
 * Three seconds of tolerance is free — services disagree about fade-outs and
 * gapless trims — and past about fifteen seconds it is a different recording:
 * a radio edit, a live take, or an extended mix.
 */
export const durationCloseness = (a: number | null, b: number | null): number | null => {
  if (!a || !b || a <= 0 || b <= 0) return null;
  const delta = Math.abs(a - b);
  if (delta <= 3) return 1;
  if (delta >= 15) return 0;
  return 1 - (delta - 3) / 12;
};

/** Seconds from either a number or an `m:ss` string. */
export const secondsOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.every((part) => /^\d+$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
};

/**
 * Weights.
 *
 * Duration is the strongest single signal when both sides report one — titles
 * and artist names are written a dozen ways, but a recording's length is a
 * fact. When it is missing the weight is redistributed rather than treated as
 * a zero, which would make every duration-less candidate unmatchable.
 */
const WEIGHTS = {title: 0.45, artist: 0.25, duration: 0.3};

/** The confidence a match must reach to be used without asking. */
export const MATCH_THRESHOLD = 0.82;

/** Score one candidate against what YouTube Music showed. */
export const scoreCandidate = (
  source: {title: string; artist: string; durationSeconds: number | null},
  candidate: SearchResult,
): MatchScore => {
  const title = similarity(source.title, candidate.title);
  const artist = similarity(source.artist, candidate.artist);
  const duration = durationCloseness(source.durationSeconds, secondsOf(candidate.duration));

  /*
   * A different kind of recording is not this recording, however well the
   * words line up. Scored zero rather than penalised: there is no confidence
   * at which an instrumental is the right answer for a song with vocals.
   */
  if (!sameVersion(source.title, candidate.title)) return {score: 0, title, artist, duration};

  const parts: Array<[number, number]> =
    duration === null
      ? [
          [title, WEIGHTS.title],
          [artist, WEIGHTS.artist],
        ]
      : [
          [title, WEIGHTS.title],
          [artist, WEIGHTS.artist],
          [duration, WEIGHTS.duration],
        ];

  const totalWeight = parts.reduce((sum, [, weight]) => sum + weight, 0);
  const score = parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;

  return {score, title, artist, duration};
};

export interface MatchSource {
  title: string;
  artist: string;
  durationSeconds: number | null;
}

/**
 * Pick the best candidate, or decline.
 *
 * `search` is injected so this is testable without a network and so the caller
 * chooses which service to match against.
 */
export const matchTrack = async (
  source: MatchSource,
  search: (query: string) => Promise<SearchResult[]>,
): Promise<MatchOutcome> => {
  /*
   * Two queries, because they fail differently. "artist title" is precise and
   * usually wins; the bare title rescues the case where YouTube credits an
   * uploader or a channel rather than the performer, which is common on
   * anything that is not an official release.
   */
  const queries = [`${source.artist} ${source.title}`.trim(), source.title.trim()].filter(
    (query, index, all) => query && all.indexOf(query) === index,
  );

  const seen = new Set<string>();
  const candidates: MatchCandidate[] = [];

  for (const query of queries) {
    let results: SearchResult[] = [];
    try {
      results = await search(query);
    } catch {
      // A failed query is not a failed match: the next one may still work.
      continue;
    }

    for (const result of results) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      candidates.push({result, score: scoreCandidate(source, result)});
    }

    // Stop early on a confident hit rather than paying for the second query.
    if (candidates.some((candidate) => candidate.score.score >= MATCH_THRESHOLD)) break;
  }

  candidates.sort((a, b) => b.score.score - a.score.score);

  if (candidates.length === 0) return {match: null, score: null, candidates, reason: 'no-results'};

  const best = candidates[0];
  if (best.score.score < MATCH_THRESHOLD) {
    return {match: null, score: best.score, candidates, reason: 'low-confidence'};
  }

  return {match: best.result, score: best.score, candidates, reason: 'matched'};
};
