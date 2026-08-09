import {useState} from 'react';
import {Link2, Plus, Trash2, Play, CheckCircle2, AlertCircle, Loader2} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {Button} from '@/shared/components/ui/Button';
import {Badge} from '@/shared/components/ui/Badge';
import {useDownload} from '@/shared/hooks/useDownload';
import {useAppStore} from '@/store/app-store';
import {getSocket} from '@/shared/lib/socket';

interface ParsedUrl {
  url: string;
  type?: string;
  title?: string;
  artist?: string;
  trackCount?: number;
  status: 'pending' | 'parsing' | 'ready' | 'error';
  error?: string;
}

export function UrlDownloadPage() {
  const [input, setInput] = useState('');
  const [urls, setUrls] = useState<ParsedUrl[]>([]);
  const {downloadUrl} = useDownload();
  const {setPage} = useAppStore();

  const extractUrls = (text: string): string[] =>
    text
      .split(/[\n\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith('http'));

  const handleAdd = () => {
    const extracted = extractUrls(input);
    if (!extracted.length) {
      toast.error('No valid URLs found. Paste Deezer, Qobuz, Spotify, TIDAL, or YouTube links.');
      return;
    }

    setUrls((prev) => [...prev, ...extracted.map((url) => ({url, status: 'parsing' as const}))]);
    setInput('');

    const socket = getSocket();

    extracted.forEach((url) => {
      socket.emit('parseUrl', {url});
    });

    // Use a single persistent listener for all results from this batch
    const onResult = (data: {
      metadata?: {title?: string; contentType?: string; trackCount?: number};
      linkinfo?: {ART_NAME?: string; artist?: {name?: string}};
      tracks?: unknown[];
    }) => {
      const title = data.metadata?.title ?? 'Unknown';
      const artist =
        ((data.linkinfo as Record<string, unknown>)?.ART_NAME as string) ??
        ((data.linkinfo as Record<string, unknown>)?.artist as Record<string, string>)?.name ??
        'Unknown Artist';
      const type = data.metadata?.contentType ?? 'album';
      const trackCount = data.metadata?.trackCount ?? data.tracks?.length ?? 0;

      setUrls((prev) =>
        prev.map((u, i) => {
          if (u.status !== 'parsing') return u;
          // Mark first matching pending item as ready
          if (i === prev.findIndex((x) => x.status === 'parsing')) {
            return {...u, status: 'ready', title, artist, type, trackCount};
          }
          return u;
        }),
      );
    };

    const onError = (data: {message: string}) => {
      setUrls((prev) =>
        prev.map((u, i) => {
          if (u.status === 'parsing' && i === prev.findIndex((x) => x.status === 'parsing')) {
            return {...u, status: 'error', error: data.message};
          }
          return u;
        }),
      );
    };

    socket.on('urlParseResults', onResult);
    socket.on('urlParseError', onError);

    // Clean up listeners after all done
    setTimeout(() => {
      socket.off('urlParseResults', onResult);
      socket.off('urlParseError', onError);
    }, 30000);
  };

  const handleRemove = (url: string) => setUrls((prev) => prev.filter((u) => u.url !== url));

  const handleDownloadAll = () => {
    const ready = urls.filter((u) => u.status === 'ready');
    if (!ready.length) {
      toast.error('No ready URLs to download');
      return;
    }

    ready.forEach((item) => {
      const svc = item.url.includes('deezer.com') ? ('deezer' as const) : ('qobuz' as const);
      downloadUrl(item.url, {
        title: item.title ?? item.url,
        artist: item.artist,
        service: svc,
      });
    });

    toast.success(`Started ${ready.length} download${ready.length > 1 ? 's' : ''}`);
    setPage('downloads');
    setUrls([]);
  };

  const pastedUrls = extractUrls(input);

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto animate-fade-in">
      <div className="rounded-2xl border border-border bg-card-bg p-5 space-y-4">
        <div className="flex items-center gap-2 text-text-secondary">
          <Link2 size={18} className="text-accent" />
          <span className="font-medium">Paste URLs</span>
          <Badge variant="secondary" className="ml-auto text-xs">
            Deezer · Qobuz · Spotify · TIDAL · YouTube
          </Badge>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd();
          }}
          placeholder={
            'Paste one or more music URLs here…\nhttps://open.qobuz.com/album/…\nhttps://www.deezer.com/album/…'
          }
          className={cn(
            'w-full h-32 rounded-xl border border-border bg-surface-bg px-4 py-3 text-sm text-text-primary',
            'placeholder:text-text-muted resize-none focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30',
            'transition-colors font-mono',
          )}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted">
            {pastedUrls.length > 0
              ? `${pastedUrls.length} URL${pastedUrls.length > 1 ? 's' : ''} detected`
              : 'Ctrl+Enter to add quickly'}
          </p>
          <div className="flex gap-2">
            {urls.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setUrls([])}>
                <Trash2 size={14} /> Clear list
              </Button>
            )}
            <Button size="sm" onClick={handleAdd} disabled={!input.trim()}>
              <Plus size={14} /> Add to list
            </Button>
          </div>
        </div>
      </div>

      {urls.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-secondary">
              {urls.length} URL{urls.length > 1 ? 's' : ''} in list
            </p>
            <Button size="sm" onClick={handleDownloadAll} disabled={!urls.some((u) => u.status === 'ready')}>
              <Play size={14} /> Download all ready
            </Button>
          </div>

          <div className="space-y-2">
            {urls.map((item) => (
              <div
                key={item.url}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3.5',
                  item.status === 'ready' && 'border-success/20 bg-success/5',
                  item.status === 'error' && 'border-danger/20 bg-danger/5',
                  (item.status === 'parsing' || item.status === 'pending') && 'border-border bg-card-bg',
                )}
              >
                <div className="shrink-0">
                  {item.status === 'parsing' && <Loader2 size={16} className="animate-spin text-accent" />}
                  {item.status === 'ready' && <CheckCircle2 size={16} className="text-success" />}
                  {item.status === 'error' && <AlertCircle size={16} className="text-danger" />}
                  {item.status === 'pending' && <Link2 size={16} className="text-text-muted" />}
                </div>
                <div className="flex-1 min-w-0">
                  {item.title ? (
                    <>
                      <p className="text-sm font-medium text-text-primary truncate">{item.title}</p>
                      <p className="text-xs text-text-muted truncate">
                        {item.artist}
                        {item.trackCount ? ` · ${item.trackCount} tracks` : ''}
                      </p>
                    </>
                  ) : item.error ? (
                    <p className="text-sm text-danger truncate">{item.error}</p>
                  ) : (
                    <p className="text-sm text-text-muted font-mono truncate">{item.url}</p>
                  )}
                </div>
                {item.type && (
                  <Badge variant="secondary" className="shrink-0 capitalize">
                    {item.type}
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => handleRemove(item.url)}
                  className="shrink-0 text-text-muted hover:text-danger"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {urls.length === 0 && (
        <div className="text-center py-16 text-text-muted">
          <Link2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-text-secondary font-medium">Paste links above to get started</p>
          <p className="text-sm mt-1">Supports Deezer, Qobuz, Spotify, TIDAL and YouTube</p>
        </div>
      )}
    </div>
  );
}
