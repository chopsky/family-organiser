/**
 * "Join an existing home" - the invite-code overlay.
 *
 * The invite LINK carries its token in the URL, but an App Store install
 * never tapped a link: a second adult who downloads the app directly used
 * to walk the founder flow and create a second, disconnected household.
 * This screen turns the typeable short code (shown next to the share link
 * and in the invite email) back into that same token.
 *
 * The confirmation card is the point of the design: nobody joins a
 * household on a typo. A valid code shows WHOSE home this is - "You're
 * joining The Shapiro family - invited by Grant" - and only the explicit
 * [Join this home] tap commits.
 *
 * Pre-account, like the rest of the flow: confirming stores the token in
 * the draft (d.joining) and signup passes it through the existing
 * ?invite= path. The lookup endpoint fails SOFT (valid: null) - this
 * screen lets the user retry rather than hard-failing onboarding.
 */
import { useEffect, useRef, useState } from 'react';
import api from '../../lib/api';
import { T, SHADOW, R } from './tokens';
import { Cta, Ghost } from './ui';

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink, fontSize: 30, margin: 0,
};
const SUB = { fontSize: 15.5, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty', margin: '10px 0 0' };

// Mirror of the server's rules (src/utils/invite-code.js) - strict subset
// is fine, divergence is not: uppercase, strip spaces/hyphens, 6 chars.
const cleanCode = (raw) => String(raw || '').toUpperCase().replace(/[\s-]+/g, '').slice(0, 6);
const displayCode = (c) => (c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c);

export default function InviteCodeOverlay({ onJoined, onCancel }) {
  const [code, setCode] = useState('');
  const [state, setState] = useState('idle'); // idle | checking | found | notfound | trouble
  const [found, setFound] = useState(null);   // { householdName, inviterName, token, invitee }
  const seq = useRef(0);

  // Auto-check the moment six valid characters are in - there's no
  // separate "check" button to discover. The effect only SCHEDULES the
  // lookup; state resets happen in onChange where the value actually
  // changed (same discipline as the inbox availability check).
  useEffect(() => {
    if (code.length !== 6) return undefined;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/invites/lookup', { params: { code } });
        if (mine !== seq.current) return;
        if (data?.valid && data?.token) {
          setFound(data);
          setState('found');
        } else {
          setFound(null);
          setState(data?.valid === null ? 'trouble' : 'notfound');
        }
      } catch {
        if (mine === seq.current) { setFound(null); setState('trouble'); }
      }
    }, 350);
    return () => clearTimeout(t);
  }, [code]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: T.bg,
        display: 'flex', flexDirection: 'column',
        padding: 'max(20px, env(safe-area-inset-top)) 24px max(20px, env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 420, width: '100%', margin: '0 auto' }}>
        <h1 style={H1}>Join a home that&rsquo;s already set up</h1>
        <p style={SUB}>
          Ask whoever set up your family for the invite code - it&rsquo;s next to the invite link on their Family screen.
        </p>

        <input
          value={displayCode(code)}
          onChange={(e) => {
            const c = cleanCode(e.target.value);
            setCode(c);
            setFound(null);
            setState(c.length === 6 ? 'checking' : 'idle');
          }}
          placeholder="KX7-M4Q"
          autoFocus
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          aria-label="Invite code"
          style={{
            marginTop: 22, width: '100%', boxSizing: 'border-box', padding: '15px 18px',
            borderRadius: 16, border: `1.5px solid ${state === 'notfound' ? T.danger : T.line2}`,
            background: T.surface, outline: 'none', textAlign: 'center',
            font: '600 22px var(--font-sans)', letterSpacing: '4px', color: T.ink,
          }}
        />

        {state === 'notfound' && (
          <p style={{ margin: '10px 0 0', font: '600 13px var(--font-sans)', color: T.danger }}>
            That code doesn&rsquo;t match an open invite. Codes expire after 7 days - ask them to send a fresh one from the Family screen.
          </p>
        )}
        {state === 'trouble' && (
          <p style={{ margin: '10px 0 0', font: '600 13px var(--font-sans)', color: T.ink2 }}>
            Couldn&rsquo;t check that just now - give it another go in a moment.
          </p>
        )}

        {state === 'found' && found && (
          <div style={{ marginTop: 18, padding: '16px 18px', background: T.surface, borderRadius: R.card, boxShadow: SHADOW.card }}>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, color: T.ink }}>
              You&rsquo;re joining <strong>{found.householdName || 'this household'}</strong>
              {found.inviterName ? <> - invited by <strong>{found.inviterName}</strong></> : null}.
            </p>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 420, width: '100%', margin: '0 auto' }}>
        {state === 'found' && found && (
          <Cta onClick={() => onJoined(found)}>Join this home</Cta>
        )}
        <Ghost onClick={onCancel}>{state === 'found' ? 'Wrong home? Go back' : 'Back'}</Ghost>
      </div>
    </div>
  );
}
