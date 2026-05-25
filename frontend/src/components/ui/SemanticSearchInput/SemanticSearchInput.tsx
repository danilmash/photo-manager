import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

import styles from './SemanticSearchInput.module.css';

interface SemanticSearchInputProps {
  activeQuery: string;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onSearch: (query: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

export default function SemanticSearchInput({
  activeQuery,
  isLoading = false,
  placeholder = 'Умный поиск: собака, закат, машина...',
  className,
  autoFocus = false,
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
      <input
        className={styles.input}
        value={draft}
        autoFocus={autoFocus}
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
      <button
        type="submit"
        className={styles.searchButton}
        disabled={isLoading}
        aria-label="Найти"
      >
        <Search size={18} aria-hidden />
      </button>
    </form>
  );
}
