import type { IMagickImage } from '@imagemagick/magick-wasm';
import magickWasmUrl from '@imagemagick/magick-wasm/magick.wasm?url';

import type { PhotoRecipe } from '../../../api/recipe';

const PREVIEW_LONG_SIDE = 1600;
const JPEG_QUALITY = 88;

type MagickModule = typeof import('@imagemagick/magick-wasm');

let initPromise: Promise<MagickModule> | null = null;
const sourceBytesCache = new Map<string, Promise<Uint8Array>>();

function ensureMagickReady(): Promise<MagickModule> {
  if (!initPromise) {
    initPromise = Promise.all([
      import('@imagemagick/magick-wasm'),
      fetch(magickWasmUrl).then((response) => {
        if (!response.ok) {
          throw new Error(`Не удалось загрузить ImageMagick WASM: ${response.status}`);
        }
        return response.arrayBuffer();
      }),
    ]).then(async ([magick, buffer]) => {
      await magick.initializeImageMagick(new Uint8Array(buffer));
      return magick;
    });
  }
  return initPromise;
}

function sourceBytes(url: string): Promise<Uint8Array> {
  const cached = sourceBytesCache.get(url);
  if (cached) return cached;

  const request = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Не удалось загрузить исходное изображение: ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => new Uint8Array(buffer));

  sourceBytesCache.set(url, request);
  return request;
}

function applyChannelShift(
  image: IMagickImage,
  channel: number,
  delta: number,
  magick: MagickModule,
): void {
  if (delta > 0) {
    image.evaluate(channel, magick.EvaluateOperator.Add, delta);
  } else if (delta < 0) {
    image.evaluate(channel, magick.EvaluateOperator.Subtract, Math.abs(delta));
  }
}

function clampImage(image: IMagickImage): void {
  const maybeClamp = image as IMagickImage & { clamp?: () => void };
  maybeClamp.clamp?.();
}

function applyRecipe(image: IMagickImage, recipe: PhotoRecipe, magick: MagickModule): void {
  if (recipe.flip_horizontal) image.flop();
  if (recipe.flip_vertical) image.flip();

  const rotationDegrees = Number(recipe.rotation_degrees);
  if (Math.abs(rotationDegrees) > 0.001) {
    image.backgroundColor = magick.MagickColors.Black;
    image.rotate(rotationDegrees);
  }

  const crop = recipe.crop;
  if (crop.x > 0 || crop.y > 0 || crop.w < 1 || crop.h < 1) {
    const left = Math.max(0, Math.min(Math.round(image.width * crop.x), Math.max(image.width - 1, 0)));
    const top = Math.max(0, Math.min(Math.round(image.height * crop.y), Math.max(image.height - 1, 0)));
    const width = Math.max(1, Math.min(Math.round(image.width * crop.w), image.width - left));
    const height = Math.max(1, Math.min(Math.round(image.height * crop.h), image.height - top));
    image.crop(new magick.MagickGeometry(left, top, width, height));
    image.resetPage();
  }

  const exposure = Number(recipe.exposure);
  const saturation = Number(recipe.saturation);
  if (exposure !== 0 || saturation !== 0) {
    image.modulate(
      new magick.Percentage(Math.max(0, 100 + exposure)),
      new magick.Percentage(Math.max(0, 100 + saturation)),
      new magick.Percentage(100),
    );
  }

  const contrast = Number(recipe.contrast);
  if (contrast !== 0) {
    image.brightnessContrast(new magick.Percentage(0), new magick.Percentage(contrast));
  }

  const quantumRange = magick.Quantum.max;

  const shadows = Number(recipe.shadows);
  if (shadows !== 0) {
    image.sigmoidalContrast(
      shadows < 0 ? -Math.max(0.1, Math.abs(shadows) / 20) : Math.max(0.1, Math.abs(shadows) / 20),
      0.25 * quantumRange,
    );
  }

  const highlights = Number(recipe.highlights);
  if (highlights !== 0) {
    image.sigmoidalContrast(
      highlights < 0 ? -Math.max(0.1, Math.abs(highlights) / 20) : Math.max(0.1, Math.abs(highlights) / 20),
      0.75 * quantumRange,
    );
  }

  const temperature = Number(recipe.temperature);
  if (temperature !== 0) {
    const delta = quantumRange * (Math.abs(temperature) / 100) * 0.06;
    if (temperature > 0) {
      applyChannelShift(image, magick.Channels.Red, delta, magick);
      applyChannelShift(image, magick.Channels.Blue, -delta, magick);
    } else {
      applyChannelShift(image, magick.Channels.Red, -delta, magick);
      applyChannelShift(image, magick.Channels.Blue, delta, magick);
    }
  }

  const tint = Number(recipe.tint);
  if (tint !== 0) {
    const delta = quantumRange * (Math.abs(tint) / 100) * 0.05;
    applyChannelShift(image, magick.Channels.Green, tint > 0 ? -delta : delta, magick);
  }

  const sharpness = Number(recipe.sharpness);
  if (sharpness > 0) {
    image.sharpen(0, Math.max(0.1, 0.5 + sharpness / 40));
  }

  const vignette = Number(recipe.vignette);
  if (vignette > 0) {
    const sigma = Math.max(image.width, image.height) * (vignette / 100) * 0.12;
    image.vignette(
      0,
      Math.max(1, sigma),
      Math.round(image.width * 0.08),
      Math.round(image.height * 0.08),
    );
  }

  clampImage(image);
}

function fitPreviewSize(image: IMagickImage, magick: MagickModule): void {
  if (Math.max(image.width, image.height) <= PREVIEW_LONG_SIDE) return;
  const geometry =
    image.width >= image.height
      ? new magick.MagickGeometry(`${PREVIEW_LONG_SIDE}x`)
      : new magick.MagickGeometry(`x${PREVIEW_LONG_SIDE}`);
  image.resize(geometry);
}

export async function renderMagickPreviewUrl(
  sourceUrl: string,
  recipe: PhotoRecipe,
): Promise<string> {
  const magick = await ensureMagickReady();
  const bytes = await sourceBytes(sourceUrl);

  return magick.ImageMagick.read(bytes, (image) => {
    image.autoOrient();
    applyRecipe(image, recipe, magick);
    fitPreviewSize(image, magick);
    image.quality = JPEG_QUALITY;

    return image.write(magick.MagickFormat.Jpeg, (data) => {
      const blob = new Blob([new Uint8Array(data)], { type: 'image/jpeg' });
      return URL.createObjectURL(blob);
    });
  });
}
