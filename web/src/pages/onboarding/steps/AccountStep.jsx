import { useRef, useState } from 'react';
import api from '../../../lib/api';
import SocialButtons from '../../../components/SocialButtons';
import TurnstileWidget from '../../../components/TurnstileWidget';
import { clearSignupPromo } from '../../../lib/signupPromo';
import { Title, Em, Kicker, PrimaryButton, Ghost } from './_ui';
import { inputStyle, labelStyle } from './_styles';

// Step 4. Creates the account. Google SSO is a popup, so it resolves in place
// and the flow advances without leaving the page. Email register has no token
// for normal signups, so it pauses on a "check your inbox" panel; verifying
// logs the user in and the auth gate funnels them back to resume.
export default function AccountStep({ form, update, setError, goAfterAuth, inviteToken, promoCode }) {
  const [showEmail, setShowEmail] = useState(false);
  const [name, setName] = useState(form.accName || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [turnstile, setTurnstile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const turnstileRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !email.trim() || !password) { setError('Please fill in your name, email and a password.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        email: email.trim(), password, name: name.trim(),
        inviteToken: inviteToken || undefined,
        promoCode: promoCode || undefined,
        turnstile_token: turnstile,
      });
      clearSignupPromo();
      update({ accName: name.trim() });
      if (data.token) {
        goAfterAuth(data);          // invite auto-join: straight on, logged in
      } else {
        setSentTo(email.trim());    // normal flow: verify by email
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
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
        <div style={{ width: 62, height: 62, borderRadius: 18, margin: '4px auto 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-plum-light)' }}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-plum)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M4 7l8 6 8-6" /></svg>
        </div>
        <Title>Check your <Em>inbox.</Em></Title>
        <p style={{ fontSize: 16, color: 'var(--color-cocoa)', lineHeight: 1.55, margin: '16px auto 0', maxWidth: 400 }}>
          We've sent a link to <strong style={{ color: 'var(--color-charcoal)' }}>{sentTo}</strong>. Tap it to confirm your account, and we'll pick up right where you left off.
        </p>
        <Ghost onClick={() => { setSentTo(null); setError(''); }}>Use a different email</Ghost>
      </div>
    );
  }

  return (
    <div>
      <Kicker>Almost there</Kicker>
      <Title>Create your <Em>free account.</Em></Title>
      {inviteToken ? (
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-plum)', margin: '12px 0 24px' }}>
          You&apos;ve been invited to join a household.
        </p>
      ) : (
        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-warm-grey)', margin: '12px 0 24px' }}>
          Free for 30 days. No card needed.
        </p>
      )}

      {/* Google SSO popup resolves in place; success advances the flow. The
          scoped style below re-skins SocialButtons' first button (Google) to
          the plum-primary treatment used on the old /signup screen. */}
      <div className="ob-account-google">
        <SocialButtons inviteToken={inviteToken} promoCode={promoCode} onSuccess={goAfterAuth} onError={setError} />
      </div>
      <style>{`
        .ob-account-google > div.space-y-3 > button:first-child {
          background: var(--color-plum) !important;
          color: #fff !important;
          border: 1px solid transparent !important;
          border-radius: 12px !important;
          padding: 15px 18px !important;
          font-size: 15px !important;
          font-weight: 700 !important;
          box-shadow: 0 10px 24px -10px rgba(109,56,173,0.55) !important;
        }
        .ob-account-google > div.space-y-3 > button:first-child:hover {
          background: var(--color-plum-dark) !important;
        }
      `}</style>

      {!showEmail ? (
        <button
          type="button" onClick={() => setShowEmail(true)}
          style={{ width: '100%', marginTop: 12, padding: '14px 18px', borderRadius: 12, background: '#fff', color: 'var(--color-charcoal)', border: '1px solid rgba(26,22,32,0.12)', boxShadow: '0 1px 0 rgba(26,22,32,0.04)', fontFamily: 'inherit', fontWeight: 600, fontSize: 14.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
          Continue with Email
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 6px' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(26,22,32,0.12)' }} />
            <span style={{ fontSize: 11, letterSpacing: '0.08em', color: 'var(--color-warm-grey)', textTransform: 'uppercase' }}>Or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(26,22,32,0.12)' }} />
          </div>
          <form onSubmit={submit} autoComplete="on" style={{ textAlign: 'left', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
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
            <PrimaryButton type="submit" disabled={loading} style={{ marginTop: 2 }}>
              {loading ? 'Creating account…' : 'Create account'}
            </PrimaryButton>
          </form>
        </>
      )}

      <p style={{ marginTop: 18, fontSize: 12.5, color: 'var(--color-warm-grey)', lineHeight: 1.5 }}>
        By creating an account, you agree to our{' '}
        <a href="/terms" style={{ color: 'var(--color-cocoa)', fontWeight: 600 }}>Terms</a> and{' '}
        <a href="/privacy" style={{ color: 'var(--color-cocoa)', fontWeight: 600 }}>Privacy Policy</a>.
      </p>
    </div>
  );
}
