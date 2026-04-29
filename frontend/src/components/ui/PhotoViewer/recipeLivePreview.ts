import type { CSSProperties } from 'react';

import type { PhotoRecipe } from '../../../api/recipe';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Как на бэкенде после normalize_recipe: множитель яркости (modulate brightness). */
function exposureMultiplier(exp: number): number {
  return Math.max(0.06, (100 + clamp(exp, -100, 100)) / 100);
}

/** Множитель насыщенности (modulate saturation). */
function saturationMultiplier(sat: number): number {
  return Math.max(0.06, (100 + clamp(sat, -100, 100)) / 100);
}

/**
 * Живое превью при движении ползунков — только приближение к пайплайну бэкенда.
 *
 * На сервере (`tasks._apply_recipe`): flip → rotate → crop → **modulate**(brightness=100+exposure,
 * saturation=100+saturation) → **brightness_contrast**(contrast) → sigmoidal **shadows
 * **highlights** → RGB-сдвиги **temperature** / **tint** → **sharpen** → **vignette**.
 *
 * Здесь CSS filter/contrast/saturate/hue не эквивалентны ImageMagick (особенно sigmoidal_contrast и
 * канальные сдвиги). Поэтому:
 * - экспозиция и насыщенность считаются **мультипликативным отношением** draft/baseline — как отношение
 *   множителей modulate (это главная поправка к прежней линейной формуле + brightness%);
 * - контраст — линейная дельта к CSS contrast % (wand brightness_contrast всё равно другая кривая);
 * - тени/свет — очень грубые поправки (sigmoid не воспроизводится filter());
 * - температура/оттенок — ослабленный hue-rotate (каналы RGB на бэкенде дают другой вид);
 * - резкость смешана с контрастом только как подсказка;
 * - превью после сохранения всегда точнее (пересчёт на сервере + JPEG).
 */
export function recipeLivePreviewDeltaStyle(
  draft: PhotoRecipe,
  baseline: PhotoRecipe,
): CSSProperties {
  const dContrast = draft.contrast - baseline.contrast;
  const dHi = draft.highlights - baseline.highlights;
  const dSh = draft.shadows - baseline.shadows;
  const dTemp = draft.temperature - baseline.temperature;
  const dTint = draft.tint - baseline.tint;
  const dSharp = draft.sharpness - baseline.sharpness;
  const dRot = draft.rotation_degrees - baseline.rotation_degrees;

  /* Яркость и насыщение: отношение множителей modulate — ближе к ImageMagick modulate(). */
  let brightnessPct =
    100 *
    (exposureMultiplier(draft.exposure) / exposureMultiplier(baseline.exposure));

  let saturatePct =
    100 *
    (saturationMultiplier(draft.saturation) /
      saturationMultiplier(baseline.saturation));

  /* Контраст: wand получает число напрямую; CSS contrast — другая модель — только направление дельты. */
  const contrastPct = clamp(100 + dContrast + dSharp * 0.12, 25, 265);

  /*
   * Тени/подсветки на бэкенде — две sigmoidal_contrast по разным midpoint;
   * здесь только лёгкая намётка (иначе смешение с экспозицией давало явный разъезд с сохранением).
   */
  brightnessPct *= clamp(1 + dHi * 0.0016 - dSh * 0.0018, 0.82, 1.22);

  brightnessPct = clamp(brightnessPct, 22, 295);
  saturatePct = clamp(saturatePct, 15, 295);

  /*
   * Temperature/tint на бэкенде — сдвиги RGB, не только hue.
   * hue-rotate даёт другой вид — коэффициенты уменьшены по смыслу «меньше обмана».
   */
  const hueDeg = clamp(dTemp * 0.22 + dTint * 0.22, -42, 42);

  const filter = [
    `brightness(${brightnessPct}%)`,
    `contrast(${contrastPct}%)`,
    `saturate(${saturatePct}%)`,
    `hue-rotate(${hueDeg}deg)`,
  ].join(' ');

  let transform = `rotate(${dRot}deg)`;
  if (draft.flip_horizontal !== baseline.flip_horizontal) transform += ' scaleX(-1)';
  if (draft.flip_vertical !== baseline.flip_vertical) transform += ' scaleY(-1)';

  return {
    filter,
    transform,
    transformOrigin: 'center center',
  };
}

/** Заглушка под прирост виньетки — wand vignette blur ≠ inset shadow. */
export function recipeVignetteDeltaOverlayStyle(
  draft: PhotoRecipe,
  baseline: PhotoRecipe,
): CSSProperties | null {
  const dv = draft.vignette - baseline.vignette;
  if (dv < 0.5) return null;
  const amount = dv / 100;
  return {
    pointerEvents: 'none',
    position: 'absolute',
    inset: 0,
    borderRadius: 12,
    boxShadow: `inset 0 0 ${40 + amount * 180}px rgba(0, 0, 0, ${0.12 + amount * 0.58})`,
    zIndex: 1,
  };
}
