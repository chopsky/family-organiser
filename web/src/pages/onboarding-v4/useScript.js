import { useEffect, useRef, useState } from 'react';

/**
 * Drives the two scripted chat beats (screen 03 "Your plan", screen 09 "Just ask").
 *
 * Pacing is deliberate and comes straight from the spec: user bubbles hold
 * 420ms, Housemait bubbles show the typing indicator for `wait` (700-1000ms)
 * before appearing. Do NOT speed this up - the pause is what makes it read as a
 * reply rather than a slideshow.
 *
 * Under Reduce Motion the whole script resolves immediately: someone who has
 * asked the OS to stop animating things should not be made to sit through a
 * simulated typing delay either.
 *
 * @param {Array<{from?: 'me'|'bot', wait?: number}>} items
 * @param {() => void} onDone   fired once, when the script finishes
 * @param {boolean} reduced     prefers-reduced-motion
 * @returns {{ shown: Array, typing: boolean, done: boolean }}
 */
export default function useScript(items, onDone, reduced = false) {
  const [n, setN] = useState(0);
  const [typing, setTyping] = useState(true);

  // Ref so a changing inline callback doesn't restart the script mid-run, and
  // so onDone can only ever fire once.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const firedRef = useRef(false);

  useEffect(() => {
    if (reduced) {
      setN(items.length);
      setTyping(false);
      if (!firedRef.current) { firedRef.current = true; doneRef.current && doneRef.current(); }
      return undefined;
    }
    if (n >= items.length) {
      setTyping(false);
      if (!firedRef.current) { firedRef.current = true; doneRef.current && doneRef.current(); }
      return undefined;
    }
    const item = items[n];
    setTyping(item.from !== 'me');
    const t = setTimeout(() => setN((v) => v + 1), item.from === 'me' ? 420 : (item.wait ?? 780));
    return () => clearTimeout(t);
    // items is a stable module-level script per screen; n drives the sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, reduced, items.length]);

  return {
    shown: reduced ? items : items.slice(0, n),
    typing: !reduced && typing && n < items.length,
    done: reduced || n >= items.length,
  };
}
