import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Settings } from 'lucide-react';
import { useAuthStore } from '../../../stores/useAuthStore';
import styles from './UserMenu.module.css';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Администратор',
  editor: 'Редактор',
};

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface UserMenuProps {
  compact?: boolean;
}

export default function UserMenu({ compact = false }: UserMenuProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={styles.menu} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${compact ? styles['trigger-compact'] : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Меню пользователя ${user.display_name}`}
      >
        <span className={styles.avatar} aria-hidden="true">
          {getInitials(user.display_name)}
        </span>
        {!compact && <span className={styles.name}>{user.display_name}</span>}
        {!compact && <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />}
      </button>

      {open && (
        <div className={styles.dropdown} role="menu">
          <div className={styles['dropdown-header']}>
            <div className={styles['dropdown-name']}>{user.display_name}</div>
            <div className={styles['dropdown-email']}>{user.email}</div>
            <span
              className={`${styles.badge} ${user.role === 'admin' ? styles['badge-admin'] : ''}`}
            >
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          </div>
          <Link
            to="/settings"
            className={styles['menu-item']}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <Settings size={16} />
            Настройки
          </Link>
          <button
            type="button"
            className={`${styles['menu-item']} ${styles['menu-item-danger']}`}
            role="menuitem"
            onClick={() => void handleLogout()}
          >
            <LogOut size={16} />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}
