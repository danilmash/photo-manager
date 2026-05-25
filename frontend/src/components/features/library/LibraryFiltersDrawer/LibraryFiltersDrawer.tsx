import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import type { AssetFilters } from '../../../../api/assets';
import Drawer from '../../../ui/Drawer';
import LibraryFiltersForm from '../LibraryFiltersBar/LibraryFiltersForm';
import styles from './LibraryFiltersDrawer.module.css';

export interface LibraryFiltersDrawerProps {
  folderId: string | null;
  filters: AssetFilters;
  filtersActive: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  onApply: (filters: AssetFilters) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

export default function LibraryFiltersDrawer({
  folderId,
  filters,
  filtersActive,
  isLoading = false,
  disabled = false,
  onApply,
  onClear,
}: LibraryFiltersDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`${styles.trigger} ${filtersActive ? styles.triggerActive : ''}`}
        onClick={() => setOpen(true)}
        aria-label={filtersActive ? 'Фильтры активны' : 'Открыть фильтры'}
      >
        <SlidersHorizontal size={20} aria-hidden />
        {filtersActive ? <span className={styles.badge} aria-hidden /> : null}
      </button>

      <Drawer
        title="Фильтры"
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        behavior="overlap"
      >
        <LibraryFiltersForm
          folderId={folderId}
          filters={filters}
          filtersActive={filtersActive}
          isLoading={isLoading}
          disabled={disabled}
          layout="drawer"
          onApply={async (nextFilters) => {
            await onApply(nextFilters);
            setOpen(false);
          }}
          onClear={async () => {
            await onClear();
            setOpen(false);
          }}
        />
      </Drawer>
    </>
  );
}
