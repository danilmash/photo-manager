import { create } from 'zustand';
import { AxiosError } from 'axios';
import {
  listAssets,
  searchAssetsSemantic,
  type AssetFilters,
  type AssetListItem,
} from '../api/assets';

export type { AssetFilters };

function emptyFilters(): AssetFilters {
  return {
    tags: [],
    takenFrom: '',
    takenTo: '',
    camera: '',
  };
}

function hasActiveFilters(filters: AssetFilters): boolean {
  return (
    (filters.tags?.length ?? 0) > 0 ||
    Boolean(filters.takenFrom) ||
    Boolean(filters.takenTo) ||
    Boolean(filters.camera?.trim())
  );
}

interface AssetsFeedStore {
  items: AssetListItem[];
  nextCursor: string | null;
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  folderId: string | null;
  filters: AssetFilters;
  filtersActive: boolean;
  personId: string | null;
  personName: string | null;
  personFilterActive: boolean;
  setFolderId: (folderId: string | null) => void;
  setFilters: (filters: AssetFilters) => void;
  applyFilters: (filters: AssetFilters) => Promise<void>;
  clearFilters: () => Promise<void>;
  applyPersonFilter: (personId: string, personName: string) => Promise<void>;
  clearPersonFilter: () => Promise<void>;
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

function buildListAssetsParams(
  state: Pick<
    AssetsFeedStore,
    'folderId' | 'filtersActive' | 'filters' | 'personFilterActive' | 'personId'
  >,
  options?: { cursor?: string | null; limit?: number },
) {
  return {
    limit: options?.limit ?? 50,
    cursor: options?.cursor ?? null,
    folderId: state.folderId,
    personId: state.personFilterActive ? state.personId : null,
    filters: state.filtersActive ? state.filters : undefined,
  };
}

export const useAssetsFeedStore = create<AssetsFeedStore>((set, get) => ({
  items: [],
  nextCursor: null,
  isLoading: false,
  error: null,
  searchQuery: '',
  folderId: null,
  filters: emptyFilters(),
  filtersActive: false,
  personId: null,
  personName: null,
  personFilterActive: false,

  setFolderId: (folderId) => {
    if (folderId) {
      set({
        folderId,
        personId: null,
        personName: null,
        personFilterActive: false,
      });
      return;
    }
    set({ folderId });
  },

  setFilters: (filters) => {
    set({ filters });
  },

  applyFilters: async (filters) => {
    const normalized: AssetFilters = {
      tags: filters.tags ?? [],
      takenFrom: filters.takenFrom ?? '',
      takenTo: filters.takenTo ?? '',
      camera: filters.camera ?? '',
    };
    const active = hasActiveFilters(normalized);
    set({
      filters: normalized,
      filtersActive: active,
      searchQuery: '',
      isLoading: true,
      error: null,
    });

    try {
      const data = await listAssets(buildListAssetsParams(get()));
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

  clearFilters: async () => {
    set({
      filters: emptyFilters(),
      filtersActive: false,
    });
    await get().loadInitial();
  },

  applyPersonFilter: async (personId, personName) => {
    set({
      personId,
      personName,
      personFilterActive: true,
      searchQuery: '',
      isLoading: true,
      error: null,
    });

    try {
      const data = await listAssets(buildListAssetsParams(get()));
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

  clearPersonFilter: async () => {
    set({
      personId: null,
      personName: null,
      personFilterActive: false,
    });
    await get().loadInitial();
  },

  loadInitial: async () => {
    set({ isLoading: true, error: null, searchQuery: '' });
    try {
      const data = await listAssets(buildListAssetsParams(get()));
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
    const state = get();
    if (state.isLoading) return;
    if (state.searchQuery) return;
    if (!state.nextCursor) return;

    set({ isLoading: true, error: null });
    try {
      const data = await listAssets(
        buildListAssetsParams(state, { cursor: state.nextCursor }),
      );
      set({
        items: mergeUniqueByAssetId(state.items, data.items),
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
    set({
      isLoading: true,
      error: null,
      searchQuery: trimmed,
      filtersActive: false,
      filters: emptyFilters(),
      personId: null,
      personName: null,
      personFilterActive: false,
    });
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
