import styles from './PhotoCarousel.module.css';
import type { AssetListItem } from '../../../api/assets';
import { useEffect, useRef } from 'react';

interface PhotoCarouselProps {
  photos: AssetListItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
  compareMode?: boolean;
  compareAssetId?: string | null;
  onCompareSelect?: (assetId: string, index: number) => void;
}

export default function PhotoCarousel({
  photos,
  currentIndex,
  onSelect,
  compareMode = false,
  compareAssetId = null,
  onCompareSelect,
}: PhotoCarouselProps) {
  const itemRefs = useRef<Array<HTMLImageElement | null>>([]);
  const isFirstScrollRef = useRef(true);

  useEffect(() => {
    const currentItem = itemRefs.current[currentIndex];
    if (!currentItem) return;

    currentItem.scrollIntoView({
      behavior: isFirstScrollRef.current ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    });
    isFirstScrollRef.current = false;
  }, [currentIndex]);

  return (
    <div className={styles['photo-carousel']}>
      {photos.map((photo, index) => {
        const pv = photo.version?.preview_url;
        const tv = photo.version?.thumbnail_url;
        if (!pv && !tv) {
          return null;
        }

        const isCurrent = index === currentIndex;
        const isComparePick =
          compareMode && compareAssetId != null && photo.asset_id === compareAssetId;

        const className = [
          styles.thumb,
          isCurrent ? styles.active : '',
          isComparePick ? styles.comparePick : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <img
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            key={photo.asset_id}
            src={pv || tv || ''}
            alt={`Photo ${index + 1}`}
            className={className}
            onClick={() => {
              if (compareMode && onCompareSelect) {
                onCompareSelect(photo.asset_id, index);
                return;
              }
              onSelect(index);
            }}
          />
        );
      })}
    </div>
  );
}
