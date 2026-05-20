import type { ViewportState } from './useImageViewport';

export type ViewportMetrics = {
  containerWidth: number;
  containerHeight: number;
  imageWidth: number;
  imageHeight: number;
};

const MIN_SCALE = 1;
const MAX_SCALE = 8;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function sanitizeViewport(viewport: ViewportState): ViewportState {
  return {
    scale: clampScale(viewport.scale),
    panX: Number.isFinite(viewport.panX) ? viewport.panX : 0,
    panY: Number.isFinite(viewport.panY) ? viewport.panY : 0,
  };
}

export function getPanLimits(metrics: ViewportMetrics, scale: number): {
  maxPanX: number;
  maxPanY: number;
} {
  const { containerWidth, containerHeight, imageWidth, imageHeight } = metrics;
  const scaledW = imageWidth * scale;
  const scaledH = imageHeight * scale;

  return {
    maxPanX: Math.max(0, (scaledW - containerWidth) / 2),
    maxPanY: Math.max(0, (scaledH - containerHeight) / 2),
  };
}

export function clampViewport(
  viewport: ViewportState,
  metrics: ViewportMetrics | null,
): ViewportState {
  const safe = sanitizeViewport(viewport);
  if (!metrics) return safe;

  const { containerWidth, containerHeight, imageWidth, imageHeight } = metrics;
  if (
    containerWidth <= 0 ||
    containerHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return safe;
  }

  const { maxPanX, maxPanY } = getPanLimits(metrics, safe.scale);

  return {
    scale: safe.scale,
    panX: Math.min(maxPanX, Math.max(-maxPanX, safe.panX)),
    panY: Math.min(maxPanY, Math.max(-maxPanY, safe.panY)),
  };
}

export function fitImageInContainer(
  containerWidth: number,
  containerHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } {
  if (containerWidth <= 0 || containerHeight <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const ratio = Math.min(
    containerWidth / naturalWidth,
    containerHeight / naturalHeight,
  );

  return {
    width: naturalWidth * ratio,
    height: naturalHeight * ratio,
  };
}

export function measureViewportMetrics(
  container: HTMLElement,
  image: HTMLImageElement | null,
): ViewportMetrics | null {
  if (!image) return null;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  if (containerWidth <= 0 || containerHeight <= 0) return null;

  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;

  const { width: imageWidth, height: imageHeight } = fitImageInContainer(
    containerWidth,
    containerHeight,
    naturalWidth,
    naturalHeight,
  );

  if (imageWidth <= 0 || imageHeight <= 0) return null;

  return {
    containerWidth,
    containerHeight,
    imageWidth,
    imageHeight,
  };
}

export type MinimapRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Прямоугольник видимой области в координатах миникарты (px). */
export function computeMinimapRect(
  viewport: ViewportState,
  metrics: ViewportMetrics,
  minimapWidth: number,
  minimapHeight: number,
): MinimapRect {
  const { scale, panX, panY } = sanitizeViewport(viewport);
  const { containerWidth, containerHeight, imageWidth, imageHeight } = metrics;

  const scaledW = imageWidth * scale;
  const scaledH = imageHeight * scale;

  const viewW = Math.min(1, containerWidth / scaledW);
  const viewH = Math.min(1, containerHeight / scaledH);

  const normCenterX = 0.5 - panX / scaledW;
  const normCenterY = 0.5 - panY / scaledH;

  let left = (normCenterX - viewW / 2) * minimapWidth;
  let top = (normCenterY - viewH / 2) * minimapHeight;
  let width = viewW * minimapWidth;
  let height = viewH * minimapHeight;

  left = Math.min(minimapWidth - 4, Math.max(0, left));
  top = Math.min(minimapHeight - 4, Math.max(0, top));
  width = Math.min(minimapWidth - left, Math.max(4, width));
  height = Math.min(minimapHeight - top, Math.max(4, height));

  return { left, top, width, height };
}
