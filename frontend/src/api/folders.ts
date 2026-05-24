import { api } from './client';

export interface FolderSummary {
  id: string;
  name: string;
  asset_count: number;
  created_at: string;
  updated_at: string;
}

export interface FolderListResponse {
  items: FolderSummary[];
}

export interface AssetFoldersResponse {
  asset_id: string;
  folders: FolderSummary[];
}

export async function listFolders(): Promise<FolderListResponse> {
  const { data } = await api.get<FolderListResponse>('/folders');
  return data;
}

export async function createFolder(name: string): Promise<FolderSummary> {
  const { data } = await api.post<FolderSummary>('/folders', { name });
  return data;
}

export async function updateFolder(folderId: string, name: string): Promise<FolderSummary> {
  const { data } = await api.patch<FolderSummary>(`/folders/${folderId}`, { name });
  return data;
}

export async function deleteFolder(folderId: string): Promise<void> {
  await api.delete(`/folders/${folderId}`);
}

export async function getAssetFolders(assetId: string): Promise<AssetFoldersResponse> {
  const { data } = await api.get<AssetFoldersResponse>(`/assets/${assetId}/folders`);
  return data;
}

export async function setAssetFolders(
  assetId: string,
  folderIds: string[],
): Promise<AssetFoldersResponse> {
  const { data } = await api.put<AssetFoldersResponse>(`/assets/${assetId}/folders`, {
    folder_ids: folderIds,
  });
  return data;
}

export async function addAssetToFolder(
  assetId: string,
  folderId: string,
): Promise<AssetFoldersResponse> {
  const { data } = await api.post<AssetFoldersResponse>(
    `/assets/${assetId}/folders/${folderId}`,
  );
  return data;
}

export async function removeAssetFromFolder(
  assetId: string,
  folderId: string,
): Promise<AssetFoldersResponse> {
  const { data } = await api.delete<AssetFoldersResponse>(
    `/assets/${assetId}/folders/${folderId}`,
  );
  return data;
}
