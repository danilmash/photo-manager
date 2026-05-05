import { useCallback, useMemo, useState, type FormEvent } from 'react';

import type {
  ImportBatchTagSuggestionItem,
  ImportBatchTagSuggestionsResponse,
} from '../../../../api/importBatches';

import styles from './ImportBatchTagsSection.module.css';

interface ImportBatchTagsSectionProps {
  suggestions: ImportBatchTagSuggestionsResponse | null;
  isLoading: boolean;
  isFetchFailed: boolean;
  applyError: string | null;
  onApply: (tags: string[]) => Promise<number>;
}

const EMPTY_GROUPS: ImportBatchTagSuggestionsResponse = {
  recent: [],
  popular: [],
  similar_batches: [],
};

function normalizeTag(value: string): string | null {
  const tag = value.trim().replace(/\s+/g, ' ');
  if (!tag) return null;
  return tag.length > 64 ? tag.slice(0, 64).trim() : tag;
}

function splitDraft(value: string): string[] {
  return value
    .split(',')
    .map(normalizeTag)
    .filter((tag): tag is string => tag !== null);
}

function dedupeTags(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const tag = normalizeTag(value);
    if (!tag) continue;
    const key = tag.toLocaleLowerCase('ru-RU');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function SuggestionGroup({
  title,
  items,
  onPick,
}: {
  title: string;
  items: ImportBatchTagSuggestionItem[];
  onPick: (tag: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className={styles.suggestionGroup}>
      <div className={styles.suggestionTitle}>{title}</div>
      <div className={styles.suggestionList}>
        {items.map((item) => (
          <button
            key={`${title}-${item.tag}`}
            type="button"
            className={styles.suggestionChip}
            onClick={() => onPick(item.tag)}
          >
            <span>{item.tag}</span>
            <span className={styles.count}>{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ImportBatchTagsSection({
  suggestions,
  isLoading,
  isFetchFailed,
  applyError,
  onApply,
}: ImportBatchTagsSectionProps) {
  const [draft, setDraft] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const groups = suggestions ?? EMPTY_GROUPS;
  const hasSuggestions =
    groups.recent.length > 0 ||
    groups.popular.length > 0 ||
    groups.similar_batches.length > 0;

  const canSubmit = selectedTags.length > 0 && !isSubmitting;

  const addTags = useCallback((values: string[]) => {
    setSelectedTags((prev) => dedupeTags([...prev, ...values]));
    setSuccessMessage(null);
  }, []);

  const commitDraft = useCallback(() => {
    const tags = splitDraft(draft);
    if (tags.length === 0) return;
    addTags(tags);
    setDraft('');
  }, [addTags, draft]);

  const removeTag = useCallback((tag: string) => {
    const key = tag.toLocaleLowerCase('ru-RU');
    setSelectedTags((prev) =>
      prev.filter((item) => item.toLocaleLowerCase('ru-RU') !== key),
    );
    setSuccessMessage(null);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const tags = dedupeTags([...selectedTags, ...splitDraft(draft)]);
      if (tags.length === 0 || isSubmitting) return;

      setIsSubmitting(true);
      setSuccessMessage(null);
      try {
        const updatedAssets = await onApply(tags);
        setSelectedTags([]);
        setDraft('');
        setSuccessMessage(`Теги добавлены к ${updatedAssets} фото`);
      } finally {
        setIsSubmitting(false);
      }
    },
    [draft, isSubmitting, onApply, selectedTags],
  );

  const emptyText = useMemo(() => {
    if (isLoading) return 'Загружаем рекомендации…';
    if (isFetchFailed) return 'Не удалось загрузить рекомендации тегов.';
    return 'Рекомендации появятся после разметки других партий.';
  }, [isFetchFailed, isLoading]);

  return (
    <div className={styles.root}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="import-batch-tags-input">
          Добавьте теги через запятую или Enter
        </label>
        <div className={styles.inputRow}>
          <input
            id="import-batch-tags-input"
            className={styles.input}
            type="text"
            value={draft}
            placeholder="портрет, студия, собака"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && draft.trim()) {
                event.preventDefault();
                commitDraft();
              }
            }}
          />
          <button
            type="button"
            className={styles.addButton}
            onClick={commitDraft}
            disabled={!draft.trim()}
          >
            Добавить
          </button>
        </div>

        {selectedTags.length > 0 ? (
          <div className={styles.selectedList} aria-label="Выбранные теги">
            {selectedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={styles.selectedChip}
                onClick={() => removeTag(tag)}
                title="Убрать тег"
              >
                {tag}
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        ) : null}

        <button type="submit" className={styles.submitButton} disabled={!canSubmit}>
          {isSubmitting ? 'Добавляем…' : 'Добавить ко всем фото'}
        </button>
      </form>

      {applyError ? <p className={styles.error}>{applyError}</p> : null}
      {successMessage ? <p className={styles.success}>{successMessage}</p> : null}

      <div className={styles.suggestions}>
        <SuggestionGroup
          title="Последние"
          items={groups.recent}
          onPick={(tag) => addTags([tag])}
        />
        <SuggestionGroup
          title="Популярные"
          items={groups.popular}
          onPick={(tag) => addTags([tag])}
        />
        <SuggestionGroup
          title="Из похожих партий"
          items={groups.similar_batches}
          onPick={(tag) => addTags([tag])}
        />
        {!hasSuggestions ? <p className={styles.muted}>{emptyText}</p> : null}
      </div>
    </div>
  );
}
