import { useEffect, useMemo, useState } from 'react';

import {
  getImportBatchDuplicateGroups,
  type ImportBatchDuplicateGroup,
} from '../../../api/importBatches';
import { getAssetViewer, restoreAsset } from '../../../api/assets';
import Button from '../Button';
import Drawer from '../Drawer';
import {
  collectDuplicatePeers,
  duplicateTypeLabel,
  type DuplicatePeerItem,
} from './duplicatePeers';

import styles from './PhotoDuplicatesDrawer.module.css';

interface PhotoDuplicatesDrawerProps {
  open: boolean;
  onClose: () => void;
  portalTarget: HTMLElement | null;
  assetId: string;
  importBatchId: string;
  duplicateOfAssetId: string | null;
  adjustContainerPadding?: boolean;
  onCompareSelect?: (assetId: string) => void;
}

function resolveImgSrc(url: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http') || url.startsWith('//')) return url;
  return url;
}

export default function PhotoDuplicatesDrawer({
  open,
  onClose,
  portalTarget,
  assetId,
  importBatchId,
  duplicateOfAssetId,
  adjustContainerPadding = true,
  onCompareSelect,
}: PhotoDuplicatesDrawerProps) {
  const [groups, setGroups] = useState<ImportBatchDuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbByAssetId, setThumbByAssetId] = useState<Record<string, string>>({});
  const [lifecycleByAssetId, setLifecycleByAssetId] = useState<Record<string, string>>({});
  const [restoringAssetId, setRestoringAssetId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !importBatchId || !assetId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void getImportBatchDuplicateGroups(importBatchId)
      .then((res) => {
        if (!cancelled) {
          setGroups(res.groups);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось загрузить список дубликатов');
          setGroups([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, importBatchId, assetId]);

  const peers = useMemo(
    () => collectDuplicatePeers(groups, assetId, duplicateOfAssetId),
    [groups, assetId, duplicateOfAssetId],
  );

  useEffect(() => {
    if (!open) return;
    const missing = peers.filter(
      (p) => p.asset_id && (!p.preview_url || !lifecycleByAssetId[p.asset_id]),
    );
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      const entries: Record<string, string> = {};
      const lifecycles: Record<string, string> = {};
      await Promise.all(
        missing.map(async (p) => {
          try {
            const v = await getAssetViewer(p.asset_id);
            const url =
              v.version?.preview_url ||
              v.version?.thumbnail_url ||
              '';
            if (url) entries[p.asset_id] = url;
            lifecycles[p.asset_id] = v.lifecycle_status;
          } catch {
            /* ignore */
          }
        }),
      );
      if (!cancelled) {
        if (Object.keys(entries).length > 0) {
          setThumbByAssetId((prev) => ({ ...prev, ...entries }));
        }
        if (Object.keys(lifecycles).length > 0) {
          setLifecycleByAssetId((prev) => ({ ...prev, ...lifecycles }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lifecycleByAssetId, open, peers]);

  const mergedPeers: DuplicatePeerItem[] = useMemo(() => {
    return peers.map((p) => ({
      ...p,
      preview_url: p.preview_url ?? thumbByAssetId[p.asset_id] ?? null,
    }));
  }, [peers, thumbByAssetId]);

  const handleRestore = async (assetId: string) => {
    if (restoringAssetId) return;
    setRestoringAssetId(assetId);
    try {
      await restoreAsset(assetId);
      setLifecycleByAssetId((prev) => ({ ...prev, [assetId]: 'active' }));
    } catch {
      setError('Не удалось восстановить фото из корзины');
    } finally {
      setRestoringAssetId(null);
    }
  };

  return (
    <Drawer
      behavior="move"
      title="Дубликаты и похожие"
      open={open}
      onClose={onClose}
      side="right"
      portalTarget={portalTarget}
      adjustContainerPadding={adjustContainerPadding}
    >
      <div className={styles.body}>
        {loading ? (
          <p className={styles.muted}>Загрузка…</p>
        ) : error ? (
          <p className={styles.error}>{error}</p>
        ) : mergedPeers.length === 0 ? (
          <p className={styles.muted}>
            Для этого фото нет связанных совпадений в партии импорта или они уже
            обработаны.
          </p>
        ) : (
          <ul className={styles.list}>
            {mergedPeers.map((item) => (
              <li key={item.asset_id} className={styles.card}>
                <div className={styles.thumbWrap}>
                  {resolveImgSrc(item.preview_url) ? (
                    <img
                      className={styles.thumb}
                      src={resolveImgSrc(item.preview_url)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles.thumbPlaceholder}>Нет превью</div>
                  )}
                </div>
                <div className={styles.meta}>
                  <div className={styles.title}>
                    {item.title?.trim() || `Ассет ${item.asset_id.slice(0, 8)}…`}
                  </div>
                  {item.duplicate_type ? (
                    <div className={styles.badge}>
                      {duplicateTypeLabel(item.duplicate_type)}
                    </div>
                  ) : item.relation === 'canonical_source' ? (
                    <div className={styles.badge}>Исходное фото</div>
                  ) : null}
                  {lifecycleByAssetId[item.asset_id] === 'trashed' ? (
                    <div className={styles.trashNotice}>
                      Фото находится в корзине. Его можно сравнить или восстановить.
                    </div>
                  ) : null}
                  <div className={styles.relation}>
                    {item.relation === 'canonical_source' &&
                      'Исходное фото, с которым был подтверждён дубликат'}
                    {item.relation === 'candidate_of_current' &&
                      'Кандидат в дубликаты'}
                    {item.relation === 'source_for_current' &&
                      'Исходное фото этой группы дубликатов'}
                    {item.relation === 'sibling_candidate' &&
                      'Другой кандидат к тому же источнику'}
                  </div>
                  {onCompareSelect ? (
                    <div className={styles.actions}>
                      <Button
                        color="secondary"
                        variant="outline"
                        size="sm"
                        onClick={() => onCompareSelect(item.asset_id)}
                      >
                        Сравнить
                      </Button>
                      {lifecycleByAssetId[item.asset_id] === 'trashed' ? (
                        <Button
                          color="primary"
                          variant="filled"
                          size="sm"
                          disabled={restoringAssetId !== null}
                          onClick={() => {
                            void handleRestore(item.asset_id);
                          }}
                        >
                          {restoringAssetId === item.asset_id ? '…' : 'Восстановить'}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
