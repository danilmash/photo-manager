import { create } from 'zustand';
import { AxiosError } from 'axios';
import {
  createFolder as createFolderApi,
  deleteFolder as deleteFolderApi,
  listFolders,
  updateFolder as updateFolderApi,
  type FolderSummary,
} from '../api/folders';

interface FoldersStore {
  items: FolderSummary[];
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  fetchFolders: () => Promise<void>;
  createFolder: (name: string) => Promise<FolderSummary>;
  renameFolder: (folderId: string, name: string) => Promise<FolderSummary>;
  removeFolder: (folderId: string) => Promise<void>;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
  }
  return fallback;
}

export const useFoldersStore = create<FoldersStore>((set, get) => ({
  items: [],
  isLoading: false,
  hasLoaded: false,
  error: null,

  fetchFolders: async () => {
    set({ isLoading: true, error: null });
    try {
      const data = await listFolders();
      set({ items: data.items, isLoading: false, hasLoaded: true });
    } catch (err) {
      set({
        isLoading: false,
        hasLoaded: true,
        error: getErrorMessage(err, 'Не удалось загрузить папки'),
      });
    }
  },

  createFolder: async (name) => {
    try {
      const folder = await createFolderApi(name);
      set({ items: [...get().items, folder].sort((a, b) => a.name.localeCompare(b.name, 'ru')) });
      return folder;
    } catch (err) {
      throw new Error(getErrorMessage(err, 'Не удалось создать папку'));
    }
  },

  renameFolder: async (folderId, name) => {
    try {
      const folder = await updateFolderApi(folderId, name);
      set({
        items: get()
          .items.map((item) => (item.id === folderId ? folder : item))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      });
      return folder;
    } catch (err) {
      throw new Error(getErrorMessage(err, 'Не удалось переименовать папку'));
    }
  },

  removeFolder: async (folderId) => {
    try {
      await deleteFolderApi(folderId);
      set({ items: get().items.filter((item) => item.id !== folderId) });
    } catch (err) {
      throw new Error(getErrorMessage(err, 'Не удалось удалить папку'));
    }
  },
}));
