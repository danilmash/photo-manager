import { api } from './client';

export type UserRole = 'admin' | 'editor';

export interface UserPublic {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserListResponse {
  items: UserPublic[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListUsersParams {
  limit?: number;
  offset?: number;
  role?: UserRole;
  is_active?: boolean;
  q?: string;
}

export interface UserCreateBody {
  email: string;
  password: string;
  display_name: string;
  role?: UserRole;
}

export interface UserUpdateBody {
  display_name?: string;
  role?: UserRole;
  is_active?: boolean;
}

export interface MeUpdateBody {
  display_name?: string;
  current_password?: string;
  new_password?: string;
}

export async function listUsers(params?: ListUsersParams): Promise<UserListResponse> {
  const { data } = await api.get<UserListResponse>('/users', { params });
  return data;
}

export async function createUser(body: UserCreateBody): Promise<UserPublic> {
  const { data } = await api.post<UserPublic>('/users', body);
  return data;
}

export async function updateUser(id: string, body: UserUpdateBody): Promise<UserPublic> {
  const { data } = await api.patch<UserPublic>(`/users/${id}`, body);
  return data;
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  await api.post(`/users/${id}/reset-password`, { new_password: newPassword });
}

export async function updateMe(body: MeUpdateBody): Promise<UserPublic> {
  const { data } = await api.patch<UserPublic>('/auth/me', body);
  return data;
}
