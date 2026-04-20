import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useBodyScrollLock } from '../../../hooks/useBodyScrollLock';

import styles from './Sidebar.module.css';

const MOBILE_BREAKPOINT = 768;

export interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  title?: string;
  ariaLabel?: string;
}

function useIsMobile(breakpoint: number): boolean {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}

export default function Sidebar({
  open,
  onToggle,
  children,
  title,
  ariaLabel = 'Боковая панель',
}: SidebarProps) {
  const isMobile = useIsMobile(MOBILE_BREAKPOINT);

  useBodyScrollLock(open && isMobile);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onToggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onToggle]);

  const panelClass = [styles.panel, open ? styles.open : styles.collapsed]
    .filter(Boolean)
    .join(' ');
  const toggleClass = [styles.toggle, open ? styles.open : styles.collapsed]
    .filter(Boolean)
    .join(' ');
  const backdropClass = [styles.backdrop, open ? styles.open : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div
        className={backdropClass}
        onClick={onToggle}
        aria-hidden="true"
      />

      <aside
        className={panelClass}
        aria-label={ariaLabel}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        {title !== undefined && (
          <header className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
          </header>
        )}
        <div className={styles.body}>{children}</div>
      </aside>

      <button
        type="button"
        className={toggleClass}
        onClick={onToggle}
        aria-label={open ? 'Свернуть панель' : 'Развернуть панель'}
        aria-expanded={open}
      >
        {open ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </>
  );
}
