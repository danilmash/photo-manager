import { create } from 'zustand';
import { api } from '../api/client';
import { AxiosError } from 'axios';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: string;
}

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
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
      const message =
        err instanceof AxiosError
          ? err.response?.data?.detail ?? 'Ошибка авторизации'
          : 'Ошибка авторизации';
      throw new Error(message);
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
}));
