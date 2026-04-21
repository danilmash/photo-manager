import { AxiosError } from 'axios';
import { create } from 'zustand';

import {
  getAssetStatus,
  listAssets,
  uploadAsset,
  type AssetListItem,
} from '../api/assets';
import {
  closeImportBatch,
  createImportBatch,
  getImportBatch,
  listImportBatches,
  type ImportBatch,
} from '../api/importBatches';
import { useAssetsFeedStore } from './useAssetsFeedStore';

export type UploadPhase = 'uploading' | 'uploaded' | 'error';

export interface UploadRow {
  id: string;
  fileName: string;
  progress: number;
  phase: UploadPhase;
  message?: string;
  assetId?: string;
}

interface ImportSessionState {
  batches: ImportBatch[];
  isListLoading: boolean;
  listError: string | null;

  // Ассеты активной партии; другие партии не грузим, чтобы не тратить
  // трафик — переключаемся только при заходе на /import/:batchId.
  assetsByBatch: Record<string, AssetListItem[]>;
  assetsLoadingByBatch: Record<string, boolean>;

  // Строки прогресса загрузки: живут отдельно от ассетов, т.к. включают
  // состояния «загружается/ошибка» до появления ассета на бэке.
  uploadsByBatch: Record<string, UploadRow[]>;

  fetchBatches: () => Promise<void>;
  createBatch: () => Promise<ImportBatch>;
  closeBatch: (batchId: string) => Promise<void>;
  refreshBatch: (batchId: string) => Promise<ImportBatch | null>;

  fetchBatchAssets: (batchId: string) => Promise<void>;
  startUploads: (batchId: string, files: File[]) => void;
  clearCompletedUploads: (batchId: string) => void;

  startBatchPolling: (batchId: string) => void;
  stopBatchPolling: () => void;
}

const POLL_INTERVAL_MS = 1500;
const HOME_REFRESH_THROTTLE_MS = 2500;

// Живут вне стора, чтобы не ререндерить компоненты из-за служебных ссылок.
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollBatchId: string | null = null;
let lastHomeRefreshAt = 0;

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function parseError(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const d = err.response?.data as { detail?: string | string[] } | undefined;
    if (typeof d?.detail === 'string') return d.detail;
    if (Array.isArray(d?.detail)) return d.detail.map(String).join(', ');
  }
  return fallback;
}

function mergeAssets(
  prev: AssetListItem[],
  next: AssetListItem[],
): AssetListItem[] {
  const byId = new Map<string, AssetListItem>();
  for (const item of prev) byId.set(item.asset_id, item);
  for (const item of next) byId.set(item.asset_id, item);
  // Порядок — как на бэке (created_at desc), префиксуем новыми.
  return next.length > 0
    ? [
        ...next,
        ...prev.filter((p) => !next.some((n) => n.asset_id === p.asset_id)),
      ]
    : Array.from(byId.values());
}

function hasNonFinalAsset(assets: AssetListItem[] | undefined): boolean {
  if (!assets) return false;
  return assets.some(
    (a) => a.status === 'queued_preview' || a.status === 'processing',
  );
}

function upsertBatch(
  list: ImportBatch[],
  batch: ImportBatch,
): ImportBatch[] {
  const idx = list.findIndex((b) => b.id === batch.id);
  if (idx === -1) return [batch, ...list];
  const copy = list.slice();
  copy[idx] = batch;
  return copy;
}

function maybeRefreshHomeFeed() {
  const now = Date.now();
  if (now - lastHomeRefreshAt < HOME_REFRESH_THROTTLE_MS) return;
  lastHomeRefreshAt = now;
  const feed = useAssetsFeedStore.getState();
  if (!feed.isLoading) {
    void feed.loadInitial().catch(() => {});
  }
}

export const useImportSessionStore = create<ImportSessionState>((set, get) => ({
  batches: [],
  isListLoading: false,
  listError: null,
  assetsByBatch: {},
  assetsLoadingByBatch: {},
  uploadsByBatch: {},

  fetchBatches: async () => {
    set({ isListLoading: true, listError: null });
    try {
      const batches = await listImportBatches({ limit: 100 });
      set({ batches, isListLoading: false });
    } catch (err) {
      set({
        isListLoading: false,
        listError: parseError(err, 'Не удалось загрузить список партий'),
      });
    }
  },

  createBatch: async () => {
    const batch = await createImportBatch();
    set((state) => ({
      batches: upsertBatch(state.batches, batch),
      assetsByBatch: { ...state.assetsByBatch, [batch.id]: [] },
    }));
    return batch;
  },

  closeBatch: async (batchId) => {
    const updated = await closeImportBatch(batchId);
    set((state) => ({
      batches: upsertBatch(state.batches, updated),
    }));
  },

  refreshBatch: async (batchId) => {
    try {
      const batch = await getImportBatch(batchId);
      set((state) => ({
        batches: upsertBatch(state.batches, batch),
      }));
      return batch;
    } catch {
      return null;
    }
  },

  fetchBatchAssets: async (batchId) => {
    set((state) => ({
      assetsLoadingByBatch: {
        ...state.assetsLoadingByBatch,
        [batchId]: true,
      },
    }));
    try {
      // Берём с запасом — в рамках партии ожидается обозримое число файлов.
      const res = await listAssets({ batchId, limit: 200 });
      set((state) => ({
        assetsByBatch: { ...state.assetsByBatch, [batchId]: res.items },
        assetsLoadingByBatch: {
          ...state.assetsLoadingByBatch,
          [batchId]: false,
        },
      }));
    } catch {
      set((state) => ({
        assetsLoadingByBatch: {
          ...state.assetsLoadingByBatch,
          [batchId]: false,
        },
      }));
    }
  },

  startUploads: (batchId, files) => {
    if (files.length === 0) return;

    const rows: UploadRow[] = files.map((f) => ({
      id: makeId(),
      fileName: f.name,
      progress: 0,
      phase: 'uploading',
    }));

    set((state) => ({
      uploadsByBatch: {
        ...state.uploadsByBatch,
        [batchId]: [...(state.uploadsByBatch[batchId] ?? []), ...rows],
      },
    }));

    const patchRow = (rowId: string, patch: Partial<UploadRow>) => {
      set((state) => {
        const list = state.uploadsByBatch[batchId] ?? [];
        return {
          uploadsByBatch: {
            ...state.uploadsByBatch,
            [batchId]: list.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
          },
        };
      });
    };

    const runOne = async (row: UploadRow, file: File) => {
      try {
        const res = await uploadAsset(
          file,
          (e) => {
            const total = e.total ?? 0;
            const pct = total > 0 ? Math.round((e.loaded / total) * 100) : 0;
            patchRow(row.id, { progress: pct, phase: 'uploading' });
          },
          { batchId },
        );

        patchRow(row.id, {
          progress: 100,
          phase: 'uploaded',
          assetId: res.asset_id,
        });

        // Добавляем плейсхолдер в сетку, чтобы пользователь сразу увидел плитку.
        const placeholder: AssetListItem = {
          asset_id: res.asset_id,
          title: res.filename,
          status: (res.status as AssetListItem['status']) ?? 'queued_preview',
          created_at: new Date().toISOString(),
          thumbnail_file_id: null,
          thumbnail_url: null,
          preview_file_id: null,
          preview_url: null,
        };
        set((state) => {
          const current = state.assetsByBatch[batchId] ?? [];
          if (current.some((a) => a.asset_id === placeholder.asset_id)) {
            return state;
          }
          return {
            assetsByBatch: {
              ...state.assetsByBatch,
              [batchId]: [placeholder, ...current],
            },
          };
        });
      } catch (err) {
        patchRow(row.id, {
          phase: 'error',
          message: parseError(err, 'Ошибка загрузки'),
        });
      }
    };

    void Promise.all(rows.map((row, i) => runOne(row, files[i])));
  },

  clearCompletedUploads: (batchId) => {
    set((state) => ({
      uploadsByBatch: {
        ...state.uploadsByBatch,
        [batchId]: (state.uploadsByBatch[batchId] ?? []).filter(
          (r) => r.phase === 'uploading',
        ),
      },
    }));
  },

  startBatchPolling: (batchId) => {
    // Перезапускаем только если таргет сменился.
    if (pollBatchId === batchId && pollTimer !== null) return;

    get().stopBatchPolling();
    pollBatchId = batchId;

    const tick = async () => {
      // Если за время ожидания поллинг переключили — игнорируем результат.
      const currentTarget = pollBatchId;
      if (currentTarget !== batchId) return;

      try {
        const [assetsRes, batch] = await Promise.all([
          listAssets({ batchId, limit: 200 }),
          getImportBatch(batchId),
        ]);

        if (pollBatchId !== batchId) return;

        set((state) => {
          const prevAssets = state.assetsByBatch[batchId] ?? [];
          return {
            batches: upsertBatch(state.batches, batch),
            assetsByBatch: {
              ...state.assetsByBatch,
              [batchId]: mergeAssets(prevAssets, assetsRes.items),
            },
          };
        });

        const state = get();
        const assets = state.assetsByBatch[batchId];
        const allFinal = !hasNonFinalAsset(assets);
        const batchFinal = batch.status !== 'processing';

        if (allFinal && batchFinal) {
          get().stopBatchPolling();
        }

        if (assets?.some((a) => a.status === 'ready')) {
          maybeRefreshHomeFeed();
        }
      } catch {
        // игнорируем одиночные ошибки, поллинг продолжается
      }
    };

    // Первый прогон сразу, чтобы не ждать 1.5s.
    void tick();
    pollTimer = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
  },

  stopBatchPolling: () => {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollBatchId = null;
  },
}));

// Совместимость с потреблением по статусу отдельного ассета (если потребуется)
export async function waitAssetReady(assetId: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { status } = await getAssetStatus(assetId);
      if (status === 'ready' || status === 'error' || status === 'preview_ready') {
        return status;
      }
    } catch {
      return 'error';
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 'error';
}
