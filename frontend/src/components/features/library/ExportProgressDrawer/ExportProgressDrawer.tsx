import Button from '../../../ui/Button';
import Drawer from '../../../ui/Drawer';
import { useExportStore } from '../../../../stores/useExportStore';
import { triggerExportDownload } from '../../../../api/exports';

import styles from './ExportProgressDrawer.module.css';

export default function ExportProgressDrawer() {
  const drawerOpen = useExportStore((s) => s.drawerOpen);
  const closeDrawer = useExportStore((s) => s.closeDrawer);
  const reset = useExportStore((s) => s.reset);
  const activeJob = useExportStore((s) => s.activeJob);
  const isStarting = useExportStore((s) => s.isStarting);
  const error = useExportStore((s) => s.error);

  const total = activeJob?.total ?? 0;
  const processed = activeJob?.processed ?? 0;
  const status = activeJob?.status ?? (isStarting ? 'pending' : null);
  const progressPercent =
    total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const isCompleted = status === 'completed';
  const isFailed = status === 'failed' || Boolean(error);
  const isActive = status === 'pending' || status === 'processing' || isStarting;

  if (!drawerOpen && !isStarting && !activeJob && !error) {
    return null;
  }

  return (
    <Drawer
      title="Экспорт фотографий"
      open={drawerOpen}
      onClose={closeDrawer}
      side="right"
      behavior="overlap"
    >
      <div className={styles.content}>
        <div className={styles.card}>
          <div className={styles.rowTop}>
            <span className={styles.title}>
              {isCompleted
                ? 'Архив готов'
                : isFailed
                  ? 'Ошибка экспорта'
                  : 'Подготовка архива…'}
            </span>
            <span className={styles.status}>
              {isActive ? `${processed} / ${total || '…'}` : `${total} файлов`}
            </span>
          </div>

          <div className={styles.barTrack} aria-hidden="true">
            <div
              className={`${styles.barFill} ${isFailed ? styles.barFillError : ''}`}
              style={{ width: `${isCompleted ? 100 : progressPercent}%` }}
            />
          </div>

          <p className={styles.summary}>
            {isCompleted
              ? 'ZIP-архив с фото в полном разрешении и применёнными правками скачан автоматически.'
              : isFailed
                ? error ?? activeJob?.error ?? 'Не удалось выполнить экспорт.'
                : 'Фотографии обрабатываются на сервере. Это может занять несколько минут.'}
          </p>
        </div>

        <div className={styles.footer}>
          {isCompleted && activeJob ? (
            <Button
              color="primary"
              variant="filled"
              size="m"
              onClick={() => triggerExportDownload(activeJob.id)}
            >
              Скачать снова
            </Button>
          ) : null}
          <Button
            color="secondary"
            variant="outline"
            size="m"
            onClick={() => {
              if (isActive) {
                closeDrawer();
                return;
              }
              reset();
            }}
          >
            {isActive ? 'Свернуть' : 'Закрыть'}
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
