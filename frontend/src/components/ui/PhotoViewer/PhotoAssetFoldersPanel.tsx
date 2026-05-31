import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Folder } from 'lucide-react';

import {
  addAssetToFolder,
  getAssetFolders,
  removeAssetFromFolder,
  type FolderSummary,
} from '../../../api/folders';
import { useFoldersStore } from '../../../stores/useFoldersStore';

import styles from './PhotoAssetFoldersPanel.module.css';

export interface PhotoAssetFoldersPanelProps {
  assetId: string;
  open: boolean;
  onChanged?: () => void;
}

export default function PhotoAssetFoldersPanel({
  assetId,
  open: _open,
  onChanged,
}: PhotoAssetFoldersPanelProps) {
  const allFolders = useFoldersStore((s) => s.items);
  const foldersLoading = useFoldersStore((s) => s.isLoading);
  const foldersLoaded = useFoldersStore((s) => s.hasLoaded);
  const foldersError = useFoldersStore((s) => s.error);
  const fetchFolders = useFoldersStore((s) => s.fetchFolders);

  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [membershipLoading, setMembershipLoading] = useState(false);
  const [savingFolderId, setSavingFolderId] = useState<string | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);

  const loadMembership = useCallback(async () => {
    if (!assetId) return;
    setMembershipLoading(true);
    setMembershipError(null);
    try {
      const response = await getAssetFolders(assetId);
      setMemberIds(new Set(response.folders.map((folder) => folder.id)));
    } catch {
      setMembershipError('Не удалось загрузить папки фото');
    } finally {
      setMembershipLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    if (!assetId) return;
    void fetchFolders();
    void loadMembership();
  }, [assetId, fetchFolders, loadMembership]);

  const selectedFolders = useMemo(
    () => allFolders.filter((folder) => memberIds.has(folder.id)),
    [allFolders, memberIds],
  );

  const handleToggle = async (folder: FolderSummary) => {
    if (savingFolderId) return;
    const checked = memberIds.has(folder.id);
    setSavingFolderId(folder.id);
    setMembershipError(null);
    try {
      const response = checked
        ? await removeAssetFromFolder(assetId, folder.id)
        : await addAssetToFolder(assetId, folder.id);
      setMemberIds(new Set(response.folders.map((item) => item.id)));
      onChanged?.();
    } catch {
      setMembershipError('Не удалось обновить папки');
    } finally {
      setSavingFolderId(null);
    }
  };

  const loading = membershipLoading || (foldersLoading && !foldersLoaded);
  const error = membershipError ?? foldersError;

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.skeletonGrid} aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className={styles.skeletonCard} />
          ))}
        </div>
      </div>
    );
  }

  if (allFolders.length === 0) {
    return (
      <p className={styles.empty}>
        Папок пока нет. Создайте их в боковой панели на главной странице библиотеки.
      </p>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.summary} aria-label="Папки, в которых находится фото">
        {selectedFolders.length > 0 ? (
          selectedFolders.map((folder) => (
            <span key={folder.id} className={styles.summaryChip}>
              <Folder size={14} aria-hidden="true" />
              {folder.name}
            </span>
          ))
        ) : (
          <p className={styles.summaryEmpty}>Фото ещё не добавлено ни в одну папку</p>
        )}
      </div>

      <div className={styles.grid} role="group" aria-label="Выбор папок">
        {allFolders.map((folder) => {
          const active = memberIds.has(folder.id);
          const disabled = savingFolderId !== null;
          return (
            <button
              key={folder.id}
              type="button"
              className={`${styles.folderCard} ${active ? styles.folderCardActive : ''}`}
              disabled={disabled}
              aria-pressed={active}
              onClick={() => {
                void handleToggle(folder);
              }}
            >
              <span className={styles.folderCardHead}>
                <span className={styles.folderIcon} aria-hidden="true">
                  <Folder size={15} />
                </span>
                <span className={styles.folderName}>{folder.name}</span>
                {active ? (
                  <Check size={16} className={styles.checkMark} aria-hidden="true" />
                ) : null}
              </span>
              <span className={styles.folderMeta}>
                {folder.asset_count}{' '}
                {folder.asset_count === 1 ? 'фото' : 'фото'}
              </span>
            </button>
          );
        })}
      </div>

      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
