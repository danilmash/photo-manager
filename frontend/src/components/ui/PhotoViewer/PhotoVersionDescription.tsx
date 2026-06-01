import { useEffect, useState } from 'react';
import { updateAssetVersionDescription } from '../../../api/assets';
import Button from '../Button';
import styles from './PhotoVersionDescription.module.css';

const MAX_LENGTH = 2000;

interface PhotoVersionDescriptionProps {
  assetId: string;
  versionId: string | null;
  description: string | null;
  disabled?: boolean;
  onSaved?: (description: string | null) => void;
}

export default function PhotoVersionDescription({
  assetId,
  versionId,
  description,
  disabled = false,
  onSaved,
}: PhotoVersionDescriptionProps) {
  const [draft, setDraft] = useState(description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(description ?? '');
    setError(null);
  }, [description, versionId]);

  const trimmed = draft.trim();
  const savedTrimmed = (description ?? '').trim();
  const dirty = trimmed !== savedTrimmed;

  const handleSave = async () => {
    if (!versionId || saving || disabled) return;

    setSaving(true);
    setError(null);
    try {
      const next = trimmed.length > 0 ? trimmed.slice(0, MAX_LENGTH) : null;
      const response = await updateAssetVersionDescription(assetId, versionId, next);
      setDraft(response.description ?? '');
      onSaved?.(response.description);
    } catch {
      setError('Не удалось сохранить описание');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.root}>
      <label className={styles.label} htmlFor="photo-version-description">
        Описание версии
      </label>
      <textarea
        id="photo-version-description"
        className={styles.textarea}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Заметка к этой обработке…"
        maxLength={MAX_LENGTH}
        disabled={disabled || !versionId || saving}
      />
      <div className={styles.actions}>
        <Button
          color="primary"
          size="sm"
          disabled={disabled || !versionId || saving || !dirty}
          onClick={() => {
            void handleSave();
          }}
        >
          {saving ? 'Сохранение…' : 'Сохранить'}
        </Button>
        <span className={styles.hint}>
          {draft.length}/{MAX_LENGTH}
        </span>
      </div>
      {error ? <div className={styles.error}>{error}</div> : null}
    </div>
  );
}
