import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Info,
  SlidersHorizontal,
} from 'lucide-react';

import styles from './PhotoViewer.module.css';
import type {
  ImportBatchDuplicateCandidateItem,
  ImportBatchDuplicateGroup,
} from '../../../api/importBatches';
import {
  createAssetVersion,
  getAssetViewer,
  type AssetListItem,
  type AssetViewer,
} from '../../../api/assets';
import { DEFAULT_PHOTO_RECIPE, normalizeRecipe, type PhotoRecipe } from '../../../api/recipe';
import Button from '../Button';
import Drawer, { DRAWER_MOVE_PADDING_PX } from '../Drawer';
import PhotoCarousel from '../PhotoCarousel';
import PhotoFacesPanel from '../PhotoFacesPanel';
import ImportDuplicateCandidatesDrawer from './ImportDuplicateCandidatesDrawer';
import PhotoDuplicatesDrawer from './PhotoDuplicatesDrawer';
import PhotoEditDrawer from './PhotoEditDrawer';
import {
  recipeLivePreviewDeltaStyle,
  recipeVignetteDeltaOverlayStyle,
} from './recipeLivePreview';

interface PhotoViewerProps {
  photos: AssetListItem[];
  currentIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
  onClose: () => void;
  /**
   * Режим импорта: карусель — все источники дубликатов в партии; кандидаты и вердикты — в дровере.
   */
  importDuplicateSourcesReview?: {
    batchId: string;
    groups: ImportBatchDuplicateGroup[];
    onCandidateReviewed: (updated: ImportBatchDuplicateCandidateItem) => void;
  };
}

type Direction = 1 | -1;

type ImageMetrics = {
  left: number;
  top: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseBbox(
  bbox: unknown,
): { x: number; y: number; width: number; height: number } | null {
  if (!bbox || typeof bbox !== 'object') return null;

  const record = bbox as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.w);
  const height = Number(record.h);

  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;

  return { x, y, width, height };
}

export default function PhotoViewer({
  photos,
  currentIndex,
  onPrevious,
  onNext,
  onSelect,
  onClose,
  importDuplicateSourcesReview,
}: PhotoViewerProps) {
  const [direction, setDirection] = useState<Direction>(1);
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [duplicatesDrawerOpen, setDuplicatesDrawerOpen] = useState(false);
  const [importDupDrawerOpen, setImportDupDrawerOpen] = useState(true);
  const [applyingVersion, setApplyingVersion] = useState(false);
  const [draftRecipe, setDraftRecipe] = useState<PhotoRecipe>(DEFAULT_PHOTO_RECIPE);
  const [editBaselineRecipe, setEditBaselineRecipe] = useState<PhotoRecipe | null>(null);
  const [viewerById, setViewerById] = useState<Record<string, AssetViewer>>({});
  const [viewerLoadingById, setViewerLoadingById] = useState<Record<string, boolean>>(
    {},
  );
  const [viewerErrorById, setViewerErrorById] = useState<
    Record<string, string | null>
  >({});
  const [imageMetrics, setImageMetrics] = useState<ImageMetrics | null>(null);
  const [imageSettled, setImageSettled] = useState(false);
  const [activeFaceId, setActiveFaceId] = useState<string | null>(null);

  const prevIndexRef = useRef(currentIndex);
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewerByIdRef = useRef<Record<string, AssetViewer>>({});
  const viewerRequestIdRef = useRef<Record<string, number>>({});

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
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNext, onPrevious]);

  const currentPhoto = photos[currentIndex];

  const currentViewer = currentPhoto ? viewerById[currentPhoto.asset_id] ?? null : null;
  const viewerLoading = currentPhoto
    ? viewerLoadingById[currentPhoto.asset_id] ?? false
    : false;
  const viewerError = currentPhoto
    ? viewerErrorById[currentPhoto.asset_id] ?? null
    : null;

  const photoSrc = useMemo(() => {
    const vv = currentViewer?.version;
    const vl = currentPhoto?.version;
    return (
      vv?.preview_url ||
      vv?.thumbnail_url ||
      vl?.preview_url ||
      vl?.thumbnail_url ||
      ''
    );
  }, [
    currentViewer?.version?.preview_url,
    currentViewer?.version?.thumbnail_url,
    currentPhoto?.version?.preview_url,
    currentPhoto?.version?.thumbnail_url,
  ]);

  const livePreviewImgStyle = useMemo(() => {
    if (!editDrawerOpen || !editBaselineRecipe) return undefined;
    return recipeLivePreviewDeltaStyle(draftRecipe, editBaselineRecipe);
  }, [editDrawerOpen, draftRecipe, editBaselineRecipe]);

  const liveVignetteStyle = useMemo(() => {
    if (!editDrawerOpen || !editBaselineRecipe) return null;
    return recipeVignetteDeltaOverlayStyle(draftRecipe, editBaselineRecipe);
  }, [editDrawerOpen, draftRecipe, editBaselineRecipe]);

  useEffect(() => {
    viewerByIdRef.current = viewerById;
  }, [viewerById]);

  const loadAssetViewer = useCallback(async (assetId: string, force = false) => {
    if (!assetId) return null;
    if (!force && viewerByIdRef.current[assetId]) {
      return viewerByIdRef.current[assetId];
    }

    const requestId = (viewerRequestIdRef.current[assetId] ?? 0) + 1;
    viewerRequestIdRef.current[assetId] = requestId;

    setViewerLoadingById((prev) => ({
      ...prev,
      [assetId]: true,
    }));
    setViewerErrorById((prev) => ({
      ...prev,
      [assetId]: null,
    }));

    try {
      const data = await getAssetViewer(assetId);

      if (viewerRequestIdRef.current[assetId] !== requestId) {
        return data;
      }

      setViewerById((prev) => {
        const next = {
          ...prev,
          [assetId]: data,
        };
        viewerByIdRef.current = next;
        return next;
      });

      return data;
    } catch (error) {
      if (viewerRequestIdRef.current[assetId] === requestId) {
        setViewerErrorById((prev) => ({
          ...prev,
          [assetId]: 'Не удалось загрузить информацию о фотографии',
        }));
      }

      throw error;
    } finally {
      if (viewerRequestIdRef.current[assetId] === requestId) {
        setViewerLoadingById((prev) => ({
          ...prev,
          [assetId]: false,
        }));
      }
    }
  }, []);

  useEffect(() => {
    setEditDrawerOpen(false);
    setDuplicatesDrawerOpen(false);
  }, [currentPhoto?.asset_id]);

  const currentImportDupGroup = useMemo(() => {
    if (!importDuplicateSourcesReview) return null;
    return importDuplicateSourcesReview.groups[currentIndex] ?? null;
  }, [importDuplicateSourcesReview, currentIndex]);

  const duplicateBatchId = currentViewer?.import_batch_id ?? null;
  const duplicateReviewStatus = currentViewer?.duplicate_review_status ?? null;
  const duplicateOfId = currentViewer?.duplicate_of_asset_id ?? null;
  const showDuplicatesEntry =
    !importDuplicateSourcesReview &&
    Boolean(duplicateBatchId) &&
    (duplicateReviewStatus === 'has_duplicates' || duplicateOfId != null);

  const moveDrawerPaddingOpen =
    infoDrawerOpen ||
    editDrawerOpen ||
    (showDuplicatesEntry && duplicatesDrawerOpen) ||
    Boolean(importDuplicateSourcesReview && currentImportDupGroup && importDupDrawerOpen);

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    el.style.transition = 'padding 0.3s ease';
    el.style.boxSizing = 'border-box';
    el.style.paddingRight = moveDrawerPaddingOpen ? `${DRAWER_MOVE_PADDING_PX}px` : '0px';

    return () => {
      el.style.paddingRight = '0px';
    };
  }, [moveDrawerPaddingOpen]);

  useEffect(() => {
    if (!editDrawerOpen) {
      setEditBaselineRecipe(null);
      return;
    }
    if (!currentViewer?.version) return;
    const normalized = normalizeRecipe(currentViewer.version.recipe);
    setEditBaselineRecipe(normalized);
    setDraftRecipe(normalized);
  }, [editDrawerOpen, currentViewer?.version?.id]);

  const handleApplyEdit = useCallback(async () => {
    const aid = currentPhoto?.asset_id;
    const vid = currentViewer?.version?.id;
    if (!aid || !vid) return;
    setApplyingVersion(true);
    try {
      await createAssetVersion(aid, {
        recipe: draftRecipe,
        base_version_id: vid,
      });
      setEditDrawerOpen(false);
      await loadAssetViewer(aid, true);
    } catch {
      // ошибку можно показать тостом позже
    } finally {
      setApplyingVersion(false);
    }
  }, [currentPhoto?.asset_id, currentViewer?.version?.id, draftRecipe, loadAssetViewer]);

  useEffect(() => {
    setImageSettled(false);
    setImageMetrics(null);
  }, [currentPhoto?.asset_id, photoSrc]);

  useEffect(() => {
    if (!currentPhoto?.asset_id) return;
    void loadAssetViewer(currentPhoto.asset_id).catch(() => {});
  }, [currentPhoto?.asset_id, loadAssetViewer]);

  useEffect(() => {
    if (!currentViewer) {
      setActiveFaceId(null);
      return;
    }

    setActiveFaceId((prev) => {
      if (prev && currentViewer.faces.some((face) => face.id === prev)) {
        return prev;
      }
      return currentViewer.faces[0]?.id ?? null;
    });
  }, [currentPhoto?.asset_id, currentViewer]);

  const updateImageMetrics = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;

    if (!stage || !img) return;

    const stageRect = stage.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();

    if (imgRect.width <= 0 || imgRect.height <= 0) return;

    const sourceWidth = toFiniteNumber(currentViewer?.photo.width) ?? img.naturalWidth;
    const sourceHeight =
      toFiniteNumber(currentViewer?.photo.height) ?? img.naturalHeight;

    if (!sourceWidth || !sourceHeight) return;

    setImageMetrics({
      left: imgRect.left - stageRect.left,
      top: imgRect.top - stageRect.top,
      width: imgRect.width,
      height: imgRect.height,
      sourceWidth,
      sourceHeight,
    });
  }, [currentViewer?.photo.height, currentViewer?.photo.width]);

  useEffect(() => {
    const scheduleUpdate = () => {
      requestAnimationFrame(() => {
        updateImageMetrics();
      });
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(scheduleUpdate)
        : null;

    if (stageRef.current) resizeObserver?.observe(stageRef.current);
    if (imgRef.current) resizeObserver?.observe(imgRef.current);

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [currentPhoto?.asset_id, updateImageMetrics]);

  const faceBoxes = useMemo(() => {
    if (!currentViewer || !imageMetrics || !imageSettled) return [];

    return currentViewer.faces
      .map((face) => {
        const parsed = parseBbox(face.bbox);
        if (!parsed) return null;

        return {
          id: face.id,
          personName: face.person_name,
          active: face.id === activeFaceId,
          left: imageMetrics.left + parsed.x * imageMetrics.width,
          top: imageMetrics.top + parsed.y * imageMetrics.height,
          width: parsed.width * imageMetrics.width,
          height: parsed.height * imageMetrics.height,
        };
      })
      .filter((box): box is NonNullable<typeof box> => Boolean(box));
  }, [activeFaceId, currentViewer, imageMetrics, imageSettled]);

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

  if (!currentPhoto) return null;

  return (
    <div ref={viewerRef} className={styles.viewer}>
      <div className={styles['viewer-toolbar']}>
        <div className={styles['close-button']}>
          <Button
            color="muted"
            variant="ghost"
            onClick={onClose}
            icon={<ArrowLeft />}
            size="xl"
          />
        </div>

        <div className={styles['options-buttons']}>
          <Button
            color="muted"
            variant="ghost"
            onClick={() => {
              setEditDrawerOpen(false);
              setDuplicatesDrawerOpen(false);
              setImportDupDrawerOpen(false);
              setInfoDrawerOpen(true);
            }}
            icon={<Info />}
            size="xl"
            aria-label="Информация"
          />
          {importDuplicateSourcesReview ? (
            <Button
              color="muted"
              variant="ghost"
              onClick={() => {
                setInfoDrawerOpen(false);
                setEditDrawerOpen(false);
                setDuplicatesDrawerOpen(false);
                setImportDupDrawerOpen(true);
              }}
              icon={<Copy />}
              size="xl"
              aria-label="Кандидаты в дубликаты"
            />
          ) : showDuplicatesEntry && duplicateBatchId ? (
            <Button
              color="muted"
              variant="ghost"
              onClick={() => {
                setInfoDrawerOpen(false);
                setEditDrawerOpen(false);
                setDuplicatesDrawerOpen(true);
              }}
              icon={<Copy />}
              size="xl"
              aria-label="Дубликаты и похожие"
            />
          ) : null}
          <Button
            color="muted"
            variant="ghost"
            onClick={() => {
              setInfoDrawerOpen(false);
              setDuplicatesDrawerOpen(false);
              setImportDupDrawerOpen(false);
              setEditDrawerOpen(true);
            }}
            icon={<SlidersHorizontal />}
            size="xl"
            aria-label="Редактирование"
          />
        </div>

        <Drawer
          behavior="move"
          title="Информация"
          open={infoDrawerOpen}
          onClose={() => setInfoDrawerOpen(false)}
          side="right"
          portalTarget={viewerRef.current}
          adjustContainerPadding={false}
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

                  <div>
                    <strong>Название:</strong> {renderValue(currentViewer.title)}
                  </div>
                  <div>
                    <strong>Файл:</strong> {renderValue(currentViewer.photo.filename)}
                  </div>
                  <div>
                    <strong>MIME:</strong> {renderValue(currentViewer.photo.mime_type)}
                  </div>
                  <div>
                    <strong>Размер:</strong> {renderValue(currentViewer.photo.size_bytes)}
                  </div>
                  <div>
                    <strong>Разрешение:</strong>{' '}
                    {currentViewer.photo.width && currentViewer.photo.height
                      ? `${renderValue(currentViewer.photo.width)} × ${renderValue(
                          currentViewer.photo.height,
                        )}`
                      : '—'}
                  </div>
                  <div>
                    <strong>Дата съёмки:</strong>{' '}
                    {renderValue(currentViewer.photo.taken_at)}
                  </div>
                  <div>
                    <strong>Производитель камеры:</strong>{' '}
                    {renderValue(currentViewer.photo.camera_make)}
                  </div>
                  <div>
                    <strong>Камера:</strong>{' '}
                    {renderValue(currentViewer.photo.camera_model)}
                  </div>
                  <div>
                    <strong>Объектив:</strong> {renderValue(currentViewer.photo.lens)}
                  </div>
                  <div>
                    <strong>ISO:</strong> {renderValue(currentViewer.photo.iso)}
                  </div>
                  <div>
                    <strong>Диафрагма:</strong>{' '}
                    {renderValue(currentViewer.photo.aperture)}
                  </div>
                  <div>
                    <strong>Выдержка:</strong>{' '}
                    {renderValue(currentViewer.photo.shutter_speed)}
                  </div>
                  <div>
                    <strong>Фокусное расстояние:</strong>{' '}
                    {renderValue(currentViewer.photo.focal_length)}
                  </div>
                  <div>
                    <strong>Рейтинг:</strong> {renderValue(currentViewer.photo.rating)}
                  </div>
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

                  <PhotoFacesPanel
                    assetId={currentViewer.id}
                    open={infoDrawerOpen}
                    faces={currentViewer.faces}
                    activeFaceId={activeFaceId}
                    onActiveFaceChange={setActiveFaceId}
                    onFacesReload={(assetId) =>
                      loadAssetViewer(assetId, true).then(() => undefined)
                    }
                  />
                </section>
              </>
            ) : (
              <div>Нет данных</div>
            )}
          </div>
        </Drawer>

        <Drawer
          behavior="move"
          title="Редактирование"
          open={editDrawerOpen}
          onClose={() => setEditDrawerOpen(false)}
          side="right"
          portalTarget={viewerRef.current}
          adjustContainerPadding={false}
        >
          <PhotoEditDrawer
            recipe={draftRecipe}
            onRecipeChange={setDraftRecipe}
            onApply={handleApplyEdit}
            applying={applyingVersion}
            disabled={!currentViewer?.version}
          />
        </Drawer>

        {showDuplicatesEntry && duplicateBatchId ? (
          <PhotoDuplicatesDrawer
            open={duplicatesDrawerOpen}
            onClose={() => setDuplicatesDrawerOpen(false)}
            portalTarget={viewerRef.current}
            assetId={currentPhoto.asset_id}
            importBatchId={duplicateBatchId}
            duplicateOfAssetId={duplicateOfId}
            adjustContainerPadding={false}
          />
        ) : null}

        {importDuplicateSourcesReview && currentImportDupGroup ? (
          <ImportDuplicateCandidatesDrawer
            open={importDupDrawerOpen}
            onClose={() => setImportDupDrawerOpen(false)}
            portalTarget={viewerRef.current}
            batchId={importDuplicateSourcesReview.batchId}
            group={currentImportDupGroup}
            onCandidateReviewed={importDuplicateSourcesReview.onCandidateReviewed}
            adjustContainerPadding={false}
          />
        ) : null}
      </div>

      <div ref={stageRef} className={styles.stage}>
        <AnimatePresence initial={false} custom={direction} mode="wait">
          {photoSrc ? (
            <motion.div
              key={currentPhoto.asset_id ?? `${currentIndex}-${photoSrc}`}
              className={styles['image-wrap']}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                duration: 0.22,
                ease: [0.22, 1, 0.36, 1],
              }}
              onAnimationComplete={() => {
                requestAnimationFrame(() => {
                  updateImageMetrics();
                  setImageSettled(true);
                });
              }}
            >
              <img
                ref={imgRef}
                src={photoSrc}
                alt="Фотография"
                className={styles['image-inner']}
                style={livePreviewImgStyle}
                draggable={false}
                onLoad={() => {
                  requestAnimationFrame(() => {
                    updateImageMetrics();
                  });
                }}
              />
              {liveVignetteStyle ? (
                <div style={liveVignetteStyle} aria-hidden />
              ) : null}
            </motion.div>
          ) : (
            <motion.div
              key={`${currentPhoto.asset_id}-pending`}
              className={styles['preview-pending']}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                duration: 0.22,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              Превью обновляется…
            </motion.div>
          )}
        </AnimatePresence>

        {faceBoxes.length > 0 && (
          <div className={styles.overlay} aria-hidden="true">
            {faceBoxes.map((box, index) => (
              <div
                key={box.id}
                className={`${styles['face-box']} ${
                  box.active ? styles['face-box-active'] : ''
                }`}
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                }}
                onClick={() => {
                  setActiveFaceId(box.id);
                  setEditDrawerOpen(false);
                  setDuplicatesDrawerOpen(false);
                  setImportDupDrawerOpen(false);
                  setInfoDrawerOpen(true);
                }}
              >
                <div
                  className={`${styles['face-label']} ${
                    box.active ? styles['face-label-active'] : ''
                  }`}
                >
                  {box.personName || `Лицо ${index + 1}`}
                </div>
              </div>
            ))}
          </div>
        )}

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
