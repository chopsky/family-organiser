// Shared visual primitives for the onboarding steps - mapped to our plum
// tokens + Instrument Serif (loaded app-wide). British English, no em dashes.
export const SERIF = "'Instrument Serif', serif";

export function Title({ children, size = 44 }) {
  return (
    <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: size, lineHeight: 1.04, letterSpacing: '-0.02em', color: 'var(--color-charcoal)', margin: 0 }}>
      {children}
    </h1>
  );
}

// The emphasised phrase in each title: serif italic, plum (or WhatsApp green on
// the WhatsApp step). `block` drops it onto its own line (welcome screen).
export function Em({ children, block = false, color = 'var(--color-plum)' }) {
  return <span style={{ fontStyle: 'italic', color, display: block ? 'block' : 'inline' }}>{children}</span>;
}

export function Kicker({ children, color = 'var(--color-plum)' }) {
  return <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color, marginBottom: 12 }}>{children}</div>;
}

export function Lead({ children }) {
  return <p style={{ fontSize: 16, color: 'var(--color-cocoa)', lineHeight: 1.5, margin: '14px auto 0', maxWidth: 430 }}>{children}</p>;
}

export function PrimaryButton({ children, onClick, disabled = false, green = false, type = 'button', style }) {
  const bg = green ? '#25A35A' : 'var(--color-plum)';
  const shadow = green ? '0 12px 26px -8px rgba(37,163,90,0.5)' : '0 12px 26px -8px rgba(109,56,173,0.45)';
  return (
    <button
      type={type} onClick={onClick} disabled={disabled}
      style={{ width: '100%', padding: 17, border: 0, borderRadius: 14, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', background: bg, color: '#fff', fontSize: 16.5, fontWeight: 700, opacity: disabled ? 0.45 : 1, boxShadow: disabled ? 'none' : shadow, ...style }}
    >
      {children}
    </button>
  );
}

export function Ghost({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ width: '100%', padding: 13, border: 0, background: 'transparent', color: 'var(--color-warm-grey)', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 500, cursor: 'pointer', marginTop: 4 }}>
      {children}
    </button>
  );
}

export function FiveStars() {
  return (
    <span style={{ display: 'inline-flex', gap: 2 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} width="15" height="15" viewBox="0 0 24 24" fill="#D89B3A" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.9 6.6 19.4l1.2-6L3.4 9.3l6-.7L12 3z" /></svg>
      ))}
    </span>
  );
}
