/**
 * Provider glyphs for calendar sources — simplified, brand-evocative marks
 * drawn inline so there are no external logo assets to ship or licence.
 *
 * Shared by Settings → Connect Calendars and the v4 onboarding calendar step,
 * so the two surfaces can't drift apart. Sizes in use: 24-30px in menu rows,
 * 34px in the onboarding tiles.
 */
export default function ProviderLogo({ id, size = 28 }) {
  const s = { width: size, height: size, flexShrink: 0 };
  if (id === 'google') {
    // Google Calendar (2020): a white page with the four Google brand colours
    // on its edges (blue TL, red TR, green BL, yellow BR) and a blue "31".
    return (
      <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
        <defs>
          <clipPath id="gcal-card"><rect x="1.5" y="1.5" width="21" height="21" rx="3.5" /></clipPath>
        </defs>
        <g clipPath="url(#gcal-card)">
          <rect x="1.5" y="1.5" width="10.5" height="10.5" fill="#4285F4" />
          <rect x="12" y="1.5" width="10.5" height="10.5" fill="#EA4335" />
          <rect x="1.5" y="12" width="10.5" height="10.5" fill="#34A853" />
          <rect x="12" y="12" width="10.5" height="10.5" fill="#FBBC04" />
        </g>
        <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="1.6" fill="#fff" />
        <text x="12" y="16.2" textAnchor="middle" fontSize="8.4" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text>
      </svg>
    );
  }
  if (id === 'apple') {
    return (
      <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#fff" stroke="#E8E5EC" strokeWidth="1" />
        <text x="12" y="7.8" textAnchor="middle" fontSize="4.4" fontWeight="700" fill="#E25555" fontFamily="Arial, sans-serif">MON</text>
        <text x="12" y="18.4" textAnchor="middle" fontSize="10.5" fontWeight="500" fill="#2D2A33" fontFamily="Arial, sans-serif">25</text>
      </svg>
    );
  }
  if (id === 'outlook') {
    // Microsoft Outlook: the blue "O" panel + calendar grid (the real icon).
    return (
      <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
        <path fill="#1976d2" d="M28,13h14.533C43.343,13,44,13.657,44,14.467v19.066C44,34.343,43.343,35,42.533,35H28V13z" />
        <rect width="14" height="15.542" x="28" y="17.958" fill="#fff" />
        <polygon fill="#1976d2" points="27,44 4,39.5 4,8.5 27,4" />
        <path fill="#fff" d="M15.25,16.5c-3.176,0-5.75,3.358-5.75,7.5s2.574,7.5,5.75,7.5S21,28.142,21,24S18.426,16.5,15.25,16.5z M15,28.5c-1.657,0-3-2.015-3-4.5s1.343-4.5,3-4.5s3,2.015,3,4.5S16.657,28.5,15,28.5z" />
        <rect width="2.7" height="2.9" x="28.047" y="29.737" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="29.737" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="29.737" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="28.047" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="38.25" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="28.047" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="38.25" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="19.112" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="19.112" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="38.25" y="19.112" fill="#1976d2" />
      </svg>
    );
  }
  // School / club link
  return (
    <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#7DAE82" />
      <path d="M10.2 13.8 13.8 10.2 M9 11.5l-2 2a2.6 2.6 0 0 0 3.7 3.7l2-2 M15 12.5l2-2a2.6 2.6 0 0 0-3.7-3.7l-2 2" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
