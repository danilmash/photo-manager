import { create } from 'zustand';
import { AxiosError } from 'axios';
import { listAssets, type AssetListItem } from '../api/assets';

interface AssetsFeedStore {
  items: AssetListItem[];
  nextCursor: string | null;
  isLoading: boolean;
  error: string | null;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
}

function mergeUniqueByAssetId(prev: AssetListItem[], next: AssetListItem[]): AssetListItem[] {
  const map = new Map<string, AssetListItem>();
  for (const item of prev) map.set(item.asset_id, item);
  for (const item of next) map.set(item.asset_id, item);
  return Array.from(map.values());
}

export const useAssetsFeedStore = create<AssetsFeedStore>((set, get) => ({
  items: [],
  nextCursor: null,
  isLoading: false,
  error: null,

  loadInitial: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await listAssets({ limit: 50, cursor: null });
      set({
        items: data.items,
        nextCursor: data.next_cursor,
        isLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof AxiosError ? err.response?.data?.detail ?? 'Ошибка загрузки' : 'Ошибка загрузки';
      set({ isLoading: false, error: message });
      throw new Error(message);
    }
  },

  loadMore: async () => {
    const { isLoading, nextCursor, items } = get();
    if (isLoading) return;
    if (!nextCursor) return;

    set({ isLoading: true, error: null });
    try {
      const data = await listAssets({ limit: 50, cursor: nextCursor });
      set({
        items: mergeUniqueByAssetId(items, data.items),
        nextCursor: data.next_cursor,
        isLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof AxiosError ? err.response?.data?.detail ?? 'Ошибка загрузки' : 'Ошибка загрузки';
      set({ isLoading: false, error: message });
    }
  },
}));

