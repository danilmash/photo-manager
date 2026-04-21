import { Loader2, UserRound } from 'lucide-react';

import type { AssetListItem } from '../../../api/assets';

import styles from './PhotoStateBadge.module.css';

export type PhotoStateBadgeVariant = 'faces-pending' | 'processing';

export interface PhotoStateBadgeProps {
  variant: PhotoStateBadgeVariant;
  /** @default 'sm' */
  size?: 'sm' | 'md';
  className?: string;
  /** Подпись для всплывающей подсказки и aria-label */
  label?: string;
}

const DEFAULT_LABELS: Record<PhotoStateBadgeVariant, string> = {
  'faces-pending': 'Ожидается поиск лиц',
  processing: 'Идёт обработка',
};

/**
 * Универсальный бейдж состояния фото на превью: либо «нужны лица» (иконка
 * человека в жёлтом круге), либо активная обработка (вращающийся лоадер).
 */
export default function PhotoStateBadge({
  variant,
  size = 'sm',
  className,
  label,
}: PhotoStateBadgeProps) {
  const ariaLabel = label ?? DEFAULT_LABELS[variant];
  const sizeClass = size === 'md' ? styles.md : styles.sm;

  return (
    <span
      className={[
        styles.root,
        sizeClass,
        variant === 'faces-pending' ? styles['faces-pending'] : styles.processing,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={ariaLabel}
      role="img"
      aria-label={ariaLabel}
    >
      {variant === 'faces-pending' ? (
        <UserRound className={styles.icon} strokeWidth={2.25} aria-hidden />
      ) : (
        <Loader2 className={`${styles.icon} ${styles.spin}`} strokeWidth={2.25} aria-hidden />
      )}
    </span>
  );
}

/**
 * Сопоставление фаз preview/faces с вариантом бейджа. Возвращает null, если
 * отдельный бейдж не нужен (например, финальные состояния или ошибка превью).
 */
export function resolvePhotoStateBadgeVariant(
  item: Pick<AssetListItem, 'preview_status' | 'faces_status'>,
): PhotoStateBadgeVariant | null {
  const { preview_status: preview, faces_status: faces } = item;

  if (preview === 'pending' || preview === 'processing') {
    return 'processing';
  }

  if (preview === 'completed') {
    if (faces === 'pending') return 'faces-pending';
    if (faces === 'processing') return 'processing';
  }

  return null;
}
