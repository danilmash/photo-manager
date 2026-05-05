import { create } from 'zustand';
import { AxiosError } from 'axios';
import {
  listAssets,
  searchAssetsSemantic,
  type AssetListItem,
} from '../api/assets';

interface AssetsFeedStore {
  items: AssetListItem[];
  nextCursor: string | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => Promise<void>;
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
  searchQuery: '',

  loadInitial: async () => {
    set({ isLoading: true, error: null, searchQuery: '' });
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
    const { isLoading, nextCursor, items, searchQuery } = get();
    if (isLoading) return;
    if (searchQuery) return;
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

  search: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      await get().clearSearch();
      return;
    }

    set({ isLoading: true, error: null, searchQuery: trimmed });
    try {
      const data = await searchAssetsSemantic({ query: trimmed, limit: 80 });
      set({
        items: data.items,
        nextCursor: null,
        isLoading: false,
      });
    } catch (err) {
      const message =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? 'Ошибка умного поиска'
          : 'Ошибка умного поиска';
      set({ isLoading: false, error: message });
      throw new Error(message);
    }
  },

  clearSearch: async () => {
    await get().loadInitial();
  },
}));

