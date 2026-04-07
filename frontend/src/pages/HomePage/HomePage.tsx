import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './HomePage.module.css';
import { useAssetsFeedStore } from '../../stores/useAssetsFeedStore';
import AssetPhotoModal from '../../components/AssetPhotoModal/AssetPhotoModal';
import type { AssetListItem } from '../../api/assets';
import Button from '../../components/ui/Button';
import { Upload } from 'lucide-react';

function statusLabel(status: string) {
  if (status === 'importing') return 'Импорт...';
  if (status === 'error') return 'Ошибка';
  return status;
}

export default function HomePage() {
  const { items, isLoading, error, nextCursor, loadInitial, loadMore } = useAssetsFeedStore();
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetListItem | null>(null);

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

  const hasItems = items.length > 0;
  const showInitialLoading = !hasItems && isLoading;

  const tiles = useMemo(() => items, [items]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Фото</h1>
            <p className={styles.subtitle}>Общая библиотека</p>
          </div>
          <Button color="primary" variant='filled' size='l' to='/import' icon={<Upload />} >
            Импорт
          </Button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

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
            const isReady = item.status === 'ready' && !!item.thumbnail_url;
            return (
              <button
                key={item.asset_id}
                type="button"
                className={styles.tileBtn}
                disabled={!isReady}
                onClick={() => setSelectedAsset(item)}
                aria-label={item.title ? `Открыть: ${item.title}` : 'Открыть фото'}
              >
                <div className={styles.tile}>
                  {isReady ? (
                    <img
                      className={styles.img}
                      src={item.thumbnail_url!}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className={styles.skeleton}>
                      <span className={styles.badge}>{statusLabel(item.status)}</span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <AssetPhotoModal
        assetId={selectedAsset?.asset_id ?? null}
        fallbackThumbnailUrl={selectedAsset?.thumbnail_url}
        fallbackTitle={selectedAsset?.title}
        onClose={() => setSelectedAsset(null)}
      />

      <div className={styles.footer}>
        {isLoading && hasItems && <div className={styles.more}>Загрузка…</div>}
        {!nextCursor && hasItems && <div className={styles.moreMuted}>Конец ленты</div>}
        <div ref={sentinelRef} className={styles.sentinel} />
      </div>
    </div>
  );
}
