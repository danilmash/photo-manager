import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Search, X } from 'lucide-react';

import SemanticSearchInput from '../../../ui/SemanticSearchInput';
import styles from './SemanticSearchExpand.module.css';

interface SemanticSearchExpandContextValue {
  activeQuery: string;
  isLoading: boolean;
  isMobile: boolean;
  expanded: boolean;
  showPanel: boolean;
  open: () => void;
  close: () => void;
  onSearch: (query: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

const SemanticSearchExpandContext = createContext<SemanticSearchExpandContextValue | null>(null);

function useSemanticSearchExpand() {
  const context = useContext(SemanticSearchExpandContext);
  if (!context) {
    throw new Error('SemanticSearchExpand components must be used within SemanticSearchExpand.Root');
  }
  return context;
}

export interface SemanticSearchExpandRootProps {
  activeQuery: string;
  isLoading?: boolean;
  isMobile: boolean;
  onSearch: (query: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
  children: ReactNode;
}

function Root({
  activeQuery,
  isLoading = false,
  isMobile,
  onSearch,
  onClear,
  children,
}: SemanticSearchExpandRootProps) {
  const [expanded, setExpanded] = useState(Boolean(activeQuery));
  const showPanel = expanded || Boolean(activeQuery);

  useEffect(() => {
    if (activeQuery) {
      setExpanded(true);
    }
  }, [activeQuery]);

  useEffect(() => {
    if (!showPanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || activeQuery) return;
      setExpanded(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [activeQuery, showPanel]);

  const close = useCallback(() => {
    if (activeQuery) {
      void onClear();
    }
    setExpanded(false);
  }, [activeQuery, onClear]);

  const handleClear = useCallback(async () => {
    await onClear();
    setExpanded(false);
  }, [onClear]);

  const value = useMemo(
    () => ({
      activeQuery,
      isLoading,
      isMobile,
      expanded,
      showPanel,
      open: () => setExpanded(true),
      close,
      onSearch,
      onClear: handleClear,
    }),
    [activeQuery, close, expanded, handleClear, isLoading, isMobile, onSearch, showPanel],
  );

  return (
    <SemanticSearchExpandContext.Provider value={value}>
      {children}
    </SemanticSearchExpandContext.Provider>
  );
}

function Trigger() {
  const { showPanel, open } = useSemanticSearchExpand();

  if (showPanel) return null;

  return (
    <button
      type="button"
      className={styles.trigger}
      onClick={open}
      aria-label="Открыть умный поиск"
    >
      <Search size={20} aria-hidden />
    </button>
  );
}

function SearchPanel({ className }: { className?: string }) {
  const { activeQuery, isLoading, showPanel, close, onSearch, onClear } = useSemanticSearchExpand();

  if (!showPanel) return null;

  return (
    <div className={`${styles.panel} ${className ?? ''}`}>
      <SemanticSearchInput
        className={styles.input}
        activeQuery={activeQuery}
        isLoading={isLoading}
        autoFocus
        onSearch={onSearch}
        onClear={onClear}
      />
      {!activeQuery ? (
        <button type="button" className={styles.closeBtn} onClick={close} aria-label="Закрыть поиск">
          <X size={18} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function InlinePanel() {
  const { isMobile } = useSemanticSearchExpand();
  if (isMobile) return null;
  return <SearchPanel className={styles.inlinePanel} />;
}

function BelowPanel() {
  const { isMobile } = useSemanticSearchExpand();
  if (!isMobile) return null;
  return <SearchPanel className={styles.belowPanel} />;
}

const SemanticSearchExpand = {
  Root,
  Trigger,
  InlinePanel,
  BelowPanel,
};

export default SemanticSearchExpand;
