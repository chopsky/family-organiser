/**
 * KidNotePopup - the full-note dialog shared by the KidNoteAlert banner
 * and the Kids' Notes archive: the drawing/message, who sent it and when,
 * Print, and the one-tap emoji reaction row (the reaction loops back to
 * the kid's Note screen in Kids Mode).
 *
 * Presentational: the parent owns the note state and passes onReact so
 * optimistic updates land wherever the note lives (banner list / archive).
 * onDelete is optional - when provided (adult surfaces), a Delete button
 * renders; the caller owns confirmation and state removal.
 */
import { REACTIONS, printNote, prettyNoteDate } from '../lib/kidNotes';

const INK2 = '#4A4453';
const INK3 = '#8A8493';
const SOFT = '#F3EEE5';

export default function KidNotePopup({ note, currentUserId, onReact, onClose, onDelete }) {
  if (!note) return null;
  const mine = note.reactions?.[currentUserId];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(26,22,32,0.45)', padding: 20 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Note from ${note.child_name || 'a child'}`}
    >
      <div
        className="w-full"
        style={{ maxWidth: 400, background: '#fff', borderRadius: 22, padding: 20, boxShadow: '0 18px 50px rgba(26,22,32,0.25)', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ gap: 8 }}>
          <h2 style={{ fontFamily: 'var(--font-serif-display)', fontSize: 22, color: '#1A1620', margin: 0, minWidth: 0 }}>
            A note from {note.child_name || 'the kids'} 💌
          </h2>
          <div className="flex items-center" style={{ gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => printNote(note)}
              style={{ height: 34, padding: '0 12px', borderRadius: 10, border: 0, background: SOFT, color: INK2, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              🖨 Print
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{ width: 34, height: 34, borderRadius: 10, border: 0, background: SOFT, color: INK2, fontSize: 16, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: INK3, margin: '2px 0 12px' }}>{prettyNoteDate(note.note_date)}</div>

        {note.image_url && (
          <img
            src={note.image_url}
            alt={`Drawing from ${note.child_name || 'a child'}`}
            style={{ display: 'block', width: '100%', borderRadius: 14, border: '1px solid rgba(26,22,32,0.08)' }}
          />
        )}
        {note.text_note && (
          <div style={{ marginTop: note.image_url ? 10 : 0, fontSize: 15, fontWeight: 500, color: INK2 }}>
            “{note.text_note}”
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600, color: INK3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Send something back
        </div>
        <div className="flex items-center" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {REACTIONS.map((emoji) => {
            const on = mine === emoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
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
        {mine && (
          <div style={{ marginTop: 10, fontSize: 13, fontWeight: 500, color: INK2 }}>
            {note.child_name || 'They'} will see your {mine} on their screen. ✨
          </div>
        )}

        {onDelete && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(26,22,32,0.06)', textAlign: 'right' }}>
            <button
              type="button"
              onClick={onDelete}
              style={{ border: 0, background: 'transparent', color: 'var(--color-coral, #E8724A)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 8px' }}
            >
              Delete note
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
