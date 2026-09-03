/**
 * Onboarding v4 screens — batch 3: sign-up, login, welcome home.
 *
 * Screen 11 (the ask, at maximum investment), the login route off the splash,
 * and screen 12 (celebration). Auth is still a stand-in here - real providers
 * and the deferred-connection replay land in Phase 5.
 */
import { useEffect, useRef, useState } from 'react';
import { T, SHADOW, R } from './tokens';
import { INBOUND_EMAIL_DOMAIN } from '../../lib/inboundEmail';
import { completedRecap } from '../../lib/onboardingDraft';
import { Lockup, Cta, Ghost, TOP_GAP } from './ui';

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink,
};
const SUB = { fontSize: 14.5, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty' };

const backChevron = (onBack) => (
  <button
    type="button" onClick={onBack} aria-label="Back"
    style={{
      width: 44, height: 44, margin: '0 0 0 -4px', padding: 0, border: 0, background: 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
    }}
  >
    <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(26,22,32,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink2} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 6l-6 6 6 6" />
      </svg>
    </span>
  </button>
);

/** The three auth buttons, shared by sign-up and login. */
function AuthStack({ onPick, auth, intent }) {
  const { showGoogle, showApple, googleReady, appleReady, signInWithGoogle, signInWithApple } = auth;
  // `intent` tells the server which screen this is: 'login' refuses to mint
  // an account for an unknown email (the Hide-My-Email trap); sign-up leaves
  // it unset and creates as before.
  const opts = intent ? { intent } : undefined;
  const base = {
    width: '100%', minHeight: 44, padding: 15, borderRadius: R.auth,
    font: '600 15.5px var(--font-sans)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
      {showGoogle && (
      <button type="button" onClick={() => signInWithGoogle(opts)} disabled={!googleReady} style={{ ...base, background: T.purple, color: '#fff', border: 0, opacity: googleReady ? 1 : 0.6, cursor: googleReady ? 'pointer' : 'wait' }}>
        <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="12" height="12" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
          </svg>
        </span>
        Continue with Google
      </button>
      )}
      {showApple && (
      <button type="button" onClick={() => signInWithApple(opts)} disabled={!appleReady} style={{ ...base, background: T.surface, color: T.ink, border: `1.5px solid ${T.line2}`, opacity: appleReady ? 1 : 0.6 }}>
        <svg width="15" height="18" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true">
          <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
        Continue with Apple
      </button>
      )}
      <button type="button" onClick={() => onPick('email')} style={{ ...base, background: T.surface, color: T.ink, border: `1.5px solid ${T.line2}` }}>
        Continue with email
      </button>
    </div>
  );
}


/**
 * Email + password. v4 already knows their name from step 05, so this asks for
 * the two things it can't infer and nothing more.
 */
function EmailForm({ mode, busy, error, onSubmit, onBack, onForgot }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const field = {
    width: '100%', minHeight: 44, padding: '14px 15px', borderRadius: R.field,
    border: `1.5px solid ${T.line2}`, background: T.surface, fontSize: 15,
    color: T.ink, outline: 'none', marginBottom: 9,
  };
  const tooShort = mode === 'signup' && password.length > 0 && password.length < 8;
  const ready = email.trim().includes('@') && password.length >= (mode === 'signup' ? 8 : 1);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onSubmit({ email, password }); }}
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <input
        type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" aria-label="Email" autoComplete="email"
        autoCapitalize="none" autoCorrect="off" style={field} required
      />
      <input
        type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === 'signup' ? 'Create a password' : 'Your password'}
        aria-label="Password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        style={field} required
      />
      {tooShort && (
        <p style={{ fontSize: 12.5, color: T.ink3, marginBottom: 8 }}>At least 8 characters.</p>
      )}
      {error && (
        <p role="alert" style={{ fontSize: 13, lineHeight: 1.4, color: T.danger, marginBottom: 8 }}>{error}</p>
      )}
      <Cta type="submit" disabled={!ready || busy}>
        {busy ? 'One moment…' : mode === 'signup' ? 'Create my account' : 'Log in'}
      </Cta>
      {/* The legacy login page always had this; the v4 screen shipped without
          it, so someone who couldn't remember a password had nowhere to go
          ("it doesn't allow me to reset", real support email 2026-09-02). */}
      {mode === 'login' && onForgot && (
        <Ghost onClick={onForgot}>Forgot password?</Ghost>
      )}
      <Ghost onClick={onBack}>Use something else</Ghost>
    </form>
  );
}

/**
 * Code entry. This is what makes email sign-up equal to a provider.
 *
 * The alternative — following the link in the email — is a NAVIGATION, and the
 * calendar address pasted at step 08 lives in memory only (it's a bearer
 * credential and is deliberately never persisted). Leaving the page destroyed
 * it, so someone who connected a calendar, watched it find 244 events, then
 * verified by link silently got no calendar. Typing the code keeps the page
 * alive, so the replay runs and everything they set up actually lands.
 *
 * The link still works and still opens the iOS app; this is the path that
 * doesn't cost them their setup.
 */
function CodeEntry({ email, busy, error, onSubmit, onResend, resent }) {
  const [code, setCode] = useState('');
  const ready = code.trim().length >= 6;

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 38 }} aria-hidden="true">📬</div>
      <h1 style={{ fontFamily: T.title, fontWeight: 400, fontSize: 28, lineHeight: 1.1, color: T.ink, marginTop: 8 }}>
        Check your email.
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.5, color: T.ink2, marginTop: 8 }}>
        We’ve sent a 6-character code to <strong style={{ color: T.ink }}>{email}</strong>.
      </p>

      <form
        onSubmit={(e) => { e.preventDefault(); if (ready && !busy) onSubmit(code.trim()); }}
        style={{ marginTop: 18 }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
          placeholder="K7M2QF"
          aria-label="Verification code"
          // iOS reads one-time codes out of Mail and offers them above the
          // keyboard; without this it doesn't know to.
          autoComplete="one-time-code"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          maxLength={6}
          autoFocus
          style={{
            width: '100%', minHeight: 56, padding: '14px 16px', borderRadius: R.field,
            border: `1.5px solid ${error ? '#C2543F' : T.line2}`, background: T.surface,
            font: '700 27px ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: '.2em', textAlign: 'center', color: T.ink, outline: 'none',
          }}
        />
        {error && (
          <p role="alert" style={{ fontSize: 13, lineHeight: 1.4, color: T.danger, marginTop: 8 }}>{error}</p>
        )}
        <div style={{ marginTop: 12 }}>
          <Cta type="submit" disabled={!ready || busy}>
            {busy ? 'Checking…' : 'Verify and finish'}
          </Cta>
        </div>
      </form>

      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: T.ink3, marginTop: 14 }}>
        The email also has a link you can tap, but entering the code here keeps
        anything you’ve already set up.
      </p>
      <Ghost onClick={onResend}>{resent ? 'Sent again' : 'Send it again'}</Ghost>
    </div>
  );
}

/* ── 11 Sign up ────────────────────────────────────────────────────────────
   The ask, at the point of maximum investment. Layout departs from the step
   frame: a floating card, and a FULL progress bar as a completion signal. */
export function SignUpScreen({ d, onBack, auth, v4 }) {
  // 'pick' -> the provider stack | 'email' -> the form | 'sent' -> check inbox
  const [face, setFace] = useState('pick');
  const [sentTo, setSentTo] = useState('');
  const [resent, setResent] = useState(false);

  const submitEmail = async ({ email, password }) => {
    const result = await v4.registerWithEmail({ email, password });
    if (result === 'verify') { setSentTo(email.trim()); setFace('sent'); }
    // 'done' advances via the shell watching v4.outcome; null leaves the error up.
  };
  // Only COMPLETED steps appear. Skipped ones are omitted entirely rather than
  // listed as "Add later", which would turn the recap into a report card of
  // failures immediately before the ask.
  const rows = completedRecap(d);

  return (
    <div
      className="ob-v4"
      style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        background: T.bg, padding: '0 26px 30px',
        paddingTop: TOP_GAP,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {backChevron(onBack)}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', marginLeft: -44, pointerEvents: 'none' }}>
          <Lockup width={112} />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            width: '100%', background: T.surface, borderRadius: R.card,
            boxShadow: SHADOW.cardLg, padding: '24px 20px 20px',
          }}
        >
          <div style={{ height: 5, borderRadius: 99, background: T.purple, marginBottom: 16 }} />

          <h1 style={{ ...H1, fontSize: 31, textAlign: 'center' }}>
            {d.house || 'Your household'} is <span style={{ color: T.purple }}>ready.</span>
          </h1>
          <p style={{ ...SUB, textAlign: 'center', marginTop: 8 }}>
            Save it to your account so it’s on every device, and for everyone you invite.
          </p>

          {rows.length > 0 && (
            <div style={{ borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}`, margin: '16px 0', padding: '4px 0' }}>
              {rows.map((r) => (
                <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0' }}>
                  <span style={{ fontSize: 14 }}>{r.icon}</span>
                  <span style={{ width: 74, flexShrink: 0, font: '600 12.5px var(--font-sans)', color: T.ink3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  <span
                    style={{
                      flex: 1, minWidth: 0, textAlign: 'right', font: '600 13.5px var(--font-sans)', lineHeight: 1.25,
                      color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: r.wrap ? 'normal' : 'nowrap',
                    }}
                  >
                    {r.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px',
                borderRadius: R.pill, background: T.okBg, color: T.okInk,
                font: '600 12.5px var(--font-sans)',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: T.okInk }} />
              Free for your family · 14 days of Premium
            </span>
          </div>

          {face === 'sent' ? (
            <CodeEntry
              email={sentTo}
              busy={v4.busy}
              error={v4.error}
              resent={resent}
              onResend={async () => { await v4.resend(sentTo); setResent(true); }}
              onSubmit={async (code) => { if (await v4.verifyCode({ email: sentTo, code })) v4.onVerified?.(); }}
            />
          ) : face === 'email' ? (
            <EmailForm
              mode="signup" busy={v4.busy} error={v4.error}
              onSubmit={submitEmail}
              onBack={() => { v4.setError(''); setFace('pick'); }}
            />
          ) : (
            <AuthStack onPick={() => setFace('email')} auth={auth} />
          )}

          {/* Required on sign-up; deliberately NOT shown on login. */}
          <p style={{ fontSize: 11, color: T.ink3, textAlign: 'center', marginTop: 14, lineHeight: 1.45 }}>
            By creating an account you agree to our <b style={{ color: T.ink2 }}>Terms</b> and{' '}
            <b style={{ color: T.ink2 }}>Privacy Policy</b>.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Login (from the splash) ─ no Terms line: they agreed at sign-up. */
export function LoginScreen({ onBack, onCreate, auth, v4, onLoggedIn, onForgot, socialError }) {
  const [face, setFace] = useState('pick');
  return (
    <div
      className="ob-v4"
      style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        background: T.bg, padding: '0 26px 30px',
        paddingTop: TOP_GAP,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {backChevron(onBack)}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', marginLeft: -44, pointerEvents: 'none' }}>
          <Lockup width={118} />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <h1 style={{ ...H1, fontSize: 38 }}>Welcome <span style={{ color: T.purple }}>back.</span></h1>
        <p style={{ ...SUB, maxWidth: 300, marginTop: 10 }}>
          Your household is exactly where you left it, with everything the family
          added while you were gone.
        </p>
        <div style={{ marginTop: 24 }}>
          {face === 'email' ? (
            <EmailForm
              mode="login" busy={v4.busy} error={v4.error}
              onSubmit={async (creds) => { if (await v4.logIn(creds)) onLoggedIn(); }}
              onBack={() => { v4.setError(''); setFace('pick'); }}
              onForgot={onForgot}
            />
          ) : (
            <>
              <AuthStack onPick={() => setFace('email')} auth={auth} intent="login" />
              {/* Social sign-in problems used to be invisible on this face
                  (the email form was the only place an error rendered), so
                  a refused Apple/Google tap looked like nothing happened. */}
              {socialError && (
                <p role="alert" style={{ fontSize: 13, lineHeight: 1.45, color: T.danger, marginTop: 12 }}>{socialError}</p>
              )}
            </>
          )}
        </div>
        <p style={{ fontSize: 12.5, color: T.ink3, marginTop: 16, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
          <span aria-hidden="true">🔒</span>
          <span>Use the same method you signed up with and you’ll drop straight back in.</span>
        </p>
      </div>

      <p style={{ fontSize: 13.5, color: T.ink2, textAlign: 'center' }}>
        New to Housemait?{' '}
        <button
          type="button" onClick={onCreate}
          style={{ background: 'none', border: 0, color: T.purple, font: '700 13.5px var(--font-sans)', cursor: 'pointer', minHeight: 44 }}
        >
          Create an account
        </button>
      </p>
    </div>
  );
}

const CONFETTI_COLOURS = ['#6D38AD', '#D89B3A', '#6BA368', '#5B8DE0', '#D8788A', '#E0612E'];

/* ── 12 Welcome home ─ celebration plus ONE action. No recap: that did its
   work on the ask screen, not after the money is in. */
export function DoneScreen({ d, onEnter, reduced, outcome }) {
  // The pieces are generated inside the effect, not during render: randomness
  // in the render phase is impure (React's lint rule catches it), and it would
  // also re-roll every position on any re-render, teleporting pieces mid-fall.
  // Building them once, in the effect that starts the celebration, does both
  // jobs - and an empty array is the "not yet" state, so no separate flag.
  const [pieces, setPieces] = useState([]);

  // One-tap partner invite: an email-less invite (link + typeable code) the
  // founder shares from their own WhatsApp. Fetched lazily; any failure
  // (joiner without admin rights, offline, endpoint missing) simply hides
  // the card - the welcome screen must never look broken over an optional
  // extra. Joiners are also excluded up front: the household they joined
  // isn't theirs to hand out.
  const [invite, setInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (d?.joining) return undefined;
    let cancelled = false;
    import('../../lib/api').then(({ default: api }) => api.post('/household/invite-link'))
      .then((res) => { if (!cancelled && res.data?.url) setInvite(res.data); })
      .catch(() => { /* card stays hidden */ });
    return () => { cancelled = true; };
  }, [d?.joining]);

  // A share or copy is "invite sent" as far as the home screen's Add-your-
  // family nudge is concerned - fire-and-forget, once.
  const nudgeMarked = useRef(false);
  const markInviteNudge = () => {
    if (nudgeMarked.current) return;
    nudgeMarked.current = true;
    import('../../lib/api')
      .then(({ default: api }) => api.post('/household/setup-nudges/dismiss', { task: 'invite' }))
      .catch(() => { /* best effort */ });
  };

  const houseName = d.house || 'our home';
  const inviteMessage = invite
    ? `We’re on Housemait, one place for the family calendar, lists and school dates. Join ${houseName}: ${invite.url}`
    : '';

  // WhatsApp-first (the button says so), generic share sheet when WhatsApp
  // isn't installed, wa.me as the web/last-ditch fallback.
  const shareInvite = async () => {
    markInviteNudge();
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher');
      const { value } = await AppLauncher.canOpenUrl({ url: 'whatsapp://send' });
      if (value) {
        await AppLauncher.openUrl({ url: `whatsapp://send?text=${encodeURIComponent(inviteMessage)}` });
        return;
      }
    } catch { /* plugin unavailable (web) - fall through */ }
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ text: inviteMessage });
      return;
    } catch { /* cancelled or unavailable - fall through */ }
    try {
      if (navigator.share) { await navigator.share({ text: inviteMessage }); return; }
    } catch { return; /* user cancelled the sheet */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(inviteMessage)}`, '_blank');
  };

  const codeShown = invite?.code ? `${invite.code.slice(0, 3)}-${invite.code.slice(3)}` : null;
  const copyCode = async () => {
    if (!codeShown) return;
    markInviteNudge();
    try { await navigator.clipboard.writeText(codeShown); } catch { /* keep the flip anyway - the code is on screen */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // 350ms after landing, per the spec - the mark's pop reads first.
  useEffect(() => {
    if (reduced) return undefined;
    const t = setTimeout(() => {
      setPieces(Array.from({ length: 80 }, (_, i) => ({
        left: `${Math.random() * 100}%`,
        background: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
        animationDuration: `${2.4 + Math.random() * 1.8}s`,
        animationDelay: `${Math.random() * 0.5}s`,
      })));
    }, 350);
    return () => clearTimeout(t);
  }, [reduced]);

  return (
    <div
      className="ob-v4"
      style={{
        minHeight: '100dvh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        background: T.bg, padding: '0 28px 30px', position: 'relative', overflow: 'hidden',
      }}
    >
      {pieces.length > 0 && (
        <div className="ob-confetti" aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {pieces.map((p, i) => <span key={i} style={p} />)}
        </div>
      )}

      <img
        src="/onboarding-v4/logomark-purple.png" alt="" aria-hidden="true"
        className={reduced ? '' : 'ob-pop'}
        style={{ width: 78, height: 62, objectFit: 'contain' }}
      />
      <p style={{ font: '700 11.5px var(--font-sans)', letterSpacing: '.16em', textTransform: 'uppercase', color: T.purple, marginTop: 18 }}>
        All set
      </p>
      {/* Two explicit lines, and textWrap back to normal for this one heading.
          H1's `balance` evens the line lengths, which on a phone split the
          greeting as "Welcome" / "home, Grant." — the phrase belongs together
          and the name belongs on its own line. The clamp keeps the designed
          37px on a normal handset and steps down on narrow ones rather than
          letting "Welcome home," break again. */}
      <h1 style={{ ...H1, fontSize: 'clamp(30px, 8.6vw, 37px)', marginTop: 8, textWrap: 'initial' }}>
        <span style={{ display: 'block' }}>Welcome home,</span>
        <span style={{ color: T.purple }}>{d.you || 'friend'}.</span>
      </h1>
      <p style={{ ...SUB, fontSize: 16, lineHeight: 1.45, marginTop: 12, maxWidth: 300 }}>
        <b style={{ color: T.ink }}>{d.house || 'Your household'}</b> is live. It gets good when the
        others are in. Everything you add, they see.
      </p>

      <div style={{ width: '100%', marginTop: 30 }}>
        {/* What actually landed. The flow promised these things several
            screens ago, so the welcome is the moment to confirm them rather
            than let the user wonder. Silent when there is nothing to report. */}
        {outcome?.calendars?.connected?.length > 0 && (
          <p style={{ fontSize: 13, color: T.okInk, marginBottom: 10 }}>
            ✓ {outcome.calendars.connected.join(' and ')} connected
          </p>
        )}
        {outcome?.calendars?.failed?.length > 0 && (
          // Per-calendar, with its own reason: "didn't connect" and "we lost
          // the link when you left this screen" call for different next moves,
          // and lumping them together would hide which happened.
          <div role="status" style={{ marginBottom: 10 }}>
            {outcome.calendars.failed.map((f) => (
              <p key={f.label} style={{ fontSize: 13, lineHeight: 1.45, color: T.ink2, marginBottom: 6 }}>
                <b style={{ color: T.ink }}>{f.label}</b> isn’t connected: {f.error} You can add it in Settings.
              </p>
            ))}
          </div>
        )}
        {/* The trial is ANNOUNCED here, never discovered at day 14: the
            lapse message says "your Premium free trial has ended", and this
            line is what makes that land as a known fact. Founders only - a
            joiner inherits the household's existing plan, whatever it is. */}
        {!d?.joining && (
          <p style={{ fontSize: 13, color: T.okInk, marginBottom: 10 }}>
            ✓ 14 days of Premium included - unlimited AI, briefs and more
          </p>
        )}
        {outcome?.kids?.length > 0 && (
          <p style={{ fontSize: 13, color: T.okInk, marginBottom: 10 }}>
            ✓ {outcome.kids.length === 1
              ? `${outcome.kids[0]}'s profile is ready`
              : `Profiles ready for ${outcome.kids.slice(0, -1).join(', ')} and ${outcome.kids[outcome.kids.length - 1]}`}
          </p>
        )}
        {/* The school step's outcome, spoken honestly: term dates landed, or
            the school is in and the School page offers the other routes
            (website / photo / PDF) - never a silent "we tried". */}
        {(outcome?.schools?.length ? outcome.schools : (outcome?.school ? [outcome.school] : [])).map((sc) => (
          <p key={sc.id || sc.name} style={{ fontSize: 13, color: T.okInk, marginBottom: 10 }}>
            ✓ {sc.termDates
              ? `${sc.name} added - ${sc.termDates} term dates are on your calendar`
              : `${sc.name} added - grab its term dates on the School page`}
          </p>
        ))}
        {/* The inbox claim, confirmed or honestly lost - replayInbox's
            contract promises the welcome screen reports it, and a silent
            claim is how a mis-captured alias goes unnoticed until Settings
            (real founder report, 2026-08-27). */}
        {outcome?.inbox?.claimed && (
          <p style={{ fontSize: 13, color: T.okInk, marginBottom: 10 }}>
            ✓ {outcome.inbox.claimed}@{INBOUND_EMAIL_DOMAIN} is your house address
          </p>
        )}
        {outcome?.inbox?.conflict && (
          <p style={{ fontSize: 13, lineHeight: 1.45, color: T.ink2, marginBottom: 10 }}>
            That email address got taken while you signed up - pick another in Settings.
          </p>
        )}
        {invite && (
          <div
            className={reduced ? '' : 'ob-in'}
            style={{
              textAlign: 'left', background: '#fff', borderRadius: 18, padding: '16px 16px 14px',
              marginBottom: 14, boxShadow: SHADOW.card, animationDelay: reduced ? undefined : '.35s',
            }}
          >
            <p style={{ font: '700 11px var(--font-sans)', letterSpacing: '.1em', textTransform: 'uppercase', color: T.ink3, margin: 0 }}>
              Bring the others in
            </p>
            <button
              type="button"
              onClick={shareInvite}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                width: '100%', minHeight: 46, marginTop: 12, borderRadius: 14, border: 0,
                cursor: 'pointer', background: T.green, color: '#fff',
                font: '700 15px var(--font-sans)',
                boxShadow: '0 8px 18px -8px rgba(31,175,84,.6)',
              }}
            >
              <img src="/onboarding-v4/whatsapp-white.svg" alt="" aria-hidden="true" style={{ width: 20, height: 20 }} />
              Invite via WhatsApp
            </button>
            {codeShown && (
              <button
                type="button"
                onClick={copyCode}
                aria-live="polite"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', minHeight: 40, marginTop: 10, borderRadius: 12,
                  cursor: 'pointer', border: '1.5px dashed rgba(109,56,173,.35)',
                  background: 'rgba(242,236,250,.5)',
                }}
              >
                {copied ? (
                  <span style={{ font: '600 13px var(--font-sans)', color: T.okInk }}>✓ Code copied</span>
                ) : (
                  <>
                    <span style={{ font: '600 13px var(--font-sans)', color: T.ink2 }}>or share the code</span>
                    <span style={{ font: '700 14px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '.14em', color: T.purpleDeep }}>{codeShown}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
        {/* One door, not two: a ghost "I'll invite them later" used to sit
            here doing exactly what the CTA does. With a neutral primary
            label there's no guilt to absolve - the invite card is plainly
            optional (founder call 2026-08-26). */}
        <Cta onClick={onEnter}>Enter Housemait</Cta>
      </div>
    </div>
  );
}
