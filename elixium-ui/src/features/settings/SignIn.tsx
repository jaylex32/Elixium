import {useState} from 'react';
import {LogIn, Loader2, CheckCircle2, AlertTriangle} from 'lucide-react';
import {toast} from 'sonner';
import {http} from '@/shared/lib/api';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';
import {cn} from '@/shared/lib/utils';
import type {Service} from '@/types';

/**
 * Sign in with an email address and password instead of pasting a token.
 *
 * The fields below this one want an ARL cookie or a Qobuz auth token, which
 * means opening browser developer tools and knowing what to copy. Most people
 * have an account and no idea where that value lives, so this trades the
 * credentials for it once and fills the field in.
 *
 * Neither service offers a supported way to do this, so it can fail for
 * reasons that are nobody's fault — an account with no password because it
 * signs in through Google, or a captcha. Those are reported as needing the
 * manual field rather than as a wrong password, because they are.
 */
export function SignIn({onSignedIn}: {onSignedIn?: () => void}) {
  const [service, setService] = useState<Service>('deezer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ok: boolean; message: string} | null>(null);

  const submit = async () => {
    if (!email.trim() || !password) {
      setResult({ok: false, message: 'Enter your email address and password'});
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const {data} = await http.post('/auth/sign-in', {service, email: email.trim(), password});
      const stored = Array.isArray(data?.stored) ? data.stored.join(' and ') : 'credentials';
      setResult({ok: true, message: `Signed in — your ${stored} ${stored.includes('and') ? 'were' : 'was'} saved.`});
      // The password has done its job; there is no reason to keep it on screen.
      setPassword('');
      toast.success(`Signed in to ${service === 'deezer' ? 'Deezer' : 'Qobuz'}`);
      onSignedIn?.();
    } catch (error) {
      setResult({ok: false, message: error instanceof Error ? error.message : 'Sign-in failed'});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Sign in</p>
          <p className="text-xs text-text-muted">
            Fills in the credential below, so you do not have to find it yourself.
          </p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-xs bg-surface-bg p-1">
          {(['deezer', 'qobuz'] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setService(id);
                setResult(null);
              }}
              aria-pressed={service === id}
              className={cn(
                'min-h-8 rounded-xs px-3 text-xs font-medium capitalize transition-colors',
                service === id ? 'bg-card-bg text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {id}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={`${service === 'deezer' ? 'Deezer' : 'Qobuz'} email address`}
          aria-label={`${service} email address`}
        />
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) void submit();
          }}
          placeholder="Password"
          aria-label={`${service} password`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-xs text-text-muted">Your password is used once and never stored.</p>
      </div>

      {result && (
        <div
          role="status"
          className={cn(
            'flex items-start gap-2 rounded-xs border p-2.5 text-xs',
            result.ok
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
          )}
        >
          {result.ok ? (
            <CheckCircle2 size={14} className="mt-px shrink-0" />
          ) : (
            <AlertTriangle size={14} className="mt-px shrink-0" />
          )}
          <span className="min-w-0">{result.message}</span>
        </div>
      )}
    </div>
  );
}
