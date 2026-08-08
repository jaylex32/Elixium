import {Badge} from '@/shared/components/ui/Badge';

const QUALITY_MAP: Record<string, {label: string; variant: 'default' | 'success' | 'info' | 'secondary'}> = {
  FLAC: {label: 'FLAC', variant: 'success'},
  MP3_320: {label: '320', variant: 'info'},
  MP3_128: {label: '128', variant: 'secondary'},
  '27': {label: 'Hi-Res', variant: 'success'},
  '7': {label: '24-bit', variant: 'info'},
  '6': {label: 'FLAC', variant: 'success'},
  '5': {label: '320', variant: 'info'},
};

export function QualityBadge({quality}: {quality: string}) {
  const q = QUALITY_MAP[quality] ?? {label: quality, variant: 'secondary' as const};
  return <Badge variant={q.variant}>{q.label}</Badge>;
}
