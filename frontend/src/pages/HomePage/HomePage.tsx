import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Menu, Trash2, Upload, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import pageLayout from '../../styles/page-layout.module.css';
import styles from './HomePage.module.css';
import { useAssetsFeedStore } from '../../stores/useAssetsFeedStore';
import { useFoldersStore } from '../../stores/useFoldersStore';
import { trashAsset, type AssetListItem } from '../../api/assets';
import type { FolderSummary } from '../../api/folders';
import Button from '../../components/ui/Button';
import PhotoStateBadge, {
  resolvePhotoStateBadgeVariant,
} from '../../components/ui/PhotoStateBadge';
import FacesErrorBadge from '../../components/ui/FacesErrorBadge';
import FaceOutsideClusterBadge from '../../components/ui/FaceOutsideClusterBadge';
import Modal from '../../components/ui/Modal';
import PhotoViewer from '../../components/ui/PhotoViewer';
import PersonsStrip from '../../components/ui/PersonsStrip';
import type { PersonListItem } from '../../api/persons';
import FoldersSidebar from '../../components/features/library/FoldersSidebar/FoldersSidebar';
import FolderNameModal from '../../components/features/library/FolderNameModal/FolderNameModal';
import ExportProgressDrawer from '../../components/features/library/ExportProgressDrawer';
import SemanticSearchExpand from '../../components/features/library/SemanticSearchExpand';
import LibraryFiltersBar from '../../components/features/library/LibraryFiltersBar';
import LibraryFiltersDrawer from '../../components/features/library/LibraryFiltersDrawer';
import { buildFilterSummaryChips } from '../../components/features/library/LibraryFiltersBar/LibraryFiltersForm';
import { useExportStore } from '../../stores/useExportStore';
import { useGallerySelection } from '../../hooks/useGallerySelection';
import {
  INLINE_LIBRARY_FILTERS_MEDIA_QUERY,
  MOBILE_MEDIA_QUERY,
  VERY_WIDE_VIEWPORT_MEDIA_QUERY,
  useMediaQuery,
} from '../../hooks/useMediaQuery';

/** Миниатюра уже есть после фазы preview; общий status может быть processing (ML). */
function canShowLibraryThumb(item: AssetListItem): boolean {
  const v = item.version;
  return v?.preview_status === 'completed' && !!v?.thumbnail_url;
}

type FolderModalMode =
  | { type: 'create' }
  | { type: 'rename'; folder: FolderSummary };

export default function HomePage() {
  const { folderId: routeFolderId } = useParams<{ folderId?: string }>();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(MOBILE_MEDIA_QUERY);
  const hasInlineFiltersViewport = useMediaQuery(INLINE_LIBRARY_FILTERS_MEDIA_QUERY);
  const isVeryWideViewport = useMediaQuery(VERY_WIDE_VIEWPORT_MEDIA_QUERY);

  const {
    items,
    isLoading,
    error,
    searchQuery,
    folderId,
    filters,
    filtersActive,
    personId,
    personName,
    personFilterActive,
    setFolderId,
    applyFilters,
    clearFilters,
    applyPersonFilter,
    clearPersonFilter,
    loadInitial,
    loadMore,
    search,
    clearSearch,
    removeItem,
  } = useAssetsFeedStore();

  const folders = useFoldersStore((s) => s.items);
  const foldersLoading = useFoldersStore((s) => s.isLoading);
  const foldersLoaded = useFoldersStore((s) => s.hasLoaded);
  const foldersError = useFoldersStore((s) => s.error);
  const fetchFolders = useFoldersStore((s) => s.fetchFolders);
  const createFolder = useFoldersStore((s) => s.createFolder);
  const renameFolder = useFoldersStore((s) => s.renameFolder);
  const removeFolder = useFoldersStore((s) => s.removeFolder);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [folderModal, setFolderModal] = useState<FolderModalMode | null>(null);
  const [folderModalError, setFolderModalError] = useState<string | null>(null);
  const [folderModalSubmitting, setFolderModalSubmitting] = useState(false);

  const useInlineFilters =
    hasInlineFiltersViewport && (!sidebarOpen || isVeryWideViewport);

  const startExport = useExportStore((s) => s.startExport);

  const activeFolder = useMemo(
    () => folders.find((folder) => folder.id === routeFolderId) ?? null,
    [folders, routeFolderId],
  );

  useEffect(() => {
    void fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    const targetFolderId = routeFolderId ?? null;
    if (folderId !== targetFolderId) {
      setFolderId(targetFolderId);
      return;
    }
    void loadInitial();
  }, [folderId, loadInitial, routeFolderId, setFolderId]);

  useEffect(() => {
    if (!routeFolderId || !foldersLoaded || foldersLoading || foldersError) return;
    if (folders.some((folder) => folder.id === routeFolderId)) return;
    navigate('/', { replace: true });
  }, [folders, foldersError, foldersLoaded, foldersLoading, navigate, routeFolderId]);

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMore();
        }
      },
      { root: null, rootMargin: '600px 0px', threshold: 0 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const handleFolderModalSubmit = useCallback(
    async (name: string) => {
      if (!folderModal) return;
      setFolderModalSubmitting(true);
      setFolderModalError(null);
      try {
        if (folderModal.type === 'create') {
          const folder = await createFolder(name);
          setFolderModal(null);
          navigate(`/folders/${folder.id}`);
        } else {
          await renameFolder(folderModal.folder.id, name);
          setFolderModal(null);
        }
      } catch (err) {
        setFolderModalError(err instanceof Error ? err.message : 'Не удалось сохранить папку');
      } finally {
        setFolderModalSubmitting(false);
      }
    },
    [createFolder, folderModal, navigate, renameFolder],
  );

  const handleDeleteFolder = useCallback(
    async (folder: FolderSummary) => {
      const confirmed = window.confirm(
        `Удалить папку «${folder.name}»? Фотографии останутся в библиотеке.`,
      );
      if (!confirmed) return;
      try {
        await removeFolder(folder.id);
        if (routeFolderId === folder.id) {
          navigate('/');
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Не удалось удалить папку');
      }
    },
    [navigate, removeFolder, routeFolderId],
  );

  const hasItems = items.length > 0;
  const showInitialLoading = !hasItems && isLoading;
  const tiles = useMemo(() => items, [items]);
  const selectedIndex = useMemo(() => {
    if (!selectedAssetId) return -1;
    return items.findIndex((item) => item.asset_id === selectedAssetId);
  }, [items, selectedAssetId]);

  const handleFoldersChanged = useCallback(async () => {
    await fetchFolders();
    if (!folderId || !selectedAssetId) return;
    await loadInitial();
    const stillInFeed = useAssetsFeedStore
      .getState()
      .items.some((item) => item.asset_id === selectedAssetId);
    if (!stillInFeed) {
      setSelectedAssetId(null);
    }
  }, [fetchFolders, folderId, loadInitial, selectedAssetId]);

  const handleTrashAsset = useCallback(
    async (assetId: string) => {
      await trashAsset(assetId);
      const index = items.findIndex((item) => item.asset_id === assetId);
      const nextItem = items[index + 1] ?? items[index - 1] ?? null;
      removeItem(assetId);
      setSelectedAssetId(nextItem?.asset_id ?? null);
    },
    [items, removeItem],
  );

  const selectableAssetIds = useMemo(
    () => tiles.filter((item) => canShowLibraryThumb(item)).map((item) => item.asset_id),
    [tiles],
  );

  const openAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
  }, []);

  const {
    selectionActive,
    selectedIds: selectedAssetIds,
    selectedCount,
    allLoadedSelected,
    isScrubbing,
    exitSelection,
    selectAllLoaded,
    clearSelection,
    getTileHandlers,
  } = useGallerySelection({
    selectableIds: selectableAssetIds,
    onOpenAsset: openAsset,
  });

  const viewerOpen = !selectionActive && selectedIndex >= 0;

  const handleTrashSelected = useCallback(async () => {
    const assetIds = Array.from(selectedAssetIds);
    if (assetIds.length === 0) return;

    const confirmed = window.confirm(
      `Переместить выбранные фото в корзину? Количество: ${assetIds.length}.`,
    );
    if (!confirmed) return;

    try {
      await Promise.all(assetIds.map((assetId) => trashAsset(assetId)));
      for (const assetId of assetIds) {
        removeItem(assetId);
      }
      clearSelection();
      exitSelection();
      setSelectedAssetId(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось переместить фото в корзину');
    }
  }, [clearSelection, exitSelection, removeItem, selectedAssetIds]);

  const handleExportSelected = useCallback(async () => {
    const assetIds = Array.from(selectedAssetIds);
    if (assetIds.length === 0) return;

    if (assetIds.length > 50) {
      const confirmed = window.confirm(
        `Экспорт ${assetIds.length} файлов может занять несколько минут. Продолжить?`,
      );
      if (!confirmed) return;
    }

    await startExport(assetIds);
    exitSelection();
  }, [exitSelection, selectedAssetIds, startExport]);

  const pageTitle = activeFolder ? activeFolder.name : 'Фото';
  const pageSubtitle = selectionActive
    ? 'Удерживайте и проведите по фото для выбора'
    : activeFolder
      ? 'Папка'
      : 'Общая библиотека';
  const filterSummaryChips = useMemo(
    () => buildFilterSummaryChips(filters, filtersActive),
    [filters, filtersActive],
  );

  const handlePersonSelect = useCallback(
    (person: PersonListItem) => {
      const name = person.name.trim() || 'Без имени';
      if (personFilterActive && personId === person.id) {
        void clearPersonFilter();
        return;
      }
      void applyPersonFilter(person.id, name);
    },
    [applyPersonFilter, clearPersonFilter, personFilterActive, personId],
  );

  return (
    <>
      <FoldersSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
        overlayOpen={viewerOpen}
        folders={folders}
        isLoading={foldersLoading}
        error={foldersError}
        onCreate={() => {
          setFolderModalError(null);
          setFolderModal({ type: 'create' });
        }}
        onRename={(folder) => {
          setFolderModalError(null);
          setFolderModal({ type: 'rename', folder });
        }}
        onDelete={(folder) => {
          void handleDeleteFolder(folder);
        }}
      />

      <div
        className={`${styles.main} ${sidebarOpen && !isMobile ? styles.mainWithSidebar : ''} ${selectionActive ? styles.mainSelecting : ''}`}
      >
        <div className={`${pageLayout.page} ${styles.page}`}>
          <section className={`${pageLayout['page-intro']} ${styles.introSection}`} aria-labelledby="home-page-title">
            <SemanticSearchExpand.Root
              activeQuery={searchQuery}
              isLoading={isLoading}
              isMobile={isMobile}
              onSearch={search}
              onClear={clearSearch}
            >
              <div className={pageLayout['page-intro-row']}>
                <div className={styles.introCopy}>
                  {isMobile ? (
                    <button
                      type="button"
                      className={styles.menuBtn}
                      onClick={() => setSidebarOpen(true)}
                      aria-label="Открыть папки"
                    >
                      <Menu size={22} />
                    </button>
                  ) : null}
                  <div>
                    <h1 id="home-page-title" className={pageLayout.title}>
                      {selectionActive ? `Выбрано: ${selectedCount}` : pageTitle}
                    </h1>
                    <p className={pageLayout.subtitle}>{pageSubtitle}</p>
                  </div>
                </div>
                <div className={styles.introActions}>
                  <SemanticSearchExpand.InlinePanel />
                  <SemanticSearchExpand.Trigger />
                  {!useInlineFilters && !searchQuery ? (
                    <LibraryFiltersDrawer
                      folderId={folderId}
                      filters={filters}
                      filtersActive={filtersActive}
                      isLoading={isLoading}
                      onApply={applyFilters}
                      onClear={clearFilters}
                    />
                  ) : null}
                  <Button color="primary" variant="filled" size="l" to="/import" icon={<Upload />}>
                    Импорт
                  </Button>
                </div>
              </div>
              <SemanticSearchExpand.BelowPanel />
            </SemanticSearchExpand.Root>
          </section>

          {searchQuery ? (
            <div className={styles['search-summary']}>
              Результаты умного поиска: <strong>{searchQuery}</strong>
              {activeFolder ? (
                <>
                  {' '}
                  в папке <strong>{activeFolder.name}</strong>
                </>
              ) : null}
              <button
                type="button"
                className={styles.searchSummaryClear}
                onClick={() => {
                  void clearSearch();
                }}
              >
                Сбросить
              </button>
            </div>
          ) : (
            <>
              {personFilterActive ? (
                <div className={styles['search-summary']}>
                  Фото с человеком: <strong>{personName ?? 'Без имени'}</strong>
                  <button
                    type="button"
                    className={styles.searchSummaryClear}
                    onClick={() => {
                      void clearPersonFilter();
                    }}
                  >
                    Сбросить человека
                  </button>
                </div>
              ) : null}
              {useInlineFilters ? (
                <LibraryFiltersBar
                  folderId={folderId}
                  filters={filters}
                  filtersActive={filtersActive}
                  isLoading={isLoading}
                  onApply={applyFilters}
                  onClear={clearFilters}
                />
              ) : null}
              {!useInlineFilters && filtersActive && filterSummaryChips.length > 0 ? (
                <div className={styles.filterSummary} aria-label="Активные фильтры">
                  {filterSummaryChips.map((chip) => (
                    <span key={chip} className={styles.filterSummaryChip}>
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {!activeFolder ? (
            <PersonsStrip
              selectedPersonId={personFilterActive ? personId : null}
              onPersonSelect={handlePersonSelect}
            />
          ) : null}

          {error && <div className={pageLayout.alert}>{error}</div>}

          {showInitialLoading && (
            <div className={styles.grid} aria-busy="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className={styles.tile}>
                  <div className={styles.skeleton} />
                </div>
              ))}
            </div>
          )}

          {hasItems && (
            <div
              className={`${styles.grid} ${selectionActive ? styles.gridSelecting : ''} ${isScrubbing ? styles.gridScrubbing : ''}`}
            >
              {tiles.map((item) => {
                const showThumb = canShowLibraryThumb(item);
                const canOpen = showThumb;
                const photoBadge = resolvePhotoStateBadgeVariant(item);
                const facesFailed = item.version?.faces_status === 'failed';
                const facesErrorMessage = item.version?.faces_error?.trim() || null;
                const outsideCluster = (item.unassigned_faces_count ?? 0) > 0;
                const isSelected = selectedAssetIds.has(item.asset_id);
                const tileHandlers = getTileHandlers(item.asset_id, canOpen);
                return (
                  <button
                    key={item.asset_id}
                    type="button"
                    data-asset-id={item.asset_id}
                    className={`${styles['tile-btn']} ${selectionActive ? styles['tile-btn-selectable'] : ''} ${isSelected ? styles['tile-btn-selected'] : ''}`}
                    disabled={!canOpen}
                    {...tileHandlers}
                    aria-label={
                      selectionActive
                        ? isSelected
                          ? 'Снять выбор'
                          : 'Выбрать фото'
                        : item.title
                          ? `Открыть: ${item.title}`
                          : 'Открыть фото'
                    }
                    aria-pressed={selectionActive ? isSelected : undefined}
                  >
                    <div
                      className={`${styles.tile} ${
                        outsideCluster ? styles['tile-outside-cluster'] : ''
                      }`}
                    >
                      {selectionActive ? (
                        <span
                          className={`${styles.selectionMark} ${isSelected ? styles.selectionMarkActive : ''}`}
                          aria-hidden="true"
                        />
                      ) : null}
                      {showThumb ? (
                        <>
                          <img
                            className={styles.img}
                            src={item.version!.thumbnail_url!}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                          />
                          {item.version?.status !== 'ready' && photoBadge && (
                            <PhotoStateBadge
                              variant={photoBadge}
                              className={styles['state-badge']}
                              size="sm"
                            />
                          )}
                          {facesFailed && (
                            <FacesErrorBadge
                              message={facesErrorMessage}
                              className={styles['faces-error-badge']}
                            />
                          )}
                          {outsideCluster && (
                            <FaceOutsideClusterBadge
                              className={styles['outside-cluster-badge']}
                            />
                          )}
                        </>
                      ) : (
                        <div className={styles.skeleton}>
                          {photoBadge && (
                            <PhotoStateBadge
                              variant={photoBadge}
                              className={styles['skeleton-badge']}
                              size="md"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!hasItems && !showInitialLoading && !error ? (
            <div className={styles.empty}>
              {searchQuery
                ? 'По запросу ничего не найдено.'
                : personFilterActive || filtersActive
                  ? 'По выбранным фильтрам ничего не найдено.'
                  : activeFolder
                    ? 'В этой папке пока нет фотографий. Добавьте их из просмотрщика в блоке «Папки».'
                    : 'Библиотека пуста. Импортируйте фотографии, чтобы начать.'}
            </div>
          ) : null}

          <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />

          <Modal
            dark
            variant="fullscreen"
            isOpen={viewerOpen}
            onClose={() => setSelectedAssetId(null)}
          >
            <PhotoViewer
              onClose={() => setSelectedAssetId(null)}
              photos={items}
              currentIndex={selectedIndex}
              onPrevious={() => {
                if (selectedIndex > 0) {
                  setSelectedAssetId(items[selectedIndex - 1].asset_id);
                }
              }}
              onNext={() => {
                if (selectedIndex >= 0 && selectedIndex < items.length - 1) {
                  setSelectedAssetId(items[selectedIndex + 1].asset_id);
                }
              }}
              onSelect={(index) => setSelectedAssetId(items[index]?.asset_id ?? null)}
              onFoldersChanged={() => {
                void handleFoldersChanged();
              }}
              onTrashAsset={handleTrashAsset}
            />
          </Modal>
        </div>
      </div>

      {selectionActive ? (
        <div className={styles.bulkBar} role="toolbar" aria-label="Действия с выбранными фото">
          <div className={styles.bulkBarInfo}>
            <strong>{selectedCount}</strong>
            <span>{selectedCount === 1 ? 'фото' : 'фото'}</span>
          </div>
          <div className={styles.bulkBarActions}>
            <button
              type="button"
              className={styles.bulkBarLink}
              onClick={allLoadedSelected ? clearSelection : selectAllLoaded}
              disabled={selectableAssetIds.length === 0}
            >
              {allLoadedSelected ? 'Снять выбор' : 'Выбрать все'}
            </button>
            <Button
              color="primary"
              variant="filled"
              size="m"
              icon={<Download />}
              disabled={selectedCount === 0}
              onClick={() => {
                void handleExportSelected();
              }}
            >
              Экспорт
            </Button>
            <Button
              color="secondary"
              variant="outline"
              size="m"
              icon={<Trash2 />}
              disabled={selectedCount === 0}
              onClick={() => {
                void handleTrashSelected();
              }}
            >
              В корзину
            </Button>
            <Button
              color="secondary"
              variant="outline"
              size="m"
              icon={<X />}
              onClick={exitSelection}
              aria-label="Отменить выбор"
            >
              Готово
            </Button>
          </div>
        </div>
      ) : null}

      <ExportProgressDrawer />

      <FolderNameModal
        isOpen={folderModal !== null}
        title={folderModal?.type === 'rename' ? 'Переименовать папку' : 'Новая папка'}
        initialName={folderModal?.type === 'rename' ? folderModal.folder.name : ''}
        confirmLabel={folderModal?.type === 'rename' ? 'Сохранить' : 'Создать'}
        isSubmitting={folderModalSubmitting}
        error={folderModalError}
        onClose={() => {
          if (folderModalSubmitting) return;
          setFolderModal(null);
          setFolderModalError(null);
        }}
        onSubmit={handleFolderModalSubmit}
      />
    </>
  );
}
