import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react';

import type { UseImageViewportResult, ViewportState } from './useImageViewport';
import { viewportTransform } from './useImageViewport';
import ViewportMinimap from './ViewportMinimap';
import { measureViewportMetrics, type ViewportMetrics } from './viewportMath';
import styles from './PhotoCompareStage.module.css';
import zoomStyles from './ZoomableImageStage.module.css';

interface ComparePaneProps {
  label: string;
  viewport: ViewportState;
  src?: string;
  paneStageRef?: Ref<HTMLDivElement>;
  imageRef?: Ref<HTMLImageElement>;
  onImageLoad?: () => void;
  emptyLabel?: string;
  children?: ReactNode;
}

function ComparePane({
  label,
  viewport,
  src,
  paneStageRef,
  imageRef,
  onImageLoad,
  emptyLabel = 'Нет изображения',
  children,
}: ComparePaneProps) {
  return (
    <div className={styles.pane}>
      <div ref={paneStageRef} className={styles.paneStage}>
        <div
          className={`${zoomStyles.root} ${zoomStyles.fill}`}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={zoomStyles.content}
            style={{ transform: viewportTransform(viewport) }}
          >
            {src ? (
              <img
                ref={imageRef}
                src={src}
                alt=""
                className={zoomStyles.image}
                draggable={false}
                onLoad={onImageLoad}
              />
            ) : (
              <div className={zoomStyles.empty}>{emptyLabel}</div>
            )}
            {children}
          </div>
        </div>
      </div>
      <div className={styles.caption}>{label}</div>
    </div>
  );
}

interface PhotoCompareStageProps {
  viewportApi: UseImageViewportResult;
  metricsRef?: MutableRefObject<ViewportMetrics | null>;
  minimapSrc?: string;
  onMetricsChange?: () => void;
  leftLabel: string;
  rightLabel: string;
  leftSrc?: string;
  rightSrc?: string;
  leftImageRef?: Ref<HTMLImageElement>;
  rightImageRef?: Ref<HTMLImageElement>;
  onLeftImageLoad?: () => void;
  onRightImageLoad?: () => void;
  rightEmptyLabel?: string;
  leftOverlay?: ReactNode;
  rightOverlay?: ReactNode;
}

export default function PhotoCompareStage({
  viewportApi,
  metricsRef,
  minimapSrc,
  onMetricsChange,
  leftLabel,
  rightLabel,
  leftSrc,
  rightSrc,
  leftImageRef,
  rightImageRef,
  onLeftImageLoad,
  onRightImageLoad,
  rightEmptyLabel = 'Выберите фото для сравнения',
  leftOverlay,
  rightOverlay,
}: PhotoCompareStageProps) {
  const [dragging, setDragging] = useState(false);
  const [localMetrics, setLocalMetrics] = useState<ViewportMetrics | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const leftPaneStageRef = useRef<HTMLDivElement>(null);
  const measureImgRef = useRef<HTMLImageElement>(null);
  const { viewport, handlers } = viewportApi;

  const updateMetrics = useCallback(() => {
    const container = leftPaneStageRef.current;
    const image = measureImgRef.current;
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
    const container = rootRef.current;
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
  }, [leftSrc, updateMetrics]);

  const setLeftImageRef = useCallback(
    (node: HTMLImageElement | null) => {
      measureImgRef.current = node;
      if (typeof leftImageRef === 'function') {
        leftImageRef(node);
      } else if (leftImageRef && 'current' in leftImageRef) {
        (leftImageRef as React.MutableRefObject<HTMLImageElement | null>).current =
          node;
      }
    },
    [leftImageRef],
  );

  const rootClass = [styles.root, dragging ? styles.rootDragging : ''].filter(Boolean).join(' ');

  const minimapMetrics = metricsRef?.current ?? localMetrics;
  const showMinimap =
    Boolean(minimapSrc || leftSrc) &&
    viewport.scale > 1.001 &&
    minimapMetrics;

  return (
    <div
      ref={rootRef}
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
      <ComparePane
        label={leftLabel}
        viewport={viewport}
        src={leftSrc}
        paneStageRef={leftPaneStageRef}
        imageRef={setLeftImageRef}
        onImageLoad={() => {
          updateMetrics();
          onLeftImageLoad?.();
        }}
      >
        {leftOverlay}
      </ComparePane>
      <ComparePane
        label={rightLabel}
        viewport={viewport}
        src={rightSrc}
        imageRef={rightImageRef}
        onImageLoad={onRightImageLoad}
        emptyLabel={rightEmptyLabel}
      >
        {rightOverlay}
      </ComparePane>

      {showMinimap && minimapMetrics ? (
        <ViewportMinimap
          src={minimapSrc || leftSrc || ''}
          viewport={viewport}
          metrics={minimapMetrics}
        />
      ) : null}
    </div>
  );
}
