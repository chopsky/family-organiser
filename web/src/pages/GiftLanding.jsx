/**
 * /gift/:code - the public landing page a referred family arrives on.
 *
 * "The <name> family gave you a month of Housemait" - gift framing, never
 * ad framing: the sender chose to give this. Stores the code (localStorage,
 * 30-day TTL, consumed at signup) and sends the visitor to /signup; the
 * server records the pending referral when their household is created and
 * rewards BOTH families once the newcomers genuinely settle in.
 *
 * Follows PartyInvite.jsx's conventions: self-contained inline styles,
 * deliberately noindex (personal links, not content).
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { storeReferralCode } from '../lib/referralCode';

const sans = 'var(--font-sans)';

const FEATURES = [
  ['📅', 'One shared calendar', 'School dates, clubs and appointments, colour-coded per person.'],
  ['💬', 'Runs on WhatsApp', 'Forward a school letter and the dates add themselves.'],
  ['🛒', 'Lists and meals sorted', 'Shopping lists and a weekly meal plan the whole family sees.'],
];

export default function GiftLanding() {
  const { code } = useParams();
  const [state, setState] = useState({ loading: true, familyName: null, valid: false });

  useEffect(() => {
    document.title = 'A gift for your family | Housemait';
    // Personal links between families - not for search engines.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/referrals/gift/${encodeURIComponent(code || '')}`);
        if (cancelled) return;
        if (data?.valid) {
          storeReferralCode(data.code);
          setState({ loading: false, familyName: data.family_name, valid: true });
        } else {
          setState({ loading: false, familyName: null, valid: false });
        }
      } catch {
        if (!cancelled) setState({ loading: false, familyName: null, valid: false });
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const family = (state.familyName || '').trim();
  const heading = state.valid
    ? `${family ? `The ${family} family` : 'A family you know'} gave you a month of Housemait`
    : 'This gift link is no longer valid';

  return (
    <div style={{ minHeight: '100vh', background: '#FBF8F3', display: 'flex', justifyContent: 'center', padding: '32px 20px' }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <img src="/housemait-logomark.svg" alt="Housemait" style={{ width: 44, height: 44, display: 'block', margin: '8px auto 20px' }} />

        <div style={{ background: '#FFFFFF', borderRadius: 18, padding: '26px 24px', boxShadow: '0 4px 16px rgba(107,63,160,0.08)' }}>
          {state.loading ? (
            <p style={{ margin: 0, fontFamily: sans, fontSize: 14, color: '#6B6774', textAlign: 'center' }}>One moment…</p>
          ) : (
            <>
              <p style={{ margin: '0 0 6px', fontFamily: sans, fontWeight: 600, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#E8724A', textAlign: 'center' }}>
                {state.valid ? '🎁 A gift for your family' : 'Housemait'}
              </p>
              <h1 style={{ margin: '0 0 10px', fontFamily: 'var(--font-serif-display, var(--font-sans))', fontWeight: 400, fontSize: 26, lineHeight: 1.15, color: '#2D2A33', textAlign: 'center' }}>
                {heading}
              </h1>
              <p style={{ margin: '0 0 18px', fontFamily: sans, fontSize: 14.5, lineHeight: 1.55, color: '#6B6774', textAlign: 'center' }}>
                {state.valid
                  ? 'Housemait is the calm home for your family’s calendar, lists and meals. Start your free trial and your gift month is added on top once you’re set up.'
                  : 'You can still try Housemait free - every new family gets a full trial of everything.'}
              </p>

              <div style={{ display: 'grid', gap: 12, margin: '0 0 20px' }}>
                {FEATURES.map(([emoji, title, sub]) => (
                  <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 20, lineHeight: '24px' }} aria-hidden="true">{emoji}</span>
                    <div>
                      <p style={{ margin: 0, fontFamily: sans, fontWeight: 600, fontSize: 13.5, color: '#2D2A33' }}>{title}</p>
                      <p style={{ margin: '1px 0 0', fontFamily: sans, fontSize: 12.5, lineHeight: 1.45, color: '#6B6774' }}>{sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Link
                to="/signup"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: 48, borderRadius: 12, background: '#6B3FA0', color: '#FFFFFF',
                  fontFamily: sans, fontWeight: 600, fontSize: 14, textDecoration: 'none',
                  boxShadow: '0 6px 16px -8px rgba(107,63,160,0.45)',
                }}
              >
                {state.valid ? 'Claim your gift month' : 'Try Housemait free'}
              </Link>
              <p style={{ margin: '10px 0 0', fontFamily: sans, fontSize: 12, color: '#6B6774', textAlign: 'center' }}>
                Free trial, no card needed.{state.valid ? ' Your extra month unlocks once your family is set up.' : ''}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
