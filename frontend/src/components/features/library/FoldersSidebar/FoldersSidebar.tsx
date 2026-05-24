import { FolderPlus, Library, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useState } from 'react';

import Sidebar from '../../../ui/Sidebar';
import type { FolderSummary } from '../../../../api/folders';

import styles from './FoldersSidebar.module.css';

export interface FoldersSidebarProps {
  open: boolean;
  onToggle: () => void;
  folders: FolderSummary[];
  isLoading: boolean;
  error: string | null;
  onCreate: () => void;
  onRename: (folder: FolderSummary) => void;
  onDelete: (folder: FolderSummary) => void;
}

export default function FoldersSidebar({
  open,
  onToggle,
  folders,
  isLoading,
  error,
  onCreate,
  onRename,
  onDelete,
}: FoldersSidebarProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  return (
    <Sidebar open={open} onToggle={onToggle} title="Папки" ariaLabel="Папки библиотеки">
      <div className={styles.inner}>
        <button type="button" className={styles.createBtn} onClick={onCreate}>
          <FolderPlus size={18} aria-hidden="true" />
          Создать папку
        </button>

        {error ? <div className={styles.alert}>{error}</div> : null}

        <nav className={styles.nav} aria-label="Навигация по библиотеке">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${styles.item} ${isActive ? styles.itemActive : ''}`
            }
            onClick={() => setMenuOpenId(null)}
          >
            <span className={styles.itemTitle}>
              <Library size={16} aria-hidden="true" />
              Вся библиотека
            </span>
          </NavLink>

          {isLoading && folders.length === 0 ? (
            <div className={styles.skeletonList}>
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={styles.itemSkeleton} />
              ))}
            </div>
          ) : null}

          {!isLoading && folders.length === 0 ? (
            <p className={styles.empty}>Создайте первую папку для группировки фото.</p>
          ) : null}

          <ul className={styles.list}>
            {folders.map((folder) => (
              <li key={folder.id} className={styles.listItem}>
                <NavLink
                  to={`/folders/${folder.id}`}
                  className={({ isActive }) =>
                    `${styles.item} ${isActive ? styles.itemActive : ''}`
                  }
                  onClick={() => setMenuOpenId(null)}
                >
                  <span className={styles.itemTitle}>{folder.name}</span>
                  <span className={styles.itemMeta}>
                    <span className={styles.itemCount}>{folder.asset_count}</span>
                  </span>
                </NavLink>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.menuBtn}
                    aria-label={`Действия для папки ${folder.name}`}
                    onClick={() =>
                      setMenuOpenId((prev) => (prev === folder.id ? null : folder.id))
                    }
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {menuOpenId === folder.id ? (
                    <div className={styles.menu} role="menu">
                      <button
                        type="button"
                        className={styles.menuItem}
                        onClick={() => {
                          setMenuOpenId(null);
                          onRename(folder);
                        }}
                      >
                        <Pencil size={14} />
                        Переименовать
                      </button>
                      <button
                        type="button"
                        className={`${styles.menuItem} ${styles.menuItemDanger}`}
                        onClick={() => {
                          setMenuOpenId(null);
                          onDelete(folder);
                        }}
                      >
                        <Trash2 size={14} />
                        Удалить
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </Sidebar>
  );
}
