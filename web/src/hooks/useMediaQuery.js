import { useState, useEffect } from 'react';

// Subscribe to a CSS media query. Returns true while it matches.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// The app's mobile breakpoint (the desktop sidebar activates at 768px).
export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)');
}
