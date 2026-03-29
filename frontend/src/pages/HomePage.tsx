import { useEffect, useMemo, useRef } from 'react';
import styles from './HomePage.module.css';
import { useAssetsFeedStore } from '../stores/useAssetsFeedStore';
import ImportNavButton from '../components/ImportNavButton/ImportNavButton';

function statusLabel(status: string) {
  if (status === 'importing') return 'Импорт...';
  if (status === 'error') return 'Ошибка';
  return status;
}

export default function HomePage() {
  const { items, isLoading, error, nextCursor, loadInitial, loadMore } = useAssetsFeedStore();
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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
          <ImportNavButton />
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
              <div key={item.asset_id} className={styles.tile}>
                {isReady ? (
                  <img
                    className={styles.img}
                    src={item.thumbnail_url!}
                    alt={item.title ?? 'Фото'}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className={styles.skeleton}>
                    <span className={styles.badge}>{statusLabel(item.status)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={styles.footer}>
        {isLoading && hasItems && <div className={styles.more}>Загрузка…</div>}
        {!nextCursor && hasItems && <div className={styles.moreMuted}>Конец ленты</div>}
        <div ref={sentinelRef} className={styles.sentinel} />
      </div>
    </div>
  );
}
