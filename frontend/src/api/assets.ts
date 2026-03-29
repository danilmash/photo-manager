import type { AxiosProgressEvent } from 'axios';
import { api } from './client';

export type AssetStatus = 'importing' | 'ready' | 'error' | string;

export interface UploadAssetResponse {
  asset_id: string;
  job_id: string;
  filename: string;
  status: string;
}

export interface AssetStatusResponse {
  asset_id: string;
  status: string;
}

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

export async function uploadAsset(
  file: File,
  onUploadProgress?: (event: AxiosProgressEvent) => void,
): Promise<UploadAssetResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<UploadAssetResponse>('/assets/upload', formData, {
    onUploadProgress,
  });
  return data;
}

export async function getAssetStatus(assetId: string): Promise<AssetStatusResponse> {
  const { data } = await api.get<AssetStatusResponse>(`/assets/${assetId}/status`);
  return data;
}

