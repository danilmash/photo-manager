import { create } from 'zustand';
import { AxiosError } from 'axios';

import {
  createExportJob,
  getExportJob,
  triggerExportDownload,
  type ExportJob,
} from '../api/exports';

const POLL_INTERVAL_MS = 1000;

export interface ExportStoreState {
  activeJob: ExportJob | null;
  drawerOpen: boolean;
  isStarting: boolean;
  error: string | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  startExport: (assetIds: string[]) => Promise<void>;
  refreshJob: () => Promise<void>;
  openDrawer: () => void;
  closeDrawer: () => void;
  reset: () => void;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

function stopPolling(get: () => ExportStoreState) {
  const timer = get().pollTimer;
  if (timer) {
    clearInterval(timer);
  }
}

export const useExportStore = create<ExportStoreState>((set, get) => ({
  activeJob: null,
  drawerOpen: false,
  isStarting: false,
  error: null,
  pollTimer: null,

  openDrawer: () => set({ drawerOpen: true }),

  closeDrawer: () => set({ drawerOpen: false }),

  reset: () => {
    stopPolling(get);
    set({
      activeJob: null,
      drawerOpen: false,
      isStarting: false,
      error: null,
      pollTimer: null,
    });
  },

  refreshJob: async () => {
    const job = get().activeJob;
    if (!job) return;

    try {
      const updated = await getExportJob(job.id);
      set({ activeJob: updated, error: null });

      if (updated.status === 'completed' && updated.download_ready) {
        stopPolling(get);
        set({ pollTimer: null, drawerOpen: true });
        triggerExportDownload(updated.id);
      }

      if (updated.status === 'failed') {
        stopPolling(get);
        set({
          pollTimer: null,
          drawerOpen: true,
          error: updated.error ?? 'Не удалось выполнить экспорт',
        });
      }
    } catch (err) {
      stopPolling(get);
      set({
        pollTimer: null,
        error: getErrorMessage(err, 'Не удалось получить статус экспорта'),
      });
    }
  },

  startExport: async (assetIds: string[]) => {
    if (assetIds.length === 0) return;

    stopPolling(get);
    set({
      isStarting: true,
      error: null,
      drawerOpen: true,
      activeJob: null,
      pollTimer: null,
    });

    try {
      const job = await createExportJob(assetIds);
      set({ activeJob: job, isStarting: false });

      if (job.status === 'completed' && job.download_ready) {
        triggerExportDownload(job.id);
        return;
      }

      const timer = setInterval(() => {
        void get().refreshJob();
      }, POLL_INTERVAL_MS);
      set({ pollTimer: timer });
      void get().refreshJob();
    } catch (err) {
      set({
        isStarting: false,
        error: getErrorMessage(err, 'Не удалось запустить экспорт'),
      });
    }
  },
}));
