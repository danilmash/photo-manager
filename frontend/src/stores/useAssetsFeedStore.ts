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
  folderId: string | null;
  setFolderId: (folderId: string | null) => void;
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

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

export const useAssetsFeedStore = create<AssetsFeedStore>((set, get) => ({
  items: [],
  nextCursor: null,
  isLoading: false,
  error: null,
  searchQuery: '',
  folderId: null,

  setFolderId: (folderId) => {
    set({ folderId });
  },

  loadInitial: async () => {
    const { folderId } = get();
    set({ isLoading: true, error: null, searchQuery: '' });
    try {
      const data = await listAssets({
        limit: 50,
        cursor: null,
        folderId,
      });
      set({
        items: data.items,
        nextCursor: data.next_cursor,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Ошибка загрузки'),
      });
      throw new Error(getErrorMessage(err, 'Ошибка загрузки'));
    }
  },

  loadMore: async () => {
    const { isLoading, nextCursor, items, searchQuery, folderId } = get();
    if (isLoading) return;
    if (searchQuery) return;
    if (!nextCursor) return;

    set({ isLoading: true, error: null });
    try {
      const data = await listAssets({
        limit: 50,
        cursor: nextCursor,
        folderId,
      });
      set({
        items: mergeUniqueByAssetId(items, data.items),
        nextCursor: data.next_cursor,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Ошибка загрузки'),
      });
    }
  },

  search: async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      await get().clearSearch();
      return;
    }

    const { folderId } = get();
    set({ isLoading: true, error: null, searchQuery: trimmed });
    try {
      const data = await searchAssetsSemantic({
        query: trimmed,
        limit: 80,
        folderId,
      });
      set({
        items: data.items,
        nextCursor: null,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Ошибка умного поиска'),
      });
      throw new Error(getErrorMessage(err, 'Ошибка умного поиска'));
    }
  },

  clearSearch: async () => {
    await get().loadInitial();
  },
}));
