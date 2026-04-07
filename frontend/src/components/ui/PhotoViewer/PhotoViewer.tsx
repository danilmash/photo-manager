import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import styles from './PhotoViewer.module.css';
import type { AssetListItem } from '../../../api/assets';
import Button from '../Button';
import PhotoCarousel from '../PhotoCarousel';

interface PhotoViewerProps {
    photos: AssetListItem[];
    currentIndex: number;
    onPrevious: () => void;
    onNext: () => void;
    onSelect: (index: number) => void;
}

type Direction = 1 | -1;

const variants = {
    enter: (direction: Direction) => ({
        x: direction > 0 ? 64 : -64,
        opacity: 0,
        scale: 0.985,
    }),
    center: {
        x: 0,
        opacity: 1,
        scale: 1,
    },
    exit: (direction: Direction) => ({
        x: direction > 0 ? -64 : 64,
        opacity: 0,
        scale: 0.985,
    }),
};

export default function PhotoViewer({
    photos,
    currentIndex,
    onPrevious,
    onNext,
    onSelect,
}: PhotoViewerProps) {
    const [direction, setDirection] = useState<Direction>(1);
    const prevIndexRef = useRef(currentIndex);

    useEffect(() => {
        if (currentIndex > prevIndexRef.current) {
        setDirection(1);
        } else if (currentIndex < prevIndexRef.current) {
        setDirection(-1);
        }

        prevIndexRef.current = currentIndex;
    }, [currentIndex]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft') {
            setDirection(-1);
            onPrevious();
        }

        if (event.key === 'ArrowRight') {
            setDirection(1);
            onNext();
        }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
        window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onPrevious, onNext]);

    const currentPhoto = photos[currentIndex];

    const photoSrc = useMemo(() => {
        return currentPhoto?.preview_url || currentPhoto?.thumbnail_url || '';
    }, [currentPhoto]);

    const handlePrevious = () => {
        setDirection(-1);
        onPrevious();
    };

    const handleNext = () => {
        setDirection(1);
        onNext();
    };

    const handleSelect = (index: number) => {
        setDirection(index > currentIndex ? 1 : -1);
        onSelect(index);
    };

    if (!currentPhoto || !photoSrc) return null;

    return (
        <div className={styles.viewer}>
        <div className={styles.stage}>
            <AnimatePresence initial={false} custom={direction} mode="wait">
            <motion.img
                key={currentPhoto.asset_id ?? `${currentIndex}-${photoSrc}`}
                src={photoSrc}
                alt="Фотография"
                className={styles.image}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                duration: 0.22,
                ease: [0.22, 1, 0.36, 1],
                }}
                draggable={false}
            />
            </AnimatePresence>

            <div className={styles['prev-button']}>
            <Button
                size="l"
                color="muted"
                variant="ghost"
                onClick={handlePrevious}
                icon={<ArrowLeft />}
            />
            </div>

            <div className={styles['next-button']}>
            <Button
                size="l"
                color="muted"
                variant="ghost"
                onClick={handleNext}
                icon={<ArrowRight />}
            />
            </div>
        </div>

        <div className={styles.footer}>
            <PhotoCarousel
            photos={photos}
            currentIndex={currentIndex}
            onSelect={handleSelect}
            />
        </div>
        </div>
    );
}