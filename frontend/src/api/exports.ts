import { api } from './client';

export interface ExportJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total: number;
  processed: number;
  error: string | null;
  download_ready: boolean;
  created_at: string;
  expires_at: string | null;
}

export async function createExportJob(assetIds: string[]): Promise<ExportJob> {
  const { data } = await api.post<ExportJob>('/exports', {
    asset_ids: assetIds,
  });
  return data;
}

export async function getExportJob(jobId: string): Promise<ExportJob> {
  const { data } = await api.get<ExportJob>(`/exports/${jobId}`);
  return data;
}

export function getExportDownloadUrl(jobId: string): string {
  return `/api/v1/exports/${jobId}/download`;
}

export function triggerExportDownload(jobId: string): void {
  const link = document.createElement('a');
  link.href = getExportDownloadUrl(jobId);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
