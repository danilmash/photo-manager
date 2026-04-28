import { useEffect, useMemo, useRef, useState } from 'react';
import pageLayout from '../../styles/page-layout.module.css';
import styles from './HomePage.module.css';
import { useAssetsFeedStore } from '../../stores/useAssetsFeedStore';
import type { AssetListItem } from '../../api/assets';
import Button from '../../components/ui/Button';
import PhotoStateBadge, {
  resolvePhotoStateBadgeVariant,
} from '../../components/ui/PhotoStateBadge';
import { Upload } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import PhotoViewer from '../../components/ui/PhotoViewer';
import PersonsStrip from '../../components/ui/PersonsStrip';

/** Миниатюра уже есть после фазы preview; общий status может быть processing (ML). */
function canShowLibraryThumb(item: AssetListItem): boolean {
  const v = item.version;
  return v?.preview_status === 'completed' && !!v?.thumbnail_url;
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
    <div className={pageLayout.page}>
      <section className={pageLayout['page-intro']} aria-labelledby="home-page-title">
        <div className={pageLayout['page-intro-row']}>
          <div>
            <h1 id="home-page-title" className={pageLayout.title}>
              Фото
            </h1>
            <p className={pageLayout.subtitle}>Общая библиотека</p>
          </div>
          <Button color="primary" variant='filled' size='l' to='/import' icon={<Upload />} >
            Импорт
          </Button>
        </div>
      </section>

      <PersonsStrip />

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
                onClick={() => setSelectedAsset(item)}
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
