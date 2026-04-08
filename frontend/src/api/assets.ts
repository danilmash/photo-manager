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
  preview_file_id: string | null;
  preview_url: string | null;
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

/**
 * Viewer / Drawer
 */

export interface AssetPhotoInfo {
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: unknown | null;
  height: unknown | null;
  taken_at: unknown | null;
  camera_make: unknown | null;
  camera_model: unknown | null;
  lens: unknown | null;
  iso: unknown | null;
  aperture: unknown | null;
  shutter_speed: unknown | null;
  focal_length: unknown | null;
  rating: number | null;
  keywords: string[];
}

export interface AssetViewerFace {
  id: string;
  person_id: string | null;
  person_name: string | null;
  bbox: unknown | null;
  confidence: number | null;
}

export interface AssetViewer {
  id: string;
  title: string | null;
  status: AssetStatus;
  created_at: string;
  updated_at: string | null;
  preview_file_id: string | null;
  preview_url: string | null;
  photo: AssetPhotoInfo;
  faces: AssetViewerFace[];
  faces_count: number;
}

export async function getAssetViewer(assetId: string): Promise<AssetViewer> {
  const { data } = await api.get<AssetViewer>(`/assets/${assetId}`);
  return data;
}

export interface AssetMetadata {
  version_id: string | null;
  version_number: number | null;
  exif: Record<string, unknown> | null;
  iptc: Record<string, unknown> | null;
  xmp: Record<string, unknown> | null;
  other: Record<string, unknown> | null;
  rating: number | null;
  keywords: string[];
  created_at: string | null;
}

export interface AssetMetadataResponse {
  id: string;
  title: string | null;
  status: AssetStatus;
  created_at: string;
  updated_at: string | null;
  metadata: AssetMetadata | null;
}

export async function getAssetMetadata(assetId: string): Promise<AssetMetadataResponse> {
  const { data } = await api.get<AssetMetadataResponse>(`/assets/${assetId}/metadata`);
  return data;
}