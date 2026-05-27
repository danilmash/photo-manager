import { UserRoundX } from 'lucide-react';

import styles from './FaceOutsideClusterBadge.module.css';

const DEFAULT_LABEL = 'Лицо исключено из кластера';
const DEFAULT_TITLE =
  'На фото есть лицо вне кластера — назначьте персону в просмотре';

export interface FaceOutsideClusterBadgeProps {
  className?: string;
  title?: string;
}

export default function FaceOutsideClusterBadge({
  className,
  title = DEFAULT_TITLE,
}: FaceOutsideClusterBadgeProps) {
  return (
    <span
      className={[styles.root, className ?? ''].filter(Boolean).join(' ')}
      title={title}
      role="img"
      aria-label={DEFAULT_LABEL}
    >
      <UserRoundX className={styles.icon} strokeWidth={2.25} aria-hidden />
    </span>
  );
}
