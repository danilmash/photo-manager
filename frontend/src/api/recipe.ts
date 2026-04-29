/** Зеркало backend DEFAULT_PHOTO_RECIPE / normalize_recipe для типобезопасных форм и превью. */

export interface PhotoRecipe {
  crop: { x: number; y: number; w: number; h: number };
  rotation_degrees: number;
  flip_horizontal: boolean;
  flip_vertical: boolean;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  saturation: number;
  sharpness: number;
  vignette: number;
}

export const DEFAULT_PHOTO_RECIPE: PhotoRecipe = {
  crop: { x: 0, y: 0, w: 1, h: 1 },
  rotation_degrees: 0,
  flip_horizontal: false,
  flip_vertical: false,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  sharpness: 0,
  vignette: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function coerceFloat(value: unknown, defaultVal: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return defaultVal;
}

function coerceBool(value: unknown, defaultVal: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  if (typeof value === 'number') return Boolean(value);
  return defaultVal;
}

/** Приводит произвольный объект версии к рецепту с допустимыми пределами. */
export function normalizeRecipe(raw: unknown): PhotoRecipe {
  const base: PhotoRecipe = {
    ...DEFAULT_PHOTO_RECIPE,
    crop: { ...DEFAULT_PHOTO_RECIPE.crop },
  };
  if (!raw || typeof raw !== 'object') return base;

  const recipe = raw as Record<string, unknown>;
  const crop = recipe.crop;
  if (crop && typeof crop === 'object') {
    const c = crop as Record<string, unknown>;
    let x = clamp(coerceFloat(c.x, 0), 0, 1);
    let y = clamp(coerceFloat(c.y, 0), 0, 1);
    let w = clamp(coerceFloat(c.w, 1), 0, 1 - x);
    let h = clamp(coerceFloat(c.h, 1), 0, 1 - y);
    base.crop = { x, y, w, h };
  }

  base.rotation_degrees = clamp(coerceFloat(recipe.rotation_degrees, 0), -180, 180);
  base.flip_horizontal = coerceBool(recipe.flip_horizontal, false);
  base.flip_vertical = coerceBool(recipe.flip_vertical, false);

  for (const field of [
    'exposure',
    'contrast',
    'highlights',
    'shadows',
    'temperature',
    'tint',
    'saturation',
  ] as const) {
    base[field] = clamp(coerceFloat(recipe[field], 0), -100, 100);
  }

  base.sharpness = clamp(coerceFloat(recipe.sharpness, 0), 0, 100);
  base.vignette = clamp(coerceFloat(recipe.vignette, 0), 0, 100);

  return base;
}
