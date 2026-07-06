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
 * "Seen" is per-device (localStorage): a note stops bannering once this
 * user has reacted to it (server state, follows them across devices) or
 * has opened/dismissed it here. Only the last 2 days can banner - an old
 * note surfacing days later would be noise, not delight.
 */

import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

const INK2 = '#4A4453';
const INK3 = '#8A8493';
const SOFT = '#F3EEE5';

// Must match REACTION_EMOJI in src/routes/kids.js - the backend rejects
// anything outside this set.
const REACTIONS = ['❤️', '😍', '🌟', '😂', '🥰', '👏'];

const escapeHtml = (s) => String(s || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Print a note on its own page so a parent can pop a keepsake on the
// fridge. Builds a minimal document (the drawing + message + who/when) as
// a Blob and opens it in a new window; the inline script waits for the
// image to paint, then fires the browser print dialog.
function printNote(note) {
  const who = escapeHtml(note.child_name || 'the kids');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>A note from ${who}</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; color: #1A1620; text-align: center; padding: 32px; }
      h1 { font-size: 24px; margin: 0 0 4px; }
      .date { color: #8A8493; font-size: 13px; margin-bottom: 20px; }
      img { max-width: 100%; border: 1px solid #ddd; border-radius: 12px; }
      .msg { font-size: 20px; font-style: italic; margin-top: 20px; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>A note from ${who} &#128156;</h1>
    <div class="date">${escapeHtml(note.note_date || '')}</div>
    ${note.image_url ? `<img alt="Drawing" src="${escapeHtml(note.image_url)}">` : ''}
    ${note.text_note ? `<div class="msg">&ldquo;${escapeHtml(note.text_note)}&rdquo;</div>` : ''}
    <script>
      window.addEventListener('load', function () {
        var img = document.querySelector('img');
        if (img && !img.complete) {
          img.addEventListener('load', function () { window.print(); });
          img.addEventListener('error', function () { window.print(); });
        } else { window.print(); }
      });
    </script>
    </body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) { URL.revokeObjectURL(url); return; }
  setTimeout(() => URL.revokeObjectURL(url), 60000); // after the window has loaded it
}

const SEEN_KEY = 'kidNotesSeen';
function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}
function writeSeen(map) {
  // Prune to the newest ~30 entries so the map can't grow forever.
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 30);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* private browsing */ }
}

export default function KidNoteAlert() {
  const { user } = useAuth();
  const [notes, setNotes] = useState([]);
  const [seen, setSeen] = useState(readSeen);
  const [viewing, setViewing] = useState(null); // the note open in the popup

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get('/kids/notes', { params: { limit: 6 } });
        // Only the last 2 days can banner - an old note surfacing days
        // later would be noise, not delight. Filtered at fetch time so
        // render stays date-free.
        const cutoff = new Date(Date.now() - 2 * 24 * 3600 * 1000).toLocaleDateString('en-CA');
        if (!cancelled) setNotes((data.notes || []).filter((n) => n.note_date >= cutoff));
      } catch { /* keep whatever we have */ }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const markSeen = (noteId) => {
    setSeen((s) => {
      const next = { ...s, [noteId]: Date.now() };
      writeSeen(next);
      return next;
    });
  };

  // Newest note this user hasn't reacted to, opened, or dismissed.
  const fresh = notes.find((n) => !n.reactions?.[user?.id] && !seen[n.id]);

  const openNote = (note) => {
    markSeen(note.id);
    setViewing(note);
  };

  const react = async (emoji) => {
    const note = viewing;
    // Optimistic - the tap should feel instant; the popup stays open so
    // the parent sees their reaction land.
    setViewing((v) => ({ ...v, reactions: { ...v.reactions, [user.id]: emoji } }));
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
              onClick={() => markSeen(fresh.id)}
              aria-label="Dismiss"
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
