import { useEffect, useMemo, useState } from 'react';

import Drawer from '../../../ui/Drawer';
import {
  useImportSessionStore,
  type UploadRow,
} from '../../../../stores/useImportSessionStore';

import styles from './UploadProgressDrawer.module.css';

// Стабильная ссылка на пустой массив: нужна, чтобы zustand-селектор не
// возвращал каждый раз новый `[]` и не уводил useSyncExternalStore в
// бесконечный цикл ререндеров.
const EMPTY_ROWS: UploadRow[] = [];

export interface UploadProgressDrawerProps {
  batchId: string | null;
}

export default function UploadProgressDrawer({ batchId }: UploadProgressDrawerProps) {
  const rows = useImportSessionStore((s) =>
    batchId ? s.uploadsByBatch[batchId] ?? EMPTY_ROWS : EMPTY_ROWS,
  );
  const clearCompleted = useImportSessionStore((s) => s.clearCompletedUploads);

  const hasActive = useMemo(
    () => rows.some((r) => r.phase === 'uploading'),
    [rows],
  );

  const [open, setOpen] = useState(false);

  // Автоматически открываем drawer при старте новой загрузки. Пользователь
  // может закрыть — тогда drawer не всплывёт, пока не появятся новые
  // активные строки.
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  // Если партия сменилась и строк нет — drawer должен быть закрыт.
  useEffect(() => {
    if (rows.length === 0) setOpen(false);
  }, [batchId, rows.length]);

  if (!batchId || rows.length === 0) return null;

  const doneCount = rows.filter(
    (r) => r.phase === 'uploaded' || r.phase === 'error',
  ).length;
  const errorCount = rows.filter((r) => r.phase === 'error').length;

  return (
    <Drawer
      title={`Загрузка (${doneCount}/${rows.length})`}
      open={open}
      onClose={() => setOpen(false)}
      side="right"
      behavior="overlap"
    >
      <div className={styles.content}>
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles['row-top']}>
                <span className={styles['file-name']} title={row.fileName}>
                  {row.fileName}
                </span>
                <span
                  className={`${styles.status} ${
                    row.phase === 'error' ? styles['status-error'] : ''
                  }`}
                >
                  {row.phase === 'uploading' && `${row.progress}%`}
                  {row.phase === 'uploaded' && 'Загружено'}
                  {row.phase === 'error' && (row.message ?? 'Ошибка')}
                </span>
              </div>
              <div className={styles['bar-track']}>
                <div
                  className={`${styles['bar-fill']} ${
                    row.phase === 'error' ? styles['bar-fill-error'] : ''
                  }`}
                  style={{
                    width: `${
                      row.phase === 'uploading' ? row.progress : 100
                    }%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>

        {!hasActive && doneCount > 0 && (
          <div className={styles.footer}>
            <p className={styles.summary}>
              Готово: {doneCount}
              {errorCount > 0 ? `, ошибок: ${errorCount}` : ''}
            </p>
            <button
              type="button"
              className={styles['clear-btn']}
              onClick={() => clearCompleted(batchId)}
            >
              Очистить список
            </button>
          </div>
        )}
      </div>
    </Drawer>
  );
}
