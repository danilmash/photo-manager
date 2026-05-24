import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Upload } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import pageLayout from '../../styles/page-layout.module.css';
import styles from './HomePage.module.css';
import { useAssetsFeedStore } from '../../stores/useAssetsFeedStore';
import { useFoldersStore } from '../../stores/useFoldersStore';
import type { AssetListItem } from '../../api/assets';
import type { FolderSummary } from '../../api/folders';
import Button from '../../components/ui/Button';
import PhotoStateBadge, {
  resolvePhotoStateBadgeVariant,
} from '../../components/ui/PhotoStateBadge';
import Modal from '../../components/ui/Modal';
import PhotoViewer from '../../components/ui/PhotoViewer';
import PersonsStrip from '../../components/ui/PersonsStrip';
import SemanticSearchInput from '../../components/ui/SemanticSearchInput';
import FoldersSidebar from '../../components/features/library/FoldersSidebar/FoldersSidebar';
import FolderNameModal from '../../components/features/library/FolderNameModal/FolderNameModal';
import { MOBILE_MEDIA_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';

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

  const {
    items,
    isLoading,
    error,
    searchQuery,
    folderId,
    setFolderId,
    loadInitial,
    loadMore,
    search,
    clearSearch,
  } = useAssetsFeedStore();

  const folders = useFoldersStore((s) => s.items);
  const foldersLoading = useFoldersStore((s) => s.isLoading);
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

  const activeFolder = useMemo(
    () => folders.find((folder) => folder.id === routeFolderId) ?? null,
    [folders, routeFolderId],
  );

  useEffect(() => {
    void fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    setFolderId(routeFolderId ?? null);
  }, [routeFolderId, setFolderId]);

  useEffect(() => {
    void loadInitial();
  }, [folderId, loadInitial]);

  useEffect(() => {
    if (!routeFolderId) return;
    if (foldersLoading) return;
    if (folders.some((folder) => folder.id === routeFolderId)) return;
    navigate('/', { replace: true });
  }, [folders, foldersLoading, navigate, routeFolderId]);

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
  const pageTitle = activeFolder ? activeFolder.name : 'Фото';
  const pageSubtitle = activeFolder ? 'Папка' : 'Общая библиотека';

  return (
    <>
      <FoldersSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
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
        className={`${styles.main} ${sidebarOpen && !isMobile ? styles.mainWithSidebar : ''}`}
      >
        <div className={`${pageLayout.page} ${styles.page}`}>
          <section className={pageLayout['page-intro']} aria-labelledby="home-page-title">
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
                    {pageTitle}
                  </h1>
                  <p className={pageLayout.subtitle}>{pageSubtitle}</p>
                </div>
              </div>
              <Button color="primary" variant="filled" size="l" to="/import" icon={<Upload />}>
                Импорт
              </Button>
            </div>
          </section>

          <section className={pageLayout.section}>
            <SemanticSearchInput
              className={styles.search}
              activeQuery={searchQuery}
              isLoading={isLoading}
              onSearch={search}
              onClear={clearSearch}
            />

            {searchQuery ? (
              <div className={styles['search-summary']}>
                Результаты умного поиска: <strong>{searchQuery}</strong>
                {activeFolder ? (
                  <>
                    {' '}
                    в папке <strong>{activeFolder.name}</strong>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>

          {!activeFolder ? <PersonsStrip /> : null}

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
            <div className={styles.grid}>
              {tiles.map((item) => {
                const showThumb = canShowLibraryThumb(item);
                const canOpen = showThumb;
                const photoBadge = resolvePhotoStateBadgeVariant(item);
                return (
                  <button
                    key={item.asset_id}
                    type="button"
                    className={styles['tile-btn']}
                    disabled={!canOpen}
                    onClick={() => setSelectedAssetId(item.asset_id)}
                    aria-label={item.title ? `Открыть: ${item.title}` : 'Открыть фото'}
                  >
                    <div className={styles.tile}>
                      {showThumb ? (
                        <>
                          <img
                            className={styles.img}
                            src={item.version!.thumbnail_url!}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                          {item.version?.status !== 'ready' && photoBadge && (
                            <PhotoStateBadge
                              variant={photoBadge}
                              className={styles['state-badge']}
                              size="sm"
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
                : activeFolder
                  ? 'В этой папке пока нет фотографий. Добавьте их из просмотрщика в блоке «Папки».'
                  : 'Библиотека пуста. Импортируйте фотографии, чтобы начать.'}
            </div>
          ) : null}

          <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />

          <Modal
            dark
            variant="fullscreen"
            isOpen={selectedIndex >= 0}
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
            />
          </Modal>
        </div>
      </div>

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
