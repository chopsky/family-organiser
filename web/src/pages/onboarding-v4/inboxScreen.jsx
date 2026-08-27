/**
 * Onboarding v4, step 10 - the house inbox.
 *
 * Every household gets an address at @inbox.housemait.com; this claims
 * the memorable half of it. Without this step a household keeps the
 * random hex token it was created with, which nobody can dictate over
 * the phone - the reason the feature has been effectively invisible.
 *
 * Pre-account, like every step before sign-up: the claim records intent
 * in the draft and replay.js sets the alias once the household exists.
 * Availability is checked for real against the same uniqueness query
 * Settings uses (public route: /api/inbox/availability), debounced while
 * typing and RE-CHECKED on claim so a stale tick can never be the reason
 * someone is told an address is theirs when it isn't.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../lib/api';
import { T, SHADOW, R } from './tokens';
import { Step, Cta, Tick } from './ui';
import { INBOUND_EMAIL_DOMAIN } from '../../lib/inboundEmail';
import { slugify, suggestionsFor } from './inboxSlug';

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink, fontSize: 34, margin: 0,
};
const EM = { color: T.purple, fontStyle: 'normal' };
const SUB = { fontSize: 16, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty', margin: '12px 0 0' };



export default function InboxStep({ d, update, onNext, onState, claimRef }) {
  const [value, setValue] = useState(() => d.inbox || slugify(d.house));
  const [claim, setClaim] = useState('idle');   // idle | busy | done
  const [avail, setAvail] = useState(null);     // null | true | false
  const [error, setError] = useState('');
  const seq = useRef(0);
  // The post-claim auto-advance. Held in a ref so an EDIT during the
  // 1-second "it's yours" pause cancels it - otherwise the step advanced
  // carrying the OLD claimed slug while the input showed the new text
  // (real founder report, 2026-08-27: claimed the prefilled default,
  // retyped, and the retype was silently lost).
  const advanceTimer = useRef(null);
  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const valid = value.trim().length >= 3;

  const check = useCallback(async (slug) => {
    const mine = ++seq.current;
    try {
      const { data } = await api.get('/inbox/availability', { params: { alias: slug } });
      // Ignore a slow reply that lost its race with newer typing.
      if (mine !== seq.current) return null;
      setAvail(data?.available);
      setError(data?.available === false ? (data.reason || 'Taken - try another') : '');
      return data?.available;
    } catch {
      if (mine === seq.current) { setAvail(null); setError(''); }
      return null;
    }
  }, []);

  // Debounced while typing. Only SCHEDULES the check - clearing the old
  // verdict happens in onChange, where the value actually changed, so
  // this effect never sets state synchronously in its body.
  useEffect(() => {
    if (!valid) return undefined;
    const t = setTimeout(() => check(value), 400);
    return () => clearTimeout(t);
  }, [value, valid, check]);

  async function go() {
    if (!valid || claim !== 'idle') return;
    setClaim('busy');
    setError('');
    // Re-validate on claim: the tick may be seconds old, and the promise
    // "<slug> is yours" must not rest on a stale check.
    const free = await check(value);
    if (free === false) { setClaim('idle'); return; }
    update({ inbox: value });
    setClaim('done');
    advanceTimer.current = setTimeout(onNext, 1000);
  }

  // Publish state up so the pinned footer (rendered by the Step frame in
  // the shell) can reflect it, and hand back the claim action so its CTA
  // fires the same code path as pressing Enter here.
  useEffect(() => { onState && onState({ value, claim }); }, [value, claim, onState]);
  useEffect(() => { if (claimRef) claimRef.current = go; });

  const suggestions = avail === false ? suggestionsFor(value, d.house) : [];

  return (
    <>
      <h1 style={H1}>And an address <span style={EM}>for the paperwork.</span></h1>
      <p style={SUB}>
        Your household gets its own email.
        <br />
        Forward school emails, bookings &amp; invites. Housemait files it all for everyone.
      </p>

      <div
        style={{
          marginTop: 20, display: 'flex', alignItems: 'center', gap: 2,
          padding: '4px 4px 4px 19px', borderRadius: 16,
          border: `1.5px solid ${avail === false ? T.danger : T.line2}`,
          background: T.surface,
        }}
      >
        <input
          value={value}
          onChange={(e) => { clearTimeout(advanceTimer.current); setValue(slugify(e.target.value)); setClaim('idle'); setAvail(null); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
          placeholder="yourhouse"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          aria-label="Your house inbox address"
          style={{
            flex: 1, minWidth: 0, padding: '14px 0', border: 0, background: 'transparent',
            fontSize: 16.5, fontWeight: 600, color: T.ink, outline: 'none',
          }}
        />
        <span
          style={{
            font: '600 13px Inter, sans-serif', color: T.ink3, padding: '10px 12px',
            borderRadius: 12, background: 'rgba(26,22,32,.04)', whiteSpace: 'nowrap',
          }}
        >
          @{INBOUND_EMAIL_DOMAIN}
        </span>
      </div>

      {valid && claim === 'idle' && avail === true && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10, font: '600 13px Inter, sans-serif', color: T.okInk }}>
          <Tick size={14} color="#3F8E52" />Available
        </div>
      )}
      {valid && claim === 'idle' && avail === false && (
        <div style={{ marginTop: 10 }}>
          <div style={{ font: '600 13px Inter, sans-serif', color: T.danger }}>{error || 'Taken - try another'}</div>
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setValue(s); setClaim('idle'); }}
                  style={{
                    padding: '7px 12px', borderRadius: 99, cursor: 'pointer',
                    border: `1.5px solid ${T.line2}`, background: T.surface,
                    font: '600 12.5px Inter, sans-serif', color: T.ink2,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 18, padding: '13px 15px', background: T.surface, borderRadius: R.card, boxShadow: SHADOW.card }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: T.purpleSoft, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.purpleDeep} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7l8 6 8-6" />
            </svg>
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', font: '700 13.5px Inter, sans-serif', color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Fwd: Year 3 trip — Science Museum
            </span>
            <span style={{ display: 'block', fontSize: 12, color: T.ink3, marginTop: 1 }}>from Oakfield Primary</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, paddingTop: 11, borderTop: `1px solid ${T.line}`, font: '600 12.5px Inter, sans-serif', color: T.okInk }}>
          <Tick size={14} color="#3F8E52" />Trip filed · 14 Oct · permission slip due Friday
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, padding: '12px 14px', borderRadius: R.field, background: 'rgba(26,22,32,.035)' }}>
        <span style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true">🔒</span>
        <span style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.4 }}>
          Only people in your household can use it. Anything else that lands there is ignored.
        </span>
      </div>
    </>
  );
}

/** Footer lives in the Step frame, so the shell renders it separately. */
export function InboxFooter({ value, claim, onClaim }) {
  if (claim === 'done') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 16, borderRadius: 17, background: T.okBg, color: T.okInk, font: '700 15.5px Inter, sans-serif', overflow: 'hidden' }}>
        <Tick size={17} color="#3F8E52" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}@{INBOUND_EMAIL_DOMAIN} is yours
        </span>
      </div>
    );
  }
  return (
    <Cta disabled={(value || '').trim().length < 3 || claim === 'busy'} onClick={onClaim}>
      {claim === 'busy' ? 'Claiming it…' : 'Claim this address'}
    </Cta>
  );
}
