import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Menu, RefreshCw } from 'lucide-react';

import type { AssetListItem } from '../../api/assets';
import BatchAssetsGrid from '../../components/features/imports/BatchAssetsGrid';
import DuplicateSourcesSection, {
  duplicateSourcesToCarouselPhotos,
} from '../../components/features/imports/DuplicateSourcesSection';
import FaceIdentityClustersSection from '../../components/features/imports/FaceIdentityClustersSection';
import ImportBatchTagsSection from '../../components/features/imports/ImportBatchTagsSection';
import DropZone from '../../components/features/imports/DropZone';
import ImportsSidebar from '../../components/features/imports/ImportsSidebar';
import UploadProgressDrawer from '../../components/features/imports/UploadProgressDrawer';
import Modal from '../../components/ui/Modal';
import PhotoViewer from '../../components/ui/PhotoViewer';
import pageLayout from '../../styles/page-layout.module.css';
import { useImportSessionStore } from '../../stores/useImportSessionStore';
import type {
  ImportBatchDuplicateCandidateItem,
  ImportBatchDuplicateGroup,
} from '../../api/importBatches';
import type { IdentityAssignmentResponse, ImportBatchFaceCluster } from '../../api/faces';

import styles from './ImportPage.module.css';

const DESKTOP_MEDIA_QUERY = '(min-width: 769px)';

const EMPTY_DUP_GROUPS: ImportBatchDuplicateGroup[] = [];
const EMPTY_FACE_CLUSTERS: ImportBatchFaceCluster[] = [];
const EMPTY_ASSETS: AssetListItem[] = [];

/** Тултип у значка под заголовком блока «Дубликаты в партии». */
const DUPLICATE_SECTION_HELP_TOOLTIP =
  'Учитываются только совпадения между фото этой партии после появления превью и хешей. Нажмите на источник — откроется просмотр: в карусели все источники с дубликатами, по кнопке «Кандидаты в дубликаты» или справа открывается дровер со списком кандидатов для текущего источника; для каждого кандидата можно вынести вердикт.';

const STATUS_LABEL: Record<string, string> = {
  uploading: 'Загрузка',
  processing: 'ML-обработка',
  pending_review: 'Ожидает ревью',
  accepted: 'Принято',
  rejected: 'Отклонено',
  cancelled: 'Отменено',
};

function formatBatchTitle(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Партия импорта';
  return `Партия от ${date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export default function ImportPage() {
  const { batchId } = useParams<{ batchId?: string }>();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();

  const batches = useImportSessionStore((s) => s.batches);
  const isListLoading = useImportSessionStore((s) => s.isListLoading);
  const listError = useImportSessionStore((s) => s.listError);
  const assetsByBatch = useImportSessionStore((s) => s.assetsByBatch);
  const assetsLoadingByBatch = useImportSessionStore(
    (s) => s.assetsLoadingByBatch,
  );
  const fetchBatches = useImportSessionStore((s) => s.fetchBatches);
  const createBatch = useImportSessionStore((s) => s.createBatch);
  const closeBatch = useImportSessionStore((s) => s.closeBatch);
  const acceptBatch = useImportSessionStore((s) => s.acceptBatch);
  const retryBatchFaces = useImportSessionStore((s) => s.retryBatchFaces);
  const retryAssetMl = useImportSessionStore((s) => s.retryAssetMl);
  const refreshBatch = useImportSessionStore((s) => s.refreshBatch);
  const fetchBatchAssets = useImportSessionStore((s) => s.fetchBatchAssets);
  const fetchBatchFaceClusters = useImportSessionStore((s) => s.fetchBatchFaceClusters);
  const fetchBatchReviewAssetsTotal = useImportSessionStore(
    (s) => s.fetchBatchReviewAssetsTotal,
  );
  const fetchBatchTagSuggestions = useImportSessionStore(
    (s) => s.fetchBatchTagSuggestions,
  );
  const applyTagsToBatch = useImportSessionStore((s) => s.applyTagsToBatch);
  const startUploads = useImportSessionStore((s) => s.startUploads);
  const startBatchPolling = useImportSessionStore((s) => s.startBatchPolling);
  const stopBatchPolling = useImportSessionStore((s) => s.stopBatchPolling);

  const duplicateGroups = useImportSessionStore((s) =>
    batchId ? s.duplicateGroupsByBatch[batchId] ?? EMPTY_DUP_GROUPS : EMPTY_DUP_GROUPS,
  );

  const duplicateReviewedCount = useMemo(() => {
    let n = 0;
    for (const g of duplicateGroups) {
      for (const c of g.candidates) {
        if (c.review_decision != null) n += 1;
      }
    }
    return n;
  }, [duplicateGroups]);

  const duplicateCandidatesTotal = useMemo(() => {
    let n = 0;
    for (const g of duplicateGroups) {
      n += g.candidates.length;
    }
    return n;
  }, [duplicateGroups]);

  const duplicatesLoaded = useImportSessionStore((s) =>
    batchId ? (s.duplicatesLoadedByBatch[batchId] ?? false) : false,
  );
  const duplicateDupFetchFailed = useImportSessionStore((s) =>
    batchId ? (s.duplicateDupFetchFailedByBatch[batchId] ?? false) : false,
  );
  const duplicatePending = useImportSessionStore((s) =>
    batchId ? (s.duplicatePendingByBatch[batchId] ?? 0) : 0,
  );
  const faceClusters = useImportSessionStore((s) =>
    batchId
      ? s.faceClustersByBatch[batchId] ?? EMPTY_FACE_CLUSTERS
      : EMPTY_FACE_CLUSTERS,
  );
  const faceClustersLoaded = useImportSessionStore((s) =>
    batchId ? (s.faceClustersLoadedByBatch[batchId] ?? false) : false,
  );
  const faceClustersFetchFailed = useImportSessionStore((s) =>
    batchId ? (s.faceClustersFetchFailedByBatch[batchId] ?? false) : false,
  );
  const reviewAssetsTotal = useImportSessionStore((s) =>
    batchId ? (s.reviewAssetsTotalByBatch[batchId] ?? 0) : 0,
  );
  const updateFaceClusterAssignment = useImportSessionStore(
    (s) => s.updateFaceClusterAssignment,
  );
  const tagSuggestions = useImportSessionStore((s) =>
    batchId ? s.tagSuggestionsByBatch[batchId] ?? null : null,
  );
  const tagSuggestionsLoading = useImportSessionStore((s) =>
    batchId ? (s.tagSuggestionsLoadingByBatch[batchId] ?? false) : false,
  );
  const tagSuggestionsFetchFailed = useImportSessionStore((s) =>
    batchId ? (s.tagSuggestionsFetchFailedByBatch[batchId] ?? false) : false,
  );
  const tagApplyError = useImportSessionStore((s) =>
    batchId ? (s.tagApplyErrorByBatch[batchId] ?? null) : null,
  );

  const faceClustersTotal = faceClusters.length;
  const faceClustersReviewed = useMemo(
    () => faceClusters.filter((cluster) => cluster.review_required_count === 0).length,
    [faceClusters],
  );

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [isAccepting, setIsAccepting] = useState<boolean>(false);
  const [isRetryingMl, setIsRetryingMl] = useState<boolean>(false);
  const [retryingAssetId, setRetryingAssetId] = useState<string | null>(null);
  const [duplicatesCollapsed, setDuplicatesCollapsed] = useState(false);
  const [faceClustersCollapsed, setFaceClustersCollapsed] = useState(false);
  const [dupClusterViewer, setDupClusterViewer] = useState<{
    photos: AssetListItem[];
    index: number;
    batchId: string;
    groups: ImportBatchDuplicateGroup[];
  } | null>(null);
  const [assetViewer, setAssetViewer] = useState<{
    photos: AssetListItem[];
    index: number;
  } | null>(null);

  useEffect(() => {
    setSidebarOpen(isDesktop);
  }, [isDesktop]);

  useEffect(() => {
    void fetchBatches();
  }, [fetchBatches]);

  useEffect(() => {
    if (!batchId) {
      stopBatchPolling();
      return;
    }
    void fetchBatchAssets(batchId);
    void refreshBatch(batchId);
    void fetchBatchTagSuggestions(batchId);
    void fetchBatchReviewAssetsTotal(batchId);
    startBatchPolling(batchId);
    return () => {
      stopBatchPolling();
    };
  }, [
    batchId,
    fetchBatchAssets,
    fetchBatchReviewAssetsTotal,
    fetchBatchTagSuggestions,
    refreshBatch,
    startBatchPolling,
    stopBatchPolling,
  ]);

  const activeBatch = useMemo(
    () => (batchId ? batches.find((b) => b.id === batchId) ?? null : null),
    [batches, batchId],
  );

  const activeAssets = useMemo(
    () => (batchId ? assetsByBatch[batchId] ?? EMPTY_ASSETS : EMPTY_ASSETS),
    [assetsByBatch, batchId],
  );

  const outsideClusterAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const asset of activeAssets) {
      if ((asset.unassigned_faces_count ?? 0) > 0) {
        ids.add(asset.asset_id);
      }
    }
    return ids;
  }, [activeAssets]);

  const viewerPhotos = useMemo(
    () =>
      activeAssets.filter(
        (asset) =>
          asset.version?.preview_status === 'completed' &&
          !!asset.version?.thumbnail_url,
      ),
    [activeAssets],
  );

  const mlFailedCount = useMemo(
    () =>
      activeAssets.filter((asset) => asset.version?.faces_status === 'failed')
        .length,
    [activeAssets],
  );
  const canRetryMl = useMemo(() => {
    if (!activeBatch || mlFailedCount === 0) return false;
    return (
      activeBatch.status === 'processing' ||
      activeBatch.status === 'pending_review'
    );
  }, [activeBatch, mlFailedCount]);
  const canRetryAssetMl = canRetryMl;
  const showMlErrorsBanner = useMemo(() => {
    if (mlFailedCount === 0 || !activeBatch) return false;
    return (
      activeBatch.status === 'processing' ||
      activeBatch.status === 'pending_review' ||
      activeBatch.status === 'accepted'
    );
  }, [activeBatch, mlFailedCount]);
  const isAssetsLoading = batchId
    ? assetsLoadingByBatch[batchId] ?? false
    : false;

  const handleCreate = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const batch = await createBatch();
      navigate(`/import/${batch.id}`);
      if (!isDesktop) setSidebarOpen(false);
    } finally {
      setIsCreating(false);
    }
  }, [createBatch, isCreating, isDesktop, navigate]);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (!batchId) return;
      startUploads(batchId, files);
    },
    [batchId, startUploads],
  );

  // Закрывать партию можно только когда для каждого ассета завершилась фаза
  // preview: либо completed (пойдёт на ML), либо failed (останется в error,
  // его можно будет потом перезапустить через retry-failed-previews).
  const canClose = useMemo(() => {
    if (!activeBatch || activeBatch.status !== 'uploading') return false;
    if (activeAssets.length === 0) return false;
    return activeAssets.every((a) => {
      const p = a.version?.preview_status ?? 'pending';
      return p === 'completed' || p === 'failed';
    });
  }, [activeBatch, activeAssets]);

  const hasQueuedPreview = activeAssets.some((a) => {
    const p = a.version?.preview_status ?? 'pending';
    return p === 'pending' || p === 'processing';
  });

  const handleClose = useCallback(async () => {
    if (!batchId || !canClose || isClosing) return;
    setIsClosing(true);
    try {
      await closeBatch(batchId);
    } finally {
      setIsClosing(false);
    }
  }, [batchId, canClose, closeBatch, isClosing]);

  const canAcceptReview = useMemo(() => {
    if (!activeBatch || activeBatch.status !== 'pending_review') return false;
    if (!duplicatesLoaded || duplicateDupFetchFailed) return false;
    if (!faceClustersLoaded || faceClustersFetchFailed) return false;
    if (duplicatePending > 0) return false;
    if (reviewAssetsTotal > 0) return false;
    return faceClusters.every((cluster) => cluster.review_required_count === 0);
  }, [
    activeBatch,
    duplicateDupFetchFailed,
    duplicatePending,
    duplicatesLoaded,
    faceClusters,
    faceClustersFetchFailed,
    faceClustersLoaded,
    reviewAssetsTotal,
  ]);

  const acceptReviewHint = useMemo(() => {
    if (!activeBatch || activeBatch.status !== 'pending_review') return '';
    if (!duplicatesLoaded || !faceClustersLoaded) {
      return 'Дождитесь загрузки данных о дубликатах и лицах';
    }
    if (duplicateDupFetchFailed || faceClustersFetchFailed) {
      return 'Не удалось загрузить данные для проверки. Обновите страницу';
    }
    if (duplicatePending > 0) {
      return `Осталось проверить ${duplicatePending} дубликатов`;
    }
    const pendingClusters = faceClusters.filter(
      (cluster) => cluster.review_required_count > 0,
    ).length;
    if (pendingClusters > 0) {
      return `Осталось проверить ${pendingClusters} кластеров лиц`;
    }
    if (reviewAssetsTotal > 0) {
      return `Осталось назначить персон для ${reviewAssetsTotal} фото`;
    }
    return 'Подтвердить завершение проверки партии';
  }, [
    activeBatch,
    duplicateDupFetchFailed,
    duplicatePending,
    duplicatesLoaded,
    faceClusters,
    faceClustersFetchFailed,
    faceClustersLoaded,
    reviewAssetsTotal,
  ]);

  const handleAcceptReview = useCallback(async () => {
    if (!batchId || !canAcceptReview || isAccepting) return;
    setIsAccepting(true);
    try {
      await acceptBatch(batchId);
    } finally {
      setIsAccepting(false);
    }
  }, [acceptBatch, batchId, canAcceptReview, isAccepting]);

  const handleRetryMl = useCallback(async () => {
    if (!batchId || !canRetryMl || isRetryingMl) return;
    setIsRetryingMl(true);
    try {
      await retryBatchFaces(batchId);
      void fetchBatchAssets(batchId);
      startBatchPolling(batchId);
    } finally {
      setIsRetryingMl(false);
    }
  }, [
    batchId,
    canRetryMl,
    fetchBatchAssets,
    isRetryingMl,
    retryBatchFaces,
    startBatchPolling,
  ]);

  const handleRetryAssetFaces = useCallback(
    async (asset: AssetListItem) => {
      if (!batchId || !canRetryAssetMl || !asset.version?.id) return;
      if (retryingAssetId === asset.asset_id) return;
      setRetryingAssetId(asset.asset_id);
      try {
        await retryAssetMl(batchId, asset.asset_id, asset.version.id);
        startBatchPolling(batchId);
      } finally {
        setRetryingAssetId(null);
      }
    },
    [batchId, canRetryAssetMl, retryAssetMl, retryingAssetId, startBatchPolling],
  );

  useEffect(() => {
    setDupClusterViewer(null);
  }, [batchId]);

  const handleOpenDuplicateCluster = useCallback(
    (group: ImportBatchDuplicateGroup) => {
      if (!batchId || duplicateGroups.length === 0) return;
      const photos = duplicateSourcesToCarouselPhotos(duplicateGroups, activeAssets);
      const idx = duplicateGroups.findIndex(
        (g) => g.source_asset_id === group.source_asset_id,
      );
      setDupClusterViewer({
        photos,
        index: idx >= 0 ? idx : 0,
        batchId,
        groups: [...duplicateGroups],
      });
    },
    [activeAssets, batchId, duplicateGroups],
  );

  const handleDupClusterCandidateReviewed = useCallback(
    (updated: ImportBatchDuplicateCandidateItem) => {
      if (!batchId) return;
      setDupClusterViewer((v) => {
        if (!v) return v;
        const parentSourceId = v.groups.find((g) =>
          g.candidates.some((c) => c.id === updated.id),
        )?.source_asset_id;
        if (parentSourceId) {
          useImportSessionStore.getState().applyDuplicateCandidateDecision(
            batchId,
            parentSourceId,
            updated,
          );
        }
        const nextGroups = v.groups.map((g) => {
          if (!g.candidates.some((c) => c.id === updated.id)) return g;
          const nextCandidates = g.candidates.map((c) =>
            c.id === updated.id ? { ...c, ...updated } : c,
          );
          const allReviewed = nextCandidates.every((c) => c.review_decision != null);
          return {
            ...g,
            candidates: nextCandidates,
            duplicate_review_status: allReviewed ? 'reviewed' : g.duplicate_review_status,
          };
        });
        return { ...v, groups: nextGroups };
      });
    },
    [batchId],
  );

  const handleFaceClusterUpdated = useCallback(
    (updated: IdentityAssignmentResponse) => {
      if (!batchId) return;
      updateFaceClusterAssignment(batchId, updated.identity_id, {
        person_id: updated.person_id,
        person_name: updated.person_name,
        review_required_count: updated.review_required_count,
      });
      void fetchBatchReviewAssetsTotal(batchId);
    },
    [batchId, fetchBatchReviewAssetsTotal, updateFaceClusterAssignment],
  );

  const handleClustersRefresh = useCallback(async () => {
    if (!batchId) return;
    await Promise.all([
      fetchBatchFaceClusters(batchId),
      fetchBatchReviewAssetsTotal(batchId),
    ]);
  }, [batchId, fetchBatchFaceClusters, fetchBatchReviewAssetsTotal]);

  const handleOpenAsset = useCallback(
    (asset: AssetListItem) => {
      const index = viewerPhotos.findIndex((item) => item.asset_id === asset.asset_id);
      if (index < 0) return;
      setAssetViewer({ photos: viewerPhotos, index });
    },
    [viewerPhotos],
  );

  const handleAssetViewerClose = useCallback(() => {
    setAssetViewer(null);
    if (batchId) {
      void fetchBatchReviewAssetsTotal(batchId);
    }
  }, [batchId, fetchBatchReviewAssetsTotal]);

  const handleApplyBatchTags = useCallback(
    async (tags: string[]) => {
      if (!batchId) return 0;
      return applyTagsToBatch(batchId, tags);
    },
    [applyTagsToBatch, batchId],
  );

  return (
    <>
      <ImportsSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        batches={batches}
        isLoading={isListLoading}
        error={listError}
        onCreate={handleCreate}
        isCreating={isCreating}
      />

      <div
        className={[
          styles.main,
          sidebarOpen ? styles['with-sidebar-open'] : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.page}>
          {!isDesktop && (
            <button
              type="button"
              className={styles['menu-btn']}
              onClick={() => setSidebarOpen(true)}
              aria-label="Открыть список партий"
            >
              <Menu size={18} />
              <span>Партии</span>
            </button>
          )}

          {!batchId && (
            <EmptyState
              onCreate={handleCreate}
              isCreating={isCreating}
              hasBatches={batches.length > 0}
            />
          )}

          {batchId && !activeBatch && !isAssetsLoading && (
            <div className={pageLayout.alert}>
              Партия не найдена. Возможно, она была удалена.
            </div>
          )}

          {batchId && activeBatch && (
            <>
              <div className={styles.importLayout}>
                <section className={styles.gridPane} aria-label="Фото в партии">
                  <div className={styles.gridPaneHead}>
                    <div>
                      <h2 className={styles.gridTitle}>Фотографии</h2>
                      <p className={styles.gridSubtitle}>
                        {activeAssets.length} в текущей партии
                      </p>
                    </div>
                  </div>
                  <BatchAssetsGrid
                    className={styles.assetsGrid}
                    assets={activeAssets}
                    onSelect={handleOpenAsset}
                    outsideClusterAssetIds={outsideClusterAssetIds}
                    onRetryFaces={canRetryAssetMl ? handleRetryAssetFaces : undefined}
                    retryingAssetId={retryingAssetId}
                  />
                </section>

                <aside className={styles.infoPanel}>
                  <section
                    className={pageLayout['page-intro-narrow']}
                    aria-labelledby="import-batch-title"
                  >
                    <div className={styles['intro-row']}>
                      <div className={styles['intro-text']}>
                        <h1 id="import-batch-title" className={pageLayout.title}>
                          {formatBatchTitle(activeBatch.created_at)}
                        </h1>
                        <p className={pageLayout['subtitle-relaxed']}>
                          Статус: {STATUS_LABEL[activeBatch.status] ?? activeBatch.status}
                          {activeBatch.assets_count > 0 && (
                            <> · {activeBatch.assets_count} фото</>
                          )}
                        </p>
                      </div>

                      {activeBatch.status === 'uploading' && (
                        <button
                          type="button"
                          className={styles['close-btn']}
                          onClick={handleClose}
                          disabled={!canClose || isClosing}
                          title={
                            canClose
                              ? 'Отправить партию на обработку'
                              : hasQueuedPreview
                                ? 'Дождитесь завершения загрузки'
                                : 'Добавьте хотя бы один файл'
                          }
                        >
                          <CheckCircle2 size={16} />
                          <span>
                            {isClosing ? 'Закрываем…' : 'Закрыть партию'}
                          </span>
                        </button>
                      )}

                      {activeBatch.status === 'pending_review' && (
                        <button
                          type="button"
                          className={styles['accept-btn']}
                          onClick={handleAcceptReview}
                          disabled={!canAcceptReview || isAccepting}
                          title={acceptReviewHint}
                        >
                          <CheckCircle2 size={16} />
                          <span>
                            {isAccepting ? 'Завершаем…' : 'Завершить проверку'}
                          </span>
                        </button>
                      )}
                    </div>
                  </section>

                  {activeBatch.status === 'uploading' && (
                    <DropZone onFiles={handleFiles} />
                  )}

                  {activeBatch.status === 'processing' && (
                    <div className={styles.banner}>
                      Идёт ML-обработка фото. Это может занять несколько минут.
                    </div>
                  )}

                  {activeBatch.status === 'pending_review' && (
                    <div className={styles.banner}>
                      Обработка завершена. Проверьте дубликаты и лица, затем
                      завершите проверку.
                    </div>
                  )}

                  {activeBatch.status === 'accepted' && (
                    <div className={`${styles.banner} ${styles['banner-success']}`}>
                      Партия принята. Импорт завершён.
                    </div>
                  )}

                  {(activeBatch.status === 'rejected' ||
                    activeBatch.status === 'cancelled') && (
                    <div className={`${styles.banner} ${styles['banner-muted']}`}>
                      Партия {STATUS_LABEL[activeBatch.status]?.toLowerCase()}.
                    </div>
                  )}

                  {showMlErrorsBanner && (
                    <div
                      className={`${styles.banner} ${styles['banner-warning']}`}
                      role="status"
                    >
                      <p className={styles['ml-error-text']}>
                        ML-ошибки: <strong>{mlFailedCount}</strong> фото не
                        обработаны. Наведите на значок ошибки, чтобы увидеть
                        причину, или нажмите кнопку повтора на плитке фото.
                      </p>
                      {canRetryMl && (
                        <button
                          type="button"
                          className={styles['retry-ml-btn']}
                          onClick={handleRetryMl}
                          disabled={isRetryingMl}
                        >
                          <RefreshCw size={16} aria-hidden />
                          <span>
                            {isRetryingMl ? 'Повторяем…' : 'Повторить ML'}
                          </span>
                        </button>
                      )}
                    </div>
                  )}

                  <section
                    className={styles.reviewSection}
                    aria-labelledby="import-batch-tags-title"
                  >
                    <div className={styles.reviewSectionHead}>
                      <h2
                        id="import-batch-tags-title"
                        className={styles.reviewSectionTitle}
                      >
                        Теги партии
                      </h2>
                    </div>
                    <div className={styles.reviewSectionBody}>
                      <p className={styles.reviewLead}>
                        Добавьте общие теги ко всем активным фото этой партии.
                      </p>
                      <ImportBatchTagsSection
                        suggestions={tagSuggestions}
                        isLoading={tagSuggestionsLoading}
                        isFetchFailed={tagSuggestionsFetchFailed}
                        applyError={tagApplyError}
                        onApply={handleApplyBatchTags}
                      />
                    </div>
                  </section>

                  <section
                    className={styles.reviewSection}
                    aria-labelledby="import-dup-summary-title"
                  >
                    <div className={styles.reviewSectionHead}>
                      <button
                        type="button"
                        className={styles.sectionToggle}
                        onClick={() => setDuplicatesCollapsed((v) => !v)}
                        aria-expanded={!duplicatesCollapsed}
                        aria-controls="import-dup-section-body"
                      >
                        {duplicatesCollapsed ? (
                          <ChevronRight size={18} aria-hidden />
                        ) : (
                          <ChevronDown size={18} aria-hidden />
                        )}
                        <h2
                          id="import-dup-summary-title"
                          className={styles.reviewSectionTitle}
                        >
                          Дубликаты в партии
                        </h2>
                      </button>
                      <button
                        type="button"
                        className={styles.reviewHelpBtn}
                        title={DUPLICATE_SECTION_HELP_TOOLTIP}
                        aria-label="Подробнее: как считаются дубликаты и как вынести вердикт"
                      >
                        <CircleAlert size={18} strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                    {!duplicatesCollapsed ? (
                      <div className={styles.reviewSectionBody} id="import-dup-section-body">
                        {!duplicatesLoaded ? (
                          <p className={styles.reviewMuted}>
                            Подсчёт потенциальных дубликатов…
                          </p>
                        ) : duplicateDupFetchFailed ? (
                          <p className={styles.reviewError}>
                            Не удалось загрузить данные о дубликатах. Попробуйте
                            обновить страницу.
                          </p>
                        ) : (
                          <>
                            <p className={styles.reviewLead}>
                              Проверено дубликатов:{' '}
                              <strong>{duplicateReviewedCount}</strong>
                              {duplicateCandidatesTotal > 0 ? (
                                <>
                                  {' '}
                                  из <strong>{duplicateCandidatesTotal}</strong>
                                </>
                              ) : null}
                            </p>
                            <DuplicateSourcesSection
                              groups={duplicateGroups}
                              onOpenDuplicateCluster={handleOpenDuplicateCluster}
                            />
                            {duplicateGroups.length === 0 ? (
                              <p className={styles.reviewMuted}>
                                Пока нет групп «источник — кандидаты»: сканирование могло не
                                найти совпадений или обработка превью ещё не завершилась.
                              </p>
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </section>

                  <section
                    className={styles.reviewSection}
                    aria-labelledby="import-face-clusters-title"
                  >
                    <div className={styles.reviewSectionHead}>
                      <button
                        type="button"
                        className={styles.sectionToggle}
                        onClick={() => setFaceClustersCollapsed((v) => !v)}
                        aria-expanded={!faceClustersCollapsed}
                        aria-controls="import-face-clusters-body"
                      >
                        {faceClustersCollapsed ? (
                          <ChevronRight size={18} aria-hidden />
                        ) : (
                          <ChevronDown size={18} aria-hidden />
                        )}
                        <h2
                          id="import-face-clusters-title"
                          className={styles.reviewSectionTitle}
                        >
                          Кластеры лиц
                        </h2>
                      </button>
                    </div>
                    {!faceClustersCollapsed ? (
                      <div className={styles.reviewSectionBody} id="import-face-clusters-body">
                        {!faceClustersLoaded ? (
                          <p className={styles.reviewMuted}>
                            Подсчёт найденных кластеров лиц…
                          </p>
                        ) : faceClustersFetchFailed ? (
                          <p className={styles.reviewError}>
                            Не удалось загрузить кластеры лиц. Попробуйте обновить страницу.
                          </p>
                        ) : (
                          <>
                            <p className={styles.reviewLead}>
                              Проверено кластеров:{' '}
                              <strong>{faceClustersReviewed}</strong>
                              {faceClustersTotal > 0 ? (
                                <>
                                  {' '}
                                  из <strong>{faceClustersTotal}</strong>
                                </>
                              ) : null}
                            </p>
                            {reviewAssetsTotal > 0 ? (
                              <p className={styles.reviewWarning} role="status">
                                <strong>{reviewAssetsTotal}</strong> фото с лицами без
                                назначенной персоны
                                {outsideClusterAssetIds.size > 0 ? (
                                  <>
                                    {' '}
                                    (в сетке слева отмечены{' '}
                                    <strong>{outsideClusterAssetIds.size}</strong> с лицами
                                    вне кластера — нажмите, чтобы открыть просмотр)
                                  </>
                                ) : (
                                  '. Назначьте персону в просмотре фото'
                                )}
                                .
                              </p>
                            ) : null}
                            {batchId ? (
                              <FaceIdentityClustersSection
                                batchId={batchId}
                                clusters={faceClusters}
                                onClusterUpdated={handleFaceClusterUpdated}
                                onClustersRefresh={handleClustersRefresh}
                              />
                            ) : null}
                          </>
                        )}
                      </div>
                    ) : null}
                  </section>
                </aside>
              </div>
            </>
          )}
        </div>
      </div>

      <UploadProgressDrawer batchId={batchId ?? null} />

      <Modal
        dark
        variant="fullscreen"
        isOpen={dupClusterViewer !== null}
        onClose={() => setDupClusterViewer(null)}
      >
        {dupClusterViewer ? (
          <PhotoViewer
            importDuplicateSourcesReview={{
              batchId: dupClusterViewer.batchId,
              groups: dupClusterViewer.groups,
              onCandidateReviewed: handleDupClusterCandidateReviewed,
            }}
            photos={dupClusterViewer.photos}
            currentIndex={dupClusterViewer.index}
            onClose={() => setDupClusterViewer(null)}
            onPrevious={() =>
              setDupClusterViewer((v) =>
                v && v.index > 0 ? { ...v, index: v.index - 1 } : v,
              )
            }
            onNext={() =>
              setDupClusterViewer((v) =>
                v && v.index < v.photos.length - 1
                  ? { ...v, index: v.index + 1 }
                  : v,
              )
            }
            onSelect={(index) =>
              setDupClusterViewer((v) => (v ? { ...v, index } : v))
            }
          />
        ) : null}
      </Modal>

      <Modal
        dark
        variant="fullscreen"
        isOpen={assetViewer !== null}
        onClose={handleAssetViewerClose}
      >
        {assetViewer ? (
          <PhotoViewer
            photos={assetViewer.photos}
            currentIndex={assetViewer.index}
            onClose={handleAssetViewerClose}
            onPrevious={() =>
              setAssetViewer((v) =>
                v && v.index > 0 ? { ...v, index: v.index - 1 } : v,
              )
            }
            onNext={() =>
              setAssetViewer((v) =>
                v && v.index < v.photos.length - 1
                  ? { ...v, index: v.index + 1 }
                  : v,
              )
            }
            onSelect={(index) =>
              setAssetViewer((v) => (v ? { ...v, index } : v))
            }
          />
        ) : null}
      </Modal>
    </>
  );
}

interface EmptyStateProps {
  onCreate: () => void;
  isCreating: boolean;
  hasBatches: boolean;
}

function EmptyState({ onCreate, isCreating, hasBatches }: EmptyStateProps) {
  return (
    <section
      className={`${pageLayout['page-intro-narrow']} ${styles.empty}`}
      aria-labelledby="import-empty-title"
    >
      <h1 id="import-empty-title" className={pageLayout.title}>
        Импорт
      </h1>
      <p className={pageLayout['subtitle-relaxed']}>
        {hasBatches
          ? 'Выберите партию слева или создайте новую.'
          : 'У вас пока нет ни одной партии импорта.'}
      </p>
      <button
        type="button"
        className={styles['create-cta']}
        onClick={onCreate}
        disabled={isCreating}
      >
        {isCreating ? 'Создаётся…' : '+ Новая партия'}
      </button>
    </section>
  );
}
