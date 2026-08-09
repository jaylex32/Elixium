import {useEffect, useState} from 'react';
import {ShieldCheck, KeyRound} from 'lucide-react';
import {getToken, setToken, onAuthRequired} from '@/shared/lib/auth-token';
import {disconnectSocket, getSocket} from '@/shared/lib/socket';
import {Button} from '@/shared/components/ui/Button';
import {Input} from '@/shared/components/ui/Input';

/**
 * Token prompt for a browser the server does not recognise.
 *
 * Only ever seen away from the host machine: loopback is exempt server side,
 * so opening Elixium locally goes straight through. On a phone or another
 * desktop the first request comes back 401 and this takes over the screen
 * until a working token is entered.
 */
export function PairingGate() {
  const [needed, setNeeded] = useState(false);
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const stop = onAuthRequired(() => setNeeded(true));

    // The socket refuses separately from HTTP, and on a fresh load it is
    // usually the first thing to be rejected.
    const socket = getSocket();
    const onError = (err: Error) => {
      if (err.message === 'auth_required' || err.message === 'auth_invalid') setNeeded(true);
    };
    socket.on('connect_error', onError);

    return () => {
      stop();
      socket.off('connect_error', onError);
    };
  }, []);

  if (!needed) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const candidate = value.trim();
    if (!candidate) return;

    setChecking(true);
    setError('');
    try {
      // Verify before storing, so a typo does not leave the app in a state
      // where every later request fails for a reason the user cannot see.
      const res = await fetch('/api/v1/settings', {headers: {'X-Elixium-Token': candidate}});
      if (res.status === 401) {
        setError('That token was not accepted. Check it in Settings on the computer running Elixium.');
        return;
      }
      if (!res.ok) {
        setError(`The server responded with ${res.status}. Try again in a moment.`);
        return;
      }

      setToken(candidate);
      // Force a fresh handshake so the socket presents the new token.
      disconnectSocket();
      getSocket();
      setNeeded(false);
      setValue('');
    } catch {
      setError('Could not reach the server. Check the address and your network.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-primary-bg/95 p-6 backdrop-blur-sm">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-border bg-card-bg p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/12 text-accent">
            <ShieldCheck size={19} />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-text-primary">Pair this device</h1>
            <p className="text-xs text-text-muted">Elixium only accepts known devices over the network.</p>
          </div>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-text-secondary">
          Open Settings on the computer running Elixium, copy the API token, and paste it here. It is stored on this
          device only.
        </p>

        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste the API token"
          className="font-mono text-xs"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label="API token"
        />

        {error && <p className="mt-2 text-xs leading-relaxed text-danger">{error}</p>}

        <Button type="submit" className="mt-4 w-full" disabled={checking || !value.trim()}>
          <KeyRound size={14} />
          {checking ? 'Checking…' : 'Pair device'}
        </Button>

        {getToken() && (
          <p className="mt-3 text-center text-[11px] text-text-muted">
            The saved token was rejected — it may have been rotated on the server.
          </p>
        )}
      </form>
    </div>
  );
}
