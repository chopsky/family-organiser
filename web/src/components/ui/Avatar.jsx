import { useState } from 'react';
import { hexFor, tintFor } from '../../lib/memberColors';
import { avatarSrc } from '../../lib/avatarSet';

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
export default function Avatar({ member, size = 40, className = '', style = {}, bg }) {
  // Track the URL that failed to load so a broken photo falls back to the
  // coloured initial instead of the browser's broken-image icon. Keyed on the
  // URL (not a boolean) so a later re-upload - a new URL - is retried rather
  // than staying stuck on the fallback.
  const [erroredUrl, setErroredUrl] = useState(null);
  if (!member) return null;

  const base = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    ...style,
  };

  if (member.avatar_url && erroredUrl !== member.avatar_url) {
    // Has-photo state: keep the member's identifying colour visible as a ring
    // around the photo (the solid fill is gone once a photo replaces it).
    // Outer = coloured ring, middle = thin white gap, inner = the photo.
    // box-sizing: border-box throughout so the whole thing stays size x size.
    const ring = Math.max(2, Math.round(size * 0.09)); // coloured ring thickness
    const gap = Math.max(1, Math.round(size * 0.045));  // white gap thickness
    return (
      <div
        className={className}
        style={{
          ...base,
          background: hexFor(member),
          padding: ring,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: '#fff',
            padding: gap,
            boxSizing: 'border-box',
          }}
        >
          <img
            src={member.avatar_url}
            alt={member.name || ''}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              objectFit: 'cover',
              display: 'block',
            }}
            onError={() => setErroredUrl(member.avatar_url)}
          />
        </div>
      </div>
    );
  }

  // Chosen illustrated avatar (no photo) - the illustration sits on a soft tint
  // of the member's identifying colour, anchored to the bottom of the circle.
  if (member.avatar_id) {
    return (
      <div
        className={className}
        // Flat, opaque pastel tint of the member's colour (see tintFor) so the
        // circle is clearly visible and overlapping avatars occlude cleanly.
        // `bg` overrides it - e.g. white on the Tasks/Rewards columns where a
        // tint would clash with the surface.
        style={{ ...base, background: bg || tintFor(member), overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <img
          src={avatarSrc(member.avatar_id)}
          alt={member.name || ''}
          // 80% width + vertically centred: a little breathing room in the circle.
          style={{ width: '80%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
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
