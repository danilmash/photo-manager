import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import { listAssetTags, type AssetFilters } from '../../../../api/assets';
import Button from '../../../ui/Button';
import Chip from '../../../ui/Chip';
import styles from './LibraryFiltersForm.module.css';

export interface LibraryFiltersFormProps {
  folderId: string | null;
  filters: AssetFilters;
  filtersActive: boolean;
  isLoading?: boolean;
  disabled?: boolean;
  layout?: 'inline' | 'drawer';
  onApply: (filters: AssetFilters) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

export function normalizeDraftFilters(filters: AssetFilters): AssetFilters {
  return {
    tags: filters.tags ?? [],
    takenFrom: filters.takenFrom ?? '',
    takenTo: filters.takenTo ?? '',
    camera: filters.camera ?? '',
  };
}

export function buildFilterSummaryChips(filters: AssetFilters, filtersActive: boolean): string[] {
  if (!filtersActive) return [];
  const chips: string[] = [];
  for (const tag of filters.tags ?? []) {
    chips.push(`#${tag}`);
  }
  if (filters.takenFrom || filters.takenTo) {
    chips.push(`Дата: ${filters.takenFrom || '…'} — ${filters.takenTo || '…'}`);
  }
  if (filters.camera?.trim()) {
    chips.push(`Камера: ${filters.camera.trim()}`);
  }
  return chips;
}

export default function LibraryFiltersForm({
  folderId,
  filters,
  filtersActive,
  isLoading = false,
  disabled = false,
  layout = 'inline',
  onApply,
  onClear,
}: LibraryFiltersFormProps) {
  const [draft, setDraft] = useState<AssetFilters>(() => normalizeDraftFilters(filters));
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const tagsInputId =
    layout === 'drawer' ? 'library-filter-tags-drawer' : 'library-filter-tags';
  const takenFromId =
    layout === 'drawer' ? 'library-filter-taken-from-drawer' : 'library-filter-taken-from';
  const takenToId =
    layout === 'drawer' ? 'library-filter-taken-to-drawer' : 'library-filter-taken-to';
  const cameraId =
    layout === 'drawer' ? 'library-filter-camera-drawer' : 'library-filter-camera';

  useEffect(() => {
    setDraft(normalizeDraftFilters(filters));
  }, [filters]);

  useEffect(() => {
    if (disabled || !tagInput.trim()) {
      setTagSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void listAssetTags({
        q: tagInput.trim(),
        limit: 12,
        folderId,
      })
        .then((response) => {
          const selected = new Set((draft.tags ?? []).map((tag) => tag.toLowerCase()));
          setTagSuggestions(
            response.items.filter((item) => !selected.has(item.toLowerCase())),
          );
        })
        .catch(() => {
          setTagSuggestions([]);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [disabled, draft.tags, folderId, tagInput]);

  const addTag = useCallback((value: string) => {
    const tag = value.trim();
    if (!tag) return;
    setDraft((prev) => {
      const existing = prev.tags ?? [];
      if (existing.some((item) => item.toLowerCase() === tag.toLowerCase())) {
        return prev;
      }
      return { ...prev, tags: [...existing, tag] };
    });
    setTagInput('');
    setSuggestionsOpen(false);
  }, []);

  const removeTag = useCallback((value: string) => {
    setDraft((prev) => ({
      ...prev,
      tags: (prev.tags ?? []).filter((tag) => tag !== value),
    }));
  }, []);

  const summaryChips = useMemo(
    () => buildFilterSummaryChips(filters, filtersActive),
    [filters, filtersActive],
  );

  return (
    <>
      <div
        className={`${styles.form} ${layout === 'drawer' ? styles.formDrawer : styles.formInline}`}
      >
        <div className={styles.fieldWide}>
          <label className={styles.label} htmlFor={tagsInputId}>
            Теги
          </label>
          <div className={styles.tagField}>
            <div className={styles.tagList}>
              {(draft.tags ?? []).map((tag) => (
                <Chip key={tag} onRemove={() => removeTag(tag)}>
                  {tag}
                </Chip>
              ))}
            </div>
            <div className={styles.tagInputRow}>
              <input
                id={tagsInputId}
                className={styles.tagInput}
                value={tagInput}
                disabled={disabled}
                placeholder="Введите тег…"
                aria-describedby={layout === 'drawer' ? `${tagsInputId}-hint` : undefined}
                onChange={(event) => {
                  setTagInput(event.target.value);
                  setSuggestionsOpen(true);
                }}
                onFocus={() => setSuggestionsOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag(tagInput);
                  }
                }}
              />
              <button
                type="button"
                className={styles.addTagBtn}
                disabled={disabled || !tagInput.trim()}
                onClick={() => addTag(tagInput)}
                aria-label="Добавить тег"
                title="Добавить тег (Enter)"
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
            {suggestionsOpen && tagSuggestions.length > 0 ? (
              <ul className={styles.suggestions} role="listbox">
                {tagSuggestions.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      className={styles.suggestionBtn}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addTag(tag)}
                    >
                      {tag}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {layout === 'drawer' ? (
              <p id={`${tagsInputId}-hint`} className={styles.tagHint}>
                Нажмите Enter или «+», чтобы добавить тег
              </p>
            ) : null}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={takenFromId}>
            Дата с
          </label>
          <input
            id={takenFromId}
            type="date"
            className={`${styles.input} ${styles.inputDate}`}
            disabled={disabled}
            value={draft.takenFrom ?? ''}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, takenFrom: event.target.value }))
            }
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={takenToId}>
            Дата по
          </label>
          <input
            id={takenToId}
            type="date"
            className={`${styles.input} ${styles.inputDate}`}
            disabled={disabled}
            value={draft.takenTo ?? ''}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, takenTo: event.target.value }))
            }
          />
        </div>

        <div className={styles.fieldWideDesktop}>
          <label className={styles.label} htmlFor={cameraId}>
            Камера
          </label>
          <input
            id={cameraId}
            type="text"
            className={styles.input}
            disabled={disabled}
            placeholder="Canon, iPhone…"
            value={draft.camera ?? ''}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, camera: event.target.value }))
            }
          />
        </div>

        <div className={styles.actions}>
          <Button
            color="primary"
            variant="filled"
            size="m"
            disabled={disabled || isLoading}
            onClick={() => {
              void onApply(draft);
            }}
          >
            Применить
          </Button>
          <Button
            color="secondary"
            variant="outline"
            size="m"
            disabled={disabled || isLoading || !filtersActive}
            onClick={() => {
              void onClear();
            }}
          >
            Сбросить
          </Button>
        </div>
      </div>

      {layout === 'inline' && filtersActive && summaryChips.length > 0 ? (
        <div className={styles.summary}>
          {summaryChips.map((chip) => (
            <span key={chip} className={styles.summaryChip}>
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </>
  );
}
