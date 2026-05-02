import { api } from './client';

export type ImportBatchStatus =
  | 'uploading'
  | 'processing'
  | 'pending_review'
  | 'accepted'
  | 'rejected'
  | 'cancelled';

export interface ImportBatch {
  id: string;
  project_id: string | null;
  status: ImportBatchStatus;
  note: string | null;
  assets_count: number;
  created_at: string;
  updated_at: string;
}

export interface ListImportBatchesParams {
  status?: ImportBatchStatus;
  project_id?: string;
  in_main_library?: boolean;
  limit?: number;
  offset?: number;
}

export async function listImportBatches(
  params?: ListImportBatchesParams,
): Promise<ImportBatch[]> {
  const { data } = await api.get<ImportBatch[]>('/import-batches', {
    params: {
      status: params?.status,
      project_id: params?.project_id,
      in_main_library: params?.in_main_library,
      limit: params?.limit,
      offset: params?.offset,
    },
  });
  return data;
}

export async function createImportBatch(body?: {
  note?: string | null;
}): Promise<ImportBatch> {
  const { data } = await api.post<ImportBatch>('/import-batches', {
    note: body?.note ?? null,
  });
  return data;
}

export async function getImportBatch(batchId: string): Promise<ImportBatch> {
  const { data } = await api.get<ImportBatch>(`/import-batches/${batchId}`);
  return data;
}

export async function closeImportBatch(batchId: string): Promise<ImportBatch> {
  const { data } = await api.post<ImportBatch>(
    `/import-batches/${batchId}/close`,
  );
  return data;
}

export interface ImportBatchRetrySummary {
  batch_id: string;
  restarted: number;
}

export async function retryBatchFailedPreviews(
  batchId: string,
): Promise<ImportBatchRetrySummary> {
  const { data } = await api.post<ImportBatchRetrySummary>(
    `/import-batches/${batchId}/retry-failed-previews`,
  );
  return data;
}

export async function retryBatchFailedFaces(
  batchId: string,
): Promise<ImportBatchRetrySummary> {
  const { data } = await api.post<ImportBatchRetrySummary>(
    `/import-batches/${batchId}/retry-failed-faces`,
  );
  return data;
}

/** Элемент группы дубликатов (ответ GET duplicate-groups). */
export interface ImportBatchDuplicateCandidateItem {
  id: string;
  candidate_asset_id: string;
  candidate_title: string | null;
  candidate_preview_url: string | null;
  duplicate_type: string;
  score: number | null;
  distance: number | null;
  rank: number;
  review_decision: string | null;
}

export interface ImportBatchDuplicateGroup {
  source_asset_id: string;
  source_title: string | null;
  source_preview_url: string | null;
  duplicate_review_status: string;
  candidates: ImportBatchDuplicateCandidateItem[];
}

export interface ImportBatchDuplicatesResponse {
  groups: ImportBatchDuplicateGroup[];
}

export async function getImportBatchDuplicateGroups(
  batchId: string,
): Promise<ImportBatchDuplicatesResponse> {
  const { data } = await api.get<ImportBatchDuplicatesResponse>(
    `/import-batches/${batchId}/duplicate-groups`,
  );
  return data;
}

/** Решение по паре источник ↔ кандидат (PATCH duplicate-candidates). */
export type DuplicateReviewDecision =
  | 'confirmed_duplicate'
  | 'rejected'
  | 'kept_both';

export async function reviewImportBatchDuplicateCandidate(
  batchId: string,
  candidateRowId: string,
  decision: DuplicateReviewDecision,
): Promise<ImportBatchDuplicateCandidateItem> {
  const { data } = await api.patch<ImportBatchDuplicateCandidateItem>(
    `/import-batches/${batchId}/duplicate-candidates/${candidateRowId}`,
    { decision },
  );
  return data;
}
