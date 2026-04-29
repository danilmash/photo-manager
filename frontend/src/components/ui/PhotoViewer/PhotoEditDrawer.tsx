import type { PhotoRecipe } from '../../../api/recipe';
import Button from '../Button';
import PhotoEditSlider from '../PhotoEditSlider';
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
            <PhotoEditSlider
              label="Экспозиция"
              value={recipe.exposure}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, exposure: v })}
            />
            <PhotoEditSlider
              label="Контраст"
              value={recipe.contrast}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, contrast: v })}
            />
            <PhotoEditSlider
              label="Светлые участки"
              value={recipe.highlights}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, highlights: v })}
            />
            <PhotoEditSlider
              label="Тени"
              value={recipe.shadows}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, shadows: v })}
            />
            <PhotoEditSlider
              label="Температура"
              value={recipe.temperature}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, temperature: v })}
            />
            <PhotoEditSlider
              label="Оттенок"
              value={recipe.tint}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, tint: v })}
            />
            <PhotoEditSlider
              label="Насыщенность"
              value={recipe.saturation}
              min={-100}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, saturation: v })}
            />
            <PhotoEditSlider
              label="Резкость"
              value={recipe.sharpness}
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, sharpness: v })}
            />
            <PhotoEditSlider
              label="Виньетирование"
              value={recipe.vignette}
              min={0}
              max={100}
              step={1}
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, vignette: v })}
            />
            <PhotoEditSlider
              label="Поворот"
              value={recipe.rotation_degrees}
              min={-180}
              max={180}
              step={1}
              unit="°"
              defaultValue={0}
              disabled={locked}
              onChange={(v) => onRecipeChange({ ...recipe, rotation_degrees: v })}
            />
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
