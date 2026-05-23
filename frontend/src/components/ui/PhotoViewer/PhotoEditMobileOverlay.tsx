import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

import type { PhotoRecipe } from '../../../api/recipe';
import Button from '../Button';
import PhotoEditSlider from '../PhotoEditSlider';
import {
  getControlsForGroup,
  PHOTO_EDIT_GROUPS,
  type PhotoEditControl,
  type PhotoEditGroupId,
} from './photoEditControls';
import styles from './PhotoEditMobileOverlay.module.css';

export interface PhotoEditMobileOverlayProps {
  recipe: PhotoRecipe;
  onRecipeChange: (recipe: PhotoRecipe) => void;
  onCancel: () => void;
  onApply: () => void | Promise<void>;
  applying: boolean;
  disabled?: boolean;
}

export default function PhotoEditMobileOverlay({
  recipe,
  onRecipeChange,
  onCancel,
  onApply,
  applying,
  disabled = false,
}: PhotoEditMobileOverlayProps) {
  const [activeGroupId, setActiveGroupId] = useState<PhotoEditGroupId>('light');
  const [activeControlKey, setActiveControlKey] = useState<PhotoEditControl['key']>(
    'exposure',
  );

  const locked = disabled || applying;

  const groupControls = useMemo(
    () => getControlsForGroup(activeGroupId),
    [activeGroupId],
  );

  const activeControl = useMemo(() => {
    const fromGroup = groupControls.find((item) => item.key === activeControlKey);
    return fromGroup ?? groupControls[0] ?? null;
  }, [activeControlKey, groupControls]);

  const activeIndex = activeControl
    ? groupControls.findIndex((item) => item.key === activeControl.key)
    : -1;

  const handleGroupChange = useCallback((groupId: PhotoEditGroupId) => {
    const controls = getControlsForGroup(groupId);
    setActiveGroupId(groupId);
    setActiveControlKey(controls[0]?.key ?? 'exposure');
  }, []);

  const handlePreviousControl = useCallback(() => {
    if (groupControls.length === 0) return;
    const nextIndex =
      activeIndex <= 0 ? groupControls.length - 1 : activeIndex - 1;
    setActiveControlKey(groupControls[nextIndex].key);
  }, [activeIndex, groupControls]);

  const handleNextControl = useCallback(() => {
    if (groupControls.length === 0) return;
    const nextIndex =
      activeIndex >= groupControls.length - 1 ? 0 : activeIndex + 1;
    setActiveControlKey(groupControls[nextIndex].key);
  }, [activeIndex, groupControls]);

  const handleResetActive = useCallback(() => {
    if (!activeControl || locked) return;
    onRecipeChange(activeControl.patch(recipe, activeControl.defaultValue));
  }, [activeControl, locked, onRecipeChange, recipe]);

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.headerAction}
          disabled={applying}
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          type="button"
          className={`${styles.headerAction} ${styles.headerActionPrimary}`}
          disabled={disabled || applying}
          onClick={() => void onApply()}
        >
          {applying ? 'Сохранение…' : 'Готово'}
        </button>
      </header>

      <div className={styles.panel}>
        {disabled ? (
          <p className={styles.hint}>Нет данных версии для редактирования.</p>
        ) : activeControl ? (
          <>
            <PhotoEditSlider
              variant="compact"
              label={activeControl.label}
              value={activeControl.getValue(recipe)}
              min={activeControl.min}
              max={activeControl.max}
              step={activeControl.step}
              defaultValue={activeControl.defaultValue}
              unit={activeControl.unit}
              disabled={locked}
              onChange={(value) => onRecipeChange(activeControl.patch(recipe, value))}
            />

            {groupControls.length > 1 ? (
              <div className={styles.paramNav}>
                <Button
                  color="muted"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  onClick={handlePreviousControl}
                  icon={<ChevronLeft />}
                  aria-label="Предыдущий параметр"
                />
                <span className={styles.paramNavLabel}>{activeControl.label}</span>
                <Button
                  color="muted"
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  onClick={handleNextControl}
                  icon={<ChevronRight />}
                  aria-label="Следующий параметр"
                />
              </div>
            ) : null}

            <div className={styles.resetRow}>
              <Button
                color="muted"
                variant="ghost"
                size="sm"
                disabled={
                  locked ||
                  activeControl.getValue(recipe) === activeControl.defaultValue
                }
                onClick={handleResetActive}
                icon={<RotateCcw />}
              >
                Сброс
              </Button>
            </div>
          </>
        ) : null}

        <div className={styles.groups} role="tablist" aria-label="Группы настроек">
          {PHOTO_EDIT_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={activeGroupId === group.id}
              className={`${styles.groupTab} ${
                activeGroupId === group.id ? styles.groupTabActive : ''
              }`}
              disabled={locked}
              onClick={() => handleGroupChange(group.id)}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
