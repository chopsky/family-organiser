/**
 * /maple-alternative - the landing page for families leaving Maple.
 *
 * Maple (growmaple.com) was acquired by Wander in July 2026 and sunsets on
 * 31 December 2026 with all family data deleted. Every small competitor has
 * a "Maple alternative" page catching those families; this is ours. Unlike
 * /gift this IS for search engines: indexed, canonical, FAQPage JSON-LD,
 * prerendered (scripts/prerender.mjs + sitemap.xml carry the route).
 *
 * Copy rules: no em dashes; honest migration story (there is no automated
 * Maple import - export from Maple, subscribe calendar feeds, re-add lists;
 * never overclaim). Head effects idempotent - the prerender snapshot re-runs
 * them (see the SEO prerendering notes in docs).
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';

function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

const FAQS = [
  {
    q: 'When does Maple shut down?',
    a: 'Maple closes on 31 December 2026 after its team was acquired by Wander. Accounts stop working after that date and Maple has said family data will be deleted, so export anything you want to keep before the end of the year.',
  },
  {
    q: 'Can I move my Maple data to Housemait?',
    a: 'There is no one-click import, but the move is quick in practice. Export your data from Maple while you still can, then in Housemait: subscribe any external calendars (Google, iCloud, Outlook) so events flow in automatically, re-add your standing shopping list in a minute, and forward any school letters to your house email address so the dates add themselves.',
  },
  {
    q: 'Is Housemait free?',
    a: 'Every new family gets a full 14-day free trial of everything. After that it is £5.99 a month or £59.99 a year (two months free). One subscription covers the whole household.',
  },
  {
    q: 'Does Housemait work outside the UK?',
    a: 'Yes. The shared calendar, lists, meal planner, chores and the WhatsApp assistant work everywhere. The automatic school term-dates library is UK-first, with more regions planned.',
  },
];

const CSS = `
.maplep{position:relative;overflow:hidden;min-height:100vh;font-family:var(--font-sans,Inter,system-ui,sans-serif);color:#1A1620;background:radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%);display:flex;flex-direction:column;align-items:center;padding:34px 20px 40px}
.maplep>div{position:relative;z-index:1;width:100%;max-width:560px}
.maplep a{color:#6B3FA0}.maplep a:hover{color:#5A3488}
.maplep-lockup{width:126px;display:block;margin:0 auto 26px}
.maplep-card{background:rgba(255,253,250,0.86);border:1px solid rgba(255,255,255,0.9);border-radius:24px;padding:30px 28px 26px;box-shadow:0 30px 80px -20px rgba(26,22,32,0.18)}
.maplep-ribbon{display:inline-flex;align-items:center;padding:7px 14px;border-radius:99px;background:#FDF0EB;color:#993C1D;font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.maplep-h1{font-family:var(--font-serif-display,Georgia,serif);font-weight:400;font-size:36px;line-height:1.12;letter-spacing:-.02em;margin:16px 0 0;text-wrap:balance}
.maplep-h1 em{font-style:normal;color:#6B3FA0}
.maplep-sub{font-size:15.5px;line-height:1.55;color:#4A4453;margin:12px 0 0;text-wrap:pretty}
.maplep-h2{font-family:var(--font-serif-display,Georgia,serif);font-weight:400;font-size:23px;margin:30px 0 4px}
.maplep-rows{margin:12px 0 0;border-top:1px solid rgba(26,22,32,.08)}
.maplep-row{display:flex;align-items:baseline;gap:12px;padding:11px 2px;border-bottom:1px solid rgba(26,22,32,.08)}
.maplep-row:last-child{border-bottom:none}
.maplep-row .tick{color:#3F8E52;font-weight:700;flex-shrink:0}
.maplep-row .plus{color:#6B3FA0;font-weight:700;flex-shrink:0}
.maplep-row b{font-size:14.5px;font-weight:600;color:#2D2A33}
.maplep-row small{display:block;font-size:13px;color:#6B6774;margin-top:1px}
.maplep-steps{margin:12px 0 0;padding:0;list-style:none;counter-reset:step}
.maplep-steps li{counter-increment:step;position:relative;padding:10px 0 10px 40px;font-size:14.5px;line-height:1.5;color:#4A4453}
.maplep-steps li::before{content:counter(step);position:absolute;left:0;top:9px;width:26px;height:26px;border-radius:9px;background:#F3EDFC;color:#6B3FA0;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center}
.maplep-steps b{color:#2D2A33}
.maplep-cta{display:block;width:100%;margin-top:22px;padding:16px;border-radius:16px;background:#6B3FA0;color:#fff !important;font-weight:600;font-size:15px;text-align:center;text-decoration:none;box-shadow:0 6px 16px -8px rgba(107,63,160,0.45)}
.maplep-cta:hover{background:#5A3488}
.maplep-mini{font-size:12.5px;color:#8A8493;margin-top:11px;text-align:center}
.maplep-faq{margin-top:8px}
.maplep-faq h3{font-size:15px;font-weight:600;color:#2D2A33;margin:16px 0 4px}
.maplep-faq p{font-size:14px;line-height:1.55;color:#4A4453;margin:0}
.maplep-foot{font-size:12.5px;color:#8A8493;margin-top:20px;text-align:center}
@media(max-width:420px){.maplep-h1{font-size:30px}.maplep-card{padding:26px 22px 22px}}
`;

export default function MapleAlternative() {
  useEffect(() => {
    document.title = 'Maple Alternative for Families | Housemait';
    upsertMeta('name', 'description', 'Maple shuts down on 31 December 2026. Housemait keeps everything Maple did, shared calendar, meal plan, lists and chores, and adds a WhatsApp assistant and UK school term dates.');
    upsertMeta('property', 'og:title', 'Moving on from Maple? Bring your family home.');
    upsertMeta('property', 'og:description', 'Maple closes 31 December 2026 and data will be deleted. Housemait is where organised families land: calendar, meals, lists, chores, plus an assistant on WhatsApp.');
    upsertMeta('property', 'og:url', 'https://housemait.com/maple-alternative');
    upsertLink('canonical', 'https://housemait.com/maple-alternative');
    // FAQPage JSON-LD - guarded by id so the prerender's re-run stays clean.
    let ld = document.getElementById('maple-faq-ld');
    if (!ld) {
      ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.id = 'maple-faq-ld';
      document.head.appendChild(ld);
    }
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }, []);

  return (
    <div className="maplep">
      <style>{CSS}</style>
      <div>
        <img className="maplep-lockup" src="/housemait-logo-web.svg" alt="Housemait" />

        <div className="maplep-card">
          <span className="maplep-ribbon">Maple shuts down 31 December 2026</span>
          <h1 className="maplep-h1">Moving on from Maple? <em>Bring your family home.</em></h1>
          <p className="maplep-sub">
            Maple&rsquo;s team has been acquired and the app closes at the end of 2026, with family
            data deleted after shutdown. Housemait keeps everything Maple did in one calm place,
            and adds the things Maple never had.
          </p>

          <h2 className="maplep-h2">Everything you used in Maple</h2>
          <div className="maplep-rows">
            <div className="maplep-row"><span className="tick">✓</span><span><b>Shared family calendar</b><small>Colour-coded per person, with device and Google calendar sync.</small></span></div>
            <div className="maplep-row"><span className="tick">✓</span><span><b>Meal planner and recipe box</b><small>A weekly plan the whole family sees, recipes saved for keeps.</small></span></div>
            <div className="maplep-row"><span className="tick">✓</span><span><b>Shopping and to-do lists</b><small>Real-time shared lists, including custom lists for holidays and parties.</small></span></div>
            <div className="maplep-row"><span className="tick">✓</span><span><b>Chores and tasks</b><small>Assigned, recurring, and kids earn stars for doing theirs.</small></span></div>
          </div>

          <h2 className="maplep-h2">And the things Maple never had</h2>
          <div className="maplep-rows">
            <div className="maplep-row"><span className="plus">+</span><span><b>An assistant you can message on WhatsApp</b><small>Type it, voice-note it, or snap a photo of a school letter, and it&rsquo;s handled.</small></span></div>
            <div className="maplep-row"><span className="plus">+</span><span><b>School term dates, automatically</b><small>UK term dates and closures imported per school, straight onto the calendar.</small></span></div>
            <div className="maplep-row"><span className="plus">+</span><span><b>A house email address</b><small>Forward bookings and letters, and the details file themselves.</small></span></div>
            <div className="maplep-row"><span className="plus">+</span><span><b>Kids Mode</b><small>A bright, safe view where children see their days, quests and stars.</small></span></div>
          </div>

          <h2 className="maplep-h2">Moving over takes an evening</h2>
          <ol className="maplep-steps">
            <li><b>Export from Maple</b> while your account still works. Anything left after 31 December is gone.</li>
            <li><b>Start your Housemait trial</b> and add your family. Kids get their own profiles from the first minute.</li>
            <li><b>Reconnect the flow:</b> subscribe your calendars so events arrive on their own, re-add the standing shopping list, and forward the next school letter to your house inbox.</li>
          </ol>

          <Link className="maplep-cta" to="/signup">Start your free trial</Link>
          <div className="maplep-mini">14 days, everything included.</div>
        </div>

        <div className="maplep-card" style={{ marginTop: 18 }}>
          <h2 className="maplep-h2" style={{ marginTop: 0 }}>Questions families ask</h2>
          <div className="maplep-faq">
            {FAQS.map((f) => (
              <div key={f.q}>
                <h3>{f.q}</h3>
                <p>{f.a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="maplep-foot">
          <Link to="/">Housemait</Link>, the calm home for family life.
        </div>
      </div>
    </div>
  );
}
