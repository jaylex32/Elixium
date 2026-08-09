import {useEffect, useState} from 'react';
import {ArrowUpCircle} from 'lucide-react';
import {toast} from 'sonner';
import {Select} from '@/shared/components/ui/Select';
import {Switch} from '@/shared/components/ui/Switch';

type Cutoff = 'mp3' | 'lossless' | 'hires';

interface Profile {
  cutoff: Cutoff;
  upgradeExisting: boolean;
}

const CUTOFF_OPTIONS = [
  {value: 'mp3', label: 'MP3 — any format is fine'},
  {value: 'lossless', label: 'FLAC 16-bit — replace lossy'},
  {value: 'hires', label: 'FLAC 24-bit — replace anything lower'},
];

/**
 * Quality profile and upgrade cutoff.
 *
 * The watchlist could tell what it had not downloaded, but not that what it
 * had was worse than what is now available — so a release grabbed as MP3
 * before a Qobuz subscription stayed MP3 forever. The cutoff names the tier
 * that counts as done; anything below it becomes a wanted upgrade.
 *
 * Existing quality is read from the files on disk, not from download history,
 * so this works for a library built before the feature existed.
 */
export function QualityProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    fetch('/api/v1/settings')
      .then((r) => r.json())
      .then((b) => {
        if (b?.ok && b.data?.qualityProfile) setProfile(b.data.qualityProfile);
      })
      .catch(() => {
        // Leave the section blank rather than blocking the rest of Settings.
      });
  }, []);

  const save = async (patch: Partial<Profile>) => {
    const previous = profile;
    const next = {...(profile as Profile), ...patch};
    setProfile(next);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({qualityProfile: patch}),
      });
      if (!res.ok) throw new Error();
    } catch {
      setProfile(previous);
      toast.error('Could not save the quality profile');
    }
  };

  if (!profile) return <p className="text-xs text-text-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary">Cutoff</label>
        <Select
          value={profile.cutoff}
          onValueChange={(v) => save({cutoff: v as Cutoff})}
          options={CUTOFF_OPTIONS}
        />
        <p className="text-[11px] leading-relaxed text-text-muted">
          A release at or above this tier is considered done. Deezer tops out at FLAC 16-bit, so a 24-bit cutoff only
          affects Qobuz.
        </p>
      </div>

      <div className="border-t border-border" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Upgrade what I already have</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-muted">
            Re-download watched releases that sit below the cutoff, when the service can actually do better.
          </p>
        </div>
        <Switch checked={profile.upgradeExisting} onCheckedChange={(v) => save({upgradeExisting: v})} />
      </div>

      {profile.upgradeExisting && (
        <div className="flex items-start gap-2.5 rounded-sm border border-accent/25 bg-accent/8 p-3">
          <ArrowUpCircle size={15} className="mt-0.5 shrink-0 text-accent" />
          <p className="text-xs leading-relaxed text-text-secondary">
            The next scan will queue every watched release below the cutoff. On a large library that can be a lot of
            downloads at once.
          </p>
        </div>
      )}
    </div>
  );
}
