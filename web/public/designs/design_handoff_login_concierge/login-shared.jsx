// Shared bits used by all login concepts

const GoogleG = ({size=18}) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.1 0-9.5-3.1-11.3-7.7l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C40.9 35.9 44 30.4 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);

const MailIcon = ({size=18, color='currentColor'}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="3"/>
    <path d="M3 7l9 7 9-7"/>
  </svg>
);

const AppleIcon = ({size=18, color='currentColor'}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M16.5 1c.1 1.1-.3 2.2-1 3.1-.7.9-1.8 1.6-2.9 1.5-.1-1.1.4-2.2 1-2.9.7-.9 1.9-1.5 2.9-1.7zM20 17.6c-.5 1.2-.8 1.7-1.5 2.7-1 1.5-2.4 3.3-4.1 3.3-1.5 0-1.9-1-3.9-1-2 0-2.5 1-4 1-1.7 0-3-1.7-4-3.1C1.7 17 1.4 12.4 3 9.9 4.1 8.1 5.9 7 7.6 7c1.7 0 2.8 1 4.2 1 1.4 0 2.3-1 4.3-1 1.5 0 3.1.8 4.2 2.2-3.7 2-3.1 7.3.7 8.4z"/>
  </svg>
);

const HouseGlyph = ({size=44, color='var(--brand)'}) => (
  // Stylized H + roof - original brand-aligned glyph
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
    <path d="M6 22 L24 6 L42 22 L42 40 Q42 42 40 42 L8 42 Q6 42 6 40 Z" stroke={color} strokeWidth="3" strokeLinejoin="round" fill="none"/>
    <path d="M17 42 V26 H31 V42" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
    <path d="M17 33 H31" stroke={color} strokeWidth="3" strokeLinecap="round"/>
    <circle cx="24" cy="18" r="1.6" fill={color}/>
  </svg>
);

// Reusable OAuth + email block. Variant: 'light' or 'dark'.
function AuthButtons({ variant='light', stacked=true, accent='var(--brand)' }) {
  const dark = variant === 'dark';
  const baseBtn = {
    width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:10,
    padding:'14px 18px', borderRadius:12, fontSize:14, fontWeight:600,
    cursor:'pointer', transition:'transform .15s ease, box-shadow .15s ease, background .15s ease',
  };
  const ghost = {
    ...baseBtn,
    background: dark ? 'rgba(255,255,255,0.06)' : '#fff',
    color: dark ? '#fff' : 'var(--ink)',
    border: dark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(26,22,32,0.10)',
    boxShadow: dark ? 'none' : '0 1px 0 rgba(26,22,32,0.04)',
  };
  // Google button is conventionally white-on-dark; only use accent color when light variant + override.
  const primary = {
    ...baseBtn,
    background: dark ? '#fff' : accent,
    color: dark ? '#1A1620' : (/^#F|^#E|^#D/i.test(accent) ? '#1A1620' : '#fff'),
    border:'1px solid transparent',
    boxShadow: dark ? '0 8px 24px -12px rgba(0,0,0,0.6)' : '0 6px 16px -8px rgba(108,61,217,0.45)',
  };

  return (
    <div style={{ display:'flex', flexDirection: stacked ? 'column' : 'row', gap:10 }}>
      <button style={primary}><GoogleG size={18}/> Continue with Google</button>
      <button style={ghost}><AppleIcon size={18} color={dark?'#fff':'var(--ink)'}/> Continue with Apple</button>
      <div style={{
        display:'flex', alignItems:'center', gap:10,
        margin:'4px 0', color: dark ? 'rgba(255,255,255,0.4)' : 'var(--ink-3)', fontSize:11, letterSpacing:'0.08em',
      }}>
        <div style={{ flex:1, height:1, background: dark ? 'rgba(255,255,255,0.14)' : 'var(--line-strong)' }}/>
        <span>OR</span>
        <div style={{ flex:1, height:1, background: dark ? 'rgba(255,255,255,0.14)' : 'var(--line-strong)' }}/>
      </div>
      <div style={{
        display:'flex', alignItems:'center', gap:10,
        padding:'12px 14px', borderRadius:12,
        background: dark ? 'rgba(255,255,255,0.04)' : '#fff',
        border: dark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(26,22,32,0.10)',
      }}>
        <MailIcon size={18} color={dark ? 'rgba(255,255,255,0.5)' : 'var(--ink-3)'}/>
        <input
          placeholder="you@household.com"
          defaultValue=""
          style={{
            flex:1, border:0, outline:'none', background:'transparent',
            color: dark ? '#fff' : 'var(--ink)', fontSize:14, padding:'4px 0',
          }}
        />
        <button style={{
          padding:'8px 14px', borderRadius:8, border:0, fontWeight:600, fontSize:13,
          background: dark ? '#fff' : 'var(--ink)', color: dark ? 'var(--ink)' : '#fff',
        }}>→</button>
      </div>
    </div>
  );
}

function LegalRow({ dark=false, align='center' }) {
  const c = dark ? 'rgba(255,255,255,0.45)' : 'var(--ink-3)';
  return (
    <div style={{
      display:'flex', justifyContent:align, gap:14, fontSize:11, color:c, letterSpacing:'0.02em',
    }}>
      <a style={{ color:c, textDecoration:'none' }}>Terms</a>
      <span>·</span>
      <a style={{ color:c, textDecoration:'none' }}>Privacy</a>
      <span>·</span>
      <a style={{ color:c, textDecoration:'none' }}>Help</a>
    </div>
  );
}

Object.assign(window, { GoogleG, MailIcon, AppleIcon, HouseGlyph, AuthButtons, LegalRow });
