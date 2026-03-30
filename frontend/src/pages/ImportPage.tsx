import { useCallback, useRef, useState } from 'react';
import { AxiosError } from 'axios';
import { uploadAsset, getAssetStatus } from '../api/assets';
import styles from './ImportPage.module.css';

type RowPhase = 'uploading' | 'processing' | 'ready' | 'error';

interface UploadRow {
  id: string;
  fileName: string;
  progress: number;
  phase: RowPhase;
  message?: string;
}

const POLL_MS = 1000;
const POLL_TIMEOUT_MS = 120_000;

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function phaseLabel(phase: RowPhase, message?: string) {
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
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const updateRow = useCallback((id: string, patch: Partial<UploadRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const pollUntilDone = useCallback(
    async (rowId: string, assetId: string) => {
      const start = Date.now();
      while (Date.now() - start < POLL_TIMEOUT_MS) {
        try {
          const { status } = await getAssetStatus(assetId);
          if (status === 'ready') {
            updateRow(rowId, { phase: 'ready', progress: 100 });
            return;
          }
          if (status === 'error') {
            updateRow(rowId, { phase: 'error', message: 'Ошибка обработки' });
            return;
          }
          updateRow(rowId, { phase: 'processing' });
        } catch {
          updateRow(rowId, { phase: 'error', message: 'Не удалось получить статус' });
          return;
        }
        await sleep(POLL_MS);
      }
      updateRow(rowId, { phase: 'error', message: 'Таймаут обработки' });
    },
    [updateRow],
  );

  const processFile = useCallback(
    async (rowId: string, file: File) => {
      try {
        const res = await uploadAsset(file, (e) => {
          const total = e.total ?? 0;
          const pct = total > 0 ? Math.round((e.loaded / total) * 100) : 0;
          updateRow(rowId, { progress: pct, phase: 'uploading' });
        });
        updateRow(rowId, { progress: 100, phase: 'processing' });
        await pollUntilDone(rowId, res.asset_id);
      } catch (err: unknown) {
        let msg = 'Ошибка загрузки';
        if (err instanceof AxiosError) {
          const d = err.response?.data as { detail?: string | string[] } | undefined;
          if (typeof d?.detail === 'string') msg = d.detail;
          else if (Array.isArray(d?.detail)) msg = d.detail.map(String).join(', ');
        }
        updateRow(rowId, { phase: 'error', message: msg });
      }
    },
    [pollUntilDone, updateRow],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const files = Array.from(fileList);
      const newRows: UploadRow[] = files.map((f) => ({
        id: crypto.randomUUID(),
        fileName: f.name,
        progress: 0,
        phase: 'uploading' as const,
      }));
      setRows((prev) => [...prev, ...newRows]);
      newRows.forEach((row, i) => {
        void processFile(row.id, files[i]);
      });
    },
    [processFile],
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
      <header className={styles.header}>
        <h1 className={styles.title}>Импорт</h1>
        <p className={styles.subtitle}>Перетащите фото сюда или выберите файлы</p>
      </header>

      <button
        type="button"
        className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
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
          className={styles.hiddenInput}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <span className={styles.dropHint}>Нажмите или перетащите файлы</span>
      </button>

      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              <div className={styles.rowTop}>
                <span className={styles.fileName}>{row.fileName}</span>
                <span className={styles.status}>{phaseLabel(row.phase, row.message)}</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
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
