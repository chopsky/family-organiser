/**
 * KidNotesCard - dashboard widget showing the kids' daily notes (drawn or
 * typed in Kids Mode) with one-tap emoji reactions.
 *
 * The reaction is the other half of the feature: it's shown back to the
 * kid on their Note screen, so reacting here has to be effortless - a
 * single tap on the emoji row under each note. One reaction per adult per
 * note (tapping another emoji swaps it).
 *
 * Data: GET /api/kids/notes (newest first, signed image URLs). Only the
 * last week is shown so the card stays fresh; it hides entirely when
 * there's nothing recent. Child names/colours resolve from the dashboard's
 * members list.
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import Avatar from './ui/Avatar';

const INK2 = '#4A4453';
const INK3 = '#8A8493';
const SOFT = '#F3EEE5';

// Must match REACTION_EMOJI in src/routes/kids.js - the backend rejects
// anything outside this set.
const REACTIONS = ['❤️', '😍', '🌟', '😂', '🥰', '👏'];

const dayLabel = (dateStr) => {
  if (dateStr === new Date().toLocaleDateString('en-CA')) return 'today';
  if (dateStr === new Date(Date.now() - 24 * 3600 * 1000).toLocaleDateString('en-CA')) return 'yesterday';
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
};

export default function KidNotesCard({ members = [], currentUserId }) {
  const [notes, setNotes] = useState(null); // null = loading, [] = none

  useEffect(() => {
    let cancelled = false;
    // Only the last week: the point is "what did they send today", not an
    // archive. Filtered here at fetch time so render stays date-free.
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toLocaleDateString('en-CA');
    api.get('/kids/notes', { params: { limit: 10 } })
      .then((res) => { if (!cancelled) setNotes((res.data?.notes || []).filter((n) => n.note_date >= cutoff)); })
      .catch(() => { if (!cancelled) setNotes([]); });
    return () => { cancelled = true; };
  }, []);

  const memberById = useMemo(() => {
    const map = {};
    for (const m of members) map[m.id] = m;
    return map;
  }, [members]);

  // Newest first (the API already sorts), max 3 on the dashboard.
  const recent = (notes || []).slice(0, 3);

  const react = async (note, emoji) => {
    // Optimistic - a reaction tap should feel instant.
    setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: { ...n.reactions, [currentUserId]: emoji } } : n)));
    try {
      const { data } = await api.post(`/kids/notes/${note.id}/reactions`, { emoji });
      setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: data.note.reactions } : n)));
    } catch { /* keep the optimistic state; it re-syncs on next load */ }
  };

  if (!recent.length) return null;

  return (
    <div
      className="p-4.5 md:p-6 md:pt-5"
      style={{
        background: '#fff', borderRadius: 22,
        boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <h2 className="text-base font-sans font-semibold text-bark">Notes from the kids 💌</h2>
      </div>

      <div className="flex flex-col" style={{ gap: 16 }}>
        {recent.map((note) => {
          const kid = memberById[note.child_id];
          const mine = note.reactions?.[currentUserId];
          const otherReactors = Object.entries(note.reactions || {})
            .filter(([uid]) => uid !== currentUserId)
            .map(([uid, emoji]) => ({ name: memberById[uid]?.name, emoji }))
            .filter((r) => r.name);
          return (
            <div key={note.id}>
              <div className="flex items-center" style={{ gap: 10, marginBottom: 8 }}>
                <Avatar member={kid} size={28} />
                <span className="text-sm font-semibold text-bark">{kid?.name || 'One of the kids'}</span>
                <span style={{ fontSize: 12, color: INK3 }}>{dayLabel(note.note_date)}</span>
              </div>

              {note.image_url && (
                <img
                  src={note.image_url}
                  alt={`Note from ${kid?.name || 'a child'}`}
                  style={{ display: 'block', width: '100%', borderRadius: 14, border: '1px solid rgba(26,22,32,0.08)' }}
                />
              )}
              {note.text_note && (
                <div style={{ marginTop: note.image_url ? 8 : 0, fontSize: 14, fontWeight: 500, color: INK2 }}>
                  “{note.text_note}”
                </div>
              )}

              <div className="flex items-center" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {REACTIONS.map((emoji) => {
                  const on = mine === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => react(note, emoji)}
                      aria-label={`React ${emoji}`}
                      aria-pressed={on}
                      style={{
                        border: 0, cursor: 'pointer', fontSize: 17, lineHeight: 1,
                        padding: '7px 10px', borderRadius: 99,
                        background: on ? 'var(--color-plum)' : SOFT,
                        transform: on ? 'scale(1.08)' : 'none', transition: 'transform .15s, background .15s',
                      }}
                    >
                      {emoji}
                    </button>
                  );
                })}
                {otherReactors.length > 0 && (
                  <span style={{ fontSize: 12, color: INK3, marginLeft: 4 }}>
                    {otherReactors.map((r) => `${r.name} ${r.emoji}`).join(' · ')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
