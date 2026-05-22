import { create } from 'zustand';
import { api } from '../api/client';
import { AxiosError } from 'axios';
import type { MeUpdateBody, UserPublic } from '../api/users';
import { updateMe } from '../api/users';

export type User = UserPublic;

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  updateProfile: (body: MeUpdateBody) => Promise<void>;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map((d) => d.msg ?? String(d)).join(', ');
  }
  return fallback;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password) => {
    try {
      const { data } = await api.post<{ user: User }>('/auth/login', { email, password });
      set({ user: data.user, isAuthenticated: true });
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Ошибка авторизации'));
    }
  },

  logout: async () => {
    await api.post('/auth/logout');
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    try {
      const { data } = await api.get<User>('/auth/me');
      set({ user: data, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  updateProfile: async (body) => {
    try {
      const user = await updateMe(body);
      set({ user });
    } catch (err) {
      throw new Error(extractErrorMessage(err, 'Не удалось обновить профиль'));
    }
  },
}));
