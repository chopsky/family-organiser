// Icon set — minimalist line + filled variants. 24px viewBox.
const I = {
  home: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z"/>
    </svg>
  ),
  homeFill: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
      <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2v-9z"/>
    </svg>
  ),
  cal: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="3"/>
      <path d="M3 10h18M8 3v4M16 3v4"/>
    </svg>
  ),
  calFill: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
      <path d="M6 3a1 1 0 0 1 2 0v2h8V3a1 1 0 0 1 2 0v2a3 3 0 0 1 3 3v2H3V8a3 3 0 0 1 3-3V3zM3 12h18v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6z"/>
    </svg>
  ),
  check: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  ),
  checkFill: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
      <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm11.3 6.3a1 1 0 0 0-1.4-1.4L11 11.8 9.1 9.9a1 1 0 0 0-1.4 1.4l2.6 2.6a1 1 0 0 0 1.4 0l5.6-5.6z"/>
    </svg>
  ),
  cart: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h2l2.5 12h11l2-9H6"/>
      <circle cx="9" cy="20" r="1.4"/>
      <circle cx="17" cy="20" r="1.4"/>
    </svg>
  ),
  cartFill: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
      <path d="M2.5 3.5A1 1 0 0 1 3.5 3H5a2 2 0 0 1 1.96 1.6L7.2 6h13.2a1.5 1.5 0 0 1 1.46 1.83l-1.86 8a1.5 1.5 0 0 1-1.46 1.17H8.6L8.4 18H19a1 1 0 1 1 0 2H7.5a1 1 0 0 1-.98-.8L4.18 4.6 3.5 4.5a1 1 0 0 1-1-1zM10 22a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm8 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>
    </svg>
  ),
  fork: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 0-3 2-3 5s1 5 3 5v8"/>
    </svg>
  ),
  forkFill: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
      <path d="M7 2a1 1 0 0 1 1 1v7a1 1 0 0 0 2 0V3a1 1 0 1 1 2 0v7a3 3 0 0 1-2 2.83V21a1 1 0 1 1-2 0v-8.17A3 3 0 0 1 6 10V3a1 1 0 0 1 1-1zm10 0a1 1 0 0 1 1 1v18a1 1 0 1 1-2 0v-7h-1a1 1 0 0 1-1-1V7a5 5 0 0 1 3-5z"/>
    </svg>
  ),
  sparkle: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
      <path d="M12 2l1.8 4.7a4 4 0 0 0 2.5 2.5L21 11l-4.7 1.8a4 4 0 0 0-2.5 2.5L12 20l-1.8-4.7a4 4 0 0 0-2.5-2.5L3 11l4.7-1.8a4 4 0 0 0 2.5-2.5L12 2z"/>
      <path d="M19 2l.7 1.8a1.5 1.5 0 0 0 .8.8L22 5l-1.5.4a1.5 1.5 0 0 0-.8.8L19 8l-.7-1.8a1.5 1.5 0 0 0-.8-.8L16 5l1.5-.4a1.5 1.5 0 0 0 .8-.8L19 2z"/>
    </svg>
  ),
  mic: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3"/>
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>
    </svg>
  ),
  send: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'currentColor'}>
      <path d="M3.4 11.1L20 3.5a1 1 0 0 1 1.3 1.3l-7.6 16.6a1 1 0 0 1-1.86-.04l-2.4-6.3a1 1 0 0 0-.6-.6l-6.3-2.4a1 1 0 0 1-.04-1.86z"/>
    </svg>
  ),
  plus: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  ),
  paperclip: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8"/>
    </svg>
  ),
  arrow: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6"/>
    </svg>
  ),
  bell: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/>
      <path d="M10 20a2 2 0 0 0 4 0"/>
    </svg>
  ),
  search: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7"/><path d="M16 16l4 4"/>
    </svg>
  ),
  close: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18"/>
    </svg>
  ),
  filter: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill="none" stroke={p.color||'currentColor'} strokeWidth={p.w||1.8} strokeLinecap="round">
      <path d="M3 5h18M6 12h12M10 19h4"/>
    </svg>
  ),
  dot: (p={}) => (
    <svg width={p.size||8} height={p.size||8} viewBox="0 0 8 8" fill={p.color||'currentColor'}>
      <circle cx="4" cy="4" r="4"/>
    </svg>
  ),
  // Logo mark — simplified house with two figures
  logo: (p={}) => (
    <svg width={p.size||24} height={p.size||24} viewBox="0 0 24 24" fill={p.color||'#6C3DD9'}>
      <path d="M12 2L2 11h2v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V11h2L12 2z"/>
      <circle cx="9" cy="14" r="2.2" fill="#fff"/>
      <circle cx="15" cy="14" r="2.2" fill="#fff"/>
      <path d="M9 16.2c0 1 .5 2.3 3 2.3s3-1.3 3-2.3" stroke="#fff" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
    </svg>
  ),
};

window.I = I;
