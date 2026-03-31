import { create } from 'zustand';
import { AxiosError } from 'axios';
import { uploadAsset, getAssetStatus } from '../api/assets';
import { useAssetsFeedStore } from './useAssetsFeedStore';

type RowPhase = 'uploading' | 'processing' | 'ready' | 'error';

export interface UploadRow {
  id: string;
  fileName: string;
  progress: number;
  phase: RowPhase;
  message?: string;
}

const POLL_MS = 1000;
const POLL_TIMEOUT_MS = 120_000;
const HOME_REFRESH_THROTTLE_MS = 2500;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function isFileList(arg: unknown): arg is FileList {
  return typeof FileList !== 'undefined' && arg instanceof FileList;
}

function parseUploadError(err: unknown): string {
  let msg = 'Ошибка загрузки';
  if (err instanceof AxiosError) {
    const d = err.response?.data as { detail?: string | string[] } | undefined;
    if (typeof d?.detail === 'string') msg = d.detail;
    else if (Array.isArray(d?.detail)) msg = d.detail.map(String).join(', ');
  }
  return msg;
}

let lastHomeRefreshAt = 0;

export const useImportStore = create<{
  rows: UploadRow[];
  startImport: (files: File[] | FileList) => Promise<void>;
  reset: () => void;
  setRow: (id: string, patch: Partial<UploadRow>) => void;
}>((set, get) => ({
  rows: [],

  reset: () => set({ rows: [] }),

  setRow: (id, patch) =>
    set((prev) => ({
      rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  startImport: async (files) => {
    const fileArray: File[] = isFileList(files) ? Array.from(files) : files;
    if (fileArray.length === 0) return;

    const newRows: UploadRow[] = fileArray.map((f) => ({
      id: makeId(),
      fileName: f.name,
      progress: 0,
      phase: 'uploading',
    }));

    set((prev) => ({ rows: [...prev.rows, ...newRows] }));

    const startRow = async (row: UploadRow, file: File) => {
      try {
        const res = await uploadAsset(file, (e) => {
          const total = e.total ?? 0;
          const pct = total > 0 ? Math.round((e.loaded / total) * 100) : 0;
          get().setRow(row.id, { progress: pct, phase: 'uploading' });
        });

        get().setRow(row.id, { progress: 100, phase: 'processing' });

        const start = Date.now();
        while (Date.now() - start < POLL_TIMEOUT_MS) {
          try {
            const { status } = await getAssetStatus(res.asset_id);
            if (status === 'ready') {
              get().setRow(row.id, { phase: 'ready', progress: 100 });

              const now = Date.now();
              if (now - lastHomeRefreshAt >= HOME_REFRESH_THROTTLE_MS) {
                lastHomeRefreshAt = now;
                const feed = useAssetsFeedStore.getState();
                // Обновляем ленту, чтобы новые фото появились на HomePage
                // но избегаем гонок, если загрузка уже идёт.
                if (!feed.isLoading) {
                  void feed.loadInitial().catch(() => {});
                }
              }
              return;
            }
            if (status === 'error') {
              get().setRow(row.id, { phase: 'error', message: 'Ошибка обработки' });
              return;
            }
            get().setRow(row.id, { phase: 'processing' });
          } catch {
            get().setRow(row.id, { phase: 'error', message: 'Не удалось получить статус' });
            return;
          }

          await sleep(POLL_MS);
        }

        get().setRow(row.id, { phase: 'error', message: 'Таймаут обработки' });
      } catch (err) {
        get().setRow(row.id, { phase: 'error', message: parseUploadError(err) });
      }
    };

    // Важно: не ждём завершения всех файлов, чтобы UI не блокировался
    void Promise.all(newRows.map((row, i) => startRow(row, fileArray[i])));
  },
}));

