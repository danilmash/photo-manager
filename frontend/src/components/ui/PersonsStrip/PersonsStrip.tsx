import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import pageLayout from '../../../styles/page-layout.module.css';
import styles from './PersonsStrip.module.css';
import { listPersons, type PersonListItem } from '../../../api/persons';

function displayName(name: string) {
  const t = name.trim();
  return t.length > 0 ? t : 'Без имени';
}

export default function PersonsStrip() {
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
          persons.map((p) => (
            <div key={p.id} className={styles.item}>
              <div className={styles.avatar}>
                {p.cover_url ? (
                  <img src={p.cover_url} alt="" loading="lazy" decoding="async" />
                ) : (
                  <User className={styles['placeholder-icon']} aria-hidden />
                )}
              </div>
              <span className={styles.name} title={displayName(p.name)}>
                {displayName(p.name)}
              </span>
              <span className={styles.count}>{p.photos_count} фото</span>
            </div>
          ))}
      </div>
    </section>
  );
}
