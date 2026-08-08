import {useEffect, useState} from 'react';
import {Clock, Save, Eye, ListMusic} from 'lucide-react';
import {toast} from 'sonner';
import {cn} from '@/shared/lib/utils';
import {getSocket} from '@/shared/lib/socket';
import {Button} from '@/shared/components/ui/Button';
import {Switch} from '@/shared/components/ui/Switch';
import {Select} from '@/shared/components/ui/Select';
import {Input} from '@/shared/components/ui/Input';

/** Mirrors the server's MonitorScheduleRecord after normalizeSchedule. */
export interface MonitorSchedule {
  enabled: boolean;
  mode: 'interval-hours' | 'interval-days' | 'weekdays' | 'monthly';
  intervalHours: number;
  intervalDays: number;
  weekdays: number[];
  monthDays: number[];
  hour: number;
  minute: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

type Kind = 'artists' | 'playlists';

const MODES: {value: MonitorSchedule['mode']; label: string}[] = [
  {value: 'interval-hours', label: 'Every N hours'},
  {value: 'interval-days', label: 'Every N days'},
  {value: 'weekdays', label: 'On chosen weekdays'},
  {value: 'monthly', label: 'On chosen days of month'},
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DEFAULT_SCHEDULE: MonitorSchedule = {
  enabled: false,
  mode: 'interval-days',
  intervalHours: 12,
  intervalDays: 1,
  weekdays: [1],
  monthDays: [1],
  hour: 8,
  minute: 0,
  lastRunAt: null,
  nextRunAt: null,
};

const formatWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/** Toggle membership in a numeric set, kept sorted so the payload is stable. */
const toggleIn = (list: number[], value: number): number[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);

function ScheduleCard({kind, schedule, onSave}: {kind: Kind; schedule: MonitorSchedule; onSave: (s: MonitorSchedule) => void}) {
  const [draft, setDraft] = useState<MonitorSchedule>(schedule);
  const [dirty, setDirty] = useState(false);

  // Adopt server state whenever it changes, unless the user has edits pending —
  // otherwise a broadcast from another client would wipe their work mid-edit.
  useEffect(() => {
    if (!dirty) setDraft(schedule);
  }, [schedule, dirty]);

  const patch = (changes: Partial<MonitorSchedule>) => {
    setDraft((d) => ({...d, ...changes}));
    setDirty(true);
  };

  const Icon = kind === 'artists' ? Eye : ListMusic;

  return (
    <section className="rounded-md border border-border bg-card-bg p-4 sm:p-5">
      <header className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon size={16} className="shrink-0 text-accent" />
          <h3 className="truncate text-sm font-semibold text-text-primary">
            {kind === 'artists' ? 'Artist releases' : 'Playlist changes'}
          </h3>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          <span>{draft.enabled ? 'On' : 'Off'}</span>
          <Switch checked={draft.enabled} onCheckedChange={(v) => patch({enabled: v})} />
        </label>
      </header>

      <div className={cn('space-y-4 pt-4', !draft.enabled && 'pointer-events-none opacity-50')}>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">Frequency</label>
          <Select
            value={draft.mode}
            onValueChange={(v) => patch({mode: v as MonitorSchedule['mode']})}
            options={MODES.map((m) => ({value: m.value, label: m.label}))}
          />
        </div>

        {draft.mode === 'interval-hours' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">Every N hours</label>
            <Input
              type="number"
              min={1}
              max={168}
              value={String(draft.intervalHours)}
              onChange={(e) => patch({intervalHours: Number(e.target.value) || 1})}
            />
          </div>
        )}

        {draft.mode === 'interval-days' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">Every N days</label>
            <Input
              type="number"
              min={1}
              max={90}
              value={String(draft.intervalDays)}
              onChange={(e) => patch({intervalDays: Number(e.target.value) || 1})}
            />
          </div>
        )}

        {draft.mode === 'weekdays' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">Days of the week</label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((label, index) => {
                const on = draft.weekdays.includes(index);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({weekdays: toggleIn(draft.weekdays, index)})}
                    className={cn(
                      'min-h-9 rounded-sm border px-2.5 text-xs font-medium transition-colors',
                      on
                        ? 'border-accent/40 bg-accent/15 text-accent'
                        : 'border-border text-text-muted hover:text-text-primary',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {draft.mode === 'monthly' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">Days of the month</label>
            <div className="flex flex-wrap gap-1">
              {Array.from({length: 31}, (_, i) => i + 1).map((day) => {
                const on = draft.monthDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patch({monthDays: toggleIn(draft.monthDays, day)})}
                    className={cn(
                      'h-8 w-8 rounded-xs border text-xs font-medium transition-colors',
                      on
                        ? 'border-accent/40 bg-accent/15 text-accent'
                        : 'border-border text-text-muted hover:text-text-primary',
                    )}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Time of day is irrelevant to an hourly interval, which fires on its
            own cadence rather than at a clock time. */}
        {draft.mode !== 'interval-hours' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary">Time of day</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={23}
                aria-label="Hour"
                value={String(draft.hour)}
                onChange={(e) => patch({hour: Math.min(23, Math.max(0, Number(e.target.value) || 0))})}
                className="w-20"
              />
              <span className="text-text-muted">:</span>
              <Input
                type="number"
                min={0}
                max={59}
                aria-label="Minute"
                value={String(draft.minute).padStart(2, '0')}
                onChange={(e) => patch({minute: Math.min(59, Math.max(0, Number(e.target.value) || 0))})}
                className="w-20"
              />
            </div>
          </div>
        )}
      </div>

      <footer className="mt-4 flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <dl className="space-y-0.5 text-xs text-text-muted">
          <div className="flex gap-1.5">
            <dt>Last run:</dt>
            <dd className="text-text-secondary">{formatWhen(schedule.lastRunAt)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Next run:</dt>
            <dd className="text-text-secondary">{schedule.enabled ? formatWhen(schedule.nextRunAt) : 'disabled'}</dd>
          </div>
        </dl>
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => {
            onSave(draft);
            setDirty(false);
          }}
        >
          <Save size={14} />
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </footer>
    </section>
  );
}

/**
 * Automatic scan schedules.
 *
 * The backend has supported per-kind schedules (artists, playlists) with four
 * frequency modes since before this UI existed — the tab previously read
 * "Schedule configuration coming soon".
 */
export function ScheduleEditor() {
  const [schedules, setSchedules] = useState<Record<Kind, MonitorSchedule>>({
    artists: DEFAULT_SCHEDULE,
    playlists: DEFAULT_SCHEDULE,
  });

  useEffect(() => {
    const socket = getSocket();
    const onSchedules = (data: Partial<Record<Kind, MonitorSchedule>>) => {
      setSchedules({
        artists: {...DEFAULT_SCHEDULE, ...(data?.artists ?? {})},
        playlists: {...DEFAULT_SCHEDULE, ...(data?.playlists ?? {})},
      });
    };

    socket.on('monitorSchedules', onSchedules);
    socket.emit('getMonitorSchedules');
    return () => {
      socket.off('monitorSchedules', onSchedules);
    };
  }, []);

  const save = (kind: Kind) => (schedule: MonitorSchedule) => {
    getSocket().emit('saveMonitorSchedule', {kind, schedule});
    toast.success(`${kind === 'artists' ? 'Artist' : 'Playlist'} schedule saved`);
  };

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <Clock size={14} />
        Elixium checks for new releases automatically on these schedules.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ScheduleCard kind="artists" schedule={schedules.artists} onSave={save('artists')} />
        <ScheduleCard kind="playlists" schedule={schedules.playlists} onSave={save('playlists')} />
      </div>
    </div>
  );
}
