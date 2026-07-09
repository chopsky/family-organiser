// Shared Kids-mode primitives: star pill, confetti + celebration overlay,
// the gradient-filled Housemait KIDS logo, and the section header. Pure
// presentational components; the theme comes in via props (see kidsTheme.js).
import { useEffect } from 'react';
import { KIDS_INK } from '../../lib/kidsTheme';

export function Star({ s = 16 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="#FBB733" stroke="#E89A12" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.2L12 17.8 6.1 20.4l1.3-6.2L2.7 9.6l6.3-.7L12 3z" />
    </svg>
  );
}

export function StarPill({ n, big }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: big ? 7 : 4, background: '#FFF3D6', padding: big ? '8px 16px' : '3px 10px 3px 8px', borderRadius: 999, border: '2px solid #FBE0A0' }}>
      <Star s={big ? 24 : 15} />
      <b style={{ fontWeight: 600, fontSize: big ? 24 : 14, color: '#B77B10' }}>{n}</b>
    </span>
  );
}

export function Confetti() {
  const cols = ['#3BB4F5', '#8B5CF6', '#FBB733', '#FB6F92', '#34D399'];
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 60 }}>
      {Array.from({ length: 70 }).map((_, i) => {
        // Deterministic pseudo-random spread so renders are stable.
        const l = (i * 37) % 100, dl = ((i * 13) % 10) / 20, du = 2 + ((i * 7) % 16) / 10, s = 8 + ((i * 11) % 8);
        return (
          <span key={i} className="kids-anim" style={{ position: 'absolute', top: 0, left: `${l}%`, width: s, height: s * 1.3, background: cols[i % 5], borderRadius: 3, animation: `kids-conffall ${du}s ${dl}s linear forwards` }} />
        );
      })}
    </div>
  );
}

export function Celebrate({ data, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div onClick={onDone} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(49,43,75,0.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Confetti />
      <div className="kids-anim" style={{ background: '#fff', borderRadius: 36, padding: '34px 30px', textAlign: 'center', width: '100%', maxWidth: 320, boxShadow: '0 20px 60px rgba(49,43,75,0.4)', animation: 'kids-burst-pop .5s ease forwards' }}>
        <div className="kids-wobble" style={{ fontSize: 74 }}>{data.emoji}</div>
        <div style={{ fontSize: 26, fontWeight: 600, marginTop: 8, color: KIDS_INK.ink }}>{data.title}</div>
        <div style={{ fontSize: 16, fontWeight: 500, color: KIDS_INK.ink2, marginTop: 6 }}>{data.sub}</div>
      </div>
    </div>
  );
}

// The Housemait logomark (extracted from housemait-logo-web.svg: the house +
// its two window dots, all recoloured to the kid's gradient) with the brand
// name set as TEXT (21px Fredoka, not the SVG wordmark) + the yellow KIDS
// badge.
export function KidsLogo({ c1, c2 }) {
  const gid = 'klg_' + String(c1 || '').replace('#', '');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <svg width={30} height={23} viewBox="0 0 200 162.44">
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></linearGradient></defs>
        <path fill={`url(#${gid})`} d="M170.64,49.13l12.68,9.24c7.66,5.55,14.84,10.98,15.98,11.99,4.84,4.38,4.34,10.55-1.17,14.26-3.52,2.34-6.6,1.56-12.89-3.2-1.95-1.48-3.67-2.54-3.98-2.42-.47.2-.55,5.86-.55,38.32s-.08,38.28-.59,39.57c-.75,2.1-1.39,2.89-2.74,3.87s-1.44,1.03-2.18,1.29-1.15.38-2.04.38h-24.95c-17.34,0-26.8-.16-27.77-.43-1.91-.51-4.49-2.85-5.39-4.84-.66-1.41-.74-2.89-.74-16.48,0-10.39-.12-14.96-.43-14.96-.23,0-1.91,1.25-3.79,2.81-4.73,3.87-7.73,5.78-9.26,5.78s-3.79-1.45-8.16-5.31c-1.84-1.6-3.52-2.89-3.75-2.89-.27,0-.39,4.61-.39,14.22,0,16.52-.14,15.86-.99,17.81-1,1.9-3.87,4.31-6.04,4.31-1.89,0-25.79,0-25.79,0-23.79,0-27.3-.08-28.32-.63h-.02c-1.84-.94-3.75-2.93-4.57-4.77-.74-1.64-.78-2.77-.74-39.77.04-35.27,0-38.05-.63-38.05-.35,0-2.42,1.21-4.61,2.66-5.31,3.63-6.99,4.26-9.73,3.63-3.44-.78-5.94-3.16-6.84-6.6-.86-3.09.55-6.91,3.09-8.55,1.33-.86,2.81-1.95,7.03-5.35,1.17-.94,2.89-2.23,3.75-2.81,2.5-1.76,10-7.27,19.88-14.65,14.47-10.55,28.5-20.97,42.89-31.81,4.65-3.44,10.55-7.77,13.05-9.65,7.03-5.2,7.84-6.09,11.19-6.09,2.94,0,3.75.67,4.91,1.21,1.64,1.11,3.94,2.54,8.44,5.82M54.95,128.06c.23-18.44.27-19.06,2.58-23.83,3.39-5.5,7.79-8.76,14.15-9.31,5.25-1,9.94,1.17,14.06,4.23,1.13.9,4.96,4.45,8.48,7.89l6.41,6.25,1.21-1.02c.66-.55,3.79-3.48,6.91-6.48,7.23-6.88,9.53-8.59,12.66-9.49,2.18-.64,3.41-1.37,5.78-1.36,3.08,0,6.69-.21,9.41,1.21,4.61,2.34,8.13,6.48,9.8,11.56.82,2.46.86,3.44,1.09,19.96l.2,17.38h16.02v-79.26l-19.92-15c-28.83-21.68-41.95-31.33-42.7-31.33-.35,0-2.93,1.72-5.7,3.83-13.32,10-28.83,21.64-45.55,34.06l-11.29,8.4v39.49c-.04,21.72.08,39.61.23,39.77.16.12,3.79.2,8.09.16l7.85-.12.23-16.99h0Z" />
        <path fill={`url(#${gid})`} d="M68.91,88.98c-12.99-3.42-15.25-21.12-3.81-27.97,10.83-6.74,25.17,2.44,23.15,15.15-1.08,8.84-10.55,15.28-19.15,12.86l-.19-.05Z" />
        <path fill={`url(#${gid})`} d="M125.88,89c-12.51-2.66-16.19-19.3-6.07-27.06,9.59-7.72,24.58-1.08,25.02,11.28.67,9.77-9.22,18.12-18.75,15.82l-.19-.04Z" />
      </svg>
      <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: -0.5 }}>Housemait</span>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1, color: '#fff', background: KIDS_INK.sun, padding: '3px 8px', borderRadius: 999, boxShadow: '0 3px 0 rgba(233,154,18,0.35)' }}>KIDS</span>
    </div>
  );
}

export function Section({ title, emoji, count, accent, hint, style, children }) {
  return (
    <div className="kids-card-in" style={{ marginBottom: 20, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 10px' }}>
        <span style={{ fontSize: 20 }}>{emoji}</span>
        <span style={{ fontSize: 19, fontWeight: 600 }}>{title}</span>
        {count != null && <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', background: accent, padding: '2px 10px', borderRadius: 999 }}>{count}</span>}
        {hint && <span style={{ fontSize: 12, color: 'inherit', opacity: 0.55, fontWeight: 500, marginLeft: 'auto' }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}
