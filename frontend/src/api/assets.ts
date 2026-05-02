import type { AxiosProgressEvent } from 'axios';
import type { PhotoRecipe } from './recipe';
import { api } from './client';

export type AssetStatus =
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'partial_error'
  | 'error'
  | string;

export type TaskStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | string;

/** Последняя (или запрошенная) версия ассета — те же поля, что и в AssetViewer.version */
export interface AssetVersionSummary {
  id: string;
  version_number: number;
  base_version_id: string | null;
  status: AssetStatus;
  preview_status: TaskStatus;
  faces_status: TaskStatus;
  preview_error: string | null;
  faces_error: string | null;
  recipe: Record<string, unknown>;
  rendered_width: number | null;
  rendered_height: number | null;
  is_identity_source: boolean;
  preview_file_id: string | null;
  preview_url: string | null;
  thumbnail_file_id: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export interface UploadAssetResponse {
  asset_id: string;
  version_id: string;
  version_number: number;
  status: AssetStatus;
  preview_status: TaskStatus;
  faces_status: TaskStatus;
  preview_error: string | null;
  faces_error: string | null;
  job_id: string;
  filename: string;
}

/** Ответ GET /assets/:id/status и retry-* — статус текущей (последней) версии */
export interface AssetVersionStatus {
  asset_id: string;
  version_id: string;
  version_number: number;
  status: AssetStatus;
  preview_status: TaskStatus;
  faces_status: TaskStatus;
  preview_error: string | null;
  faces_error: string | null;
}

export interface AssetListItem {
  asset_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  /** Последняя версия по version_number; после загрузки обычно не null */
  version: AssetVersionSummary | null;
}

export interface AssetListResponse {
  items: AssetListItem[];
  next_cursor: string | null;
}

export async function listAssets(params?: {
  limit?: number;
  cursor?: string | null;
  batchId?: string | null;
}): Promise<AssetListResponse> {
  const { data } = await api.get<AssetListResponse>('/assets', {
    params: {
      limit: params?.limit,
      cursor: params?.cursor ?? undefined,
      batch_id: params?.batchId ?? undefined,
    },
  });
  return data;
}

export async function uploadAsset(
  file: File,
  onUploadProgress?: (event: AxiosProgressEvent) => void,
  opts?: { batchId?: string | null },
): Promise<UploadAssetResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (opts?.batchId) {
    formData.append('batch_id', opts.batchId);
  }

  const { data } = await api.post<UploadAssetResponse>('/assets/upload', formData, {
    onUploadProgress,
  });

  return data;
}

export async function getAssetStatus(assetId: string): Promise<AssetVersionStatus> {
  const { data } = await api.get<AssetVersionStatus>(`/assets/${assetId}/status`);
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
  asset_version_id: string;
  identity_id: string | null;
  person_id: string | null;
  person_name: string | null;
  bbox: unknown | null;
  confidence: number | null;
  quality_score: number | null;
  is_reference: boolean;
  assignment_source: string | null;
  review_required: boolean;
  review_state: string | null;
  candidates: AssetViewerFaceCandidate[];
}

export interface AssetViewerFaceCandidate {
  person_id: string;
  person_name: string | null;
  best_identity_id: string;
  rank: number;
  score: number;
}

export interface AssetViewer {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string | null;
  version: AssetVersionSummary | null;
  photo: AssetPhotoInfo;
  faces: AssetViewerFace[];
  faces_count: number;
  /** Партия импорта; без неё список дубликатов из сканера недоступен. */
  import_batch_id?: string | null;
  duplicate_review_status?: string | null;
  duplicate_of_asset_id?: string | null;
}

export async function getAssetViewer(assetId: string): Promise<AssetViewer> {
  const { data } = await api.get<AssetViewer>(`/assets/${assetId}`);
  return data;
}

export interface AssetVersionJobResponse {
  asset_id: string;
  version_id: string;
  version_number: number;
  status: AssetStatus;
  preview_status: TaskStatus;
  faces_status: TaskStatus;
  preview_error: string | null;
  faces_error: string | null;
  job_id: string;
}

/** Новая версия с заданным рецептом; бэкенд ставит превью/лица в очередь. */
export async function createAssetVersion(
  assetId: string,
  body: { recipe: PhotoRecipe; base_version_id?: string | null },
): Promise<AssetVersionJobResponse> {
  const { data } = await api.post<AssetVersionJobResponse>(`/assets/${assetId}/versions`, {
    recipe: body.recipe,
    base_version_id: body.base_version_id ?? undefined,
  });
  return data;
}

export async function retryAssetPreview(
  assetId: string,
  versionId: string,
): Promise<AssetVersionStatus> {
  const { data } = await api.post<AssetVersionStatus>(
    `/assets/${assetId}/versions/${versionId}/retry-preview`,
  );
  return data;
}

export async function retryAssetFaces(
  assetId: string,
  versionId: string,
): Promise<AssetVersionStatus> {
  const { data } = await api.post<AssetVersionStatus>(
    `/assets/${assetId}/versions/${versionId}/retry-faces`,
  );
  return data;
}

export interface AssetMetadata {
  version_id: string | null;
  version_number: number | null;
  base_version_id: string | null;
  status: string | null;
  preview_status: string | null;
  faces_status: string | null;
  preview_error: string | null;
  faces_error: string | null;
  recipe: Record<string, unknown> | null;
  exif: Record<string, unknown> | null;
  iptc: Record<string, unknown> | null;
  xmp: Record<string, unknown> | null;
  other: Record<string, unknown> | null;
  rating: number | null;
  keywords: string[];
  rendered_width: number | null;
  rendered_height: number | null;
  is_identity_source: boolean | null;
  created_at: string | null;
}

export interface AssetMetadataResponse {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string | null;
  metadata: AssetMetadata | null;
}

export async function getAssetMetadata(assetId: string): Promise<AssetMetadataResponse> {
  const { data } = await api.get<AssetMetadataResponse>(`/assets/${assetId}/metadata`);
  return data;
}
