import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './HomePage.module.css';
import { useAssetsFeedStore } from '../../stores/useAssetsFeedStore';
import type { AssetListItem } from '../../api/assets';
import Button from '../../components/ui/Button';
import { Upload } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import PhotoViewer from '../../components/ui/PhotoViewer';
import PersonsStrip from '../../components/ui/PersonsStrip';

function statusLabel(status: string) {
  if (status === 'importing') return 'Импорт...';
  if (status === 'error') return 'Ошибка';
  return status;
}

export default function HomePage() {
  const { items, isLoading, error, loadInitial, loadMore } = useAssetsFeedStore();
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
      <section className={styles['page-intro']} aria-labelledby="home-page-title">
        <div className={styles['page-intro-row']}>
          <div>
            <h1 id="home-page-title" className={styles.title}>
              Фото
            </h1>
            <p className={styles.subtitle}>Общая библиотека</p>
          </div>
          <Button color="primary" variant='filled' size='l' to='/import' icon={<Upload />} >
            Импорт
          </Button>
        </div>
      </section>

      <PersonsStrip />

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
                className={styles['tile-btn']}
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

      <Modal dark={true} variant='fullscreen' isOpen={!!selectedAsset} onClose={() => setSelectedAsset(null)}>
        <PhotoViewer
          onClose={() => setSelectedAsset(null)}
          photos={items}
          currentIndex={selectedAsset ? items.indexOf(selectedAsset) : 0}
          onPrevious={() => {
            const index = selectedAsset ? items.indexOf(selectedAsset) : 0;
            if (index > 0) {
              setSelectedAsset(items[index - 1]);
            }
          }}
          onNext={() => {
            const index = selectedAsset ? items.indexOf(selectedAsset) : 0;
            if (index < items.length - 1) {
              setSelectedAsset(items[index + 1]);
            }
          }}
          onSelect={(index) => setSelectedAsset(items[index])}
        />
      </Modal>
    </div>
  );
}
