/**
 * KidNoteAlert - the adult-side surface for kids' daily notes.
 *
 * When a child sends a note from Kids Mode, a banner slides in at the top
 * of whatever page the parent is on: "💌 Olivia has sent you a note." with
 * a View button. Viewing opens a popup with the drawing/message and a
 * one-tap emoji reaction row - the reaction is shown back to the kid on
 * their Note screen, so reacting here has to be effortless.
 *
 * Mounted once in Layout (adult UI only; Child Mode renders KidsShell
 * instead). Polls GET /api/kids/notes every 60s, so a note lands within a
 * minute even if the parent ignores the push notification.
 *
 * A note's banner is retired permanently when this user OPENS it (seen_by,
 * server state, so it follows them across devices) or reacts. Reacting is
 * optional - it's the delight path, not the dismissal toll. The banner's ✕
 * alone only snoozes for this session: an unopened note returns next launch
 * (for up to 7 days), so a kid's note is never dismissed unseen. The full
 * archive (incl. seen and text-only notes) lives on the Notes page
 * (KidNotesArchive).
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { confirmDestructive } from '../lib/action-sheet';
import { prettyNoteDate } from '../lib/kidNotes';
import useHasChildren from '../hooks/useHasChildren';
import KidNotePopup from './KidNotePopup';

const INK3 = '#8A8493';

// Dismissed-note ids for THIS page session. Module-level (not component state)
// on purpose: every route wraps its page in its own <Layout>, so navigating
// remounts KidNoteAlert — a component-state snooze would reset on every page
// change and the banner would keep popping back. This Set survives navigation
// and is cleared only on a full reload / new tab, so an un-reacted note still
// returns next session (and always lives in the Notes archive) — never lost.
const sessionDismissed = new Set();

export default function KidNoteAlert() {
  const { user } = useAuth();
  // No children → no notes can ever exist; skip the 60s polling entirely.
  const hasChildren = useHasChildren();
  const [notes, setNotes] = useState([]);
  // Dismissed note ids (the banner's ✕, and opening a note). Seeded from the
  // module-level Set so a dismissal survives the Layout remount on navigation;
  // REACTION is still the only thing that permanently retires a note server-side.
  const [snoozed, setSnoozed] = useState(() => new Set(sessionDismissed));
  const [viewing, setViewing] = useState(null); // the note open in the popup

  useEffect(() => {
    // One-time cleanup of the old localStorage flag: earlier builds hid a
    // note forever the moment it was opened, stranding un-reacted notes.
    try { localStorage.removeItem('kidNotesSeen'); } catch { /* private browsing */ }
    if (!hasChildren) return undefined; // polling starts if a child is added
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/kids/notes', { params: { limit: 6 } });
        // A week's window: forgiving enough that a busy parent doesn't lose
        // a note, tight enough that an old one doesn't resurface as noise.
        const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toLocaleDateString('en-CA');
        if (!cancelled) setNotes((data.notes || []).filter((n) => n.note_date >= cutoff));
      } catch { /* keep whatever we have */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [hasChildren]);

  const snooze = (noteId) => {
    sessionDismissed.add(noteId); // survives navigation (see the module Set above)
    setSnoozed((s) => new Set(s).add(noteId));
  };

  // Newest note this user hasn't SEEN (opened) or reacted to, and hasn't
  // snoozed this session. Seen is server state, so a note opened on one
  // device never re-banners on another.
  const fresh = notes.find((n) => !n.seen_by?.[user?.id] && !n.reactions?.[user?.id] && !snoozed.has(n.id));

  // Opening a note is what retires its banner permanently: the parent has
  // seen it, and demanding an emoji before the banner would die made
  // reacting a toll instead of a delight. Reacting stays optional; the ✕
  // (snooze) alone never marks seen - an unopened note still returns next
  // session, and every note always lives in the Notes archive.
  const openNote = (note) => {
    snooze(note.id); // instant local retire + fallback while seen_by lands (or pre-migration)
    setViewing(note);
    const seenApplied = { ...(note.seen_by || {}), [user.id]: new Date().toISOString() };
    setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, seen_by: seenApplied } : n)));
    api.post(`/kids/notes/${note.id}/seen`).catch(() => { /* session snooze covers this open */ });
  };

  const react = async (emoji) => {
    const note = viewing;
    // Optimistic on BOTH the popup and the notes list - the tap feels
    // instant and the banner retires immediately (reacting is what retires
    // a note). The popup stays open so the parent sees their reaction land.
    const applied = { ...note.reactions, [user.id]: emoji };
    setViewing((v) => ({ ...v, reactions: applied }));
    setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: applied } : n)));
    try {
      const { data } = await api.post(`/kids/notes/${note.id}/reactions`, { emoji });
      setViewing((v) => (v && v.id === note.id ? { ...v, reactions: data.note.reactions } : v));
      setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: data.note.reactions } : n)));
    } catch { /* keep the optimistic state; it re-syncs on the next poll */ }
  };

  const removeNote = async () => {
    const note = viewing;
    const ok = await confirmDestructive({
      title: 'Delete this note?',
      message: `${note.child_name || 'This'} note from ${prettyNoteDate(note.note_date)} will be gone for good.`,
      confirmLabel: 'Delete note',
    });
    if (!ok) return;
    try {
      await api.delete(`/kids/notes/${note.id}`);
      setNotes((ns) => ns.filter((n) => n.id !== note.id));
      setViewing(null);
    } catch { /* leave the note in place; nothing was deleted */ }
  };

  return (
    <>
      {/* ── Banner ── */}
      {fresh && !viewing && (
        <div
          className="fixed inset-x-4 md:inset-x-auto md:right-8 md:w-[380px] z-40"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        >
          <div
            className="flex items-center gap-3"
            style={{
              background: '#fff', borderRadius: 18, padding: '12px 12px 12px 16px',
              boxShadow: '0 8px 28px rgba(26,22,32,0.16), 0 1px 0 rgba(26,22,32,0.04)',
              border: '1px solid rgba(26,22,32,0.06)',
            }}
            role="status"
          >
            <span style={{ fontSize: 22 }} aria-hidden="true">💌</span>
            <span className="flex-1 text-sm text-bark" style={{ fontWeight: 500, minWidth: 0 }}>
              <b style={{ fontWeight: 700 }}>{fresh.child_name || 'One of the kids'}</b> has sent you a note.
            </span>
            <button
              type="button"
              onClick={() => openNote(fresh)}
              className="text-xs font-semibold"
              style={{ background: 'var(--color-plum)', color: '#fff', border: 0, borderRadius: 99, padding: '8px 14px', cursor: 'pointer', flexShrink: 0 }}
            >
              View
            </button>
            <button
              type="button"
              onClick={() => snooze(fresh.id)}
              aria-label="Not now"
              title="Not now — it'll come back until you react"
              style={{ background: 'transparent', border: 0, color: INK3, fontSize: 16, lineHeight: 1, padding: 6, cursor: 'pointer', flexShrink: 0 }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ── Note popup (shared with the Kids' Notes archive) ── */}
      {viewing && (
        <KidNotePopup
          note={viewing}
          currentUserId={user?.id}
          onReact={react}
          onClose={() => setViewing(null)}
          onDelete={removeNote}
        />
      )}
    </>
  );
}
