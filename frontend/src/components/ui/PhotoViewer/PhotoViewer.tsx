import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, ChevronLeft, Ellipsis, Info } from 'lucide-react';

import styles from './PhotoViewer.module.css';
import { getAssetViewer, type AssetListItem, type AssetViewer } from '../../../api/assets';
import Button from '../Button';
import PhotoCarousel from '../PhotoCarousel';
import Drawer from '../Drawer';

interface PhotoViewerProps {
    photos: AssetListItem[];
    currentIndex: number;
    onPrevious: () => void;
    onNext: () => void;
    onSelect: (index: number) => void;
    onClose: () => void;
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
    onClose,
}: PhotoViewerProps) {
    const [direction, setDirection] = useState<Direction>(1);
    const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
    const [viewerById, setViewerById] = useState<Record<string, AssetViewer>>({});
    const [viewerLoading, setViewerLoading] = useState(false);
    const [viewerError, setViewerError] = useState<string | null>(null);

    const prevIndexRef = useRef(currentIndex);
    const viewerRef = useRef<HTMLDivElement>(null);

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

    const currentViewer = currentPhoto ? viewerById[currentPhoto.asset_id] ?? null : null;

    useEffect(() => {
        if (!infoDrawerOpen || !currentPhoto?.asset_id) return;
        if (viewerById[currentPhoto.asset_id]) return;

        let cancelled = false;

        setViewerLoading(true);
        setViewerError(null);

        getAssetViewer(currentPhoto.asset_id)
            .then((data) => {
                if (cancelled) return;
                setViewerById((prev) => ({
                    ...prev,
                    [currentPhoto.asset_id]: data,
                }));
            })
            .catch(() => {
                if (cancelled) return;
                setViewerError('Не удалось загрузить информацию о фотографии');
            })
            .finally(() => {
                if (cancelled) return;
                setViewerLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [infoDrawerOpen, currentPhoto?.asset_id, viewerById]);

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

    const renderValue = (value: unknown) => {
        if (value === null || value === undefined || value === '') return '—';
        return String(value);
    };

    if (!currentPhoto || !photoSrc) return null;

    return (
        <div ref={viewerRef} className={styles.viewer}>
            <div className={styles.header}>
                <div className={styles['close-button']}>
                    <Button color="muted" variant="ghost" onClick={onClose} icon={<ArrowLeft />} size="xl" />
                </div>
                <div className={styles['options-buttons']}>
                    <Button color="muted" variant="ghost" onClick={() => setInfoDrawerOpen(true)} icon={<Info />} size="xl" />
                    <Button color="muted" variant="ghost" onClick={() => {}} icon={<Ellipsis />} size="xl" />
                </div>
                <Drawer
                    behavior="move"
                    title="Информация"
                    open={infoDrawerOpen}
                    onClose={() => setInfoDrawerOpen(false)}
                    side="right"
                    portalTarget={viewerRef.current}
                >
                    <div style={{ padding: 16, display: 'grid', gap: 20 }}>
                        {viewerLoading && !currentViewer ? (
                            <div>Загрузка...</div>
                        ) : viewerError && !currentViewer ? (
                            <div>{viewerError}</div>
                        ) : currentViewer ? (
                            <>
                                <section style={{ display: 'grid', gap: 10 }}>
                                    <h3 style={{ margin: 0, fontSize: 16 }}>Основная информация</h3>

                                    <div><strong>Название:</strong> {renderValue(currentViewer.title)}</div>
                                    <div><strong>Файл:</strong> {renderValue(currentViewer.photo.filename)}</div>
                                    <div><strong>MIME:</strong> {renderValue(currentViewer.photo.mime_type)}</div>
                                    <div><strong>Размер:</strong> {renderValue(currentViewer.photo.size_bytes)}</div>
                                    <div>
                                        <strong>Разрешение:</strong>{' '}
                                        {currentViewer.photo.width && currentViewer.photo.height
                                            ? `${renderValue(currentViewer.photo.width)} × ${renderValue(currentViewer.photo.height)}`
                                            : '—'}
                                    </div>
                                    <div><strong>Дата съемки:</strong> {renderValue(currentViewer.photo.taken_at)}</div>
                                    <div><strong>Производитель камеры:</strong> {renderValue(currentViewer.photo.camera_make)}</div>
                                    <div><strong>Камера:</strong> {renderValue(currentViewer.photo.camera_model)}</div>
                                    <div><strong>Объектив:</strong> {renderValue(currentViewer.photo.lens)}</div>
                                    <div><strong>ISO:</strong> {renderValue(currentViewer.photo.iso)}</div>
                                    <div><strong>Диафрагма:</strong> {renderValue(currentViewer.photo.aperture)}</div>
                                    <div><strong>Выдержка:</strong> {renderValue(currentViewer.photo.shutter_speed)}</div>
                                    <div><strong>Фокусное расстояние:</strong> {renderValue(currentViewer.photo.focal_length)}</div>
                                    <div><strong>Рейтинг:</strong> {renderValue(currentViewer.photo.rating)}</div>
                                    <div>
                                        <strong>Ключевые слова:</strong>{' '}
                                        {currentViewer.photo.keywords.length > 0
                                            ? currentViewer.photo.keywords.join(', ')
                                            : '—'}
                                    </div>
                                </section>

                                <section style={{ display: 'grid', gap: 10 }}>
                                    <h3 style={{ margin: 0, fontSize: 16 }}>
                                        Лица ({currentViewer.faces_count})
                                    </h3>

                                    {currentViewer.faces.length === 0 ? (
                                        <div>Лица не найдены</div>
                                    ) : (
                                        <div style={{ display: 'grid', gap: 12 }}>
                                            {currentViewer.faces.map((face, index) => (
                                                <div
                                                    key={face.id}
                                                    style={{
                                                        border: '1px solid rgba(255,255,255,0.08)',
                                                        borderRadius: 12,
                                                        padding: 12,
                                                        display: 'grid',
                                                        gap: 6,
                                                    }}
                                                >
                                                    <div><strong>Лицо #{index + 1}</strong></div>
                                                    <div><strong>Персона:</strong> {renderValue(face.person_name)}</div>
                                                    <div><strong>Confidence:</strong> {renderValue(face.confidence)}</div>
                                                    <div><strong>bbox:</strong> {renderValue(JSON.stringify(face.bbox))}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </>
                        ) : (
                            <div>Нет данных</div>
                        )}
                    </div>
                </Drawer>
            </div>

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
                        size="xl"
                        color="muted"
                        variant="ghost"
                        onClick={handlePrevious}
                        icon={<ChevronLeft />}
                    />
                </div>

                <div className={styles['next-button']}>
                    <Button
                        size="xl"
                        color="muted"
                        variant="ghost"
                        onClick={handleNext}
                        icon={<ChevronRight />}
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