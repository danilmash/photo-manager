import { AlertTriangle } from 'lucide-react';

import type { AssetListItem } from '../../../../api/assets';

import styles from './BatchAssetsGrid.module.css';

function statusBadge(status: string): string | null {
  switch (status) {
    case 'queued_preview':
      return 'Загрузка…';
    case 'preview_ready':
      return 'Готово к ревью';
    case 'processing':
      return 'Обработка…';
    case 'error':
      return 'Ошибка';
    case 'ready':
      return null;
    default:
      return status;
  }
}

export interface BatchAssetsGridProps {
  assets: AssetListItem[];
  onSelect?: (asset: AssetListItem) => void;
  className?: string;
}

export default function BatchAssetsGrid({ assets, onSelect, className }: BatchAssetsGridProps) {
  if (assets.length === 0) {
    return (
      <p className={styles.empty}>
        В этой партии пока нет файлов. Перетащите фото в область выше.
      </p>
    );
  }

  return (
    <ul className={`${styles.grid} ${className ?? ''}`}>
      {assets.map((asset) => {
        const hasThumb = !!asset.thumbnail_url;
        const isError = asset.status === 'error';
        const badge = statusBadge(asset.status);
        const clickable = !!onSelect && hasThumb && !isError;

        const tile = (
          <div className={styles.tile}>
            {hasThumb && !isError ? (
              <img
                className={styles.img}
                src={asset.thumbnail_url!}
                alt={asset.title ?? ''}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div
                className={`${styles.skeleton} ${
                  isError ? styles['skeleton-error'] : ''
                }`}
              >
                {isError && (
                  <AlertTriangle
                    size={20}
                    className={styles['error-icon']}
                    aria-hidden="true"
                  />
                )}
              </div>
            )}
            {badge && <span className={styles.badge}>{badge}</span>}
          </div>
        );

        return (
          <li key={asset.asset_id}>
            {clickable ? (
              <button
                type="button"
                className={styles['tile-btn']}
                onClick={() => onSelect?.(asset)}
                aria-label={asset.title ? `Открыть: ${asset.title}` : 'Открыть фото'}
              >
                {tile}
              </button>
            ) : (
              <div className={styles['tile-wrap']} aria-hidden={isError}>
                {tile}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
