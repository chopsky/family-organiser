/**
 * /gift/:code - the public landing page a referred family arrives on
 * (design_handoff_gift_page: signup-matched aesthetic - brand gradient,
 * floating cream card, Recoleta H1 with plum em, line icons, no emoji).
 *
 * Gift framing, never ad framing: a friend chose to give this. The code
 * comes from the URL, is never displayed, and flows through the CTA as
 * /signup?gift=<CODE> (plus a localStorage fallback for detours). The
 * sender is ALWAYS "A friend" - household names never cross households
 * (privacy decision 2026-08-18; the API deliberately doesn't return one).
 *
 * Also routed at bare /gift so the prerender can snapshot a shell whose
 * head carries gift-specific OG tags: Vercel rewrites /gift/:code to that
 * static file, giving WhatsApp's no-JS preview bot the right card while
 * humans hydrate into the live page. With no :code the page stays in the
 * loading state forever - that IS the prerender shell.
 *
 * Deliberately noindex (personal links, not content).
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { storeReferralCode } from '../lib/referralCode';

// Real testimonial pending (the reference's quote is placeholder voice) -
// flip on once the founder supplies words we have rights to use.
const SHOW_TESTIMONIAL = false;

/** Find-or-create a head meta tag. Idempotent - the prerender snapshot
 *  re-runs effects and duplicated metas would poison every crawler. */
function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return el;
}

const ICONS = {
  gift: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13" />
      <path d="M12 8s-4.3.2-5.8-1.4C4.9 5.2 6 3.2 7.4 3.2 9.8 3.2 12 8 12 8zm0 0s4.3.2 5.8-1.4C19.1 5.2 18 3.2 16.6 3.2 14.2 3.2 12 8 12 8z" />
    </svg>
  ),
  calendar: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#4A1D96" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4m8-4v4M3 10h18" />
    </svg>
  ),
  chat: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#4A1D96" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
    </svg>
  ),
  trolley: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#4A1D96" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9.5" cy="19.5" r="1.6" />
      <circle cx="16.5" cy="19.5" r="1.6" />
      <path d="M3 4h2l2.3 10.5h11L20.5 7.5H6" />
    </svg>
  ),
  star: (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#4A1D96" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9z" />
    </svg>
  ),
};

const BENEFITS = [
  [ICONS.calendar, 'One shared calendar', 'School dates, clubs and appointments, colour-coded per person.'],
  [ICONS.chat, 'Runs on WhatsApp', 'Forward a school letter and the dates add themselves.'],
  [ICONS.trolley, 'Lists and meals sorted', 'Shopping lists and a weekly meal plan the whole family sees.'],
  [ICONS.star, 'Chores kids actually do', 'Stars and rewards turn helping out into a game.'],
];

const CSS = `
.giftp{min-height:100vh;font-family:var(--font-sans,Inter,system-ui,sans-serif);color:#1A1620;background:linear-gradient(175deg,#f1ecf6 0%,#f5eff7 26%,#F7F1EC 52%,#f5eee7 76%,#f0e7dd 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:34px 20px 26px}
.giftp a{color:#4A1D96}.giftp a:hover{color:#6D38AD}
.giftp-lockup{width:126px;display:block;margin:0 auto 26px}
.giftp-card{width:100%;max-width:480px;background:#FFFDFA;border-radius:24px;padding:30px 28px 26px;box-shadow:0 26px 60px -26px rgba(26,22,32,.35),0 0 0 1px rgba(26,22,32,.05);text-align:center;animation:giftp-rise .55s cubic-bezier(.22,.8,.2,1) backwards}
.giftp-ribbon{display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border-radius:99px;background:#FBF1DE;color:#8A5F1E;font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.giftp-ribbon--neutral{background:#F2ECFA;color:#4A1D96}
.giftp-h1{font-family:var(--font-serif-display,Georgia,serif);font-weight:400;font-size:34px;line-height:1.12;letter-spacing:-.015em;margin:16px auto 0;max-width:330px;text-wrap:balance}
.giftp-h1 em{font-style:normal;color:#6D38AD}
.giftp-sub{font-size:15px;line-height:1.5;color:#4A4453;margin:12px auto 0;width:330px;max-width:100%;text-wrap:pretty}
.giftp-rows{margin:20px 0 0;border-top:1px solid rgba(26,22,32,.08)}
.giftp-row{display:flex;align-items:center;gap:13px;padding:12px 2px;border-bottom:1px solid rgba(26,22,32,.08);text-align:left}
.giftp-row:last-child{border-bottom:none}
.giftp-tile{width:38px;height:38px;border-radius:11px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:#F2ECFA}
.giftp-row b{display:block;font-size:14px;font-weight:600;color:#2D2A33}
.giftp-row small{display:block;font-size:12.5px;color:#8A8493;margin-top:1px}
.giftp-cta{display:block;width:100%;margin-top:20px;padding:16px;border-radius:16px;border:0;background:#6D38AD;color:#fff !important;font-weight:600;font-size:15px;cursor:pointer;box-shadow:0 10px 24px -8px rgba(109,56,173,.55);text-decoration:none}
.giftp-cta:hover{background:#4A1D96;color:#fff !important}
.giftp-mini{font-size:12.5px;color:#8A8493;margin-top:11px}
.giftp-quote{margin-top:22px;text-align:center;animation:giftp-rise .55s .12s cubic-bezier(.22,.8,.2,1) backwards}
.giftp-stars{color:#D89B3A;font-size:13px;letter-spacing:2.5px}
.giftp-quote p{font-size:13px;color:#4A4453;margin-top:5px}
.giftp-quote span{font-size:12px;color:#8A8493}
.giftp-foot{font-size:12px;color:#8A8493;margin-top:18px;text-align:center}
@keyframes giftp-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.giftp-card,.giftp-quote{animation-duration:.01ms}}
@media(max-width:420px){.giftp-h1{font-size:30px}.giftp-card{padding:26px 22px 22px}}
`;

export default function GiftLanding() {
  const { code } = useParams();
  const [state, setState] = useState({ loading: true, valid: false });

  useEffect(() => {
    document.title = 'Two free months of Housemait';
    // OG tags for link previews - WhatsApp is the main referrer and its
    // bot reads the prerendered /gift shell, which is this page snapshotted.
    upsertMeta('property', 'og:title', 'Two free months of Housemait');
    upsertMeta('property', 'og:description', "The calm home for your family's calendar, lists and meals. A friend gave you your first two months free.");
    upsertMeta('property', 'og:url', 'https://housemait.com/gift');
    // Personal links between families - not for search engines.
    const robots = upsertMeta('name', 'robots', 'noindex');
    return () => { try { document.head.removeChild(robots); } catch { /* already gone */ } };
  }, []);

  useEffect(() => {
    // Bare /gift (the prerender shell) has no code: stay in the loading
    // state - real visitors always arrive on /gift/<code>.
    if (!code) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/referrals/gift/${encodeURIComponent(code)}`);
        if (cancelled) return;
        if (data?.valid) {
          storeReferralCode(data.code);
          setState({ loading: false, valid: true, code: data.code });
        } else {
          setState({ loading: false, valid: false });
        }
      } catch {
        if (!cancelled) setState({ loading: false, valid: false });
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const valid = state.valid;

  return (
    <div className="giftp">
      <style>{CSS}</style>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <img className="giftp-lockup" src="/housemait-logo-web.svg" alt="Housemait" />

        <div className="giftp-card">
          {state.loading ? (
            <p className="giftp-sub" style={{ margin: 0 }}>One moment…</p>
          ) : (
            <>
              <span className={valid ? 'giftp-ribbon' : 'giftp-ribbon giftp-ribbon--neutral'}>
                {valid && ICONS.gift}
                {valid ? 'A gift for your family' : 'Housemait'}
              </span>

              {valid ? (
                <h1 className="giftp-h1">A friend gave you <em>two free months</em> of Housemait.</h1>
              ) : (
                <h1 className="giftp-h1">This gift link isn&apos;t valid.</h1>
              )}

              <p className="giftp-sub">
                {valid
                  ? "The calm home for your family's calendar, lists and meals. Start your free trial and your bonus month is added automatically once your family starts using Housemait."
                  : 'The link may have been mistyped along the way. You can still try Housemait free, every new family gets a full trial of everything.'}
              </p>

              <div className="giftp-rows">
                {BENEFITS.map(([icon, title, sub]) => (
                  <div key={title} className="giftp-row">
                    <span className="giftp-tile">{icon}</span>
                    <span>
                      <b>{title}</b>
                      <small>{sub}</small>
                    </span>
                  </div>
                ))}
              </div>

              <Link className="giftp-cta" to={valid ? `/signup?gift=${encodeURIComponent(state.code)}` : '/signup'}>
                {valid ? 'Claim your two free months' : 'Try Housemait free'}
              </Link>
              <div className="giftp-mini">Free trial, no card needed.</div>
            </>
          )}
        </div>

        {SHOW_TESTIMONIAL && (
          <div className="giftp-quote">
            <div className="giftp-stars">★★★★★</div>
            <p>&quot;&quot;</p>
            <span></span>
          </div>
        )}

        <div className="giftp-foot">
          Already using Housemait? This gift is for new families, <Link to="/login">pass it on</Link>.
        </div>
      </div>
    </div>
  );
}
