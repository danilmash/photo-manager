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
