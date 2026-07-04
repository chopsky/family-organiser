// Plain shared style constants for the onboarding steps. Kept out of _ui.jsx so
// that file only exports components (react-refresh/only-export-components).
export const SERIF = 'var(--font-serif-display)';

// Matches the Login/Signup form fields + labels (14px input, 12px medium label).
export const inputStyle = {
  width: '100%', padding: '12px 14px', borderRadius: 12, background: '#fff',
  border: '1px solid rgba(26,22,32,0.10)', fontFamily: 'var(--font-sans)',
  fontSize: 14, color: 'var(--color-charcoal)', outline: 'none',
};

export const labelStyle = { display: 'block', fontSize: 12, fontWeight: 500, color: '#4A4453', marginBottom: 4 };
