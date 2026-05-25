import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import pageLayout from '../../../styles/page-layout.module.css';
import styles from './PersonsStrip.module.css';
import { listPersons, type PersonListItem } from '../../../api/persons';

function displayName(name: string) {
  const t = name.trim();
  return t.length > 0 ? t : 'Без имени';
}

export interface PersonsStripProps {
  selectedPersonId?: string | null;
  onPersonSelect?: (person: PersonListItem) => void;
}

export default function PersonsStrip({
  selectedPersonId = null,
  onPersonSelect,
}: PersonsStripProps) {
  const [persons, setPersons] = useState<PersonListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await listPersons();
        if (!cancelled) {
          setPersons(data);
        }
      } catch {
        if (!cancelled) {
          setError('Не удалось загрузить персоны');
          setPersons([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isLoading && !error && persons.length === 0) {
    return null;
  }

  return (
    <section className={pageLayout.section} aria-label="Персоны">
      <h2 className={pageLayout['section-heading']}>Люди</h2>
      {error && <p className={pageLayout['alert-inline']}>{error}</p>}
      <div className={styles.strip}>
        {isLoading &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={styles.item}>
              <div className={styles['skeleton-avatar']} aria-hidden />
              <div className={styles['skeleton-line']} aria-hidden />
            </div>
          ))}
        {!isLoading &&
          persons.map((p) => {
            const isSelected = selectedPersonId === p.id;
            const name = displayName(p.name);
            return (
              <button
                key={p.id}
                type="button"
                className={`${styles.item} ${styles.itemButton} ${isSelected ? styles.itemSelected : ''}`}
                onClick={() => onPersonSelect?.(p)}
                aria-pressed={isSelected}
                aria-label={`${isSelected ? 'Сбросить фильтр' : 'Показать фото'}: ${name}`}
              >
                <div className={styles.avatar}>
                  {p.cover_url ? (
                    <img src={p.cover_url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <User className={styles['placeholder-icon']} aria-hidden />
                  )}
                </div>
                <span className={styles.name} title={name}>
                  {name}
                </span>
                <span className={styles.count}>{p.photos_count} фото</span>
              </button>
            );
          })}
      </div>
    </section>
  );
}
