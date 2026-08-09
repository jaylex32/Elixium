import {useState} from 'react';
import {FolderTree, RotateCcw} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useSettingsStore, type Settings} from '@/store/settings-store';
import {Input} from '@/shared/components/ui/Input';
import {Button} from '@/shared/components/ui/Button';

type LayoutKey = keyof Settings['layout'];

/**
 * Path templates, one set per service.
 *
 * The server has always stored eight — track/album/artist/playlist for Deezer
 * and the qobuz- prefixed equivalents — but the UI offered a single "File
 * template" field that was never included in the save payload, so editing it
 * did nothing at all.
 *
 * The two services use different placeholder vocabularies, which is exactly
 * why they cannot share one template: Deezer substitutes raw SCREAMING_SNAKE
 * field names straight off its private API payload, while Qobuz resolves a
 * fixed lowercase set by name. {SNG_TITLE} means nothing to Qobuz and {title}
 * means nothing to Deezer.
 */
const SERVICES: {
  id: 'deezer' | 'qobuz';
  label: string;
  accent: string;
  rows: {key: LayoutKey; label: string}[];
  tokens: string[];
}[] = [
  {
    id: 'deezer',
    label: 'Deezer',
    accent: '#a259ff',
    rows: [
      {key: 'track', label: 'Single track'},
      {key: 'album', label: 'Album'},
      {key: 'artist', label: 'Artist'},
      {key: 'playlist', label: 'Playlist'},
    ],
    /*
     * Deezer substitutes any field name from its own track/album payload, so
     * this lists the ones that are reliably present rather than a closed set.
     * Names are the raw API fields — SCREAMING_SNAKE, not prettified.
     */
    tokens: [
      '{ART_NAME}',
      '{ALB_TITLE}',
      '{SNG_TITLE}',
      '{TRACK_NUMBER}',
      '{TRACK_POSITION}',
      '{NO_TRACK_NUMBER}',
      '{DISK_NUMBER}',
      '{list_title}',
    ],
  },
  {
    id: 'qobuz',
    label: 'Qobuz',
    accent: '#0067b3',
    rows: [
      {key: 'qobuz-track', label: 'Single track'},
      {key: 'qobuz-album', label: 'Album'},
      {key: 'qobuz-artist', label: 'Artist'},
      {key: 'qobuz-playlist', label: 'Playlist'},
    ],
    // Qobuz supports a fixed set, resolved by name in buildQobuzPath.
    tokens: [
      '{alb_artist}',
      '{alb_title}',
      '{title}',
      '{track_number}',
      '{no_track_number}',
      '{disc_number}',
      '{genre}',
      '{release_date}',
      '{list_title}',
      '{maximum_bit_depth}',
      '{maximum_sampling_rate}',
    ],
  },
];

/** Mirrors the server defaults in src/lib/config.ts. */
const DEFAULTS: Settings['layout'] = {
  track: '{ALB_TITLE}/{SNG_TITLE}',
  album: '{ART_NAME}/{ALB_TITLE}/{NO_TRACK_NUMBER}{SNG_TITLE}',
  artist: '{ALB_TITLE}/{SNG_TITLE}',
  playlist: '{ART_NAME}/{ART_NAME} - {ALB_TITLE}/{NO_TRACK_NUMBER}{ART_NAME} - {SNG_TITLE}',
  'qobuz-track': '{alb_artist}/{alb_artist} - {alb_title}/{no_track_number}{alb_artist} - {title}',
  'qobuz-album': '{alb_artist}/{alb_artist} - {alb_title}/{no_track_number}{alb_artist} - {title}',
  'qobuz-artist': 'artist/{alb_title}/{no_track_number}{alb_artist} - {title}',
  'qobuz-playlist': 'Playlist/{list_title}/{alb_artist}/{alb_artist} - {alb_title}/{no_track_number}{alb_artist} - {title}',
};

export function PathTemplates() {
  const {settings, update} = useSettingsStore();
  const [active, setActive] = useState<'deezer' | 'qobuz'>('deezer');
  const service = SERVICES.find((s) => s.id === active) as (typeof SERVICES)[number];

  const setLayout = (key: LayoutKey, value: string) => update({layout: {...settings.layout, [key]: value}});

  const resetService = () => {
    const next = {...settings.layout};
    for (const {key} of service.rows) next[key] = DEFAULTS[key];
    update({layout: next});
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-sm border border-border bg-secondary-bg p-1">
          {SERVICES.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              aria-pressed={active === s.id}
              className={cn(
                'min-h-9 rounded-xs px-3.5 text-xs font-semibold transition-all duration-fast',
                active === s.id ? 'text-white shadow-sm' : 'text-text-muted hover:text-text-primary',
              )}
              style={active === s.id ? {backgroundColor: s.accent} : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={resetService} className="text-text-muted">
          <RotateCcw size={13} />
          Reset {service.label}
        </Button>
      </div>

      <div className="space-y-3">
        {service.rows.map(({key, label}) => (
          <div key={key} className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">{label}</label>
            <Input
              value={settings.layout[key] ?? ''}
              onChange={(e) => setLayout(key, e.target.value)}
              placeholder={DEFAULTS[key]}
              className="font-mono text-xs"
            />
          </div>
        ))}
      </div>

      <div className="rounded-sm border border-border bg-secondary-bg p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
          <FolderTree size={12} />
          Placeholders for {service.label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {service.tokens.map((token) => (
            <code
              key={token}
              className="rounded-xs border border-border bg-card-bg px-1.5 py-0.5 font-mono text-[11px] text-text-muted"
            >
              {token}
            </code>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
          The two services expose different metadata, so their placeholders differ and the templates are kept separate.
          Forward slashes create folders; the file extension is added automatically.
        </p>
      </div>
    </div>
  );
}
