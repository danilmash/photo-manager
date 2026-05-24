import { useCallback, useEffect, useState } from 'react';

import {
  addAssetToFolder,
  getAssetFolders,
  listFolders,
  removeAssetFromFolder,
  type FolderSummary,
} from '../../../api/folders';

export interface PhotoAssetFoldersPanelProps {
  assetId: string;
  open: boolean;
  onChanged?: () => void;
}

export default function PhotoAssetFoldersPanel({
  assetId,
  open,
  onChanged,
}: PhotoAssetFoldersPanelProps) {
  const [allFolders, setAllFolders] = useState<FolderSummary[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [savingFolderId, setSavingFolderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!assetId) return;
    setLoading(true);
    setError(null);
    try {
      const [foldersResponse, assetFoldersResponse] = await Promise.all([
        listFolders(),
        getAssetFolders(assetId),
      ]);
      setAllFolders(foldersResponse.items);
      setMemberIds(new Set(assetFoldersResponse.folders.map((folder) => folder.id)));
    } catch {
      setError('Не удалось загрузить папки');
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    if (!open || !assetId) return;
    void load();
  }, [assetId, load, open]);

  const handleToggle = async (folder: FolderSummary, checked: boolean) => {
    if (savingFolderId) return;
    setSavingFolderId(folder.id);
    setError(null);
    try {
      if (checked) {
        const response = await addAssetToFolder(assetId, folder.id);
        setMemberIds(new Set(response.folders.map((item) => item.id)));
      } else {
        const response = await removeAssetFromFolder(assetId, folder.id);
        setMemberIds(new Set(response.folders.map((item) => item.id)));
      }
      onChanged?.();
    } catch {
      setError('Не удалось обновить папки');
    } finally {
      setSavingFolderId(null);
    }
  };

  if (loading) {
    return <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>Загрузка…</div>;
  }

  if (allFolders.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-secondary)' }}>
        Папок пока нет. Создайте их на главной странице библиотеки.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {allFolders.map((folder) => {
        const checked = memberIds.has(folder.id);
        const disabled = savingFolderId !== null;
        return (
          <label
            key={folder.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 14,
              color: 'var(--color-text-primary)',
              cursor: disabled ? 'default' : 'pointer',
              opacity: savingFolderId === folder.id ? 0.6 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => {
                void handleToggle(folder, event.target.checked);
              }}
            />
            <span>{folder.name}</span>
          </label>
        );
      })}
      {error ? (
        <div style={{ color: 'var(--color-danger, #c62828)', fontSize: 13 }}>{error}</div>
      ) : null}
    </div>
  );
}
