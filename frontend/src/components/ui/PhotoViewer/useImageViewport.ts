import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import {
  clampScale,
  clampViewport,
  sanitizeViewport,
  type ViewportMetrics,
} from './viewportMath';

export type ViewportState = {
  scale: number;
  panX: number;
  panY: number;
};

export const DEFAULT_VIEWPORT: ViewportState = {
  scale: 1,
  panX: 0,
  panY: 0,
};

const WHEEL_ZOOM_FACTOR = 1.12;

type PanSession = {
  pointerId: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
};

export type UseImageViewportOptions = {
  resetKey?: string | number | null;
  metricsRef?: MutableRefObject<ViewportMetrics | null>;
};

export type UseImageViewportResult = {
  viewport: ViewportState;
  isZoomed: boolean;
  reset: () => void;
  recalculateBounds: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  handlers: {
    onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
  };
};

export function useImageViewport(
  options: UseImageViewportOptions = {},
): UseImageViewportResult {
  const { resetKey, metricsRef } = options;
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const panStartRef = useRef<PanSession | null>(null);

  const applyViewport = useCallback(
    (updater: (prev: ViewportState) => ViewportState) => {
      setViewport((prev) => {
        const next = sanitizeViewport(updater(prev));
        return clampViewport(next, metricsRef?.current ?? null);
      });
    },
    [metricsRef],
  );

  useLayoutEffect(() => {
    if (resetKey === undefined) return;
    setViewport(DEFAULT_VIEWPORT);
    panStartRef.current = null;
  }, [resetKey]);

  const reset = useCallback(() => {
    setViewport(DEFAULT_VIEWPORT);
    panStartRef.current = null;
  }, []);

  const recalculateBounds = useCallback(() => {
    setViewport((prev) => clampViewport(prev, metricsRef?.current ?? null));
  }, [metricsRef]);

  const endPanSession = useCallback((pointerId: number) => {
    const panStart = panStartRef.current;
    if (!panStart || panStart.pointerId !== pointerId) return;

    panStartRef.current = null;
  }, []);

  const movePanSession = useCallback(
    (pointerId: number, clientX: number, clientY: number) => {
      const panStart = panStartRef.current;
      if (!panStart || panStart.pointerId !== pointerId) return;

      const dx = clientX - panStart.startX;
      const dy = clientY - panStart.startY;

      applyViewport(() => ({
        scale: viewportRef.current.scale,
        panX: panStart.panX + dx,
        panY: panStart.panY + dy,
      }));
    },
    [applyViewport],
  );

  useEffect(() => {
    const movePan = (event: PointerEvent) => {
      movePanSession(event.pointerId, event.clientX, event.clientY);
    };

    const finishPan = (event: PointerEvent) => {
      endPanSession(event.pointerId);
    };

    window.addEventListener('pointermove', movePan);
    window.addEventListener('pointerup', finishPan);
    window.addEventListener('pointercancel', finishPan);
    return () => {
      window.removeEventListener('pointermove', movePan);
      window.removeEventListener('pointerup', finishPan);
      window.removeEventListener('pointercancel', finishPan);
    };
  }, [endPanSession, movePanSession]);

  const zoomByFactor = useCallback(
    (factor: number) => {
      applyViewport((prev) => {
        const nextScale = clampScale(prev.scale * factor);
        if (nextScale === prev.scale) return prev;
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          panX: prev.panX * ratio,
          panY: prev.panY * ratio,
        };
      });
    },
    [applyViewport],
  );

  const zoomIn = useCallback(() => {
    zoomByFactor(WHEEL_ZOOM_FACTOR);
  }, [zoomByFactor]);

  const zoomOut = useCallback(() => {
    zoomByFactor(1 / WHEEL_ZOOM_FACTOR);
  }, [zoomByFactor]);

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const delta = event.deltaY;
      if (delta === 0) return;

      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const px = event.clientX - centerX;
      const py = event.clientY - centerY;

      const factor = delta < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;

      applyViewport((prev) => {
        const nextScale = clampScale(prev.scale * factor);
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          panX: px - (px - prev.panX) * ratio,
          panY: py - (py - prev.panY) * ratio,
        };
      });
    },
    [applyViewport],
  );

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const { panX, panY } = viewportRef.current;

    panStartRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX,
      panY,
    };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      movePanSession(event.pointerId, event.clientX, event.clientY);
    },
    [movePanSession],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endPanSession(event.pointerId);
    },
    [endPanSession],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endPanSession(event.pointerId);
    },
    [endPanSession],
  );

  const onDoubleClick = useCallback(() => {
    reset();
  }, [reset]);

  return {
    viewport,
    isZoomed: viewport.scale > 1.001,
    reset,
    recalculateBounds,
    zoomIn,
    zoomOut,
    handlers: {
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onDoubleClick,
    },
  };
}

export function viewportTransform(viewport: ViewportState): string {
  const safe = sanitizeViewport(viewport);
  return `translate(${safe.panX}px, ${safe.panY}px) scale(${safe.scale})`;
}
