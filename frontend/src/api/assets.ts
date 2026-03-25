import { api } from './client';

export type AssetStatus = 'importing' | 'ready' | 'error' | string;

export interface AssetListItem {
  asset_id: string;
  title: string | null;
  status: AssetStatus;
  created_at: string;
  thumbnail_file_id: string | null;
  thumbnail_url: string | null;
}

export interface AssetListResponse {
  items: AssetListItem[];
  next_cursor: string | null;
}

export async function listAssets(params?: {
  limit?: number;
  cursor?: string | null;
}): Promise<AssetListResponse> {
  const { data } = await api.get<AssetListResponse>('/assets', {
    params: {
      limit: params?.limit,
      cursor: params?.cursor ?? undefined,
    },
  });
  return data;
}

