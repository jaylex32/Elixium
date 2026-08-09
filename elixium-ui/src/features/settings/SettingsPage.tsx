import {useEffect, useState} from 'react';
import {Save, Eye, EyeOff, Palette, Shield, ShieldCheck, HardDrive, Sliders, RefreshCw, Mic2, FolderTree} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';
import {Switch} from '@/shared/components/ui/Switch';
import {Select} from '@/shared/components/ui/Select';
import {Badge} from '@/shared/components/ui/Badge';
import {useSettingsStore, DEEZER_QUALITY_LABELS, QOBUZ_QUALITY_LABELS} from '@/store/settings-store';
import {useAppStore, THEMES} from '@/store/app-store';
import {getSocket} from '@/shared/lib/socket';
import {ConnectionTest} from './ConnectionTest';
import {ApiAccess} from './ApiAccess';
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
function Field({label, description, children}: {label: string; description?: string; children: React.ReactNode}) {
  return (
    <div className="flex flex-col gap-1.5 py-1 sm:flex-row sm:items-start sm:gap-4">
      <div className="min-w-0 flex-1 sm:pt-0.5">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
      </div>
      <div className="w-full shrink-0 sm:w-56">{children}</div>
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

const defaultLayout = useSettingsStoreRaw.getState().settings.layout;

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
        cookies?: {arl?: string; sp_dc?: string};
        qobuz?: {app_id?: string; secrets?: string; token?: string};
        concurrency?: number;
        paths?: {deezer?: string; qobuz?: string};
        quality?: {deezer?: string; qobuz?: string};
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
          qobuzAppId: String(data.qobuz?.app_id ?? ''),
          qobuzSecrets: data.qobuz?.secrets ?? '',
          qobuzToken: data.qobuz?.token ?? '',
          concurrency: data.concurrency ?? 3,
          downloadPath: data.paths?.deezer ?? '',
          qobuzDownloadPath: data.paths?.qobuz ?? '',
          trackNumbering: data.trackNumber ?? true,
          coverArt: data.deezerDownloadCover ?? true,
          fallbackTrack: data.fallbackTrack ?? true,
          fallbackQuality: data.fallbackQuality ?? true,
          embedLyrics: data.embedLyrics ?? true,
          saveLrcFile: data.saveLrcFile ?? false,
          ...(data.saveLayout ? {layout: {...defaultLayout, ...data.saveLayout}} : {}),
          ...(data.coverSize ? {coverSize: String(data.coverSize)} : {}),
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
            cookies: {arl: settings.deezerArl, sp_dc: settings.spotifySpDc},
            qobuz: {
              app_id: settings.qobuzAppId,
              secrets: settings.qobuzSecrets,
              token: settings.qobuzToken,
            },
          }
        : {qobuz: {app_id: settings.qobuzAppId}}),
      paths: {deezer: settings.downloadPath, qobuz: settings.qobuzDownloadPath},
      quality: {deezer: settings.deezerQuality, qobuz: settings.qobuzQuality},
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
      </Section>

      {/* Access control for this server, distinct from the service credentials
          above — those authenticate Elixium to Deezer/Qobuz, this authenticates
          other devices to Elixium. */}
      <Section title="API access" icon={ShieldCheck}>
        <ApiAccess />
      </Section>

      <Section title="Lyrics" icon={Mic2}>
        <Field
          label="Embed lyrics in files"
          description="Written into the tags (USLT for MP3, LYRICS for FLAC)"
        >
          <div className="flex sm:justify-end">
            <Switch checked={settings.embedLyrics} onCheckedChange={(v) => update({embedLyrics: v})} />
          </div>
        </Field>
        <div className="border-t border-border" />
        <Field
          label="Save .lrc file"
          description="A sidecar with timings, for players that read synced lyrics"
        >
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

      <Section title="Download Paths" icon={HardDrive}>
        <Field label="Deezer downloads">
          <Input
            value={settings.downloadPath}
            onChange={(e) => update({downloadPath: e.target.value})}
            placeholder="e.g. C:\Music\Deezer"
          />
        </Field>
        <Field label="Qobuz downloads">
          <Input
            value={settings.qobuzDownloadPath}
            onChange={(e) => update({qobuzDownloadPath: e.target.value})}
            placeholder="e.g. C:\Music\Qobuz"
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
