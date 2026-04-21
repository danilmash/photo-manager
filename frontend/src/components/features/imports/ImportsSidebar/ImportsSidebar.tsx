import { Plus } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import Sidebar from '../../../ui/Sidebar';
import type { ImportBatch } from '../../../../api/importBatches';

import styles from './ImportsSidebar.module.css';

const STATUS_LABEL: Record<ImportBatch['status'], string> = {
  uploading: 'Загрузка',
  processing: 'Обработка',
  pending_review: 'Ревью',
  accepted: 'Принято',
  rejected: 'Отклонено',
  cancelled: 'Отменено',
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface ImportsSidebarProps {
  open: boolean;
  onToggle: () => void;
  batches: ImportBatch[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  isCreating: boolean;
}

export default function ImportsSidebar({
  open,
  onToggle,
  batches,
  isLoading,
  error,
  onCreate,
  isCreating,
}: ImportsSidebarProps) {
  return (
    <Sidebar
      open={open}
      onToggle={onToggle}
      title="Импорты"
      ariaLabel="Список партий импорта"
    >
      <div className={styles['sidebar-inner']}>
        <button
          type="button"
          className={styles['create-btn']}
          onClick={onCreate}
          disabled={isCreating}
        >
          <Plus size={16} />
          <span>{isCreating ? 'Создаётся…' : 'Новая партия'}</span>
        </button>

        {error && <div className={styles.alert}>{error}</div>}

        {isLoading && batches.length === 0 && (
          <ul className={styles.list} aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className={styles['item-skeleton']} />
            ))}
          </ul>
        )}

        {!isLoading && batches.length === 0 && !error && (
          <p className={styles.empty}>
            Пока нет ни одной партии. Нажмите «Новая партия», чтобы начать.
          </p>
        )}

        {batches.length > 0 && (
          <ul className={styles.list}>
            {batches.map((batch) => (
              <li key={batch.id}>
                <NavLink
                  to={`/import/${batch.id}`}
                  className={({ isActive }) =>
                    [styles.item, isActive ? styles['item-active'] : '']
                      .filter(Boolean)
                      .join(' ')
                  }
                >
                  <span className={styles['item-title']}>
                    {formatDate(batch.created_at)}
                  </span>
                  <span className={styles['item-meta']}>
                    <span
                      className={`${styles.badge} ${
                        styles[`badge-${batch.status}`] ?? ''
                      }`}
                    >
                      {STATUS_LABEL[batch.status] ?? batch.status}
                    </span>
                    <span className={styles['item-count']}>
                      {batch.assets_count}
                    </span>
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sidebar>
  );
}
