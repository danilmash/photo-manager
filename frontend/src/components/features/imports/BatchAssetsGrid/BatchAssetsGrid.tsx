import { AlertTriangle, RefreshCw } from 'lucide-react';

import type { AssetListItem, TaskStatus } from '../../../../api/assets';
import FaceOutsideClusterBadge from '../../../ui/FaceOutsideClusterBadge';
import FacesErrorBadge from '../../../ui/FacesErrorBadge';
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
  facesErrorMessage: string | null;
  canRetryFaces: boolean;
  clickable: boolean;
  outsideCluster: boolean;
}

function isPreviewInFlight(status: TaskStatus): boolean {
  return status === 'pending' || status === 'processing';
}

function deriveTileState(
  asset: AssetListItem,
  hasClickHandler: boolean,
  canRetryFaces: boolean,
  outsideCluster: boolean,
): TileState {
  const preview = asset.version?.preview_status ?? 'pending';
  const faces = asset.version?.faces_status ?? 'pending';

  if (isPreviewInFlight(preview)) {
    return {
      variant: 'skeleton',
      photoBadge: 'processing',
      showFacesError: false,
      facesErrorMessage: null,
      canRetryFaces: false,
      clickable: false,
      outsideCluster: false,
    };
  }

  const hasThumb = !!asset.version?.thumbnail_url;
  const facesFailed = faces === 'failed';
  const facesErrorMessage =
    facesFailed && asset.version?.faces_error?.trim()
      ? asset.version.faces_error.trim()
      : null;
  const photoBadge = resolvePhotoStateBadgeVariant(asset);

  return {
    variant: hasThumb ? 'thumb' : 'skeleton',
    photoBadge,
    showFacesError: facesFailed,
    facesErrorMessage,
    canRetryFaces: canRetryFaces && facesFailed && !!asset.version?.id,
    clickable: hasClickHandler && hasThumb,
    outsideCluster,
  };
}

export interface BatchAssetsGridProps {
  assets: AssetListItem[];
  onSelect?: (asset: AssetListItem) => void;
  onRetryFaces?: (asset: AssetListItem) => void;
  retryingAssetId?: string | null;
  /** asset_id фото с лицами, исключёнными из кластера */
  outsideClusterAssetIds?: ReadonlySet<string>;
  className?: string;
}

export default function BatchAssetsGrid({
  assets,
  onSelect,
  onRetryFaces,
  retryingAssetId = null,
  outsideClusterAssetIds,
  className,
}: BatchAssetsGridProps) {
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
        const outsideCluster = outsideClusterAssetIds?.has(asset.asset_id) ?? false;
        const state = deriveTileState(
          asset,
          !!onSelect,
          !!onRetryFaces,
          outsideCluster,
        );
        const isRetrying = retryingAssetId === asset.asset_id;

        const tile = (
          <div
            className={`${styles.tile} ${
              state.outsideCluster ? styles['tile-outside-cluster'] : ''
            }`}
          >
            {state.variant === 'thumb' && asset.version?.thumbnail_url ? (
              <img
                className={styles.img}
                src={asset.version.thumbnail_url}
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
            {state.outsideCluster && (
              <FaceOutsideClusterBadge
                className={styles['outside-cluster-badge']}
              />
            )}
            {state.showFacesError && (
              <FacesErrorBadge
                message={state.facesErrorMessage}
                className={styles['faces-error-badge']}
              />
            )}
            {state.canRetryFaces && (
              <button
                type="button"
                className={styles['retry-faces-btn']}
                onClick={(event) => {
                  event.stopPropagation();
                  onRetryFaces?.(asset);
                }}
                disabled={isRetrying}
                title={
                  state.facesErrorMessage
                    ? `Повторить ML: ${state.facesErrorMessage}`
                    : 'Повторить ML для этого фото'
                }
                aria-label={
                  isRetrying
                    ? 'Повтор ML выполняется'
                    : 'Повторить ML для этого фото'
                }
              >
                <RefreshCw
                  size={14}
                  strokeWidth={2.25}
                  className={isRetrying ? styles.spin : undefined}
                  aria-hidden
                />
              </button>
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
