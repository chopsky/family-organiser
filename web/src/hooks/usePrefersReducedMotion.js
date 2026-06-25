import { useEffect, useState } from 'react';

// True when the user has asked the OS to minimise motion. Used to branch the
// JS-timed bits of the onboarding flow (e.g. skipping the welcome notifications'
// drift-out delay); the bulk of the animation suppression is handled by the
// global prefers-reduced-motion rule in index.css.
export default function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = (e) => setReduced(e.matches);
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}
