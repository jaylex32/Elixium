import {useEffect, useState} from 'react';
import {Copy, RefreshCw, ShieldCheck, ShieldAlert, Eye, EyeOff} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';
import {Switch} from '@/shared/components/ui/Switch';

interface TokenInfo {
  token: string;
  enabled: boolean;
  allowedOrigins: string[];
}

/**
 * API access panel.
 *
 * The token is fetched from /auth/token, which the server serves only to
 * loopback — so this section fills in on the machine running Elixium and shows
 * an explanation everywhere else. That is deliberate: a paired phone should not
 * be able to read the credential back out and pass it on.
 */
export function ApiAccess() {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/v1/auth/token');
      if (res.status === 403) {
        setLocalOnly(true);
        return;
      }
      const body = await res.json();
      if (body?.ok) setInfo(body.data);
    } catch {
      // Leave the panel empty rather than blocking the rest of Settings.
    }
  };

  useEffect(() => {
    load();
  }, []);

  const copy = async () => {
    if (!info?.token) return;
    try {
      await navigator.clipboard.writeText(info.token);
      toast.success('Token copied');
    } catch {
      toast.error('Could not copy — select and copy it manually');
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/auth/rotate', {method: 'POST'});
      const body = await res.json();
      if (body?.ok) {
        setInfo((prev) => (prev ? {...prev, token: body.data.token} : prev));
        setReveal(true);
        toast.success('Token rotated — paired devices must be paired again');
      } else {
        toast.error('Could not rotate the token');
      }
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  const setEnabled = async (enabled: boolean) => {
    setInfo((prev) => (prev ? {...prev, enabled} : prev));
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({auth: {enabled}}),
      });
      if (!res.ok) throw new Error();
      toast.success(enabled ? 'Network access now requires the token' : 'Token requirement disabled');
    } catch {
      setInfo((prev) => (prev ? {...prev, enabled: !enabled} : prev));
      toast.error('Could not change the setting');
    }
  };

  if (localOnly) {
    return (
      <p className="text-xs leading-relaxed text-text-muted">
        The API token can only be viewed on the computer running Elixium. Open Settings there to copy it or pair another
        device.
      </p>
    );
  }

  if (!info) return <p className="text-xs text-text-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Require a token off this machine</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
            This computer always has access. Phones, tablets and the Android app must present the token below.
          </p>
        </div>
        <Switch checked={info.enabled} onCheckedChange={setEnabled} />
      </div>

      {!info.enabled && (
        <div className="flex items-start gap-2.5 rounded-sm border border-warning/30 bg-warning/8 p-3">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-xs leading-relaxed text-text-secondary">
            Anything that can reach this server can now read your settings, queue downloads and stream your library
            without authenticating. Only leave this off on a network you fully trust.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">API token</label>
        <div className="relative">
          <Input
            readOnly
            value={reveal ? info.token : '•'.repeat(Math.min(info.token.length, 43))}
            onFocus={(e) => reveal && e.currentTarget.select()}
            className="pr-11 font-mono text-xs"
            aria-label="API token"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide token' : 'Show token'}
            aria-pressed={reveal}
            className="absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm text-text-muted transition-colors hover:text-text-primary"
          >
            {reveal ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>
          <Copy size={13} />
          Copy token
        </Button>
        <Button variant="ghost" size="sm" onClick={rotate} disabled={busy} className="text-text-muted">
          <RefreshCw size={13} />
          {busy ? 'Rotating…' : 'Rotate'}
        </Button>
      </div>

      <div className="flex items-start gap-2.5 rounded-sm border border-border bg-secondary-bg p-3">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-text-muted" />
        <p className="text-xs leading-relaxed text-text-muted">
          Rotating immediately cuts off every paired device, including the Android app. Use it if the token has been
          shared somewhere it should not have been.
        </p>
      </div>
    </div>
  );
}
