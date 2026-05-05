import type { ReactNode } from 'react';

import styles from './Chip.module.css';

interface ChipProps {
  children: ReactNode;
  count?: number;
  title?: string;
  onClick?: () => void;
  onRemove?: () => void;
}

export default function Chip({
  children,
  count,
  title,
  onClick,
  onRemove,
}: ChipProps) {
  const interactive = Boolean(onClick || onRemove);
  const content = (
    <>
      <span>{children}</span>
      {typeof count === 'number' ? <span className={styles.count}>{count}</span> : null}
      {onRemove ? <span className={styles.removeMark} aria-hidden>×</span> : null}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={styles.chip}
        title={title}
        onClick={onRemove ?? onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={styles.chip} title={title}>
      {content}
    </span>
  );
}
