import styles from './PhotoCarousel.module.css';
import type { AssetListItem } from '../../../api/assets';
import { useEffect, useRef } from 'react';

interface PhotoCarouselProps {
    photos: AssetListItem[];
    currentIndex: number;
    onSelect: (index: number) => void;
}

export default function PhotoCarousel({ photos, currentIndex, onSelect }: PhotoCarouselProps) {
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
                if (photo.preview_url || photo.thumbnail_url) {
                    return (
                        <img 
                            ref={(node) => {
                                itemRefs.current[index] = node;
                            }}
                            key={index}
                            src={photo.preview_url || photo.thumbnail_url || ''}
                            alt={`Photo ${index + 1}`}
                            className={`carousel-photo ${index === currentIndex ? 'active' : ''}`}
                            onClick={() => onSelect(index)}
                        />
                    )
                } else {
                    return <></>
                }
            })}
        </div>
    );
}