/**
 * Invite-aware landing for web visitors arriving on /signup?invite=<token>.
 *
 * The invite link gets tapped inside WhatsApp, whose in-app browser shows
 * no Smart App Banner - so without this screen a phone-first invitee lands
 * on a signup form with nothing steering them to the app, and installing
 * from the store would lose the invite entirely. This screen resolves the
 * token to the household's name AND its typeable code, so the person who
 * installs the app arrives with the code in hand ("Enter your invite code"
 * on the app's first screen), while "Continue in the browser" keeps the
 * web path one tap away.
 *
 * Native never renders this (the same URL deep-links straight into the
 * app's joiner flow), and an unresolvable token falls through to the
 * normal signup rather than dead-ending the visitor.
 */
import { useEffect, useState } from 'react';
import api from '../lib/api';
import { APP_STORE_URL, PLAY_STORE_URL } from '../lib/app-store';

export default function InviteLanding({ token, onContinue }) {
  const [state, setState] = useState('loading'); // loading | found | fallthrough
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/invites/lookup', { params: { token } })
      .then((res) => {
        if (cancelled) return;
        if (res.data?.valid) { setInfo(res.data); setState('found'); } else setState('fallthrough');
      })
      .catch(() => { if (!cancelled) setState('fallthrough'); });
    return () => { cancelled = true; };
  }, [token]);

  // Unknown/expired token or a lookup hiccup: the classic signup handles it
  // (the backend re-validates the token at registration anyway).
  useEffect(() => { if (state === 'fallthrough') onContinue(); }, [state, onContinue]);

  if (state !== 'found') return null;

  const codeShown = info.code ? `${info.code.slice(0, 3)}-${info.code.slice(3)}` : null;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--cream, #FBF8F3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center' }}>
      <img src="/housemait-logomark.svg" alt="Housemait" style={{ width: 56, height: 56 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      <h1 style={{ fontFamily: 'var(--font-serif-display, Georgia, serif)', fontWeight: 400, fontSize: 'clamp(28px, 7vw, 36px)', lineHeight: 1.1, color: '#2D2A33', margin: '20px 0 0', maxWidth: 340 }}>
        You&rsquo;re invited to join{' '}
        <span style={{ color: '#6B3FA0' }}>{info.householdName || 'a household'}</span>
      </h1>
      <p style={{ fontSize: 15.5, lineHeight: 1.5, color: '#6B6774', margin: '12px 0 0', maxWidth: 320 }}>
        {info.inviterName ? `${info.inviterName} uses` : 'Your family uses'} Housemait for the family
        calendar, lists, meals and school dates. Best experienced in the app.
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a
          href={APP_STORE_URL}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 20px',
            borderRadius: 14, background: '#2D2A33', color: '#fff', textDecoration: 'none',
            fontSize: 14.5, fontWeight: 600,
          }}
        >
           Download on the App Store
        </a>
        <a
          href={PLAY_STORE_URL}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 20px',
            borderRadius: 14, background: '#fff', color: '#2D2A33', textDecoration: 'none',
            border: '1.5px solid #E8E5EC', fontSize: 14.5, fontWeight: 600,
          }}
        >
          ▶ Get it on Google Play
        </a>
      </div>

      {codeShown && (
        <div style={{ marginTop: 18, padding: '13px 18px', borderRadius: 12, border: '1.5px dashed rgba(107,63,160,.35)', background: '#fff' }}>
          <p style={{ fontSize: 13, color: '#6B6774', margin: 0 }}>
            After installing, tap <b style={{ color: '#2D2A33' }}>&ldquo;Enter your invite code&rdquo;</b> and type
          </p>
          <p style={{ font: '700 20px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '.18em', color: '#6B3FA0', margin: '6px 0 0' }}>{codeShown}</p>
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        style={{ marginTop: 26, padding: '12px 20px', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 14.5, fontWeight: 600, color: '#6B3FA0', textDecoration: 'underline', textUnderlineOffset: 3 }}
      >
        Or continue in the browser
      </button>
    </div>
  );
}
