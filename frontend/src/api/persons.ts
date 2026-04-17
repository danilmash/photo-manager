import { api } from './client';

export interface PersonListItem {
  id: string;
  name: string;
  photos_count: number;
  cover_url: string | null;
}

export async function listPersons(): Promise<PersonListItem[]> {
  const { data } = await api.get<PersonListItem[]>('/faces/persons');
  return data;
}
