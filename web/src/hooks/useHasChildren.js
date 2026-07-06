/**
 * useHasChildren - does this household have any child (dependent) members?
 *
 * Drives the "the app grows with the household" rule: kid-only surfaces
 * (the Kids' Notes nav entry, the Child Mode settings card) stay hidden
 * until the first child is added in Family, and reappear instantly when
 * one is.
 *
 * A localStorage snapshot gives the right answer on first paint; a
 * throttled /household fetch keeps it honest. All mounted consumers
 * share one fetch (module-level in-flight + throttle) and stay in sync
 * via a broadcast event. FamilySetup dispatches
 * 'housemait:members-changed' after member mutations, which forces a
 * refetch past the throttle.
 *
 * Unknown (no snapshot yet) defaults to TRUE - most households have
 * kids, and briefly showing a kid feature to a childless household is
 * gentler than briefly hiding it from a parent.
 */
import { useState, useEffect } from 'react';
import api from '../lib/api';

const KEY = 'hasChildren';
const THROTTLE_MS = 15000;

let lastFetchTs = 0;
let inFlight = null;

function readSnapshot() {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

function refresh(force = false) {
  if (!force && Date.now() - lastFetchTs < THROTTLE_MS) return;
  if (inFlight) return;
  inFlight = api.get('/household')
    .then((r) => {
      const has = (r.data?.members || []).some((m) => m.member_type === 'dependent');
      try { localStorage.setItem(KEY, has ? '1' : '0'); } catch { /* private browsing */ }
      lastFetchTs = Date.now();
      window.dispatchEvent(new CustomEvent('housemait:has-children', { detail: has }));
    })
    .catch(() => { /* keep the snapshot */ })
    .finally(() => { inFlight = null; });
}

export default function useHasChildren() {
  const [has, setHas] = useState(readSnapshot);

  useEffect(() => {
    const onResolved = (e) => setHas(e.detail);
    const onMembersChanged = () => refresh(true);
    window.addEventListener('housemait:has-children', onResolved);
    window.addEventListener('housemait:members-changed', onMembersChanged);
    refresh();
    return () => {
      window.removeEventListener('housemait:has-children', onResolved);
      window.removeEventListener('housemait:members-changed', onMembersChanged);
    };
  }, []);

  return has;
}
