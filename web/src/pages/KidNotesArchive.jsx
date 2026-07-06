/**
 * KidNotesArchive - "Notes from the kids": the parents' keepsake history of
 * every note a child has sent from Kids Mode.
 *
 * The KidNoteAlert banner only nudges recent, un-reacted notes; this page is
 * where a parent revisits ALL of them - drawings AND text-only ones, whether
 * or not they've reacted. Each note can be reacted to (the reaction loops
 * back to the kid's screen) and printed.
 *
 * Reachable from the Household nav group / More sheet. Adult-only: in Child
 * Mode the ChildGate redirects /notes to the kids' home.
 */
import { useState, useEffect, useMemo } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import { REACTIONS, printNote } from '../lib/kidNotes';

const INK2 = '#4A4453';
const INK3 = '#8A8493';
const SOFT = '#F3EEE5';
const CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';

// "Monday 6 July" from a YYYY-MM-DD string (noon avoids TZ edge cases).
const prettyDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  } catch { return dateStr; }
};

export default function KidNotesArchive() {
  const { user } = useAuth();
  const [notes, setNotes] = useState(null); // null = loading
  const [members, setMembers] = useState([]);
  const [childFilter, setChildFilter] = useState(null); // child_id or null = all

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/kids/notes', { params: { limit: 60 } }).then((r) => r.data?.notes || []).catch(() => []),
      api.get('/household').then((r) => r.data?.members || []).catch(() => []),
    ]).then(([ns, ms]) => {
      if (cancelled) return;
      setNotes(ns);
      setMembers(ms);
    });
    return () => { cancelled = true; };
  }, []);

  const memberById = useMemo(() => {
    const m = {};
    for (const x of members) m[x.id] = x;
    return m;
  }, [members]);

  // Children who have actually sent a note - the filter chips.
  const kidsWithNotes = useMemo(() => {
    const seen = new Map();
    for (const n of (notes || [])) if (!seen.has(n.child_id)) seen.set(n.child_id, n.child_name || memberById[n.child_id]?.name || 'Child');
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [notes, memberById]);

  const shown = (notes || []).filter((n) => !childFilter || n.child_id === childFilter);

  const react = async (note, emoji) => {
    const applied = { ...note.reactions, [user.id]: emoji };
    setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: applied } : n)));
    try {
      const { data } = await api.post(`/kids/notes/${note.id}/reactions`, { emoji });
      setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: data.note.reactions } : n)));
    } catch { /* keep optimistic; re-syncs on next load */ }
  };

  return (
    <div className="max-w-[720px] mx-auto">
      <PageHeader
        title="Notes from the kids"
        subtitle="Every note your children have sent you - keep them, react, or print."
      />

      {kidsWithNotes.length > 1 && (
        <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 18 }}>
          <Chip on={!childFilter} onClick={() => setChildFilter(null)}>Everyone</Chip>
          {kidsWithNotes.map((k) => (
            <Chip key={k.id} on={childFilter === k.id} onClick={() => setChildFilter(k.id)}>{k.name}</Chip>
          ))}
        </div>
      )}

      {notes === null ? null
        : shown.length === 0 ? <Empty />
          : (
            <div className="flex flex-col" style={{ gap: 16 }}>
              {shown.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  kid={memberById[note.child_id]}
                  memberById={memberById}
                  currentUserId={user?.id}
                  onReact={react}
                />
              ))}
            </div>
          )}
    </div>
  );
}

function Chip({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 0, cursor: 'pointer', borderRadius: 99, padding: '7px 14px', fontSize: 13, fontWeight: 600,
        background: on ? 'var(--color-plum)' : SOFT, color: on ? '#fff' : INK2,
      }}
    >
      {children}
    </button>
  );
}

function Empty() {
  return (
    <div style={{ background: '#fff', borderRadius: 22, boxShadow: CARD_SHADOW, padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 44 }}>💌</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: '#1A1620', marginTop: 10 }}>No notes yet</div>
      <div style={{ fontSize: 14, color: INK3, marginTop: 6, maxWidth: 320, margin: '6px auto 0' }}>
        When your kids draw or write you a note from Kids Mode, it&apos;ll be kept here.
      </div>
    </div>
  );
}

function NoteCard({ note, kid, memberById, currentUserId, onReact }) {
  const mine = note.reactions?.[currentUserId];
  const otherReactors = Object.entries(note.reactions || {})
    .filter(([uid]) => uid !== currentUserId)
    .map(([uid, emoji]) => ({ name: memberById[uid]?.name, emoji }))
    .filter((r) => r.name);

  return (
    <div style={{ background: '#fff', borderRadius: 22, boxShadow: CARD_SHADOW, overflow: 'hidden' }}>
      {/* Header: who + when + print */}
      <div className="flex items-center" style={{ gap: 10, padding: '14px 16px 12px' }}>
        <Avatar member={kid} size={32} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-bark">{note.child_name || kid?.name || 'One of the kids'}</div>
          <div style={{ fontSize: 12, color: INK3 }}>{prettyDate(note.note_date)}</div>
        </div>
        <button
          type="button"
          onClick={() => printNote(note)}
          style={{ border: 0, background: SOFT, color: INK2, borderRadius: 10, padding: '7px 11px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          🖨 Print
        </button>
      </div>

      {note.image_url && (
        <img src={note.image_url} alt={`Drawing from ${note.child_name || 'a child'}`} style={{ display: 'block', width: '100%' }} />
      )}
      {note.text_note && (
        <div style={{ padding: '14px 16px', fontSize: 16, fontWeight: 500, color: INK2, borderTop: note.image_url ? '1px solid rgba(26,22,32,0.06)' : 'none' }}>
          “{note.text_note}”
        </div>
      )}

      {/* Reactions */}
      <div style={{ padding: '12px 16px 14px', borderTop: '1px solid rgba(26,22,32,0.06)' }}>
        <div className="flex items-center" style={{ gap: 6, flexWrap: 'wrap' }}>
          {REACTIONS.map((emoji) => {
            const on = mine === emoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(note, emoji)}
                aria-label={`React ${emoji}`}
                aria-pressed={on}
                style={{
                  border: 0, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '8px 11px', borderRadius: 99,
                  background: on ? 'var(--color-plum)' : SOFT,
                  transform: on ? 'scale(1.08)' : 'none', transition: 'transform .15s, background .15s',
                }}
              >
                {emoji}
              </button>
            );
          })}
        </div>
        {otherReactors.length > 0 && (
          <div style={{ fontSize: 12, color: INK3, marginTop: 8 }}>
            {otherReactors.map((r) => `${r.name} ${r.emoji}`).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}
