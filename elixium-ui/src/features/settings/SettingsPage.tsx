import {useEffect, useState} from 'react';
import {
  Save,
  Eye,
  EyeOff,
  Palette,
  Shield,
  ShieldCheck,
  ArrowUpCircle,
  HardDrive,
  Sliders,
  RefreshCw,
  Mic2,
  FolderTree,
  FolderSearch,
  FolderOpen,
} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';
import {Switch} from '@/shared/components/ui/Switch';
import {Select} from '@/shared/components/ui/Select';
import {Badge} from '@/shared/components/ui/Badge';
import {Tooltip, TooltipProvider} from '@/shared/components/ui/Tooltip';
import {useSettingsStore, DEEZER_QUALITY_LABELS, QOBUZ_QUALITY_LABELS, type Settings} from '@/store/settings-store';
import {useAppStore, THEMES} from '@/store/app-store';
import {getSocket} from '@/shared/lib/socket';
import {ConnectionTest} from './ConnectionTest';
import {desktop} from '@/shared/lib/desktop';
import {http} from '@/shared/lib/api';
import {ApiAccess} from './ApiAccess';
import {QualityProfile} from './QualityProfile';
import {PathTemplates} from './PathTemplates';
import {useSettingsStore as useSettingsStoreRaw} from '@/store/settings-store';
import {cn} from '@/shared/lib/utils';

function Section({title, icon: Icon, children}: {title: string; icon: React.ElementType; children: React.ReactNode}) {
  return (
    <div className="rounded-2xl border border-border bg-card-bg overflow-hidden">
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border bg-secondary-bg/50">
        <Icon size={16} className="text-accent" />
        <h3 className="font-semibold text-sm text-text-primary">{title}</h3>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

/*
 * Stacks on phones. Side-by-side, the fixed 224px control column left the
 * label roughly 88px on a 360px screen, so "Deezer ARL" wrapped to two lines
 * and its helper text collapsed into a one-word-per-line ribbon.
 */
function Field({
  label,
  description,
  children,
  wide,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  /** Give the control most of the row — for file paths and other long values. */
  wide?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-1 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1 sm:pt-0.5">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
      </div>
      {/* The default column is sized for a toggle or a short select. A download
          path plus Browse and Open needs far more than 224px, which is why the
          path box looked cramped to the point of being unusable. */}
      <div className={cn('w-full shrink-0', wide ? 'sm:w-[30rem] sm:max-w-[60%]' : 'sm:w-56')}>{children}</div>
    </div>
  );
}

function SecretInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '···'}
        className="pr-11 font-mono text-xs"
        /*
         * Credential fields share `font-mono text-xs` with the path-template
         * inputs, which made a class-based selector match both — a QA probe
         * aimed at the templates overwrote a stored ARL. Anything automating
         * this page must select on these markers, never on styling.
         */
        data-secret="true"
        autoComplete="off"
        spellCheck={false}
      />
      {/* Padded to a real tap target: the bare 14px icon was a 14x14 hit area. */}
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide value' : 'Show value'}
        aria-pressed={show}
        className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-primary"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

/** The services that can be switched off, in the order the switcher shows them. */
const SERVICE_TOGGLES: {key: 'deezer' | 'qobuz' | 'ytmusic'; label: string; note: string}[] = [
  {key: 'deezer', label: 'Deezer', note: 'Lossless FLAC, wide catalogue'},
  {key: 'qobuz', label: 'Qobuz', note: 'Hi-res up to 24-bit'},
  {key: 'ytmusic', label: 'YouTube Music', note: 'Widest catalogue, AAC or Opus'},
];

const SERVICE_TOGGLE_KEYS = SERVICE_TOGGLES.map((s) => s.key);

const defaultLayout = useSettingsStoreRaw.getState().settings.layout;

/**
 * The engine's spelling of a Deezer quality, in the interface's vocabulary.
 *
 * The config stores what the CLI accepts — `128`, `320`, `FLAC` — while the
 * interface works in Deezer's own format names. Anything unrecognised keeps the
 * safest option rather than silently promoting someone to a tier their account
 * cannot play.
 */
const normaliseDeezerQuality = (value: string): Settings['deezerQuality'] => {
  const raw = String(value).trim().toUpperCase();
  if (raw === 'FLAC' || raw === 'MP3_320' || raw === 'MP3_128') return raw as Settings['deezerQuality'];
  if (raw === '320') return 'MP3_320';
  if (raw === '128') return 'MP3_128';
  return 'MP3_128';
};

export function SettingsPage() {
  const {settings, update, isDirty, markClean} = useSettingsStore();
  const {theme, setTheme} = useAppStore();

  /*
   * Whether the server's settings have actually arrived.
   *
   * Credentials live in a persisted store, so before the `settings` event
   * lands the fields hold whatever localStorage had — possibly nothing. The
   * server now honours an empty credential as "clear this", so saving from
   * that unloaded state would wipe real tokens. Until this flips true the
   * credential keys are left out of the payload entirely.
   */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('getSettings');
    socket.once(
      'settings',
      (data: {
        cookies?: {arl?: string; sp_dc?: string; spotifyClientId?: string; spotifyClientSecret?: string};
        qobuz?: {app_id?: string; secrets?: string; token?: string};
        ytmusic?: {cookie?: string};
        concurrency?: number;
        paths?: {deezer?: string; qobuz?: string; ytmusic?: string};
        quality?: {deezer?: string; qobuz?: string; ytmusic?: string};
        services?: {deezer?: boolean; qobuz?: boolean; ytmusic?: boolean};
        trackNumber?: boolean;
        deezerDownloadCover?: boolean;
        fallbackTrack?: boolean;
        fallbackQuality?: boolean;
        embedLyrics?: boolean;
        saveLrcFile?: boolean;
        saveLayout?: Record<string, string>;
        coverSize?: number | string;
      }) => {
        if (!data) return;
        update({
          deezerArl: data.cookies?.arl ?? '',
          spotifySpDc: data.cookies?.sp_dc ?? '',
          spotifyClientId: data.cookies?.spotifyClientId ?? '',
          spotifyClientSecret: data.cookies?.spotifyClientSecret ?? '',
          qobuzAppId: String(data.qobuz?.app_id ?? ''),
          qobuzSecrets: data.qobuz?.secrets ?? '',
          qobuzToken: data.qobuz?.token ?? '',
          ytmusicCookie: data.ytmusic?.cookie ?? '',
          concurrency: data.concurrency ?? 3,
          downloadPath: data.paths?.deezer ?? '',
          qobuzDownloadPath: data.paths?.qobuz ?? '',
          ytmusicDownloadPath: data.paths?.ytmusic ?? '',
          trackNumbering: data.trackNumber ?? true,
          coverArt: data.deezerDownloadCover ?? true,
          fallbackTrack: data.fallbackTrack ?? true,
          fallbackQuality: data.fallbackQuality ?? true,
          embedLyrics: data.embedLyrics ?? true,
          saveLrcFile: data.saveLrcFile ?? false,
          ...(data.saveLayout ? {layout: {...defaultLayout, ...data.saveLayout}} : {}),
          ...(data.coverSize ? {coverSize: String(data.coverSize)} : {}),
          /*
           * Quality has to be read back, not just written.
           *
           * These two were the only saved fields the page never loaded, so it
           * always showed its own default and wrote that default back on the
           * next save — opening Settings for something unrelated and pressing
           * Save silently changed the download and playback quality to
           * whatever the interface happened to start at.
           */
          ...(data.quality?.deezer ? {deezerQuality: normaliseDeezerQuality(data.quality.deezer)} : {}),
          ...(data.quality?.qobuz ? {qobuzQuality: String(data.quality.qobuz) as Settings['qobuzQuality']} : {}),
          ...(data.quality?.ytmusic ? {ytmusicFormat: data.quality.ytmusic === 'opus' ? 'opus' : 'aac'} : {}),
          ...(data.services
            ? {
                enabledServices: {
                  deezer: data.services.deezer !== false,
                  qobuz: data.services.qobuz !== false,
                  ytmusic: data.services.ytmusic !== false,
                },
              }
            : {}),
        });
        setLoaded(true);
        markClean();
      },
    );
  }, []);

  const handleSave = () => {
    const socket = getSocket();
    socket.emit('saveSettings', {
      concurrency: settings.concurrency,
      trackNumber: settings.trackNumbering,
      fallbackTrack: settings.fallbackTrack,
      fallbackQuality: settings.fallbackQuality,
      deezerDownloadCover: settings.coverArt,
      qobuzDownloadCover: settings.coverArt,
      embedLyrics: settings.embedLyrics,
      saveLrcFile: settings.saveLrcFile,
      saveLayout: settings.layout,
      coverSize: Number(settings.coverSize) || 1000,
      // Omitted until the server's values have loaded — see `loaded` above.
      ...(loaded
        ? {
            cookies: {
              arl: settings.deezerArl,
              sp_dc: settings.spotifySpDc,
              spotifyClientId: settings.spotifyClientId,
              spotifyClientSecret: settings.spotifyClientSecret,
            },
            qobuz: {
              app_id: settings.qobuzAppId,
              secrets: settings.qobuzSecrets,
              token: settings.qobuzToken,
            },
            ytmusic: {cookie: settings.ytmusicCookie},
          }
        : {qobuz: {app_id: settings.qobuzAppId}}),
      paths: {
        deezer: settings.downloadPath,
        qobuz: settings.qobuzDownloadPath,
        ytmusic: settings.ytmusicDownloadPath,
      },
      quality: {
        deezer: settings.deezerQuality,
        qobuz: settings.qobuzQuality,
        ytmusic: settings.ytmusicFormat,
      },
      services: settings.enabledServices,
    });
    socket.once('settingsSaved', () => {
      toast.success('Settings saved');
      markClean();
    });
    socket.once('settingsError', (err: {message: string}) => toast.error(err.message || 'Save failed'));
  };

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto animate-fade-in">
      {isDirty && (
        <div className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning/10 px-4 py-3">
          <p className="text-sm text-warning font-medium">You have unsaved changes</p>
          <Button size="sm" onClick={handleSave}>
            <Save size={14} /> Save changes
          </Button>
        </div>
      )}

      <Section title="Appearance" icon={Palette}>
        <div>
          <p className="text-sm font-medium text-text-primary mb-3">Theme</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2.5 border text-sm font-medium transition-all',
                  theme === t.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-surface-bg text-text-secondary hover:border-accent/40',
                )}
              >
                {theme === t.id && <span className="h-2 w-2 rounded-full bg-accent shrink-0" />}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Authentication" icon={Shield}>
        <ConnectionTest />
        <div className="h-px bg-border" />
        <Field label="Deezer ARL" description="From browser cookies (deezer.com)">
          <SecretInput
            value={settings.deezerArl}
            onChange={(v) => update({deezerArl: v})}
            placeholder="Paste ARL token"
          />
        </Field>
        <div className="border-t border-border" />
        <Field label="Spotify sp_dc" description="From browser cookies (spotify.com)">
          <SecretInput
            value={settings.spotifySpDc}
            onChange={(v) => update({spotifySpDc: v})}
            placeholder="Paste sp_dc cookie"
          />
        </Field>
        <div className="border-t border-border" />
        <Field label="Qobuz App ID">
          <Input
            value={settings.qobuzAppId}
            onChange={(e) => update({qobuzAppId: e.target.value})}
            placeholder="App ID"
          />
        </Field>
        <Field label="Qobuz Token">
          <SecretInput
            value={settings.qobuzToken}
            onChange={(v) => update({qobuzToken: v})}
            placeholder="User auth token"
          />
        </Field>
        <Field label="Qobuz Secrets">
          <SecretInput
            value={settings.qobuzSecrets}
            onChange={(v) => update({qobuzSecrets: v})}
            placeholder="Comma-separated secrets"
          />
        </Field>
        <div className="border-t border-border" />
        <Field
          label="YouTube"
          description="Optional. Most tracks download without one — add a session only if something is refused."
        >
          <YouTubeSession value={settings.ytmusicCookie} onChange={(v) => update({ytmusicCookie: v})} />
        </Field>
      </Section>

      {/* Access control for this server, distinct from the service credentials
          above — those authenticate Elixium to Deezer/Qobuz, this authenticates
          other devices to Elixium. */}
      <Section title="API access" icon={ShieldCheck}>
        <ApiAccess />
      </Section>

      <Section title="Lyrics" icon={Mic2}>
        <Field label="Embed lyrics in files" description="Written into the tags (USLT for MP3, LYRICS for FLAC)">
          <div className="flex sm:justify-end">
            <Switch checked={settings.embedLyrics} onCheckedChange={(v) => update({embedLyrics: v})} />
          </div>
        </Field>
        <div className="border-t border-border" />
        <Field label="Save .lrc file" description="A sidecar with timings, for players that read synced lyrics">
          <div className="flex sm:justify-end">
            <Switch checked={settings.saveLrcFile} onCheckedChange={(v) => update({saveLrcFile: v})} />
          </div>
        </Field>
        <p className="text-xs text-text-muted">
          Lyrics come from LRCLIB, which needs no account. A track with none is downloaded exactly as before — the
          lookup never blocks or fails a download.
        </p>
      </Section>

      <Section title="Audio Quality" icon={Sliders}>
        <Field label="Deezer quality">
          <Select
            value={settings.deezerQuality}
            onValueChange={(v) => update({deezerQuality: v as typeof settings.deezerQuality})}
            options={Object.entries(DEEZER_QUALITY_LABELS).map(([value, label]) => ({value, label}))}
          />
        </Field>
        <Field label="Qobuz quality">
          <Select
            value={settings.qobuzQuality}
            onValueChange={(v) => update({qobuzQuality: v as typeof settings.qobuzQuality})}
            options={Object.entries(QOBUZ_QUALITY_LABELS).map(([value, label]) => ({value, label}))}
          />
        </Field>
        {/*
          Tags are not part of this choice any more, so they are not mentioned:
          both formats carry them in full. Opus used to lose its metadata
          because YouTube ships it inside WebM, which has no tag writer — it is
          rewrapped into Ogg on the way to disk, leaving the audio identical.
          What is left to weigh is quality against compatibility.
        */}
        <Field
          label="YouTube Music format"
          description="Opus is the better codec and the higher bitrate. AAC plays on anything, Apple devices included."
        >
          <Select
            value={settings.ytmusicFormat}
            onValueChange={(v) => update({ytmusicFormat: v as typeof settings.ytmusicFormat})}
            options={[
              {value: 'aac', label: 'AAC · m4a — ~131 kbps'},
              {value: 'opus', label: 'Opus · opus — ~147 kbps'},
            ]}
          />
        </Field>
        <Field label="Concurrency" description="Parallel downloads (1–10)">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={10}
              value={settings.concurrency}
              onChange={(e) => update({concurrency: parseInt(e.target.value)})}
              className="flex-1 accent-[var(--primary-accent)]"
            />
            <Badge variant="secondary" className="w-6 text-center shrink-0">
              {settings.concurrency}
            </Badge>
          </div>
        </Field>
      </Section>

      {/* Distinct from Audio Quality above: that is what to fetch now, this is
          what counts as good enough for something already in the library. */}
      <Section title="Quality profile" icon={ArrowUpCircle}>
        <QualityProfile />
      </Section>

      {/*
        Turning a service off removes it from the switcher entirely.
        *
        * Somebody with no Qobuz subscription has no use for a Qobuz button —
        * it can only ever report credentials they do not have. One has to stay
        * on, or the switcher would be empty with no way back.
      */}
      <Section title="Services" icon={Sliders}>
        {SERVICE_TOGGLES.map(({key, label, note}) => {
          const enabled = settings.enabledServices[key];
          const lastOne = enabled && SERVICE_TOGGLE_KEYS.filter((k) => settings.enabledServices[k]).length === 1;
          return (
            <Field key={key} label={label} description={lastOne ? 'At least one service has to stay on' : note}>
              <Switch
                checked={enabled}
                disabled={lastOne}
                onCheckedChange={(v) =>
                  update({enabledServices: {...settings.enabledServices, [key]: v}})
                }
              />
            </Field>
          );
        })}
      </Section>

      <Section title="Download Paths" icon={HardDrive}>
        {/* Browse and Open act on the machine running the engine, which is
            where downloads actually land — not on whichever device happens to
            be displaying this page. */}
        <Field label="Deezer downloads" wide>
          <PathField
            value={settings.downloadPath}
            onChange={(v) => update({downloadPath: v})}
            placeholder="e.g. C:\Music\Deezer"
          />
        </Field>
        <Field label="Qobuz downloads" wide>
          <PathField
            value={settings.qobuzDownloadPath}
            onChange={(v) => update({qobuzDownloadPath: v})}
            placeholder="e.g. C:\Music\Qobuz"
          />
        </Field>
        <Field label="YouTube Music downloads" wide>
          <PathField
            value={settings.ytmusicDownloadPath}
            onChange={(v) => update({ytmusicDownloadPath: v})}
            placeholder="e.g. C:\Music\YouTube Music"
          />
        </Field>
      </Section>

      <Section title="File naming" icon={FolderTree}>
        <PathTemplates />
      </Section>

      <Section title="Behaviour" icon={RefreshCw}>
        {/*
          Deezer renders any size on demand (capped at 1800 by its CDN). Qobuz
          only hosts 230 / 600 / 4000, so a request lands on the smallest rung
          that meets it — 1000 and 1500 both resolve to 4000px there.
        */}
        <Field
          label="Cover art size"
          description="Pixel size of embedded and saved artwork. Qobuz serves fixed sizes, so anything above 600 uses its 4000px original."
        >
          <Select
            value={settings.coverSize}
            onValueChange={(v) => update({coverSize: v})}
            options={[
              {value: '250', label: '250 x 250'},
              {value: '500', label: '500 x 500'},
              {value: '1000', label: '1000 x 1000'},
              {value: '1500', label: '1500 x 1500'},
            ]}
          />
        </Field>
        <div className="border-t border-border" />
        <Field label="Track numbering" description="Prefix filenames with track number">
          <Switch checked={settings.trackNumbering} onCheckedChange={(v) => update({trackNumbering: v})} />
        </Field>
        <Field label="Download cover art">
          <Switch checked={settings.coverArt} onCheckedChange={(v) => update({coverArt: v})} />
        </Field>
        <Field label="Create playlist files" description=".m3u8 for albums and playlists">
          <Switch checked={settings.createPlaylists} onCheckedChange={(v) => update({createPlaylists: v})} />
        </Field>
        <Field label="Fallback track" description="Try next format if unavailable">
          <Switch checked={settings.fallbackTrack} onCheckedChange={(v) => update({fallbackTrack: v})} />
        </Field>
        <Field label="Fallback quality" description="Try lower quality if requested isn't available">
          <Switch checked={settings.fallbackQuality} onCheckedChange={(v) => update({fallbackQuality: v})} />
        </Field>
      </Section>

      {!isDirty && (
        <div className="flex justify-end">
          <Button onClick={handleSave}>
            <Save size={14} /> Save settings
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Hand Elixium a YouTube session, via a cookies.txt export.
 *
 * There is no sign-in button, and there cannot be. Google refuses to
 * authenticate anybody from a window embedded in another program — an
 * anti-phishing measure rather than something to work around — and the OAuth
 * device-code flow that briefly replaced it was withdrawn. Chromium browsers
 * have encrypted their cookie stores against everything but themselves since
 * Chrome 127, so Chrome, Edge and Brave cannot be read either.
 *
 * What every browser does have is an extension that exports cookies.txt, the
 * same format yt-dlp consumes. So the file comes from the browser the person
 * already uses, whichever one that is.
 */
function YouTubeSession({value, onChange}: {value: string; onChange: (value: string) => void}) {
  const [busy, setBusy] = useState(false);
  const signedIn = value.trim().length > 0;

  const uploadCookiesTxt = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const {data} = await http.post('/ytmusic/cookies-txt', {text});
      if (data?.imported) {
        /*
         * Read the stored session back rather than marking the field with a
         * placeholder.
         *
         * The server has already saved the real cookie, but this form posts
         * its own field on Save — so putting anything else in it, even as a
         * marker, overwrites the real session with that marker the moment
         * Save is pressed. Which is exactly what happened.
         */
        const socket = getSocket();
        socket.emit('getSettings');
        socket.once('settings', (fresh: {ytmusic?: {cookie?: string}}) => {
          if (fresh?.ytmusic?.cookie) onChange(fresh.ytmusic.cookie);
        });
        /*
         * Say now whether YouTube actually accepts it.
         *
         * A file can carry every cookie by name — SAPISID included — and still
         * be a signed-out session, because the values rotate and an export
         * taken from a profile that was not signed in looks identical from
         * here. Without this the first sign of trouble is a download failing
         * much later, which sends people looking at the downloader.
         */
        if (data.signedIn === false) {
          toast.error('That file is not a signed-in session', {
            description:
              'YouTube reports it as signed out. Sign in to youtube.com, check your avatar is showing, then export cookies.txt again from that tab.',
            duration: 10000,
          });
        } else if (data.signedIn === true) {
          toast.success(data.account ? `Signed in as ${data.account}` : 'YouTube session verified', {
            description: `${data.cookies} cookies read from ${file.name}. Remember to press Save.`,
          });
        } else {
          toast.success('YouTube session imported', {
            description: `${data.cookies} cookies from ${file.name}. Could not reach YouTube to confirm it. Press Save.`,
          });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error('Could not read that cookies.txt', {description: message});
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label>
            <input
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Cleared so choosing the same file twice still fires.
                e.target.value = '';
                if (file) void uploadCookiesTxt(file);
              }}
            />
            <span
              className={cn(
                'inline-flex h-9 cursor-pointer items-center rounded-sm px-3 text-xs font-semibold transition-colors',
                signedIn ? 'bg-surface-bg text-text-primary' : 'bg-accent text-white',
                busy && 'pointer-events-none opacity-60',
              )}
            >
              {busy ? 'Reading…' : 'Upload cookies.txt'}
            </span>
          </label>
          {signedIn && (
            <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={busy}>
              Clear
            </Button>
          )}
          <span className="text-xs text-text-muted">{signedIn ? 'Session saved' : 'No session'}</span>
          <Tooltip
            side="left"
            wide
            delayDuration={150}
            content={
              <div className="space-y-1.5">
                <p className="font-semibold text-text-primary">Exporting a YouTube session</p>
                <ol className="list-decimal space-y-1 pl-4">
                  <li>In a private/incognito window, sign in to youtube.com.</li>
                  <li>Export cookies.txt from that tab with a cookies.txt extension.</li>
                  <li>Close the window without browsing, then upload the file.</li>
                </ol>
                <p className="text-text-muted">
                  The private window matters: YouTube rotates a normal session as you browse, which invalidates an
                  earlier export.
                </p>
              </div>
            }
          >
            <button
              type="button"
              aria-label="How to export a YouTube session"
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border border-border text-[10px] font-semibold',
                'text-text-muted transition-colors hover:border-accent/50 hover:text-text-primary',
              )}
            >
              i
            </button>
          </Tooltip>
        </div>
        {/*
        The steps live behind the hover, not on the page.

        They are read once if at all — most people never need a session, since
        downloads work without one — and printing them permanently took more
        room than the control they explain. The private-window instruction is
        the load-bearing part: YouTube rotates a live session as you browse,
        which silently invalidates an export taken from it earlier.
      */}
        <SecretInput value={value} onChange={onChange} placeholder="Or paste a Cookie header" />
      </div>
    </TooltipProvider>
  );
}

/**
 * A path with Browse and Open beside it — desktop only.
 *
 * The buttons appear solely inside the Electron shell, where the window and the
 * engine are the same machine, so a native dialog picks folders that downloads
 * will actually reach. The server build keeps the text field alone: it is
 * routinely used from another device, where a local dialog would offer folders
 * the engine cannot see, and a filesystem browser served over HTTP would let
 * anyone on the network enumerate the host's drives.
 */
function PathField({
  value,
  onChange,
  placeholder,
}: {
  value: string;

  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const bridge = desktop();

  const browse = async () => {
    const chosen = await bridge?.pickFolder(value.trim() || undefined);
    if (chosen) onChange(chosen);
  };

  const open = async () => {
    if (!value.trim()) return toast.error('Set a folder first');
    const ok = await bridge?.openFolder(value.trim());
    if (!ok) toast.error('Could not open that folder');
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1" />
      {bridge && (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={browse} className="flex-1 sm:flex-none">
            <FolderSearch size={14} />
            Browse
          </Button>
          <Button variant="ghost" size="sm" onClick={open} className="flex-1 sm:flex-none">
            <FolderOpen size={14} />
            Open
          </Button>
        </div>
      )}
    </div>
  );
}
