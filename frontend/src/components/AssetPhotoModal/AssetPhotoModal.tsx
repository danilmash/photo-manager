import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil } from 'lucide-react';
import Button from '../ui/Button';
import { getAsset, type AssetDetail } from '../../api/assets';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import styles from './AssetPhotoModal.module.css';

const META_SECTIONS = ['exif', 'iptc', 'xmp', 'other'] as const;
const META_LABELS: Record<(typeof META_SECTIONS)[number], string> = {
  exif: 'EXIF',
  iptc: 'IPTC',
  xmp: 'XMP',
  other: 'Прочее',
};

function formatMetaValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'object') {
    return (
      <pre className={styles.pre}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return String(value);
}

function hasSectionContent(data: unknown): data is Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    Object.keys(data as object).length > 0
  );
}

function MetadataSections({
  exif,
  iptc,
  xmp,
  other,
}: {
  exif: Record<string, unknown> | null;
  iptc: Record<string, unknown> | null;
  xmp: Record<string, unknown> | null;
  other: Record<string, unknown> | null;
}) {
  const metadata: Record<string, unknown> = { exif, iptc, xmp, other };

  const blocks = META_SECTIONS.flatMap((key) => {
    const block = metadata[key];
    if (!hasSectionContent(block)) {
      return [];
    }
    return [
      <section key={key} className={styles.metaSection}>
        <h3 className={styles.metaHeading}>{META_LABELS[key]}</h3>
        <dl className={styles.dl}>
          {Object.entries(block).map(([k, v]) => (
            <div key={k} className={styles.dlRow}>
              <dt className={styles.dt}>{k}</dt>
              <dd className={styles.dd}>{formatMetaValue(v)}</dd>
            </div>
          ))}
        </dl>
      </section>,
    ];
  });

  if (blocks.length === 0) {
    return <p className={styles.muted}>Нет метаданных</p>;
  }

  return <>{blocks}</>;
}

export interface AssetPhotoModalProps {
  assetId: string | null;
  fallbackThumbnailUrl?: string | null;
  /** Пока грузится API — подставляется в заголовок */
  fallbackTitle?: string | null;
  onClose: () => void;
}

export default function AssetPhotoModal({
  assetId,
  fallbackThumbnailUrl,
  fallbackTitle,
  onClose,
}: AssetPhotoModalProps) {
  const titleId = useId();
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assetId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    void getAsset(assetId)
      .then((d) => {
        if (!cancelled) {
          setDetail(d);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Не удалось загрузить данные');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const onBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  const onPanelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  useEffect(() => {
    if (!assetId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [assetId, onClose]);

  useBodyScrollLock(!!assetId);

  if (!assetId) {
    return null;
  }

  const imgSrc = detail?.preview_url ?? fallbackThumbnailUrl ?? undefined;
  const displayTitle = detail?.title ?? fallbackTitle ?? 'Фото';
  const headerTitle =
    loading && !fallbackTitle ? 'Загрузка…' : (detail?.title ?? fallbackTitle ?? 'Фото');
  const version = detail?.version;

  const showImageSkeleton = loading;
  const showLoadedImage = !loading && !error && !!imgSrc;
  const showErrorFallbackImg = !loading && !!error && !!fallbackThumbnailUrl;
  const showErrorOnlyInImage = !loading && !!error && !fallbackThumbnailUrl;
  const showNoImage = !loading && !error && !imgSrc;

  const node = (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={onPanelClick}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {headerTitle}
          </h2>
          <div className={styles.headerActions}>
            <Button color="muted" variant='outline' size='m' onClick={() => {alert('Пока не реализовано')}} disabled={!detail} icon={<Pencil />} >
              Редактировать
            </Button>
            <Button color='muted' variant='ghost' size='m' onClick={onClose} icon={<X />} aria-label="Закрыть" />
          </div>
        </header>

        <div className={styles.body}>
          <div className={styles.imageWrap}>
            {showImageSkeleton && (
              <div className={styles.imageSkeleton} aria-busy="true" />
            )}
            {showLoadedImage && (
              <img
                className={styles.image}
                src={imgSrc!}
                alt={displayTitle}
                decoding="async"
              />
            )}
            {showErrorFallbackImg && (
              <img
                className={styles.image}
                src={fallbackThumbnailUrl!}
                alt={displayTitle}
                decoding="async"
              />
            )}
            {showErrorOnlyInImage && (
              <div className={styles.errorBox}>{error}</div>
            )}
            {showNoImage && (
              <div className={styles.errorBox}>Нет изображения</div>
            )}
          </div>

          <div className={styles.metaScroll}>
            {error && showErrorFallbackImg && (
              <p className={styles.bannerError} role="alert">
                {error}
              </p>
            )}
            {version && (
              <>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Создано</span>
                  <span className={styles.metaValue}>
                    {new Date(version.created_at).toLocaleString()}
                  </span>
                </div>
                {version.rating != null && (
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Рейтинг</span>
                    <span className={styles.metaValue}>{version.rating}</span>
                  </div>
                )}
                {version.keywords.length > 0 && (
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Ключевые слова</span>
                    <span className={styles.metaValue}>{version.keywords.join(', ')}</span>
                  </div>
                )}
              </>
            )}
            <div className={styles.metaBlocks}>
              <h3 className={styles.sectionTitle}>Метаданные</h3>
              {version ? (
                <MetadataSections
                  exif={version.exif}
                  iptc={version.iptc}
                  xmp={version.xmp}
                  other={version.other}
                />
              ) : (
                !loading && !error && <p className={styles.muted}>Нет версии</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
