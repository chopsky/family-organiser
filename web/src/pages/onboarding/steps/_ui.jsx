// Shared visual primitives for the onboarding steps - mapped to our plum tokens
// + Instrument Serif (loaded app-wide). British English, no em dashes. Plain
// shared constants (SERIF, inputStyle, labelStyle) live in ./_styles so this
// module only exports components (react-refresh).
import { SERIF } from './_styles';

export function Title({ children, size = 32 }) {
  return (
    <h1 style={{ fontFamily: SERIF, fontWeight: 400, fontSize: size, lineHeight: 1.08, letterSpacing: '-0.02em', color: 'var(--color-charcoal)', margin: 0 }}>
      {children}
    </h1>
  );
}

// The emphasised phrase in each title: serif, plum (or WhatsApp green on
// step 7). Upright, not italic - Recoleta has no true italic. `block` drops
// it onto its own line (welcome + account screens).
export function Em({ children, block = false, color = 'var(--color-plum)' }) {
  return <span style={{ fontStyle: 'normal', color, display: block ? 'block' : 'inline' }}>{children}</span>;
}

export function Kicker({ children, color = 'var(--color-plum)' }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color, marginBottom: 12 }}>{children}</div>;
}

export function Lead({ children }) {
  return <p style={{ fontSize: 14, color: 'var(--color-cocoa)', lineHeight: 1.5, margin: '14px auto 0', maxWidth: 400 }}>{children}</p>;
}

// Matches the Login/Signup primary button: Inter 14/600, 14x18 padding, 12px
// radius, soft plum shadow (green variant for the WhatsApp step).
export function PrimaryButton({ children, onClick, disabled = false, green = false, type = 'button', style }) {
  const bg = green ? '#25A35A' : 'var(--color-plum)';
  const shadow = green ? '0 6px 16px -8px rgba(37,163,90,0.5)' : '0 6px 16px -8px rgba(107,63,160,0.45)';
  return (
    <button
      type={type} onClick={onClick} disabled={disabled}
      style={{ width: '100%', padding: '14px 18px', border: 0, borderRadius: 12, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-sans)', background: bg, color: '#fff', fontSize: 14, fontWeight: 600, lineHeight: 1.45, opacity: disabled ? 0.45 : 1, boxShadow: disabled ? 'none' : shadow, ...style }}
    >
      {children}
    </button>
  );
}

export function Ghost({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ width: '100%', padding: 13, border: 0, background: 'transparent', color: 'var(--color-warm-grey)', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, cursor: 'pointer', marginTop: 4 }}>
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

// Pill segmented control (Start new / Join existing).
export function Segmented({ value, onChange, options }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 4, background: 'var(--color-oat)', border: '1px solid rgba(26,22,32,0.06)', borderRadius: 12, padding: 4 }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key} role="tab" type="button" aria-selected={active}
            onClick={() => onChange(o.key)}
            style={{ flex: 1, padding: '10px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 13.5, background: active ? '#fff' : 'transparent', color: active ? 'var(--color-charcoal)' : 'var(--color-warm-grey)', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', transition: 'all .15s ease' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
