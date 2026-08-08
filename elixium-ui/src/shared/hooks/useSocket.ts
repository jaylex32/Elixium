import {useEffect} from 'react';
import {toast} from 'sonner';
import {getSocket} from '@/shared/lib/socket';
import {ON} from '@/shared/lib/events';
import {useAppStore} from '@/store/app-store';
import {useDownloadStore} from '@/store/download-store';

export function useSocket() {
  const setConnected = useAppStore((s) => s.setConnected);
  const {onProgress, onConversionProgress, onBatchComplete, onError, setRunning, clearDone} = useDownloadStore();

  useEffect(() => {
    const s = getSocket();

    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    if (s.connected) setConnected(true);

    s.on(
      ON.DOWNLOAD_PROGRESS,
      (data: {
        itemId?: string;
        percentage?: number;
        currentTrack?: string;
        current?: number;
        total?: number;
        itemStatus?: string;
        itemProgress?: number;
      }) => {
        onProgress(data);
      },
    );

    s.on(ON.DIRECT_DOWNLOAD_PROGRESS, (data: {phase: string; message: string; percentage: number; itemId?: string}) => {
      onConversionProgress(data);
    });

    s.on(ON.DOWNLOAD_COMPLETE, (data: {count?: number; files?: string[]}) => {
      const count = data.count ?? data.files?.length ?? 1;
      onBatchComplete(count);
      toast.success(`Download complete — ${count} track${count > 1 ? 's' : ''}`);
      // Retire finished rows shortly after, so the list settles back to what
      // is actually still running instead of accumulating completed entries.
      window.setTimeout(() => clearDone(), 4000);
    });

    s.on(ON.DOWNLOAD_ERROR, (data: {message?: string; itemId?: string}) => {
      const id = data.itemId ?? '__error__';
      onError(id, data.message ?? 'Download failed');
      toast.error(data.message ?? 'Download failed');
    });

    s.on(ON.DIRECT_DOWNLOAD_START, () => setRunning(true));

    return () => {
      s.off('connect');
      s.off('disconnect');
      s.off(ON.DOWNLOAD_PROGRESS);
      s.off(ON.DIRECT_DOWNLOAD_PROGRESS);
      s.off(ON.DOWNLOAD_COMPLETE);
      s.off(ON.DOWNLOAD_ERROR);
      s.off(ON.DIRECT_DOWNLOAD_START);
    };
  }, [setConnected, onProgress, onConversionProgress, onBatchComplete, onError, setRunning, clearDone]);
}
