import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import styles from './ZoomableImageStage.module.css';
import type { ViewportState } from './useImageViewport';
import { viewportTransform } from './useImageViewport';
import ViewportMinimap from './ViewportMinimap';
import { measureViewportMetrics, type ViewportMetrics } from './viewportMath';

export type ZoomableViewportHandlers = {
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
};

interface ZoomableImageStageProps {
  viewport: ViewportState;
  handlers: ZoomableViewportHandlers;
  src?: string;
  alt?: string;
  imageRef?: Ref<HTMLImageElement>;
  onImageLoad?: () => void;
  fill?: boolean;
  emptyLabel?: string;
  children?: ReactNode;
  className?: string;
  metricsRef?: MutableRefObject<ViewportMetrics | null>;
  onMetricsChange?: () => void;
  showMinimap?: boolean;
}

export default function ZoomableImageStage({
  viewport,
  handlers,
  src,
  alt = 'Фотография',
  imageRef,
  onImageLoad,
  fill = false,
  emptyLabel = 'Нет изображения',
  children,
  className,
  metricsRef,
  onMetricsChange,
  showMinimap = true,
}: ZoomableImageStageProps) {
  const [dragging, setDragging] = useState(false);
  const [localMetrics, setLocalMetrics] = useState<ViewportMetrics | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const localImgRef = useRef<HTMLImageElement>(null);

  const updateMetrics = useCallback(() => {
    const container = containerRef.current;
    const image = localImgRef.current;
    if (!container || !image) return;

    const next = measureViewportMetrics(container, image);
    if (!next) return;

    if (metricsRef) {
      metricsRef.current = next;
    }
    setLocalMetrics(next);
    onMetricsChange?.();
  }, [metricsRef, onMetricsChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    updateMetrics();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            updateMetrics();
          })
        : null;

    resizeObserver?.observe(container);
    window.addEventListener('resize', updateMetrics);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [src, updateMetrics]);

  const setImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      localImgRef.current = node;
      if (typeof imageRef === 'function') {
        imageRef(node);
      } else if (imageRef && 'current' in imageRef) {
        (imageRef as React.MutableRefObject<HTMLImageElement | null>).current = node;
      }
    },
    [imageRef],
  );

  const rootClass = [
    styles.root,
    fill ? styles.fill : '',
    dragging ? styles.rootDragging : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const minimapMetrics = metricsRef?.current ?? localMetrics;
  const showMinimapPanel =
    showMinimap && Boolean(src) && viewport.scale > 1.001 && minimapMetrics;

  return (
    <div
      ref={containerRef}
      className={rootClass}
      onWheel={handlers.onWheel}
      onPointerDown={(event) => {
        setDragging(true);
        handlers.onPointerDown(event);
      }}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={(event) => {
        setDragging(false);
        handlers.onPointerUp(event);
      }}
      onPointerCancel={(event) => {
        setDragging(false);
        handlers.onPointerCancel(event);
      }}
      onDoubleClick={handlers.onDoubleClick}
    >
      <div
        className={styles.content}
        style={{ transform: viewportTransform(viewport) }}
      >
        {src ? (
          <img
            ref={setImageRef}
            src={src}
            alt={alt}
            className={styles.image}
            draggable={false}
            onLoad={() => {
              updateMetrics();
              onImageLoad?.();
            }}
          />
        ) : (
          <div className={styles.empty}>{emptyLabel}</div>
        )}
        {children}
      </div>

      {showMinimapPanel && src && minimapMetrics ? (
        <ViewportMinimap src={src} viewport={viewport} metrics={minimapMetrics} />
      ) : null}
    </div>
  );
}
