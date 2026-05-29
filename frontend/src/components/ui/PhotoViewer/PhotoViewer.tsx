import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Copy,
  Info,
  Maximize2,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import styles from './PhotoViewer.module.css';
import type {
  ImportBatchDuplicateCandidateItem,
  ImportBatchDuplicateGroup,
} from '../../../api/importBatches';
import {
  createAssetVersion,
  getAssetViewer,
  updateAssetVersionTags,
  type AssetListItem,
  type AssetViewer,
} from '../../../api/assets';
import { DEFAULT_PHOTO_RECIPE, normalizeRecipe, type PhotoRecipe } from '../../../api/recipe';
import Button from '../Button';
import Chip from '../Chip';
import Drawer, { DRAWER_MOVE_PADDING_PX } from '../Drawer';
import PhotoCarousel from '../PhotoCarousel';
import PhotoFacesPanel from '../PhotoFacesPanel';
import ImportDuplicateCandidatesDrawer from './ImportDuplicateCandidatesDrawer';
import PhotoDuplicatesDrawer from './PhotoDuplicatesDrawer';
import PhotoEditDrawer from './PhotoEditDrawer';
import PhotoEditMobileOverlay from './PhotoEditMobileOverlay';
import PhotoCompareStage from './PhotoCompareStage';
import PhotoAssetFoldersPanel from './PhotoAssetFoldersPanel';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '../../../hooks/useMediaQuery';
import ZoomableImageStage from './ZoomableImageStage';
import { renderMagickPreviewUrl } from './magickPreview';
import { useImageViewport } from './useImageViewport';
import type { ViewportMetrics } from './viewportMath';

interface PhotoViewerProps {
  photos: AssetListItem[];
  currentIndex: number;
  lifecycleMode?: 'active' | 'trashed';
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
  onClose: () => void;
  onFoldersChanged?: () => void;
  onTrashAsset?: (assetId: string) => Promise<void> | void;
  onRestoreAsset?: (assetId: string) => Promise<void> | void;
  onPermanentlyDeleteAsset?: (assetId: string) => Promise<void> | void;
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
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: Direction) => ({
    x: direction > 0 ? -64 : 64,
    opacity: 0,
  }),
};

function assetListPreviewSrc(item: AssetListItem): string {
  return item.version?.preview_url || item.version?.thumbnail_url || '';
}

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

function normalizeTag(value: string): string | null {
  const tag = value.trim().replace(/\s+/g, ' ');
  if (!tag) return null;
  return tag.length > 64 ? tag.slice(0, 64).trim() : tag;
}

function normalizeTagsFromValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    const tag = normalizeTag(item);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 30) break;
  }
  return out;
}

export default function PhotoViewer({
  photos,
  currentIndex,
  lifecycleMode = 'active',
  onPrevious,
  onNext,
  onSelect,
  onClose,
  onFoldersChanged,
  onTrashAsset,
  onRestoreAsset,
  onPermanentlyDeleteAsset,
  importDuplicateSourcesReview,
}: PhotoViewerProps) {
  const [direction, setDirection] = useState<Direction>(1);
  const [infoDrawerOpen, setInfoDrawerOpen] = useState(false);
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);
  const [duplicatesDrawerOpen, setDuplicatesDrawerOpen] = useState(false);
  const [importDupDrawerOpen, setImportDupDrawerOpen] = useState(true);
  const [applyingVersion, setApplyingVersion] = useState(false);
  const [draftRecipe, setDraftRecipe] = useState<PhotoRecipe>(DEFAULT_PHOTO_RECIPE);
  const [viewerById, setViewerById] = useState<Record<string, AssetViewer>>({});
  const [viewerLoadingById, setViewerLoadingById] = useState<Record<string, boolean>>(
    {},
  );
  const [viewerErrorById, setViewerErrorById] = useState<
    Record<string, string | null>
  >({});
  const [tagDraft, setTagDraft] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [renderedPreviewUrl, setRenderedPreviewUrl] = useState<string | null>(null);
  const [renderingPreview, setRenderingPreview] = useState(false);
  const [previewRenderError, setPreviewRenderError] = useState<string | null>(null);
  const [imageMetrics, setImageMetrics] = useState<ImageMetrics | null>(null);
  const [imageSettled, setImageSettled] = useState(false);
  const [activeFaceId, setActiveFaceId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareAssetId, setCompareAssetId] = useState<string | null>(null);
  const [compareSrc, setCompareSrc] = useState('');
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareLabel, setCompareLabel] = useState('');
  const [assetActionLoading, setAssetActionLoading] = useState(false);

  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const isTrashMode = lifecycleMode === 'trashed';
  const isEditing = !isTrashMode && editDrawerOpen;

  const prevIndexRef = useRef(currentIndex);
  const viewerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewerByIdRef = useRef<Record<string, AssetViewer>>({});
  const viewerRequestIdRef = useRef<Record<string, number>>({});
  const previewRenderRequestIdRef = useRef(0);
  const renderedPreviewUrlRef = useRef<string | null>(null);
  const compareImgRef = useRef<HTMLImageElement>(null);
  const viewportMetricsRef = useRef<ViewportMetrics | null>(null);

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
      if (editDrawerOpen) return;

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
  }, [editDrawerOpen, onNext, onPrevious]);

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

  const displayPhotoSrc = renderedPreviewUrl ?? photoSrc;

  const viewportResetKey = currentPhoto?.asset_id ?? null;
  const viewportApi = useImageViewport({
    resetKey: viewportResetKey,
    metricsRef: viewportMetricsRef,
  });

  const recalculateBounds = viewportApi.recalculateBounds;
  const handleViewportMetricsChange = useCallback(() => {
    recalculateBounds();
  }, [recalculateBounds]);

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

  useEffect(() => {
    if (!isTrashMode) return;
    setEditDrawerOpen(false);
    setDuplicatesDrawerOpen(false);
    setImportDupDrawerOpen(false);
  }, [isTrashMode]);

  const currentImportDupGroup = useMemo(() => {
    if (!importDuplicateSourcesReview) return null;
    return importDuplicateSourcesReview.groups[currentIndex] ?? null;
  }, [importDuplicateSourcesReview, currentIndex]);

  const duplicateBatchId =
    currentViewer?.import_batch_id ?? currentPhoto?.import_batch_id ?? null;
  const duplicateReviewStatus =
    currentViewer?.duplicate_review_status ?? currentPhoto?.duplicate_review_status ?? null;
  const duplicateOfId =
    currentViewer?.duplicate_of_asset_id ?? currentPhoto?.duplicate_of_asset_id ?? null;
  const showDuplicatesEntry =
    !isTrashMode &&
    !importDuplicateSourcesReview &&
    Boolean(duplicateBatchId) &&
    (duplicateReviewStatus === 'has_duplicates' ||
      duplicateReviewStatus === 'reviewed' ||
      duplicateOfId != null);

  const moveDrawerPaddingOpen =
    infoDrawerOpen ||
    (editDrawerOpen && !isMobile) ||
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

  const handleCancelEdit = useCallback(() => {
    setEditDrawerOpen(false);
  }, []);

  const handleOpenEdit = useCallback(() => {
    setInfoDrawerOpen(false);
    setDuplicatesDrawerOpen(false);
    setImportDupDrawerOpen(false);
    setCompareMode(false);
    setEditDrawerOpen(true);
  }, []);

  useEffect(() => {
    if (!editDrawerOpen) return;
    if (!currentViewer?.version) return;
    const normalized = normalizeRecipe(currentViewer.version.recipe);
    setDraftRecipe(normalized);
  }, [editDrawerOpen, currentViewer?.version?.id]);

  useEffect(() => {
    if (!editDrawerOpen || !currentViewer?.photo.original_url || !currentViewer.version) {
      previewRenderRequestIdRef.current += 1;
      setRenderingPreview(false);
      setPreviewRenderError(null);
      setRenderedPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        renderedPreviewUrlRef.current = null;
        return null;
      });
      return;
    }

    const requestId = previewRenderRequestIdRef.current + 1;
    previewRenderRequestIdRef.current = requestId;
    setRenderingPreview(true);
    setPreviewRenderError(null);

    const timer = window.setTimeout(() => {
      void renderMagickPreviewUrl(currentViewer.photo.original_url!, draftRecipe)
        .then((nextUrl) => {
          if (previewRenderRequestIdRef.current !== requestId) {
            URL.revokeObjectURL(nextUrl);
            return;
          }

          setRenderedPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            renderedPreviewUrlRef.current = nextUrl;
            return nextUrl;
          });
        })
        .catch(() => {
          if (previewRenderRequestIdRef.current === requestId) {
            setPreviewRenderError('Не удалось построить live preview через ImageMagick');
          }
        })
        .finally(() => {
          if (previewRenderRequestIdRef.current === requestId) {
            setRenderingPreview(false);
          }
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    draftRecipe,
    editDrawerOpen,
    currentViewer?.photo.original_url,
    currentViewer?.version?.id,
  ]);

  useEffect(() => {
    return () => {
      if (renderedPreviewUrlRef.current) {
        URL.revokeObjectURL(renderedPreviewUrlRef.current);
        renderedPreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setTagDraft('');
    setTagError(null);
  }, [currentViewer?.version?.id]);

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

  const saveTags = useCallback(
    async (tags: string[]) => {
      const aid = currentPhoto?.asset_id;
      const vid = currentViewer?.version?.id;
      if (!aid || !vid || tagSaving) return;

      setTagSaving(true);
      setTagError(null);
      try {
        const response = await updateAssetVersionTags(aid, vid, tags);
        setTagDraft('');
        setViewerById((prev) => {
          const viewer = prev[aid];
          if (!viewer) return prev;
          const next = {
            ...prev,
            [aid]: {
              ...viewer,
              version: viewer.version
                ? { ...viewer.version, keywords: response.keywords }
                : viewer.version,
              photo: {
                ...viewer.photo,
                keywords: response.keywords,
              },
            },
          };
          viewerByIdRef.current = next;
          return next;
        });
      } catch {
        setTagError('Не удалось сохранить теги версии');
      } finally {
        setTagSaving(false);
      }
    },
    [currentPhoto?.asset_id, currentViewer?.version?.id, tagSaving],
  );

  const handleAddTag = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const currentTags = currentViewer?.photo.keywords ?? [];
      const nextTags = normalizeTagsFromValues([...currentTags, tagDraft]);
      if (nextTags.length === currentTags.length || tagSaving) return;
      await saveTags(nextTags);
    },
    [currentViewer?.photo.keywords, saveTags, tagDraft, tagSaving],
  );

  const handleRemoveTag = useCallback(
    async (tag: string) => {
      const currentTags = currentViewer?.photo.keywords ?? [];
      const key = tag.toLocaleLowerCase('ru-RU');
      const nextTags = currentTags.filter(
        (item) => item.toLocaleLowerCase('ru-RU') !== key,
      );
      if (nextTags.length === currentTags.length || tagSaving) return;
      await saveTags(nextTags);
    },
    [currentViewer?.photo.keywords, saveTags, tagSaving],
  );

  useEffect(() => {
    setImageSettled(false);
    setImageMetrics(null);
  }, [currentPhoto?.asset_id, displayPhotoSrc]);

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

  const handleTrashCurrent = async () => {
    if (!currentPhoto || !onTrashAsset || assetActionLoading) return;
    const confirmed = window.confirm('Переместить фото в корзину?');
    if (!confirmed) return;

    setAssetActionLoading(true);
    try {
      await onTrashAsset(currentPhoto.asset_id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось переместить фото в корзину');
    } finally {
      setAssetActionLoading(false);
    }
  };

  const handleRestoreCurrent = async () => {
    if (!currentPhoto || !onRestoreAsset || assetActionLoading) return;

    setAssetActionLoading(true);
    try {
      await onRestoreAsset(currentPhoto.asset_id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось восстановить фото');
    } finally {
      setAssetActionLoading(false);
    }
  };

  const handlePermanentlyDeleteCurrent = async () => {
    if (!currentPhoto || !onPermanentlyDeleteAsset || assetActionLoading) return;
    const confirmed = window.confirm(
      'Удалить фото окончательно? Это действие нельзя отменить.',
    );
    if (!confirmed) return;

    setAssetActionLoading(true);
    try {
      await onPermanentlyDeleteAsset(currentPhoto.asset_id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось удалить фото');
    } finally {
      setAssetActionLoading(false);
    }
  };

  const handleSelect = (index: number) => {
    setDirection(index > currentIndex ? 1 : -1);
    onSelect(index);
  };

  const handleCompareSelect = useCallback(
    (assetId: string) => {
      if (!currentPhoto || assetId === currentPhoto.asset_id) return;
      setCompareAssetId(assetId);
      setCompareMode(true);
    },
    [currentPhoto?.asset_id],
  );

  const handleCarouselCompareSelect = useCallback(
    (assetId: string, index: number) => {
      if (!compareMode) return;
      if (index === currentIndex) return;
      handleCompareSelect(assetId);
    },
    [compareMode, currentIndex, handleCompareSelect],
  );

  const toggleCompareMode = useCallback(() => {
    setCompareMode((prev) => {
      if (prev) {
        setCompareAssetId(null);
        viewportApi.reset();
      }
      return !prev;
    });
  }, [viewportApi]);

  useEffect(() => {
    if (!compareAssetId) {
      setCompareSrc('');
      setCompareLabel('');
      setCompareLoading(false);
      return;
    }

    const inList = photos.find((item) => item.asset_id === compareAssetId);
    if (inList) {
      setCompareSrc(assetListPreviewSrc(inList));
      setCompareLabel(inList.title?.trim() || 'Сравнение');
      setCompareLoading(false);
      return;
    }

    let cancelled = false;
    setCompareLoading(true);

    void getAssetViewer(compareAssetId)
      .then((data) => {
        if (cancelled) return;
        const url =
          data.version?.preview_url || data.version?.thumbnail_url || '';
        setCompareSrc(url);
        setCompareLabel(data.title?.trim() || 'Сравнение');
      })
      .catch(() => {
        if (!cancelled) {
          setCompareSrc('');
          setCompareLabel('Сравнение');
        }
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [compareAssetId, photos]);

  const renderValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  };

  if (!currentPhoto) return null;

  const chromeButtonClass = styles['chrome-button'];
  const chromeButtonActiveClass = styles['chrome-button-active'];

  const zoomButtons = (
    <>
      <Button
        color="muted"
        variant="ghost"
        className={chromeButtonClass}
        onClick={viewportApi.zoomIn}
        icon={<ZoomIn />}
        size="xl"
        aria-label="Приблизить"
      />
      <Button
        color="muted"
        variant="ghost"
        className={chromeButtonClass}
        onClick={viewportApi.zoomOut}
        icon={<ZoomOut />}
        size="xl"
        aria-label="Отдалить"
      />
      <Button
        color="muted"
        variant="ghost"
        className={chromeButtonClass}
        onClick={viewportApi.reset}
        icon={<Maximize2 />}
        size="xl"
        aria-label="Сбросить масштаб"
      />
    </>
  );

  const viewerClassName = [
    styles.viewer,
    isEditing ? styles.viewerEditing : '',
    isEditing && isMobile ? styles.viewerEditingMobile : '',
  ]
    .filter(Boolean)
    .join(' ');

  const stageClassName = [
    compareMode ? `${styles.stage} ${styles.stageCompare}` : styles.stage,
    isEditing && isMobile ? styles.stageEditingMobile : '',
  ]
    .filter(Boolean)
    .join(' ');

  const toolbarClassName = [
    styles['viewer-toolbar'],
    isEditing && !isMobile ? styles['viewer-toolbar-editing'] : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={viewerRef} className={viewerClassName}>
      {!(isEditing && isMobile) ? (
      <div className={toolbarClassName}>
        {!isEditing ? (
          <div className={styles['close-button']}>
            <Button
              color="muted"
              variant="ghost"
              className={chromeButtonClass}
              onClick={onClose}
              icon={<ArrowLeft />}
              size="xl"
            />
          </div>
        ) : (
          <div className={styles['close-button']} aria-hidden="true" />
        )}

        <div className={styles['options-buttons']}>
          {!isEditing ? (
            <Button
              color="muted"
              variant="ghost"
              className={compareMode ? chromeButtonActiveClass : chromeButtonClass}
              onClick={toggleCompareMode}
              icon={<Columns2 />}
              size="xl"
              aria-label={compareMode ? 'Закрыть сравнение' : 'Сравнение'}
            />
          ) : null}
          {!isMobile ? zoomButtons : null}
          {!isEditing ? (
            <>
              <Button
                color="muted"
                variant="ghost"
                className={chromeButtonClass}
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
              {isTrashMode ? (
                <>
                  {onRestoreAsset ? (
                    <Button
                      color="muted"
                      variant="ghost"
                      className={chromeButtonClass}
                      onClick={() => {
                        void handleRestoreCurrent();
                      }}
                      icon={<RotateCcw />}
                      size="xl"
                      disabled={assetActionLoading}
                      aria-label="Восстановить"
                    />
                  ) : null}
                  {onPermanentlyDeleteAsset ? (
                    <Button
                      color="muted"
                      variant="ghost"
                      className={chromeButtonClass}
                      onClick={() => {
                        void handlePermanentlyDeleteCurrent();
                      }}
                      icon={<Trash2 />}
                      size="xl"
                      disabled={assetActionLoading}
                      aria-label="Удалить окончательно"
                    />
                  ) : null}
                </>
              ) : onTrashAsset ? (
                <Button
                  color="muted"
                  variant="ghost"
                  className={chromeButtonClass}
                  onClick={() => {
                    void handleTrashCurrent();
                  }}
                  icon={<Trash2 />}
                  size="xl"
                  disabled={assetActionLoading}
                  aria-label="Переместить в корзину"
                />
              ) : null}
              {importDuplicateSourcesReview ? (
                <Button
                  color="muted"
                  variant="ghost"
                  className={chromeButtonClass}
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
                  className={chromeButtonClass}
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
              {!isTrashMode ? (
                <Button
                  color="muted"
                  variant="ghost"
                  className={chromeButtonClass}
                  onClick={handleOpenEdit}
                  icon={<SlidersHorizontal />}
                  size="xl"
                  aria-label="Редактирование"
                />
              ) : null}
            </>
          ) : null}
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
                  <form
                    onSubmit={handleAddTag}
                    style={{ display: 'grid', gap: 8 }}
                  >
                    <label
                      htmlFor="photo-version-tags"
                      style={{ fontWeight: 700 }}
                    >
                      Ключевые слова
                    </label>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                      }}
                    >
                      <input
                        id="photo-version-tags"
                        value={tagDraft}
                        onChange={(event) => setTagDraft(event.target.value)}
                        placeholder="Новый тег"
                        disabled={isTrashMode || !currentViewer.version || tagSaving}
                        style={{
                          minWidth: 0,
                          flex: 1,
                          boxSizing: 'border-box',
                          borderRadius: 8,
                          border: '1px solid var(--color-border)',
                          background: 'var(--color-bg-primary)',
                          color: 'var(--color-text-primary)',
                          padding: '8px 10px',
                          font: 'inherit',
                        }}
                      />
                      <Button
                        color="primary"
                        size="sm"
                        disabled={
                          isTrashMode || !currentViewer.version || tagSaving || !tagDraft.trim()
                        }
                      >
                        {tagSaving ? '...' : 'Добавить'}
                      </Button>
                    </div>
                    {currentViewer.photo.keywords.length > 0 ? (
                      <div
                        aria-label="Теги текущей версии"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        {currentViewer.photo.keywords.map((tag) => (
                          <Chip
                            key={tag}
                            onRemove={
                              isTrashMode
                                ? undefined
                                : () => {
                                    void handleRemoveTag(tag);
                                  }
                            }
                            title="Удалить тег"
                          >
                            {tag}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                    {tagError ? (
                      <div style={{ color: 'var(--color-danger, #c62828)' }}>
                        {tagError}
                      </div>
                    ) : null}
                  </form>
                </section>

                {!isTrashMode ? (
                  <>
                    <section style={{ display: 'grid', gap: 10 }}>
                      <h3 style={{ margin: 0, fontSize: 16 }}>Папки</h3>
                      <PhotoAssetFoldersPanel
                        assetId={currentViewer.id}
                        open={infoDrawerOpen}
                        onChanged={onFoldersChanged}
                      />
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
                ) : null}
              </>
            ) : (
              <div>Нет данных</div>
            )}
          </div>
        </Drawer>

        <Drawer
          behavior="move"
          title="Редактирование"
          open={isEditing && !isMobile}
          onClose={handleCancelEdit}
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
            onCompareSelect={handleCompareSelect}
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
            onCompareSelect={handleCompareSelect}
          />
        ) : null}
      </div>
      ) : null}

      {isEditing && isMobile ? (
        <PhotoEditMobileOverlay
          className={styles['mobile-edit-overlay']}
          recipe={draftRecipe}
          onRecipeChange={setDraftRecipe}
          onCancel={handleCancelEdit}
          onApply={handleApplyEdit}
          applying={applyingVersion}
          disabled={!currentViewer?.version}
        />
      ) : null}

      <div
        ref={stageRef}
        className={stageClassName}
      >
        {compareMode ? (
          <PhotoCompareStage
            viewportApi={viewportApi}
            metricsRef={viewportMetricsRef}
            minimapSrc={displayPhotoSrc || undefined}
            onMetricsChange={handleViewportMetricsChange}
            leftLabel={
              currentViewer?.title?.trim() ||
              currentPhoto.title?.trim() ||
              'Текущее'
            }
            rightLabel={compareLoading ? 'Загрузка…' : compareLabel || 'Сравнение'}
            leftSrc={displayPhotoSrc || undefined}
            rightSrc={compareSrc || undefined}
            leftImageRef={imgRef}
            rightImageRef={compareImgRef}
            onLeftImageLoad={() => {
              requestAnimationFrame(() => {
                updateImageMetrics();
              });
            }}
            rightEmptyLabel={
              compareLoading
                ? 'Загрузка превью…'
                : 'Выберите фото в карусели или в списке дубликатов'
            }
            leftOverlay={
              <>
                {renderingPreview ? (
                  <div className={styles['render-status']}>ImageMagick preview...</div>
                ) : null}
                {previewRenderError ? (
                  <div className={styles['render-status']}>{previewRenderError}</div>
                ) : null}
              </>
            }
          />
        ) : (
          <AnimatePresence initial={false} custom={direction} mode="wait">
          {displayPhotoSrc ? (
            <motion.div
              key={currentPhoto.asset_id ?? `${currentIndex}-${displayPhotoSrc}`}
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
              <ZoomableImageStage
                fill
                viewport={viewportApi.viewport}
                handlers={viewportApi.handlers}
                src={displayPhotoSrc}
                imageRef={imgRef}
                metricsRef={viewportMetricsRef}
                onMetricsChange={handleViewportMetricsChange}
                onImageLoad={() => {
                  requestAnimationFrame(() => {
                    updateImageMetrics();
                  });
                }}
              >
              {renderingPreview ? (
                <div className={styles['render-status']}>ImageMagick preview...</div>
              ) : null}
              {previewRenderError ? (
                <div className={styles['render-status']}>{previewRenderError}</div>
              ) : null}
              </ZoomableImageStage>
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
        )}

        {!compareMode &&
          !isEditing &&
          !viewportApi.isZoomed &&
          faceBoxes.length > 0 && (
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

        {!isEditing ? (
          <>
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
          </>
        ) : null}
      </div>

      {isMobile || !isEditing ? (
        <div className={styles.footer}>
          {isMobile ? (
            <div className={styles['zoom-bar']}>{zoomButtons}</div>
          ) : null}
          {!isEditing ? (
            <PhotoCarousel
              photos={photos}
              currentIndex={currentIndex}
              onSelect={handleSelect}
              compareMode={compareMode}
              compareAssetId={compareAssetId}
              onCompareSelect={handleCarouselCompareSelect}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
