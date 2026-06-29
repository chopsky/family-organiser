import { useEffect, useRef, useState } from 'react';
import api from '../../../lib/api';
import SocialButtons from '../../../components/SocialButtons';
import TurnstileWidget from '../../../components/TurnstileWidget';
import ErrorBanner from '../../../components/ErrorBanner';
import { clearSignupPromo } from '../../../lib/signupPromo';
import { Title, Em, Kicker, PrimaryButton, Ghost } from './_ui';
import { inputStyle, labelStyle } from './_styles';

// Human label for a confirmed promo, e.g. "25% off" or "£10 off" (lifted from
// Signup.jsx so the discount banner reads identically).
function promoDiscountLabel(info) {
  if (info?.percentOff) return `${info.percentOff}% off`;
  if (info?.amountOff) {
    const symbol = { gbp: '£', usd: '$', eur: '€', zar: 'R' }[info.currency] || '';
    return `${symbol}${(info.amountOff / 100).toFixed(2)} off`;
  }
  return 'A discount';
}

// Entry step. Creates the account. Google SSO is a popup, so it resolves in place
// and the flow advances without leaving the page. Email register has no token
// for normal signups, so it pauses on a "check your inbox" panel; verifying
// logs the user in and the auth gate funnels them back to resume.
//
// Discount/promo parity with Signup.jsx: the captured promoCode is confirmed
// for the banner, passed to BOTH register and the SSO buttons, and cleared once
// the account exists.
export default function AccountStep({ update, setError, goAfterAuth, inviteToken, promoCode, navigate }) {
  const [showEmail, setShowEmail] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstile, setTurnstile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [promoInfo, setPromoInfo] = useState(null);
  // Email-form errors render inline next to the Create account button (the card
  // is tall once the form is open, so the shared top-of-card banner scrolls out
  // of view). SSO errors still use the shared banner - the Google button is up
  // top where that banner is visible.
  const [formError, setFormError] = useState('');
  const turnstileRef = useRef(null);

  // Confirm the promo with the backend so the banner can show the real discount.
  // Reassurance only - a failed lookup just hides the banner; the code is still
  // saved + applied at checkout regardless.
  useEffect(() => {
    if (!promoCode) return undefined;
    let cancelled = false;
    api.get(`/subscription/promo/${encodeURIComponent(promoCode)}`)
      .then(({ data }) => { if (!cancelled && data?.valid) setPromoInfo(data); })
      .catch(() => { /* no banner on lookup failure */ });
    return () => { cancelled = true; };
  }, [promoCode]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setFormError('');
    if (!name.trim() || !email.trim() || !password) { setFormError('Please fill in your name, email and a password.'); return; }
    if (password.length < 8) { setFormError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        email: email.trim(), password, name: name.trim(),
        inviteToken: inviteToken || undefined,
        promoCode: promoCode || undefined,
        turnstile_token: turnstile,
      });
      clearSignupPromo();              // account created - consume the code
      update({ accName: name.trim() });
      if (data.token) {
        goAfterAuth(data);             // invite auto-join: straight on, logged in
      } else {
        setSentTo(email.trim());       // normal flow: verify by email
      }
    } catch (err) {
      setFormError(err.response?.data?.error || 'Something went wrong. Please try again.');
      // Turnstile tokens are single-use and the backend just consumed this one.
      setTurnstile(null);
      turnstileRef.current?.reset();
    } finally {
      setLoading(false);
    }
  }

  // Email sent: a calm pause. The user verifies in their inbox and comes back.
  if (sentTo) {
    return (
      <div>
        <div style={{ width: 60, height: 60, borderRadius: 18, margin: '4px auto 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-plum-light)' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-plum)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></svg>
        </div>
        <Title>Check your <Em>inbox.</Em></Title>
        <p style={{ fontSize: 15, color: 'var(--color-cocoa)', lineHeight: 1.55, margin: '16px auto 0', maxWidth: 380 }}>
          We've sent a link to <strong style={{ color: 'var(--color-charcoal)' }}>{sentTo}</strong>. Tap it to confirm your account, and we'll pick up right where you left off.
        </p>
        <Ghost onClick={() => { setSentTo(null); setError(''); }}>Use a different email</Ghost>
      </div>
    );
  }

  return (
    <div>
      <img src="/housemait-logo-web.svg" alt="Housemait" style={{ width: 140, height: 'auto', margin: '0 auto 22px', display: 'block' }} />
      <Title>Your calmer family life<Em block>starts here.</Em></Title>

      {inviteToken ? (
        <p style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-plum)', margin: '14px 0 0' }}>
          You&apos;ve been invited to join a household.
        </p>
      ) : (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, margin: '16px 0 0', padding: '6px 14px', borderRadius: 99, background: '#E5F0E2', fontSize: 13, fontWeight: 600, color: '#3F6E3D' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6BA368' }} />
          Free for 30 days, no card needed
        </div>
      )}

      {/* Confirmed promo discount banner (reassurance). */}
      {promoInfo?.valid && (
        <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 12, background: 'rgba(125,174,130,0.14)', border: '1px solid rgba(125,174,130,0.35)', fontSize: 13, color: 'var(--color-charcoal)', lineHeight: 1.45 }}>
          🎉 <strong>{promoDiscountLabel(promoInfo)}</strong> applied with code <strong>{promoInfo.code}</strong>, finish signing up to claim it.
        </div>
      )}

      {/* Google SSO popup resolves in place; success advances the flow. The
          scoped style re-skins SocialButtons' first button (Google) to the
          plum-primary treatment used on the old /signup screen. */}
      <div className="ob-account-google" style={{ marginTop: 24 }}>
        <SocialButtons inviteToken={inviteToken} promoCode={promoCode} onSuccess={goAfterAuth} onError={setError} />
      </div>
      <style>{`
        .ob-account-google > div.space-y-3 > button:first-child {
          background: var(--color-plum) !important;
          color: #fff !important;
          border: 1px solid transparent !important;
          border-radius: 12px !important;
          padding: 14px 18px !important;
          font-family: var(--font-sans) !important;
          font-size: 14px !important;
          font-weight: 600 !important;
          line-height: 1.45 !important;
          box-shadow: 0 6px 16px -8px rgba(107,63,160,0.45) !important;
        }
        .ob-account-google > div.space-y-3 > button:first-child:hover { background: var(--color-plum-dark) !important; }
      `}</style>

      {!showEmail ? (
        <button
          type="button" onClick={() => setShowEmail(true)}
          style={{ width: '100%', marginTop: 10, padding: '14px 18px', borderRadius: 12, background: '#fff', color: 'var(--color-charcoal)', border: '1px solid rgba(26,22,32,0.10)', boxShadow: '0 1px 0 rgba(26,22,32,0.04)', fontFamily: 'var(--font-sans)', fontWeight: 600, fontSize: 14, lineHeight: 1.45, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
          Continue with Email
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0 6px' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(26,22,32,0.12)' }} />
            <span style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--color-warm-grey)', textTransform: 'uppercase' }}>Or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(26,22,32,0.12)' }} />
          </div>
          <form onSubmit={submit} autoComplete="on" style={{ textAlign: 'left', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label htmlFor="ob-name" style={labelStyle}>Your name</label>
              <input id="ob-name" name="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah" autoComplete="given-name" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ob-email" style={labelStyle}>Email</label>
              <input id="ob-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@household.com" autoComplete="email" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="ob-password" style={labelStyle}>Password</label>
              <input id="ob-password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" style={inputStyle} />
            </div>
            <TurnstileWidget ref={turnstileRef} onChange={setTurnstile} />
            {formError && (
              <div style={{ textAlign: 'left' }}>
                <ErrorBanner message={formError} onDismiss={() => setFormError('')} />
              </div>
            )}
            <PrimaryButton type="submit" disabled={loading} style={{ marginTop: 2 }}>
              {loading ? 'Creating account…' : 'Create account'}
            </PrimaryButton>
          </form>
        </>
      )}

      {/* This is the landing screen now (the welcome/pitch steps were removed),
          so keep a path to sign in for returning users. */}
      {navigate && (
        <p style={{ marginTop: 18, fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--color-cocoa)' }}>
          Already have an account?{' '}
          <button type="button" onClick={() => navigate('/login')} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--color-plum-dark)', fontWeight: 700, borderBottom: '1.5px solid var(--color-plum-dark)' }}>
            Log in →
          </button>
        </p>
      )}

      <p style={{ marginTop: 14, fontFamily: 'var(--font-sans)', fontSize: 12, color: '#8A8493', lineHeight: 1.45 }}>
        By creating an account, you agree to our{' '}
        <a href="/terms" style={{ color: '#4A4453', textDecoration: 'none' }}>Terms</a> and{' '}
        <a href="/privacy" style={{ color: '#4A4453', textDecoration: 'none' }}>Privacy Policy</a>.
      </p>
    </div>
  );
}
