import { Link } from 'react-router-dom';

/**
 * Minimal auth-screen top bar (LiveChat-style): a small wordmark top-left
 * and the opposite-action link top-right ("Sign up free" on /login,
 * "Log in" on /signup). Absolutely positioned so it floats over the
 * vertically-centred auth card; the screens pad their content down to
 * clear it. `cta` is { label, to } (omit for a logo-only header).
 */
export default function AuthHeader({ cta }) {
  return (
    <header
      className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 sm:px-8"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 18px)', paddingBottom: 14 }}
    >
      <Link to="/" aria-label="Housemait home" className="shrink-0 inline-flex">
        <img src="/housemait-logo-web.svg" alt="Housemait" style={{ height: 24, width: 'auto', display: 'block' }} />
      </Link>
      {cta && (
        <Link
          to={cta.to}
          className="shrink-0"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--color-plum)',
            textDecoration: 'none',
            padding: '9px 18px',
            borderRadius: 8, // match the "Continue with..." buttons (Tailwind rounded-lg)
            border: '1px solid rgba(107, 63, 160, 0.28)',
            background: 'rgba(255, 255, 255, 0.65)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
        >
          {cta.label}
        </Link>
      )}
    </header>
  );
}
