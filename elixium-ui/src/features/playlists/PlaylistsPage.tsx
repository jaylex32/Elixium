import {ListMusic, Plus} from 'lucide-react';
import {Button} from '@/shared/components/ui/Button';

export function PlaylistsPage() {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">Your playlists and collections</p>
        <Button size="sm" variant="secondary">
          <Plus size={14} />
          New playlist
        </Button>
      </div>

      <div className="flex flex-col items-center justify-center py-24 text-text-muted">
        <ListMusic size={48} className="mb-4 opacity-30" />
        <p className="text-text-secondary font-medium">No playlists yet</p>
        <p className="text-sm mt-1">Create a playlist or import one from your music service</p>
      </div>
    </div>
  );
}
