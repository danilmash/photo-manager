import { create } from 'zustand';
import { AxiosError } from 'axios';
import { listAssets, type AssetListItem } from '../api/assets';

interface TrashFeedStore {
  items: AssetListItem[];
  nextCursor: string | null;
  isLoading: boolean;
  error: string | null;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  removeItem: (assetId: string) => void;
}

function mergeUniqueByAssetId(prev: AssetListItem[], next: AssetListItem[]): AssetListItem[] {
  const map = new Map<string, AssetListItem>();
  for (const item of prev) map.set(item.asset_id, item);
  for (const item of next) map.set(item.asset_id, item);
  return Array.from(map.values());
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

export const useTrashFeedStore = create<TrashFeedStore>((set, get) => ({
  items: [],
  nextCursor: null,
  isLoading: false,
  error: null,

  loadInitial: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await listAssets({ limit: 50, cursor: null, lifecycle: 'trashed' });
      set({
        items: data.items,
        nextCursor: data.next_cursor,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Ошибка загрузки корзины'),
      });
      throw new Error(getErrorMessage(err, 'Ошибка загрузки корзины'));
    }
  },

  loadMore: async () => {
    const state = get();
    if (state.isLoading) return;
    if (!state.nextCursor) return;

    set({ isLoading: true, error: null });
    try {
      const data = await listAssets({
        limit: 50,
        cursor: state.nextCursor,
        lifecycle: 'trashed',
      });
      set({
        items: mergeUniqueByAssetId(state.items, data.items),
        nextCursor: data.next_cursor,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Ошибка загрузки корзины'),
      });
    }
  },

  removeItem: (assetId) => {
    set((state) => ({
      items: state.items.filter((item) => item.asset_id !== assetId),
    }));
  },
}));
