import { CheckCircle2 } from 'lucide-react';

import type { ImportBatchDuplicateGroup } from '../../../../api/importBatches';

import styles from './DuplicateSourcesSection.module.css';

export interface DuplicateSourcesSectionProps {
  groups: ImportBatchDuplicateGroup[];
  onOpenDuplicateCluster: (group: ImportBatchDuplicateGroup) => void;
}

function imgSrc(url: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http') || url.startsWith('//')) return url;
  return url;
}

function reviewedCount(group: ImportBatchDuplicateGroup): number {
  return group.candidates.filter((c) => c.review_decision != null).length;
}

function allDuplicatesResolved(group: ImportBatchDuplicateGroup): boolean {
  return (
    group.candidates.length > 0 &&
    group.candidates.every((c) => c.review_decision != null)
  );
}

export default function DuplicateSourcesSection({
  groups,
  onOpenDuplicateCluster,
}: DuplicateSourcesSectionProps) {
  if (groups.length === 0) return null;

  return (
    <ul className={styles.grid} aria-label="Источники с найденными дубликатами">
      {groups.map((group) => {
        const reviewed = reviewedCount(group);
        const total = group.candidates.length;
        const preview = imgSrc(group.source_preview_url);
        const resolved = allDuplicatesResolved(group);

        return (
          <li key={group.source_asset_id}>
            <button
              type="button"
              className={`${styles.tileBtn} ${resolved ? styles.tileBtnResolved : ''}`}
              onClick={() => onOpenDuplicateCluster(group)}
              aria-label={
                resolved
                  ? group.source_title
                    ? `Все дубликаты разрешены: «${group.source_title}». Открыть просмотр`
                    : `Все дубликаты разрешены: источник ${group.source_asset_id.slice(0, 8)}. Открыть просмотр`
                  : group.source_title
                    ? `Открыть просмотр: «${group.source_title}» и ${total} кандидатов`
                    : `Открыть просмотр дубликатов (${total} кандидатов)`
              }
            >
              <div className={`${styles.tile} ${resolved ? styles.tileResolved : ''}`}>
                {resolved ? (
                  <span className={styles.resolvedMark} title="Все дубликаты разрешены">
                    <CheckCircle2 size={18} strokeWidth={2.25} aria-hidden />
                  </span>
                ) : null}
                {preview ? (
                  <img
                    className={styles.img}
                    src={preview}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className={styles.placeholder}>Нет превью</div>
                )}
                <span
                  className={`${styles.badge} ${resolved ? styles.badgeResolved : ''}`}
                >
                  {resolved ? 'Готово' : `${reviewed} / ${total}`}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
