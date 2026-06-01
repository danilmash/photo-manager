import type { AssetVersionSummary } from '../../../api/assets';
import styles from './PhotoVersionHistory.module.css';

function versionThumbSrc(version: AssetVersionSummary): string | null {
  return version.thumbnail_url || version.preview_url || null;
}

function formatVersionDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function previewStatusLabel(status: string): string {
  if (status === 'completed') return 'Превью готово';
  if (status === 'processing') return 'Превью обрабатывается';
  if (status === 'failed') return 'Ошибка превью';
  return 'Превью ожидает';
}

interface PhotoVersionHistoryProps {
  versions: AssetVersionSummary[];
  latestVersionId: string | null;
  selectedVersionId: string | null;
  onSelect: (versionId: string) => void;
  loading?: boolean;
  error?: string | null;
}

export default function PhotoVersionHistory({
  versions,
  latestVersionId,
  selectedVersionId,
  onSelect,
  loading = false,
  error = null,
}: PhotoVersionHistoryProps) {
  if (loading && versions.length === 0) {
    return <p className={styles.message}>Загрузка версий…</p>;
  }

  if (error && versions.length === 0) {
    return <p className={`${styles.message} ${styles.messageError}`}>{error}</p>;
  }

  if (versions.length === 0) {
    return <p className={styles.message}>Нет версий</p>;
  }

  const activeId = selectedVersionId ?? latestVersionId;

  return (
    <ul className={styles.list} aria-label="История версий">
      {versions.map((version) => {
        const thumb = versionThumbSrc(version);
        const isActive = version.id === activeId;
        const isLatest = version.id === latestVersionId;

        return (
          <li key={version.id}>
            <button
              type="button"
              className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
              onClick={() => onSelect(version.id)}
              aria-current={isActive ? 'true' : undefined}
            >
              {thumb ? (
                <img
                  className={styles.thumb}
                  src={thumb}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className={`${styles.thumb} ${styles.thumbPlaceholder}`}>
                  …
                </div>
              )}
              <div className={styles.meta}>
                <div className={styles.titleRow}>
                  <span className={styles.versionLabel}>
                    Версия {version.version_number}
                  </span>
                  {isLatest ? <span className={styles.badge}>Текущая</span> : null}
                </div>
                <span className={styles.date}>{formatVersionDate(version.created_at)}</span>
                <span className={styles.status}>
                  {previewStatusLabel(version.preview_status)}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
