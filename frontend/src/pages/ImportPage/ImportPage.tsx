import { useCallback, useRef, useState } from 'react';
import styles from './ImportPage.module.css';
import { useImportStore } from '../../stores/useImportStore';

function phaseLabel(phase: 'uploading' | 'processing' | 'ready' | 'error', message?: string) {
  if (message) return message;
  switch (phase) {
    case 'uploading':
      return 'Загрузка…';
    case 'processing':
      return 'Обработка…';
    case 'ready':
      return 'Готово';
    case 'error':
      return 'Ошибка';
    default:
      return phase;
  }
}

export default function ImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const rows = useImportStore((s) => s.rows);
  const startImport = useImportStore((s) => s.startImport);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      void startImport(Array.from(fileList));
    },
    [startImport],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragActive(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles['page-intro']} aria-labelledby="import-page-title">
        <h1 id="import-page-title" className={styles.title}>
          Импорт
        </h1>
        <p className={styles.subtitle}>Перетащите фото сюда или выберите файлы</p>
      </section>

      <button
        type="button"
        className={`${styles['drop-zone']} ${dragActive ? styles['drop-zone-active'] : ''}`}
        onClick={() => inputRef.current?.click()}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className={styles['hidden-input']}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className={styles['drop-hint']}>Нажмите или перетащите файлы</span>
      </button>

      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles['row-top']}>
                <span className={styles['file-name']}>{row.fileName}</span>
                <span className={styles.status}>{phaseLabel(row.phase, row.message)}</span>
              </div>
              <div className={styles['bar-track']}>
                <div
                  className={styles['bar-fill']}
                  style={{
                    width: `${row.phase === 'uploading' ? row.progress : 100}%`,
                  }}
                />
              </div>
              {row.phase === 'uploading' && <span className={styles.pct}>{row.progress}%</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
