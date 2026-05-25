import { useCallback, useEffect, useRef, useState } from 'react';

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;
const SCRUB_START_PX = 8;

function findAssetIdFromElement(el: Element | null): string | null {
  while (el) {
    if (el instanceof HTMLElement && el.dataset.assetId) {
      return el.dataset.assetId;
    }
    el = el.parentElement;
  }
  return null;
}

export interface UseGallerySelectionOptions {
  selectableIds: string[];
  onOpenAsset: (assetId: string) => void;
}

export interface UseGallerySelectionResult {
  selectionActive: boolean;
  selectedIds: Set<string>;
  selectedCount: number;
  allLoadedSelected: boolean;
  isScrubbing: boolean;
  exitSelection: () => void;
  selectAllLoaded: () => void;
  clearSelection: () => void;
  getTileHandlers: (assetId: string, enabled: boolean) => {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  };
}

export function useGallerySelection({
  selectableIds,
  onOpenAsset,
}: UseGallerySelectionOptions): UseGallerySelectionResult {
  const [selectionActive, setSelectionActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isScrubbing, setIsScrubbing] = useState(false);

  const selectableSetRef = useRef(new Set<string>());
  selectableSetRef.current = new Set(selectableIds);

  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  const longPressTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; assetId: string } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const scrubIntentRef = useRef<'select' | 'deselect'>('select');
  const scrubVisitedRef = useRef<Set<string>>(new Set());
  const scrubStartedRef = useRef(false);
  const didScrubGestureRef = useRef(false);
  const rangeAnchorRef = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const exitSelection = useCallback(() => {
    clearLongPressTimer();
    setSelectionActive(false);
    setSelectedIds(new Set());
    setIsScrubbing(false);
    longPressTriggeredRef.current = false;
    pointerStartRef.current = null;
    rangeAnchorRef.current = null;
    scrubVisitedRef.current = new Set();
    scrubStartedRef.current = false;
    didScrubGestureRef.current = false;
  }, [clearLongPressTimer]);

  const enterSelectionWith = useCallback((assetId: string) => {
    setSelectionActive(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(assetId);
      return next;
    });
    rangeAnchorRef.current = assetId;
  }, []);

  const toggleId = useCallback((assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }
      return next;
    });
    rangeAnchorRef.current = assetId;
  }, []);

  const selectRange = useCallback(
    (toAssetId: string) => {
      const anchor = rangeAnchorRef.current;
      if (!anchor) {
        enterSelectionWith(toAssetId);
        return;
      }

      const fromIndex = selectableIds.indexOf(anchor);
      const toIndex = selectableIds.indexOf(toAssetId);
      if (fromIndex === -1 || toIndex === -1) {
        toggleId(toAssetId);
        return;
      }

      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      setSelectionActive(true);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let index = start; index <= end; index += 1) {
          next.add(selectableIds[index]);
        }
        return next;
      });
      rangeAnchorRef.current = toAssetId;
    },
    [enterSelectionWith, selectableIds, toggleId],
  );

  const applyScrubAtPoint = useCallback((clientX: number, clientY: number) => {
    const assetId = findAssetIdFromElement(document.elementFromPoint(clientX, clientY));
    if (!assetId || !selectableSetRef.current.has(assetId)) return;
    if (scrubVisitedRef.current.has(assetId)) return;

    scrubVisitedRef.current.add(assetId);
    if (scrubVisitedRef.current.size > 1) {
      didScrubGestureRef.current = true;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (scrubIntentRef.current === 'select') {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      return next;
    });
  }, []);

  const beginScrub = useCallback(
    (assetId: string, clientX: number, clientY: number, forcedIntent?: 'select' | 'deselect') => {
      if (scrubStartedRef.current) return;
      scrubStartedRef.current = true;
      scrubVisitedRef.current = new Set();
      didScrubGestureRef.current = false;
      scrubIntentRef.current =
        forcedIntent ??
        (selectedIdsRef.current.has(assetId) ? 'deselect' : 'select');
      setIsScrubbing(true);
      applyScrubAtPoint(clientX, clientY);
    },
    [applyScrubAtPoint],
  );

  const maybeBeginScrub = useCallback(
    (assetId: string, clientX: number, clientY: number) => {
      const start = pointerStartRef.current;
      if (!start || start.assetId !== assetId || scrubStartedRef.current) return;
      const dx = clientX - start.x;
      const dy = clientY - start.y;
      if (Math.hypot(dx, dy) < SCRUB_START_PX) return;
      beginScrub(assetId, clientX, clientY);
    },
    [beginScrub],
  );

  useEffect(() => {
    if (!isScrubbing) return;

    const handleMove = (event: PointerEvent) => {
      event.preventDefault();
      applyScrubAtPoint(event.clientX, event.clientY);
    };

    const handleEnd = () => {
      setIsScrubbing(false);
      scrubVisitedRef.current = new Set();
      scrubStartedRef.current = false;
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
        didScrubGestureRef.current = false;
      }, 0);
    };

    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };
  }, [applyScrubAtPoint, isScrubbing]);

  useEffect(() => {
    if (!selectionActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        exitSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [exitSelection, selectionActive]);

  const getTileHandlers = useCallback(
    (assetId: string, enabled: boolean) => {
      const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
        if (!enabled || !selectableSetRef.current.has(assetId)) return;
        if (event.button !== 0) return;

        clearLongPressTimer();
        longPressTriggeredRef.current = false;
        didScrubGestureRef.current = false;
        scrubStartedRef.current = false;
        pointerStartRef.current = { x: event.clientX, y: event.clientY, assetId };

        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setSelectionActive(true);
          toggleId(assetId);
          suppressNextClickRef.current = true;
          return;
        }

        if (selectionActive) {
          event.preventDefault();
          return;
        }

        longPressTimerRef.current = window.setTimeout(() => {
          longPressTriggeredRef.current = true;
          suppressNextClickRef.current = true;
          enterSelectionWith(assetId);
          beginScrub(assetId, event.clientX, event.clientY, 'select');
          if (navigator.vibrate) {
            navigator.vibrate(10);
          }
        }, LONG_PRESS_MS);
      };

      const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
        const start = pointerStartRef.current;
        if (!start || start.assetId !== assetId) return;

        if (selectionActive) {
          maybeBeginScrub(assetId, event.clientX, event.clientY);
          return;
        }

        if (longPressTriggeredRef.current) {
          maybeBeginScrub(assetId, event.clientX, event.clientY);
          return;
        }

        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
          clearLongPressTimer();
          pointerStartRef.current = null;
        }
      };

      const handlePointerUp = (event: React.PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;

        const started = pointerStartRef.current;
        pointerStartRef.current = null;
        clearLongPressTimer();

        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          return;
        }

        if (scrubStartedRef.current || didScrubGestureRef.current || isScrubbing) return;

        if (!started || started.assetId !== assetId) return;

        if (selectionActive) {
          if (event.shiftKey) {
            selectRange(assetId);
          } else {
            toggleId(assetId);
          }
          suppressNextClickRef.current = true;
          return;
        }

        onOpenAsset(assetId);
      };

      const handlePointerCancel = () => {
        pointerStartRef.current = null;
        scrubStartedRef.current = false;
        clearLongPressTimer();
      };

      const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        if (suppressNextClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      };

      const handleContextMenu = (event: React.MouseEvent<HTMLElement>) => {
        if (!enabled) return;
        event.preventDefault();
        setSelectionActive(true);
        if (!selectedIdsRef.current.has(assetId)) {
          enterSelectionWith(assetId);
        }
      };

      return {
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        onPointerCancel: handlePointerCancel,
        onClick: handleClick,
        onContextMenu: handleContextMenu,
      };
    },
    [
      beginScrub,
      clearLongPressTimer,
      enterSelectionWith,
      isScrubbing,
      maybeBeginScrub,
      onOpenAsset,
      selectRange,
      selectionActive,
      toggleId,
    ],
  );

  const selectAllLoaded = useCallback(() => {
    setSelectionActive(true);
    setSelectedIds(new Set(selectableIds));
  }, [selectableIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedCount = selectedIds.size;
  const allLoadedSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  return {
    selectionActive,
    selectedIds,
    selectedCount,
    allLoadedSelected,
    isScrubbing,
    exitSelection,
    selectAllLoaded,
    clearSelection,
    getTileHandlers,
  };
}
