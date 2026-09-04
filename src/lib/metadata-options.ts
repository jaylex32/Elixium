/**
 * Which tags get written into a downloaded file.
 *
 * Everything here was previously unconditional, which is fine until one of the
 * tags is unwanted. ReplayGain is the case that prompted this: Deezer reports
 * a gain on every track — commonly around -12 dB — and a player that honours
 * it plays the file that much quieter than a copy from somewhere that writes
 * no gain at all. Nothing about the audio differs, but quieter is reliably
 * heard as worse, and people reasonably conclude the download is poor.
 *
 * So it is off by default now, and the rest are switches rather than rules.
 * Every other default matches what was written before, so an existing library
 * keeps being tagged the way it always was.
 */
export interface MetadataOptions {
  /**
   * Deezer's loudness figure, for players that level tracks automatically.
   *
   * Off by default: it makes a file play quieter than untagged copies of the
   * same track, which is heard as a quality difference and is not one.
   */
  replayGain: boolean;
  /** The recording's ISRC. */
  isrc: boolean;
  /** The release barcode, or UPC. */
  barcode: boolean;
  /** Record label and publisher. */
  label: boolean;
  /** Copyright line. */
  copyright: boolean;
  /** Whether the lyrics are marked explicit. */
  explicit: boolean;
  /** Composer, producer, engineer, writer, author, mixer, lyricist. */
  credits: boolean;
  /**
   * The rest of the roles Deezer sends.
   *
   * Its contributor list is deeper than the handful that were being read —
   * mixing engineer, recording engineer, additional producer, drum programmer
   * and whatever else a particular release credits. Off by default because it
   * can be a long list on a heavily credited record.
   */
  extraCredits: boolean;
  /**
   * Beats per minute, as Deezer reports it.
   *
   * Off by default: Deezer returns 0 for a good part of its catalogue, and a
   * tag saying 0 BPM is worse than no tag at all.
   */
  bpm: boolean;
  /** Where the file came from: source, source id, and the encoder line. */
  provenance: boolean;
  /** Album, EP or Single. */
  releaseType: boolean;
  /** The compilation flag, for libraries that group by it. */
  compilation: boolean;
  /** "Digital Media". */
  media: boolean;
}

/**
 * What gets written when nobody has said otherwise.
 *
 * Deliberately equal to the previous behaviour in every respect except
 * ReplayGain, so that turning nothing on or off leaves files tagged as before.
 */
export const DEFAULT_METADATA_OPTIONS: MetadataOptions = {
  replayGain: false,
  isrc: true,
  barcode: true,
  label: true,
  copyright: true,
  explicit: true,
  credits: true,
  extraCredits: false,
  bpm: false,
  provenance: true,
  releaseType: true,
  compilation: true,
  media: true,
};

/**
 * Read the options from stored settings, falling back per field.
 *
 * Per field rather than wholesale: a config written before a tag existed is
 * missing that key, and treating the whole object as absent would silently
 * revert every other choice the user had made.
 */
export const metadataOptionsFrom = (stored: unknown): MetadataOptions => {
  const source = (stored ?? {}) as Record<string, unknown>;
  const result = {...DEFAULT_METADATA_OPTIONS};
  for (const key of Object.keys(DEFAULT_METADATA_OPTIONS) as Array<keyof MetadataOptions>) {
    if (typeof source[key] === 'boolean') result[key] = source[key] as boolean;
  }
  return result;
};

/**
 * Which of these each service can actually write.
 *
 * The three do not carry the same information. Deezer sends a loudness figure
 * and a barcode; Qobuz sends most of the same and its own peak alongside the
 * gain; YouTube Music sends almost none of it — a title, an artist, a year and
 * the artwork, with the provenance line the only thing here that applies.
 *
 * Listed rather than inferred so the interface can show each service only the
 * switches that do something for it, instead of offering thirteen and quietly
 * ignoring ten.
 */
export const SUPPORTED_TAGS: Record<'deezer' | 'qobuz' | 'ytmusic', Array<keyof MetadataOptions>> = {
  deezer: [
    'replayGain',
    'isrc',
    'barcode',
    'label',
    'copyright',
    'explicit',
    'credits',
    'extraCredits',
    'bpm',
    'releaseType',
    'compilation',
    'media',
    'provenance',
  ],
  qobuz: [
    'replayGain',
    'isrc',
    'barcode',
    'label',
    'copyright',
    'explicit',
    'credits',
    'releaseType',
    'media',
    'provenance',
  ],
  ytmusic: ['provenance'],
};

/** Per-service choices, since the services do not carry the same tags. */
export interface MetadataSettings {
  deezer: MetadataOptions;
  qobuz: MetadataOptions;
  ytmusic: MetadataOptions;
}

export const DEFAULT_METADATA_SETTINGS: MetadataSettings = {
  deezer: {...DEFAULT_METADATA_OPTIONS},
  qobuz: {...DEFAULT_METADATA_OPTIONS},
  ytmusic: {...DEFAULT_METADATA_OPTIONS},
};

/**
 * Read per-service choices from stored settings.
 *
 * Also accepts the older flat shape, where one set of switches applied to
 * Deezer alone — those become the Deezer entry and the other two keep their
 * defaults, so an existing config is not silently reset.
 */
export const metadataSettingsFrom = (stored: unknown): MetadataSettings => {
  const source = (stored ?? {}) as Record<string, unknown>;
  const perService = 'deezer' in source || 'qobuz' in source || 'ytmusic' in source;

  if (!perService) {
    return {
      deezer: metadataOptionsFrom(source),
      qobuz: {...DEFAULT_METADATA_OPTIONS},
      ytmusic: {...DEFAULT_METADATA_OPTIONS},
    };
  }

  return {
    deezer: metadataOptionsFrom(source.deezer),
    qobuz: metadataOptionsFrom(source.qobuz),
    ytmusic: metadataOptionsFrom(source.ytmusic),
  };
};
