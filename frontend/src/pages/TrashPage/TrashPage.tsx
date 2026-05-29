import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import pageLayout from '../../styles/page-layout.module.css';
import styles from './TrashPage.module.css';
import {
  emptyTrash,
  permanentlyDeleteAsset,
  restoreAsset,
  type AssetListItem,
} from '../../api/assets';
import { useTrashFeedStore } from '../../stores/useTrashFeedStore';
import { useGallerySelection } from '../../hooks/useGallerySelection';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import PhotoViewer from '../../components/ui/PhotoViewer';

function canShowTrashThumb(item: AssetListItem): boolean {
  const v = item.version;
  return v?.preview_status === 'completed' && !!v?.thumbnail_url;
}

function formatTrashedAt(value?: string | null): string {
  if (!value) return 'В корзине';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'В корзине';
  return `Удалено ${date.toLocaleDateString('ru-RU')}`;
}

export default function TrashPage() {
  const { items, isLoading, error, loadInitial, loadMore, removeItem } =
    useTrashFeedStore();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

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

  const selectedIndex = useMemo(() => {
    if (!selectedAssetId) return -1;
    return items.findIndex((item) => item.asset_id === selectedAssetId);
  }, [items, selectedAssetId]);

  const selectNeighborAfterRemoval = useCallback(
    (assetId: string) => {
      const index = items.findIndex((item) => item.asset_id === assetId);
      const nextItem = items[index + 1] ?? items[index - 1] ?? null;
      removeItem(assetId);
      setSelectedAssetId(nextItem?.asset_id ?? null);
    },
    [items, removeItem],
  );

  const handleRestoreAsset = useCallback(
    async (assetId: string) => {
      await restoreAsset(assetId);
      selectNeighborAfterRemoval(assetId);
    },
    [selectNeighborAfterRemoval],
  );

  const handlePermanentlyDeleteAsset = useCallback(
    async (assetId: string) => {
      await permanentlyDeleteAsset(assetId);
      selectNeighborAfterRemoval(assetId);
    },
    [selectNeighborAfterRemoval],
  );

  const selectableAssetIds = useMemo(
    () => items.filter((item) => canShowTrashThumb(item)).map((item) => item.asset_id),
    [items],
  );

  const openAsset = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
  }, []);

  const {
    selectionActive,
    selectedIds,
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

  const handleRestoreSelected = useCallback(async () => {
    const assetIds = Array.from(selectedIds);
    if (assetIds.length === 0) return;

    const confirmed = window.confirm(
      `Восстановить выбранные фото? Количество: ${assetIds.length}.`,
    );
    if (!confirmed) return;

    try {
      await Promise.all(assetIds.map((assetId) => restoreAsset(assetId)));
      for (const assetId of assetIds) {
        removeItem(assetId);
      }
      clearSelection();
      exitSelection();
      setSelectedAssetId(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось восстановить фото');
    }
  }, [clearSelection, exitSelection, removeItem, selectedIds]);

  const handlePermanentlyDeleteSelected = useCallback(async () => {
    const assetIds = Array.from(selectedIds);
    if (assetIds.length === 0) return;

    const confirmed = window.confirm(
      `Удалить выбранные фото окончательно? Количество: ${assetIds.length}. Это действие нельзя отменить.`,
    );
    if (!confirmed) return;

    try {
      await Promise.all(assetIds.map((assetId) => permanentlyDeleteAsset(assetId)));
      for (const assetId of assetIds) {
        removeItem(assetId);
      }
      clearSelection();
      exitSelection();
      setSelectedAssetId(null);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось удалить фото');
    }
  }, [clearSelection, exitSelection, removeItem, selectedIds]);

  const hasItems = items.length > 0;
  const showInitialLoading = !hasItems && isLoading;

  const handleEmptyTrash = useCallback(async () => {
    if (!hasItems) return;
    const confirmed = window.confirm(
      'Очистить корзину? Все фото в корзине будут удалены окончательно.',
    );
    if (!confirmed) return;

    try {
      await emptyTrash();
      clearSelection();
      exitSelection();
      setSelectedAssetId(null);
      await loadInitial();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Не удалось очистить корзину');
    }
  }, [clearSelection, exitSelection, hasItems, loadInitial]);

  return (
    <div className={`${pageLayout.page} ${styles.page} ${selectionActive ? styles.pageSelecting : ''}`}>
      <section className={pageLayout['page-intro']} aria-labelledby="trash-page-title">
        <div className={pageLayout['page-intro-row']}>
          <div>
            <h1 id="trash-page-title" className={pageLayout.title}>
              {selectionActive ? `Выбрано: ${selectedCount}` : 'Корзина'}
            </h1>
            <p className={pageLayout.subtitle}>
              {selectionActive
                ? 'Удерживайте и проведите по фото для выбора'
                : 'Здесь находятся фото, удаленные из библиотеки.'}
            </p>
          </div>
          <div className={styles.introActions}>
            <Button
              color="secondary"
              variant="outline"
              size="m"
              icon={<Trash2 />}
              onClick={() => {
                void handleEmptyTrash();
              }}
              disabled={!hasItems || isLoading}
            >
              Очистить корзину
            </Button>
            <Button
              color="secondary"
              variant="outline"
              size="m"
              icon={<RotateCcw />}
              onClick={() => {
                void loadInitial();
              }}
              disabled={isLoading}
            >
              Обновить
            </Button>
          </div>
        </div>
      </section>

      {error && <div className={pageLayout.alert}>{error}</div>}

      {showInitialLoading ? (
        <div className={styles.grid} aria-busy="true">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={styles.tile}>
              <div className={styles.skeleton} />
            </div>
          ))}
        </div>
      ) : null}

      {hasItems ? (
        <div
          className={`${styles.grid} ${selectionActive ? styles.gridSelecting : ''} ${isScrubbing ? styles.gridScrubbing : ''}`}
        >
          {items.map((item) => {
            const showThumb = canShowTrashThumb(item);
            const isSelected = selectedIds.has(item.asset_id);
            const tileHandlers = getTileHandlers(item.asset_id, showThumb);
            return (
              <button
                key={item.asset_id}
                type="button"
                data-asset-id={item.asset_id}
                className={styles.tileBtn}
                disabled={!showThumb}
                {...tileHandlers}
                aria-label={item.title ? `Открыть: ${item.title}` : 'Открыть фото'}
                aria-pressed={selectionActive ? isSelected : undefined}
              >
                <div className={`${styles.tile} ${isSelected ? styles.tileSelected : ''}`}>
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
                      <span className={styles.trashedBadge}>
                        {formatTrashedAt(item.trashed_at)}
                      </span>
                    </>
                  ) : (
                    <div className={styles.skeleton} />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {!hasItems && !showInitialLoading && !error ? (
        <div className={styles.empty}>Корзина пуста.</div>
      ) : null}

      <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />

      <Modal
        dark
        variant="fullscreen"
        isOpen={selectedIndex >= 0}
        onClose={() => setSelectedAssetId(null)}
      >
        <PhotoViewer
          lifecycleMode="trashed"
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
          onRestoreAsset={handleRestoreAsset}
          onPermanentlyDeleteAsset={handlePermanentlyDeleteAsset}
        />
      </Modal>

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
              icon={<RotateCcw />}
              disabled={selectedCount === 0}
              onClick={() => {
                void handleRestoreSelected();
              }}
            >
              Восстановить
            </Button>
            <Button
              color="secondary"
              variant="outline"
              size="m"
              icon={<Trash2 />}
              disabled={selectedCount === 0}
              onClick={() => {
                void handlePermanentlyDeleteSelected();
              }}
            >
              Удалить
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
    </div>
  );
}
