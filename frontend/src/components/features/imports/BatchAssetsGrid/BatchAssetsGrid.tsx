import { AlertTriangle } from 'lucide-react';

import type { AssetListItem, TaskStatus } from '../../../../api/assets';
import PhotoStateBadge, {
  resolvePhotoStateBadgeVariant,
  type PhotoStateBadgeVariant,
} from '../../../ui/PhotoStateBadge';

import styles from './BatchAssetsGrid.module.css';

type TileVariant = 'skeleton' | 'thumb' | 'error';

interface TileState {
  variant: TileVariant;
  photoBadge: PhotoStateBadgeVariant | null;
  showFacesError: boolean;
  clickable: boolean;
}

function isPreviewInFlight(status: TaskStatus): boolean {
  return status === 'pending' || status === 'processing';
}

function deriveTileState(asset: AssetListItem, hasClickHandler: boolean): TileState {
  if (asset.preview_status === 'failed') {
    return {
      variant: 'error',
      photoBadge: null,
      showFacesError: false,
      clickable: false,
    };
  }

  if (isPreviewInFlight(asset.preview_status)) {
    return {
      variant: 'skeleton',
      photoBadge: 'processing',
      showFacesError: false,
      clickable: false,
    };
  }

  const hasThumb = !!asset.thumbnail_url;
  const facesFailed = asset.faces_status === 'failed';
  const photoBadge = resolvePhotoStateBadgeVariant(asset);

  return {
    variant: hasThumb ? 'thumb' : 'skeleton',
    photoBadge,
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
            {state.photoBadge && (
              <PhotoStateBadge
                variant={state.photoBadge}
                className={styles['state-badge']}
                size="sm"
              />
            )}
            {state.showFacesError && (
              <span
                className={styles['faces-error-badge']}
                title="Поиск лиц завершился ошибкой"
                role="img"
                aria-label="Ошибка поиска лиц"
              >
                <AlertTriangle size={14} strokeWidth={2.25} aria-hidden />
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
