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
import { REACTIONS, printNote } from '../lib/kidNotes';

const INK2 = '#4A4453';
const INK3 = '#8A8493';
const SOFT = '#F3EEE5';

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

      {/* ── Note popup ── */}
      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(26,22,32,0.45)', padding: 20 }}
          onClick={() => setViewing(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Note from ${viewing.child_name || 'a child'}`}
        >
          <div
            className="w-full"
            style={{ maxWidth: 400, background: '#fff', borderRadius: 22, padding: 20, boxShadow: '0 18px 50px rgba(26,22,32,0.25)', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: 12, gap: 8 }}>
              <h2 style={{ fontFamily: 'var(--font-serif-display)', fontSize: 22, color: '#1A1620', margin: 0, minWidth: 0 }}>
                A note from {viewing.child_name || 'the kids'} 💌
              </h2>
              <div className="flex items-center" style={{ gap: 8, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => printNote(viewing)}
                  style={{ height: 34, padding: '0 12px', borderRadius: 10, border: 0, background: SOFT, color: INK2, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  🖨 Print
                </button>
                <button
                  type="button"
                  onClick={() => setViewing(null)}
                  aria-label="Close"
                  style={{ width: 34, height: 34, borderRadius: 10, border: 0, background: SOFT, color: INK2, fontSize: 16, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            </div>

            {viewing.image_url && (
              <img
                src={viewing.image_url}
                alt={`Drawing from ${viewing.child_name || 'a child'}`}
                style={{ display: 'block', width: '100%', borderRadius: 14, border: '1px solid rgba(26,22,32,0.08)' }}
              />
            )}
            {viewing.text_note && (
              <div style={{ marginTop: viewing.image_url ? 10 : 0, fontSize: 15, fontWeight: 500, color: INK2 }}>
                “{viewing.text_note}”
              </div>
            )}

            <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600, color: INK3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Send something back
            </div>
            <div className="flex items-center" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {REACTIONS.map((emoji) => {
                const on = viewing.reactions?.[user?.id] === emoji;
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => react(emoji)}
                    aria-label={`React ${emoji}`}
                    aria-pressed={on}
                    style={{
                      border: 0, cursor: 'pointer', fontSize: 20, lineHeight: 1,
                      padding: '9px 12px', borderRadius: 99,
                      background: on ? 'var(--color-plum)' : SOFT,
                      transform: on ? 'scale(1.1)' : 'none', transition: 'transform .15s, background .15s',
                    }}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
            {viewing.reactions?.[user?.id] && (
              <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: INK2 }}>
                {viewing.child_name || 'They'} will see your {viewing.reactions[user.id]} on their screen. ✨
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
