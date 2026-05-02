import { useEffect, useMemo, useState } from 'react';

import {
  getImportBatchDuplicateGroups,
  type ImportBatchDuplicateGroup,
} from '../../../api/importBatches';
import { getAssetViewer } from '../../../api/assets';
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
}: PhotoDuplicatesDrawerProps) {
  const [groups, setGroups] = useState<ImportBatchDuplicateGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbByAssetId, setThumbByAssetId] = useState<Record<string, string>>({});

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
    const missing = peers.filter((p) => !p.preview_url && p.asset_id);
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      const entries: Record<string, string> = {};
      await Promise.all(
        missing.map(async (p) => {
          try {
            const v = await getAssetViewer(p.asset_id);
            const url =
              v.version?.preview_url ||
              v.version?.thumbnail_url ||
              '';
            if (url) entries[p.asset_id] = url;
          } catch {
            /* ignore */
          }
        }),
      );
      if (!cancelled && Object.keys(entries).length > 0) {
        setThumbByAssetId((prev) => ({ ...prev, ...entries }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, peers]);

  const mergedPeers: DuplicatePeerItem[] = useMemo(() => {
    return peers.map((p) => ({
      ...p,
      preview_url: p.preview_url ?? thumbByAssetId[p.asset_id] ?? null,
    }));
  }, [peers, thumbByAssetId]);

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
                  <div className={styles.relation}>
                    {item.relation === 'canonical_source' &&
                      'Ссылка после подтверждения дубликата'}
                    {item.relation === 'candidate_of_current' &&
                      'Кандидат в дубликаты'}
                    {item.relation === 'source_for_current' &&
                      'Источник для текущего фото'}
                    {item.relation === 'sibling_candidate' &&
                      'Другой кандидат к тому же источнику'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
