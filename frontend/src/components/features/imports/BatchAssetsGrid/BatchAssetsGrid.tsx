import { AlertTriangle } from 'lucide-react';

import type { AssetListItem, TaskStatus } from '../../../../api/assets';

import styles from './BatchAssetsGrid.module.css';

type TileVariant = 'skeleton' | 'thumb' | 'error';

interface TileState {
  variant: TileVariant;
  badge: string | null;
  showFacesError: boolean;
  clickable: boolean;
}

function isPreviewInFlight(status: TaskStatus): boolean {
  return status === 'pending' || status === 'processing';
}

function deriveTileState(asset: AssetListItem, hasClickHandler: boolean): TileState {
  // Preview — ключевая фаза: по ней решаем, что показывать в плитке.
  // Faces — опциональная фаза, влияет только на бейдж.
  if (asset.preview_status === 'failed') {
    return {
      variant: 'error',
      badge: 'Ошибка превью',
      showFacesError: false,
      clickable: false,
    };
  }

  if (isPreviewInFlight(asset.preview_status)) {
    return {
      variant: 'skeleton',
      badge: asset.preview_status === 'processing' ? 'Обработка…' : 'Загрузка…',
      showFacesError: false,
      clickable: false,
    };
  }

  // preview_status === 'completed'
  const hasThumb = !!asset.thumbnail_url;
  const facesFailed = asset.faces_status === 'failed';
  const facesInFlight = isPreviewInFlight(asset.faces_status);

  let badge: string | null = null;
  if (facesInFlight) badge = 'Поиск лиц…';
  else if (facesFailed) badge = null; // отдельный бейдж ниже

  return {
    variant: hasThumb ? 'thumb' : 'skeleton',
    badge,
    showFacesError: facesFailed,
    clickable: hasClickHandler && hasThumb,
  };
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
        const state = deriveTileState(asset, !!onSelect);

        const tile = (
          <div className={styles.tile}>
            {state.variant === 'thumb' && asset.thumbnail_url ? (
              <img
                className={styles.img}
                src={asset.thumbnail_url}
                alt={asset.title ?? ''}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div
                className={`${styles.skeleton} ${
                  state.variant === 'error' ? styles['skeleton-error'] : ''
                }`}
              >
                {state.variant === 'error' && (
                  <AlertTriangle
                    size={20}
                    className={styles['error-icon']}
                    aria-hidden="true"
                  />
                )}
              </div>
            )}
            {state.badge && <span className={styles.badge}>{state.badge}</span>}
            {state.showFacesError && (
              <span
                className={`${styles.badge} ${styles['badge-warning']}`}
                title={asset.faces_status === 'failed' ? 'Поиск лиц завершился ошибкой' : undefined}
              >
                Лица: ошибка
              </span>
            )}
          </div>
        );

        return (
          <li key={asset.asset_id}>
            {state.clickable ? (
              <button
                type="button"
                className={styles['tile-btn']}
                onClick={() => onSelect?.(asset)}
                aria-label={asset.title ? `Открыть: ${asset.title}` : 'Открыть фото'}
              >
                {tile}
              </button>
            ) : (
              <div
                className={styles['tile-wrap']}
                aria-hidden={state.variant === 'error'}
              >
                {tile}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
