import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

import Button from '../Button';
import styles from './SemanticSearchInput.module.css';

interface SemanticSearchInputProps {
  activeQuery: string;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  onSearch: (query: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

export default function SemanticSearchInput({
  activeQuery,
  isLoading = false,
  placeholder = 'Умный поиск: собака, закат, машина...',
  className,
  onSearch,
  onClear,
}: SemanticSearchInputProps) {
  const [draft, setDraft] = useState(activeQuery);

  useEffect(() => {
    setDraft(activeQuery);
  }, [activeQuery]);

  return (
    <form
      className={`${styles.root} ${className ?? ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        void onSearch(draft);
      }}
    >
      <Search className={styles.icon} aria-hidden />
      <input
        className={styles.input}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label="Умный поиск по фотографиям"
      />
      {activeQuery ? (
        <button
          type="button"
          className={styles.clear}
          onClick={() => {
            setDraft('');
            void onClear();
          }}
          aria-label="Сбросить поиск"
        >
          <X size={16} aria-hidden />
        </button>
      ) : null}
      <Button color="primary" variant="filled" size="m" disabled={isLoading}>
        Найти
      </Button>
    </form>
  );
}
