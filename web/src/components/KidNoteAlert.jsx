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
 * A note is retired ONLY when this user reacts to it (server state, so it
 * follows them across devices). Opening the popup does not hide it, and
 * the banner's ✕ is a session-only snooze - so an un-reacted note is never
 * lost. Notes ≤7 days old can banner. The full archive (incl. reacted and
 * text-only notes) lives on the Notes page (KidNotesArchive).
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { confirmDestructive } from '../lib/action-sheet';
import { prettyNoteDate } from '../lib/kidNotes';
import KidNotePopup from './KidNotePopup';

const INK3 = '#8A8493';

export default function KidNoteAlert() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  // Snoozed-for-this-session note ids (the banner's ✕). Deliberately NOT
  // persisted: a note the parent hasn't reacted to must never be lost - it
  // returns on the next load until they react. REACTION is the only thing
  // that permanently retires a note.
  const [snoozed, setSnoozed] = useState(() => new Set());
  const [viewing, setViewing] = useState(null); // the note open in the popup

  useEffect(() => {
    // One-time cleanup of the old localStorage flag: earlier builds hid a
    // note forever the moment it was opened, stranding un-reacted notes.
    try { localStorage.removeItem('kidNotesSeen'); } catch { /* private browsing */ }
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
  }, []);

  const snooze = (noteId) => setSnoozed((s) => new Set(s).add(noteId));

  // Newest note this user hasn't reacted to and hasn't snoozed this session.
  const fresh = notes.find((n) => !n.reactions?.[user?.id] && !snoozed.has(n.id));

  // Opening does NOT retire the note - only reacting does. So if the parent
  // reads it and closes without reacting, the banner comes back.
  const openNote = (note) => setViewing(note);

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
