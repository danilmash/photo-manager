import type { PhotoRecipe } from '../../../api/recipe';
import Button from '../Button';
import PhotoEditSlider from '../PhotoEditSlider';
import { PHOTO_EDIT_CONTROLS } from './photoEditControls';
import styles from './PhotoEditDrawer.module.css';

export interface PhotoEditDrawerProps {
  recipe: PhotoRecipe;
  onRecipeChange: (recipe: PhotoRecipe) => void;
  onApply: () => void | Promise<void>;
  applying: boolean;
  disabled?: boolean;
}

export default function PhotoEditDrawer({
  recipe,
  onRecipeChange,
  onApply,
  applying,
  disabled = false,
}: PhotoEditDrawerProps) {
  const locked = disabled || applying;

  return (
    <div className={styles.root}>
      <div className={styles.scroll}>
        {disabled ? (
          <p className={styles.hint}>Нет данных версии для редактирования.</p>
        ) : (
          <div className={styles.sliders}>
            {PHOTO_EDIT_CONTROLS.map((control) => (
              <PhotoEditSlider
                key={control.key}
                label={control.label}
                value={control.getValue(recipe)}
                min={control.min}
                max={control.max}
                step={control.step}
                defaultValue={control.defaultValue}
                unit={control.unit}
                disabled={locked}
                onChange={(value) => onRecipeChange(control.patch(recipe, value))}
              />
            ))}
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <Button
          color="primary"
          variant="filled"
          size="m"
          disabled={disabled || applying}
          onClick={() => void onApply()}
        >
          {applying ? 'Сохранение…' : 'Применить'}
        </Button>
        <p className={styles.note}>
          Будет создана новая версия с этими настройками и заново построены превью.
        </p>
      </div>
    </div>
  );
}
