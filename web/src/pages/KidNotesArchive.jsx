/**
 * KidNotesArchive - "Notes from the kids": the parents' keepsake history of
 * every note a child has sent from Kids Mode.
 *
 * Laid out as a photo-library gallery so it stays navigable as daily notes
 * pile up across children: compact thumbnails in a responsive grid under
 * date headers (Today / Yesterday / earlier this month / past months).
 * Today's notes render larger - they're the ones a parent is most likely
 * to react to; everything older is the archive. Tapping a tile opens the
 * same full-note popup as the banner (drawing, message, reactions, Print).
 *
 * The KidNoteAlert banner only nudges recent, un-reacted notes; this page
 * is where a parent revisits ALL of them - drawings AND text-only ones,
 * whether or not they've reacted. Reachable from the Household nav group /
 * More sheet. Adult-only: in Child Mode the ChildGate redirects /notes to
 * the kids' home.
 */
import { useState, useEffect, useMemo } from 'react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { confirmDestructive } from '../lib/action-sheet';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import KidNotePopup from '../components/KidNotePopup';
import { prettyNoteDate } from '../lib/kidNotes';

const INK2 = '#4A4453';
const INK3 = '#8A8493';
const SOFT = '#F3EEE5';
const CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';

// Bucket the (already newest-first) notes under date headers. `refs` holds
// today/yesterday as YYYY-MM-DD strings, captured at fetch time so this
// stays pure at render (react-hooks/purity forbids Date.now() in render).
function groupByDate(notes, refs) {
  if (!refs) return [];
  const groups = [];
  for (const n of notes) {
    let key; let label; let big = false;
    if (n.note_date === refs.today) {
      key = 'today'; label = 'Today'; big = true;
    } else if (n.note_date === refs.yesterday) {
      key = 'yesterday'; label = 'Yesterday';
    } else {
      key = n.note_date.slice(0, 7); // YYYY-MM
      const d = new Date(`${n.note_date}T12:00:00`);
      label = key === refs.today.slice(0, 7)
        ? `Earlier in ${d.toLocaleDateString(undefined, { month: 'long' })}`
        : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.notes.push(n);
    else groups.push({ key, label, big, notes: [n] });
  }
  return groups;
}

export default function KidNotesArchive() {
  const { user } = useAuth();
  const [notes, setNotes] = useState(null); // null = loading
  const [members, setMembers] = useState([]);
  const [refs, setRefs] = useState(null); // { today, yesterday } YYYY-MM-DD
  const [childFilter, setChildFilter] = useState(null); // child_id or null = all
  const [viewingId, setViewingId] = useState(null); // note open in the popup

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/kids/notes', { params: { limit: 200 } }).then((r) => r.data?.notes || []).catch(() => []),
      api.get('/household').then((r) => r.data?.members || []).catch(() => []),
    ]).then(([ns, ms]) => {
      if (cancelled) return;
      setRefs({
        today: new Date().toLocaleDateString('en-CA'),
        yesterday: new Date(Date.now() - 24 * 3600 * 1000).toLocaleDateString('en-CA'),
      });
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

  const shown = useMemo(
    () => (notes || []).filter((n) => !childFilter || n.child_id === childFilter),
    [notes, childFilter],
  );
  const groups = useMemo(() => groupByDate(shown, refs), [shown, refs]);

  // Derive the open note from the list so reactions stay in sync.
  const viewing = viewingId ? (notes || []).find((n) => n.id === viewingId) : null;

  const react = async (note, emoji) => {
    const applied = { ...note.reactions, [user.id]: emoji };
    setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: applied } : n)));
    try {
      const { data } = await api.post(`/kids/notes/${note.id}/reactions`, { emoji });
      setNotes((ns) => ns.map((n) => (n.id === note.id ? { ...n, reactions: data.note.reactions } : n)));
    } catch { /* keep optimistic; re-syncs on next load */ }
  };

  const removeNote = async (note) => {
    const ok = await confirmDestructive({
      title: 'Delete this note?',
      message: `${note.child_name || 'This'} note from ${prettyNoteDate(note.note_date)} will be gone for good.`,
      confirmLabel: 'Delete note',
    });
    if (!ok) return;
    try {
      await api.delete(`/kids/notes/${note.id}`);
      setNotes((ns) => ns.filter((n) => n.id !== note.id));
      setViewingId(null);
    } catch { /* leave the note in place; nothing was deleted */ }
  };

  return (
    <div className="max-w-[720px] mx-auto pb-24">
      <PageHeader title="Notes from the kids" />

      {kidsWithNotes.length > 1 && (
        <div className="flex flex-wrap" style={{ gap: 8, marginBottom: 6 }}>
          <Chip on={!childFilter} onClick={() => setChildFilter(null)}>Everyone</Chip>
          {kidsWithNotes.map((k) => (
            <Chip key={k.id} on={childFilter === k.id} onClick={() => setChildFilter(k.id)}>{k.name}</Chip>
          ))}
        </div>
      )}

      {notes === null ? null
        : shown.length === 0 ? <Empty />
          : groups.map((g) => (
            <section key={g.key}>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: INK3, margin: '18px 0 10px' }}>
                {g.label} <span style={{ fontWeight: 500 }}>· {g.notes.length}</span>
              </div>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: `repeat(auto-fill, minmax(${g.big ? 150 : 106}px, 1fr))` }}>
                {g.notes.map((note) => (
                  <NoteTile
                    key={note.id}
                    note={note}
                    kid={memberById[note.child_id]}
                    big={g.big}
                    unreacted={!note.reactions?.[user?.id]}
                    myReaction={note.reactions?.[user?.id]}
                    onOpen={() => setViewingId(note.id)}
                  />
                ))}
              </div>
            </section>
          ))}

      {viewing && (
        <KidNotePopup
          note={viewing}
          currentUserId={user?.id}
          onReact={(emoji) => react(viewing, emoji)}
          onClose={() => setViewingId(null)}
          onDelete={() => removeNote(viewing)}
        />
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
    <div style={{ background: '#fff', borderRadius: 22, boxShadow: CARD_SHADOW, padding: '48px 24px', textAlign: 'center', marginTop: 12 }}>
      <div style={{ fontSize: 44 }}>💌</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: '#1A1620', marginTop: 10 }}>No notes yet</div>
      <div style={{ fontSize: 14, color: INK3, marginTop: 6, maxWidth: 320, margin: '6px auto 0' }}>
        When your kids draw or write you a note from Kids Mode, it&apos;ll be kept here.
      </div>
    </div>
  );
}

// One gallery thumbnail: the drawing (or the message, for text-only notes),
// a footer with who sent it, and a coral dot when this user hasn't reacted
// yet (same convention as the tab-bar notification dot).
function NoteTile({ note, kid, big, unreacted, myReaction, onOpen }) {
  const name = note.child_name || kid?.name || 'Child';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Note from ${name}, ${note.note_date}`}
      style={{ display: 'block', width: '100%', padding: 0, border: 0, textAlign: 'left', background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: CARD_SHADOW, cursor: 'pointer' }}
    >
      <div style={{ aspectRatio: '4 / 3', background: SOFT, position: 'relative' }}>
        {note.image_url ? (
          <img
            src={note.image_url}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ padding: big ? 12 : 8, fontSize: big ? 14 : 12, fontStyle: 'italic', fontWeight: 500, color: INK2, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            “{note.text_note}”
          </div>
        )}
        {unreacted && (
          <span
            aria-hidden="true"
            style={{ position: 'absolute', top: 7, right: 7, width: 9, height: 9, borderRadius: '50%', background: 'var(--color-coral, #E8724A)', border: '1.5px solid #fff' }}
          />
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: big ? '7px 9px' : '5px 7px' }}>
        <Avatar member={kid} size={big ? 20 : 16} />
        <span style={{ fontSize: big ? 12 : 11, fontWeight: 600, color: '#1A1620', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
          {name}
        </span>
        {myReaction && <span style={{ marginLeft: 'auto', fontSize: big ? 13 : 11, flexShrink: 0 }}>{myReaction}</span>}
      </div>
    </button>
  );
}
