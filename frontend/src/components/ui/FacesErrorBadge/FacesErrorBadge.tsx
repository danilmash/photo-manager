import { AlertTriangle } from 'lucide-react';

import styles from './FacesErrorBadge.module.css';

const DEFAULT_LABEL = 'Ошибка поиска лиц';
const DEFAULT_TITLE = 'Поиск лиц завершился ошибкой';

export interface FacesErrorBadgeProps {
  message?: string | null;
  className?: string;
}

export default function FacesErrorBadge({
  message,
  className,
}: FacesErrorBadgeProps) {
  const trimmed = message?.trim();
  const title = trimmed || DEFAULT_TITLE;
  const ariaLabel = trimmed || DEFAULT_LABEL;

  return (
    <span
      className={[styles.root, className ?? ''].filter(Boolean).join(' ')}
      title={title}
      role="img"
      aria-label={ariaLabel}
    >
      <AlertTriangle size={14} strokeWidth={2.25} aria-hidden />
    </span>
  );
}
