import { hexFor } from '../../lib/memberColors';

/**
 * Avatar - solid colour circle with the member's initial, or their uploaded
 * photo when present. Colour resolves from `member.color_theme` via the
 * shared palette (see lib/memberColors). Ported from the desktop design
 * handoff; the one shared implementation the app uses everywhere.
 *
 * Props:
 *   member  - { name, color_theme, avatar_url }
 *   size    - px diameter (default 40)
 *   className / style - merged onto the root
 */
export default function Avatar({ member, size = 40, className = '', style = {} }) {
  if (!member) return null;

  const base = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    ...style,
  };

  if (member.avatar_url) {
    return (
      <img
        src={member.avatar_url}
        alt={member.name || ''}
        className={className}
        style={{ ...base, objectFit: 'cover' }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        ...base,
        background: hexFor(member),
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: size * 0.42,
        letterSpacing: -0.2,
      }}
      aria-hidden="true"
    >
      {member.name?.[0]?.toUpperCase() || '?'}
    </div>
  );
}
