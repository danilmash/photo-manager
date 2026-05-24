import { useEffect, useState } from 'react';

import Button from '../../../ui/Button';
import Modal from '../../../ui/Modal';

import styles from './FolderNameModal.module.css';

export interface FolderNameModalProps {
  isOpen: boolean;
  title: string;
  initialName?: string;
  confirmLabel: string;
  isSubmitting?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
}

export default function FolderNameModal({
  isOpen,
  title,
  initialName = '',
  confirmLabel,
  isSubmitting = false,
  error = null,
  onClose,
  onSubmit,
}: FolderNameModalProps) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
    }
  }, [initialName, isOpen]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isSubmitting) return;
    void onSubmit(trimmed);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} dark={false}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <h2 className={styles.title}>{title}</h2>
        <label className={styles.label} htmlFor="folder-name-input">
          Название
        </label>
        <input
          id="folder-name-input"
          className={styles.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={256}
          autoFocus
          disabled={isSubmitting}
        />
        {error ? <div className={styles.error}>{error}</div> : null}
        <div className={styles.actions}>
          <Button color="secondary" variant="outline" type="button" onClick={onClose} disabled={isSubmitting}>
            Отмена
          </Button>
          <Button color="primary" variant="filled" type="submit" disabled={isSubmitting || !name.trim()}>
            {isSubmitting ? 'Сохранение…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
