import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const MOBILE_MEDIA_QUERY = '(max-width: 768px)';
export const INLINE_LIBRARY_FILTERS_MEDIA_QUERY = '(min-width: 1280px)';
export const VERY_WIDE_VIEWPORT_MEDIA_QUERY = '(min-width: 1536px)';
