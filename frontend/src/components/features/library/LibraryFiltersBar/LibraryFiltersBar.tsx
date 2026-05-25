import type { AssetFilters } from '../../../../api/assets';
import LibraryFiltersForm from './LibraryFiltersForm';
import styles from './LibraryFiltersBar.module.css';

export interface LibraryFiltersBarProps {
  folderId: string | null;
  filters: AssetFilters;
  filtersActive: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  onApply: (filters: AssetFilters) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

export default function LibraryFiltersBar({
  folderId,
  filters,
  filtersActive,
  isLoading = false,
  disabled = false,
  onApply,
  onClear,
}: LibraryFiltersBarProps) {
  return (
    <section className={styles.root} aria-label="Фильтры библиотеки">
      <LibraryFiltersForm
        folderId={folderId}
        filters={filters}
        filtersActive={filtersActive}
        isLoading={isLoading}
        disabled={disabled}
        layout="inline"
        onApply={onApply}
        onClear={onClear}
      />
    </section>
  );
}
