import type { PhotoRecipe } from '../../../api/recipe';

export type PhotoEditGroupId = 'light' | 'color' | 'details' | 'rotation';

export interface PhotoEditGroup {
  id: PhotoEditGroupId;
  label: string;
}

export interface PhotoEditControl {
  key: keyof PhotoRecipe;
  label: string;
  group: PhotoEditGroupId;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit?: string;
  getValue: (recipe: PhotoRecipe) => number;
  patch: (recipe: PhotoRecipe, value: number) => PhotoRecipe;
}

export const PHOTO_EDIT_GROUPS: PhotoEditGroup[] = [
  { id: 'light', label: 'Свет' },
  { id: 'color', label: 'Цвет' },
  { id: 'details', label: 'Детали' },
  { id: 'rotation', label: 'Поворот' },
];

function control(
  key: keyof PhotoRecipe,
  label: string,
  group: PhotoEditGroupId,
  min: number,
  max: number,
  step: number,
  defaultValue: number,
  unit?: string,
): PhotoEditControl {
  return {
    key,
    label,
    group,
    min,
    max,
    step,
    defaultValue,
    unit,
    getValue: (recipe) => recipe[key] as number,
    patch: (recipe, value) => ({ ...recipe, [key]: value }),
  };
}

export const PHOTO_EDIT_CONTROLS: PhotoEditControl[] = [
  control('exposure', 'Экспозиция', 'light', -100, 100, 1, 0),
  control('contrast', 'Контраст', 'light', -100, 100, 1, 0),
  control('highlights', 'Светлые участки', 'light', -100, 100, 1, 0),
  control('shadows', 'Тени', 'light', -100, 100, 1, 0),
  control('temperature', 'Температура', 'color', -100, 100, 1, 0),
  control('tint', 'Оттенок', 'color', -100, 100, 1, 0),
  control('saturation', 'Насыщенность', 'color', -100, 100, 1, 0),
  control('sharpness', 'Резкость', 'details', 0, 100, 1, 0),
  control('vignette', 'Виньетирование', 'details', 0, 100, 1, 0),
  control('rotation_degrees', 'Поворот', 'rotation', -180, 180, 1, 0, '°'),
];

export function getControlsForGroup(groupId: PhotoEditGroupId): PhotoEditControl[] {
  return PHOTO_EDIT_CONTROLS.filter((item) => item.group === groupId);
}

export function getControlByKey(key: keyof PhotoRecipe): PhotoEditControl | undefined {
  return PHOTO_EDIT_CONTROLS.find((item) => item.key === key);
}
