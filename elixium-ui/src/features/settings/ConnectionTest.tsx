import {useState} from 'react';
import {CheckCircle2, AlertCircle, Loader2, PlugZap} from 'lucide-react';
import {cn} from '@/shared/lib/utils';
import {useVerifyService, type VerifyResult} from '@/shared/lib/api';
import {Button} from '@/shared/components/ui/Button';
import type {Service} from '@/types';

const SERVICES: {id: Service; label: string}[] = [
  {id: 'deezer', label: 'Deezer'},
  {id: 'qobuz', label: 'Qobuz'},
];

/**
 * Credential health.
 *
 * Settings could previously only show that a credential had *been entered*.
 * An expired Deezer ARL still looks configured, and its symptoms — 30-second
 * previews instead of full tracks, and no lyrics — give the user no hint that
 * the cookie is the cause. This runs a real authenticated call per service and
 * reports the outcome in plain language.
 */
export function ConnectionTest() {
  const verify = useVerifyService();
  const [results, setResults] = useState<Partial<Record<Service, VerifyResult>>>({});
  const [testing, setTesting] = useState<Service | 'all' | null>(null);

  const run = async (service: Service) => {
    setTesting(service);
    try {
      const result = await verify.mutateAsync(service);
      setResults((r) => ({...r, [service]: result}));
    } catch (error) {
      setResults((r) => ({
        ...r,
        [service]: {
          service,
          ok: false,
          message: error instanceof Error ? error.message : 'Could not reach the server.',
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const runAll = async () => {
    setTesting('all');
    for (const {id} of SERVICES) {
      try {
        const result = await verify.mutateAsync(id);
        setResults((r) => ({...r, [id]: result}));
      } catch {
        setResults((r) => ({...r, [id]: {service: id, ok: false, message: 'Could not reach the server.'}}));
      }
    }
    setTesting(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">
          Checks that the saved credentials still authenticate — not just that they are filled in.
        </p>
        <Button size="sm" variant="secondary" onClick={runAll} disabled={testing !== null}>
          {testing === 'all' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
          Test all
        </Button>
      </div>

      <div className="space-y-2">
        {SERVICES.map(({id, label}) => {
          const result = results[id];
          const busy = testing === id || testing === 'all';

          return (
            <div
              key={id}
              className={cn(
                'flex flex-col gap-2 rounded-sm border p-3 transition-colors sm:flex-row sm:items-center sm:justify-between',
                result?.ok && 'border-success/25 bg-success/5',
                result && !result.ok && 'border-danger/25 bg-danger/5',
                !result && 'border-border bg-secondary-bg',
              )}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                {busy ? (
                  <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-text-muted" />
                ) : result?.ok ? (
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                ) : result ? (
                  <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
                ) : (
                  <PlugZap size={16} className="mt-0.5 shrink-0 text-text-muted" />
                )}

                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {label}
                    {result?.account && <span className="ml-2 text-xs font-normal text-success">{result.account}</span>}
                  </p>
                  <p
                    className={cn(
                      'text-xs',
                      result?.ok ? 'text-success' : result ? 'text-danger' : 'text-text-muted',
                    )}
                  >
                    {busy ? 'Checking…' : (result?.message ?? 'Not tested yet.')}
                  </p>
                </div>
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={() => run(id)}
                disabled={testing !== null}
                className="shrink-0 self-start sm:self-auto"
              >
                Test
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
