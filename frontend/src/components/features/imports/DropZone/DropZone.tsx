import { useCallback, useRef, useState } from 'react';

import styles from './DropZone.module.css';

export interface DropZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  accept?: string;
  hint?: string;
}

export default function DropZone({
  onFiles,
  disabled = false,
  accept = 'image/*',
  hint = 'Нажмите или перетащите файлы',
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (disabled) return;
      if (!fileList || fileList.length === 0) return;
      onFiles(Array.from(fileList));
    },
    [onFiles, disabled],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) e.dataTransfer.dropEffect = 'copy';
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragActive(false);
    }
  };

  return (
    <button
      type="button"
      className={[
        styles['drop-zone'],
        dragActive ? styles['drop-zone-active'] : '',
        disabled ? styles['drop-zone-disabled'] : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => !disabled && inputRef.current?.click()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      disabled={disabled}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className={styles['hidden-input']}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <span className={styles['drop-hint']}>{hint}</span>
    </button>
  );
}
