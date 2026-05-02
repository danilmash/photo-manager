import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Menu } from 'lucide-react';

import type { AssetListItem } from '../../api/assets';
import BatchAssetsGrid from '../../components/features/imports/BatchAssetsGrid';
import DuplicateSourcesSection, {
  duplicateSourcesToCarouselPhotos,
} from '../../components/features/imports/DuplicateSourcesSection';
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

import styles from './ImportPage.module.css';

const DESKTOP_MEDIA_QUERY = '(min-width: 769px)';

const EMPTY_DUP_GROUPS: ImportBatchDuplicateGroup[] = [];

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
  const refreshBatch = useImportSessionStore((s) => s.refreshBatch);
  const fetchBatchAssets = useImportSessionStore((s) => s.fetchBatchAssets);
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

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [isClosing, setIsClosing] = useState<boolean>(false);
  const [dupClusterViewer, setDupClusterViewer] = useState<{
    photos: AssetListItem[];
    index: number;
    batchId: string;
    groups: ImportBatchDuplicateGroup[];
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
    startBatchPolling(batchId);
    return () => {
      stopBatchPolling();
    };
  }, [batchId, fetchBatchAssets, refreshBatch, startBatchPolling, stopBatchPolling]);

  const activeBatch = useMemo(
    () => (batchId ? batches.find((b) => b.id === batchId) ?? null : null),
    [batches, batchId],
  );

  const activeAssets = useMemo(
    () => (batchId ? assetsByBatch[batchId] ?? [] : []),
    [assetsByBatch, batchId],
  );
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
        <div className={pageLayout['page-narrow']}>
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
                  Обработка завершена. Партия готова к ревью.
                </div>
              )}

              {(activeBatch.status === 'rejected' ||
                activeBatch.status === 'cancelled') && (
                <div className={`${styles.banner} ${styles['banner-muted']}`}>
                  Партия {STATUS_LABEL[activeBatch.status]?.toLowerCase()}.
                </div>
              )}

              <section
                className={styles.duplicateSection}
                aria-labelledby="import-dup-summary-title"
              >
                <div className={styles.duplicateSectionHead}>
                  <h2
                    id="import-dup-summary-title"
                    className={styles.duplicateSectionTitle}
                  >
                    Дубликаты в партии
                  </h2>
                  <button
                    type="button"
                    className={styles.duplicateHelpBtn}
                    title={DUPLICATE_SECTION_HELP_TOOLTIP}
                    aria-label="Подробнее: как считаются дубликаты и как вынести вердикт"
                  >
                    <CircleAlert size={18} strokeWidth={2} aria-hidden />
                  </button>
                </div>
                {!duplicatesLoaded ? (
                  <p className={styles.duplicateMuted}>
                    Подсчёт потенциальных дубликатов…
                  </p>
                ) : duplicateDupFetchFailed ? (
                  <p className={styles.duplicateError}>
                    Не удалось загрузить данные о дубликатах. Попробуйте
                    обновить страницу.
                  </p>
                ) : (
                  <>
                    <p className={styles.duplicateLead}>
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
                      <p className={styles.duplicateMuted}>
                        Пока нет групп «источник — кандидаты»: сканирование могло не
                        найти совпадений или обработка превью ещё не завершилась.
                      </p>
                    ) : null}
                  </>
                )}
              </section>

              <BatchAssetsGrid className={styles.assetsGrid} assets={activeAssets} />
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
