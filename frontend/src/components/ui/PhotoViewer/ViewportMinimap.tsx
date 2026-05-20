import { useMemo } from 'react';

import styles from './ViewportMinimap.module.css';
import type { ViewportState } from './useImageViewport';
import {
  computeMinimapRect,
  type ViewportMetrics,
} from './viewportMath';

const MINIMAP_WIDTH = 124;
const MINIMAP_HEIGHT = 91;

interface ViewportMinimapProps {
  src: string;
  viewport: ViewportState;
  metrics: ViewportMetrics;
}

export default function ViewportMinimap({
  src,
  viewport,
  metrics,
}: ViewportMinimapProps) {
  const rect = useMemo(
    () => computeMinimapRect(viewport, metrics, MINIMAP_WIDTH, MINIMAP_HEIGHT),
    [viewport, metrics],
  );

  return (
    <div className={styles.wrap} aria-hidden="true">
      <div className={styles.frame}>
        <img className={styles.thumb} src={src} alt="" draggable={false} />
        <div
          className={styles.viewport}
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      </div>
      <div className={styles.label}>Область просмотра</div>
    </div>
  );
}
