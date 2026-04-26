import { useMemo, useState } from 'react';
import { Search, UserPlus, X } from 'lucide-react';

import Button from '../Button';
import styles from './PersonPicker.module.css';
import type { PersonListItem } from '../../../api/persons';

interface PersonPickerProps {
  persons: PersonListItem[];
  currentPersonId: string | null;
  currentPersonName: string | null;
  isLoading?: boolean;
  disabled?: boolean;
  onSelectPerson: (person: PersonListItem) => Promise<void> | void;
  onCreatePerson: (name: string) => Promise<void> | void;
  onClear: () => Promise<void> | void;
}

function getDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Без имени';
}

export default function PersonPicker({
  persons,
  currentPersonId,
  currentPersonName,
  isLoading = false,
  disabled = false,
  onSelectPerson,
  onCreatePerson,
  onClear,
}: PersonPickerProps) {
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();

  const filteredPersons = useMemo(() => {
    if (!normalizedQuery) return [];

    return persons
      .filter((person) => {
        if (person.id === currentPersonId) return false;
        return getDisplayName(person.name).toLowerCase().includes(normalizedQuery);
      })
      .slice(0, 6);
  }, [currentPersonId, normalizedQuery, persons]);

  const hasExactMatch = useMemo(() => {
    if (!normalizedQuery) return false;

    return persons.some(
      (person) => getDisplayName(person.name).toLowerCase() === normalizedQuery,
    );
  }, [normalizedQuery, persons]);

  const canCreate = normalizedQuery.length > 0 && !hasExactMatch;

  const handleSelect = (person: PersonListItem) => {
    if (disabled) return;

    Promise.resolve(onSelectPerson(person))
      .then(() => setQuery(''))
      .catch(() => {});
  };

  const handleCreate = () => {
    const trimmed = query.trim();
    if (disabled || trimmed.length === 0) return;

    Promise.resolve(onCreatePerson(trimmed))
      .then(() => setQuery(''))
      .catch(() => {});
  };

  const showResults = normalizedQuery.length > 0;

  return (
    <div className={styles.root}>
      <div className={styles['current-row']}>
        <div className={styles['current-copy']}>
          <span className={styles.label}>Текущая персона</span>
          {currentPersonId ? (
            <span className={styles.value}>{getDisplayName(currentPersonName)}</span>
          ) : (
            <span className={styles.empty}>Не выбрана</span>
          )}
        </div>

        {currentPersonId && (
          <Button
            color="muted"
            variant="ghost"
            size="sm"
            disabled={disabled}
            icon={<X />}
            onClick={onClear}
          >
            Снять
          </Button>
        )}
      </div>

      <div className={styles.search}>
        <Search className={styles.icon} aria-hidden />
        <input
          className={styles.input}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти или создать персону"
          disabled={disabled}
        />
      </div>

      {showResults ? (
        <div className={styles.results}>
          {filteredPersons.length > 0 && (
            <div className={styles['results-group']}>
              <span className={styles.label}>Найденные персоны</span>
              <div className={styles['results-list']}>
                {filteredPersons.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className={styles['result-button']}
                    onClick={() => handleSelect(person)}
                    disabled={disabled}
                  >
                    <span className={styles['result-name']}>
                      {getDisplayName(person.name)}
                    </span>
                    <span className={styles['result-count']}>
                      {person.photos_count} фото
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {canCreate && (
            <button
              type="button"
              className={styles['create-button']}
              onClick={handleCreate}
              disabled={disabled}
            >
              <UserPlus aria-hidden />
              <span>Создать «{query.trim()}»</span>
            </button>
          )}

          {!canCreate && filteredPersons.length === 0 && (
            <div className={styles.hint}>Совпадений не найдено</div>
          )}
        </div>
      ) : (
        <div className={styles.hint}>
          {isLoading
            ? 'Загружаем список персон...'
            : 'Введите имя, чтобы найти существующую персону или создать новую.'}
        </div>
      )}
    </div>
  );
}
