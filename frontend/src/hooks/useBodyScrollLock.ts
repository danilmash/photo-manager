import { useEffect } from 'react';

let lockCount = 0;
let originalOverflow = '';

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;

    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    lockCount += 1;

    return () => {
      lockCount -= 1;

      if (lockCount <= 0) {
        document.body.style.overflow = originalOverflow;
        lockCount = 0;
      }
    };
  }, [active]);
}
