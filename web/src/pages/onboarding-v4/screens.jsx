/**
 * Onboarding v4 screens — batch 1: splash and the pickers.
 *
 * Screens 01 (splash), 02 (pains), 04 (shape), 05 (name), 06 (role),
 * 07 (household name + house-sign reward). The chat beats (03, 09), calendars
 * (08), reminders (10), sign-up (11) and welcome (12) land in later batches.
 *
 * Layout values are the spec's; colours resolve through ./tokens to the app's
 * existing custom properties.
 */
import { useEffect, useRef, useState } from 'react';
import { T, SHADOW, R } from './tokens';
import api from '../../lib/api';
import { detectCountryFromLocaleRegion, detectCountryFromLocaleCookie, detectCountryFromTimezone } from '../../lib/country';
import { readLocaleCookie } from '../../hooks/useLocale';
import { getStorefrontCountry } from '../../lib/revenuecat';
import { NOTES, PAINS, SHAPES, ROLES, houseSuggestions } from './content';
import { Lockup, Cta, Ghost, OptionRow, ChipGrid, Field, Tick } from './ui';

const MEMOJI = ['/onboarding-v4/memoji/m21.png', '/onboarding-v4/memoji/m07.png', '/onboarding-v4/memoji/m28.png'];

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink,
};
const EM = { color: T.purple, fontStyle: 'normal' };
const SUB = { fontSize: 15, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty' };
const EYEBROW = {
  font: '700 11.5px var(--font-sans)', letterSpacing: '.16em',
  textTransform: 'uppercase', color: T.purple,
};
const rise = (delay, reduced) => ({
  animation: reduced ? 'none' : `obRise .5s ${delay}s cubic-bezier(.22,.8,.2,1) backwards`,
});

/* ── 01 Splash ─────────────────────────────────────────────────────────────
   Empathy before product. Earns the next tap and nothing else - no feature
   claims, no screenshots. The pile IS the pitch. */
export function Splash({ onStart, onLogin, reduced }) {
  return (
    <div
      className="ob-v4"
      style={{
        height: '100dvh', display: 'flex', flexDirection: 'column',
        background: T.bg, padding: '60px 28px 30px',
        paddingTop: 'calc(60px + env(safe-area-inset-top, 0px))',
      }}
    >
      <Lockup width={134} />

      {/* Sticky-note pile. Rotation and final opacity ride on CSS vars so the
          obRiseR keyframe can preserve both - otherwise notes snap upright. */}
      <div style={{ position: 'relative', height: 196, marginTop: 24, flexShrink: 0 }}>
        {NOTES.map((n, i) => (
          <div
            key={n.t}
            style={{
              position: 'absolute', ...n.x,
              '--rot': `${n.r}deg`, '--op': n.o,
              // Set the final opacity inline rather than relying on the
              // keyframe's end state: obRiseR uses fill-mode backwards, so once
              // it finishes the element reverts to its own style. Without this
              // every note settled at opacity 1 and the "buried" fade down the
              // pile - the whole point of the image - disappeared.
              opacity: n.o,
              transform: `rotate(${n.r}deg)`,
              animation: reduced ? 'none' : `obRiseR .5s ${0.12 + i * 0.09}s cubic-bezier(.22,.8,.2,1) backwards`,
              background: '#fff', borderRadius: 14, padding: '9px 13px',
              font: '500 13.5px var(--font-sans)', color: T.ink,
              boxShadow: SHADOW.note, whiteSpace: 'nowrap',
            }}
          >
            {n.t}
          </div>
        ))}
      </div>

      <h1 style={{ ...H1, fontSize: 40, marginTop: 4, ...rise(0.5, reduced) }}>
        You’re holding<br />it <span style={EM}>all in your head.</span>
      </h1>
      <p style={{ ...SUB, maxWidth: 312, marginTop: 12, ...rise(0.58, reduced) }}>
        Housemait catches every last one of them, then shares the load with the
        people you live with.
      </p>

      <div style={{ flex: 1 }} />

      {/* Proof, quietly: the same five things, handled. */}
      <div
        style={{
          background: T.surface, borderRadius: R.card, boxShadow: SHADOW.card,
          padding: '15px 16px', marginBottom: 18, display: 'flex', alignItems: 'center',
          gap: 12, ...rise(0.66, reduced),
        }}
      >
        <span
          style={{
            width: 30, height: 30, borderRadius: '50%', background: '#E9F3EA', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Tick size={15} color="#3F8E52" />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', font: '700 14.5px var(--font-sans)', color: T.ink }}>All handled</span>
          <span style={{ display: 'block', fontSize: 12, color: T.ink3 }}>5 things, shared with 3 people</span>
        </span>
        <span style={{ display: 'flex', flexShrink: 0 }}>
          {MEMOJI.map((src, i) => (
            <span
              key={src}
              style={{
                width: 30, height: 30, borderRadius: '50%', background: T.purpleSoft,
                boxShadow: `0 0 0 2px ${T.surface}`, marginLeft: i === 0 ? 0 : -9,
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}
            >
              <img src={src} alt="" aria-hidden="true" style={{ width: 28, height: 28, objectFit: 'contain' }} />
            </span>
          ))}
        </span>
      </div>

      <div style={rise(0.74, reduced)}>
        <Cta onClick={onStart}>Hand it over to Housemait</Cta>
        <p style={{ fontSize: 12.5, color: T.ink3, textAlign: 'center', marginTop: 10 }}>
          {/* Free-app model: the app is free for good and signup takes no
              card - the old "cancel anytime" implied an auto-renewing
              wall that no longer exists. Premium (the assistant
              unlimited, briefs, sync) rides along free for 14 days. */}
          Free for your family · Premium included for 14 days
        </p>
        <Ghost onClick={onLogin}>I already have an account</Ghost>
      </div>
    </div>
  );
}

/* ── 02 Pain picker ────────────────────────────────────────────────────────
   Looks like a survey; is actually the personalisation engine and a commitment
   device. All six must fit without scrolling at 844px, hence the compact rows. */
export function PainPicker({ d, toggle }) {
  return (
    <>
      <p style={EYEBROW}>Step 1 of 6</p>
      <h1 style={{ ...H1, fontSize: 32, marginTop: 8 }}>Which of these sound like you?</h1>
      <p style={{ ...SUB, marginTop: 8 }}>Pick as many as you like.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 18 }}>
        {PAINS.map((p, i) => (
          <OptionRow
            key={p.id} i={i} compact emoji={p.emoji} label={p.label} note={p.note}
            selected={(d.pains || []).includes(p.id)}
            onClick={() => toggle(p.id)}
          />
        ))}
      </div>
    </>
  );
}

/* ── 04 Household shape ─ tapping advances; no CTA. */
export function ShapePicker({ d, pick }) {
  return (
    <>
      <p style={EYEBROW}>Step 2 of 6</p>
      <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>Who’s in your household?</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 18 }}>
        {SHAPES.map((s, i) => (
          <OptionRow
            key={s.id} i={i} emoji={s.emoji} label={s.label} note={s.note}
            selected={d.shape === s.id}
            onClick={() => pick({ shape: s.id })}
          />
        ))}
      </div>
    </>
  );
}

/* ── 05 Your name ─ the only free-text step before the household name. */
export function NameStep({ d, update, onEnter }) {
  return (
    <>
      <p style={EYEBROW}>Step 3 of 6</p>
      <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>What should we call you?</h1>
      <p style={{ ...SUB, marginTop: 8 }}>This is how you’ll show up to everyone else in the house.</p>
      <div style={{ marginTop: 18 }}>
        <Field
          value={d.you}
          onChange={(v) => update({ you: v })}
          onEnter={onEnter}
          placeholder="Your first name"
        />
      </div>
    </>
  );
}

/* ── 06 Your role ─ the sub states the CONSEQUENCE, which is why people answer
   honestly rather than picking whatever sounds nicest. */
export function RoleStep({ d, pick }) {
  return (
    <>
      <p style={EYEBROW}>Step 4 of 6</p>
      <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>And you’re the…</h1>
      <p style={{ ...SUB, marginTop: 8 }}>Roles decide who can assign chores, set rewards and invite people.</p>
      <div style={{ marginTop: 18 }}>
        <ChipGrid options={ROLES} value={d.role} onPick={(r) => pick({ role: r })} />
      </div>
    </>
  );
}

/* ── 07 Household name ─ the first thing they CREATE, hence the reward. */
/* ── 06 Kids ─ shown only to kid-shaped households (machine.js hops it
   otherwise). First names are enough; profiles are created at signup by
   replay.js, so Child Mode / School / stars are alive from day one. */
export function KidsStep({ d, update }) {
  // The half-typed name sits in the draft (kidDraft), not local state, so
  // the frame's CTA can commit it: a parent who types "Mason" and taps
  // Continue without Add used to lose the child - and with it the school
  // step, which only shows once a child is named (founder hit this 3 Sep).
  const draft = d.kidDraft || '';
  const setDraft = (v) => update({ kidDraft: v });
  const kids = d.kids || [];
  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (!kids.some((k) => k.toLowerCase() === name.toLowerCase())) {
      update({ kids: [...kids, name], kidDraft: '' });
    } else {
      setDraft('');
    }
  };
  return (
    <>
      <p style={EYEBROW}>Step 4 of 6</p>
      <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>Who are the kids?</h1>
      <p style={{ ...SUB, marginTop: 10 }}>First names are enough. They get their own colour, star chart and school days.</p>
      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={kids.length ? 'Another name?' : 'e.g. Olivia'}
          autoCapitalize="words"
          autoCorrect="off"
          aria-label="Child's first name"
          style={{
            flex: 1, minWidth: 0, padding: '15px 17px', borderRadius: 16,
            border: `1.5px solid ${T.line2}`, background: T.surface, outline: 'none',
            font: '600 16.5px var(--font-sans)', color: T.ink,
          }}
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          style={{
            padding: '0 22px', borderRadius: 16, border: 0, cursor: draft.trim() ? 'pointer' : 'default',
            background: draft.trim() ? T.purple : 'rgba(26,22,32,.08)',
            color: draft.trim() ? '#fff' : T.ink3, font: '600 15px var(--font-sans)',
          }}
        >
          Add
        </button>
      </div>
      {kids.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {kids.map((k) => (
            <span
              key={k}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '9px 9px 9px 14px', borderRadius: 99,
                background: T.purpleSoft, color: T.purpleDeep, font: '600 14px var(--font-sans)',
              }}
            >
              {k}
              <button
                type="button"
                onClick={() => update({ kids: kids.filter((x) => x !== k) })}
                aria-label={`Remove ${k}`}
                style={{
                  width: 22, height: 22, borderRadius: 99, border: 0, cursor: 'pointer',
                  background: 'rgba(26,22,32,.10)', color: T.ink2, font: '600 13px var(--font-sans)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/* ── 06b School ─ right after the kids step, only when a child was named
   (machine.js hops it otherwise). The ask takes the household's shape by
   COUNTRY, using the same detection cascade create-household will use:
   GB searches the England schools directory (GIAS, public endpoint, so it
   works pre-auth); every other country types a plain name - the directory
   is England-only, and a wrong pick would import English council dates -
   with South Africa additionally getting the national term dates at
   replay. The pick is created at signup by replay.js. Launch-week data
   (2026-09-02): 3 of 13 kid-households had added a school, because
   nothing had ever asked. */
export function SchoolStep({ d, update, onSearching = () => {} }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  // With the keyboard up, the frame's pinned footer sat on top of the
  // results (founder's phone, 3 Sep): the list rendered below the input,
  // under Continue, and nothing said "scroll". While the input has focus
  // the frame drops its footer (onSearching) and the input scrolls to the
  // top of the body, so the list gets the whole space above the keyboard.
  const inputRef = useRef(null);
  const onSearchingRef = useRef(onSearching);
  onSearchingRef.current = onSearching;
  const focusIn = () => {
    onSearchingRef.current(true);
    // After the keyboard animation, or the scroll lands on the old layout.
    setTimeout(() => inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 260);
  };
  const focusOut = () => onSearchingRef.current(false);
  useEffect(() => () => onSearchingRef.current(false), []);
  const [country, setCountry] = useState(() => (
    detectCountryFromLocaleRegion()
    || detectCountryFromLocaleCookie(readLocaleCookie())
    || detectCountryFromTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    || 'GB'
  ));
  // The App Store / Play storefront is the strongest signal on a device,
  // but it's async - refine once it answers.
  useEffect(() => {
    let on = true;
    getStorefrontCountry().then((c) => { if (on && c) setCountry(c); }).catch(() => {});
    return () => { on = false; };
  }, []);
  const isGb = country === 'GB';
  const isZa = country === 'ZA';
  const kids = d.kids || [];
  const picked = d.school || null;

  useEffect(() => {
    if (!isGb) return undefined;
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return undefined; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/schools/search?q=${encodeURIComponent(q)}`);
        if (!cancelled) setResults((data?.schools || []).slice(0, 6));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, isGb]);

  const pick = (r) => {
    update({ school: { urn: r.urn, name: r.name, type: r.type || null, local_authority: r.local_authority || null, postcode: r.postcode || null, country } });
    setResults([]);
    // The input unmounts with the pick, so its blur never fires.
    onSearchingRef.current(false);
  };
  const who = kids.length === 1 ? kids[0] : kids.length === 2 ? `${kids[0]} and ${kids[1]}` : 'the kids';
  const verb = kids.length === 1 ? 'does' : 'do';
  const meta = (r) => [r.local_authority, r.postcode].filter(Boolean).join(' · ');
  const inputStyle = {
    width: '100%', padding: '15px 17px', borderRadius: 16,
    border: `1.5px solid ${T.line2}`, background: T.surface, outline: 'none',
    font: '600 16.5px var(--font-sans)', color: T.ink,
  };

  // Non-GB: a plain name is the whole answer - it lands in the draft as
  // they type (no pick step), so the CTA reads "Add this school" once
  // there's a name.
  if (!isGb) {
    return (
      <>
        <p style={EYEBROW}>Step 4 of 6</p>
        <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>Where {verb} {who} go to school?</h1>
        <p style={{ ...SUB, marginTop: 10 }}>
          {isZa
            ? 'Type the school’s name and tell us which calendar it follows.'
            : 'Type the school’s name. Once you’re in, you can add its term dates from the school’s website or a photo of the letter.'}
        </p>
        <div style={{ marginTop: 18 }}>
          <input
            value={picked?.name || ''}
            onChange={(e) => {
              const name = e.target.value;
              update({ school: name.trim() ? { ...(picked || {}), urn: null, name, type: null, local_authority: null, postcode: null, country, freeText: true } : null });
            }}
            placeholder={isZa ? 'e.g. Sandown Primary' : 'e.g. Lincoln Elementary'}
            autoCapitalize="words"
            autoCorrect="off"
            aria-label="School name"
            ref={inputRef}
            onFocus={focusIn}
            onBlur={focusOut}
            style={inputStyle}
          />
        </div>
        {/* South Africa: public schools follow the national calendar;
            independent schools set their own. Nothing is assumed - the
            national dates are only imported when the family says so,
            because the wrong calendar on a private-school family's
            year is worse than none (founder, 2026-09-02). */}
        {isZa && picked?.name && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
            {[
              { v: true, label: 'Public school', note: 'Follows the national term dates - we’ll add them for you' },
              { v: false, label: 'Private or independent', note: 'Sets its own calendar - add its dates on the School page' },
            ].map((o) => {
              const on = picked.usesNationalDates === o.v;
              return (
                <button
                  key={String(o.v)}
                  type="button"
                  onClick={() => { update({ school: { ...picked, usesNationalDates: o.v } }); inputRef.current?.blur(); }}
                  style={{
                    textAlign: 'left', padding: '12px 14px', borderRadius: 16, cursor: 'pointer',
                    border: `1.5px solid ${on ? T.purple : T.line2}`, background: on ? T.purpleSoft : T.surface,
                  }}
                >
                  <div style={{ font: '600 15px var(--font-sans)', color: on ? T.purpleDeep : T.ink }}>{o.label}</div>
                  <div style={{ font: '500 12.5px var(--font-sans)', color: T.ink3, marginTop: 2 }}>{o.note}</div>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <p style={EYEBROW}>Step 4 of 6</p>
      <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>Where {verb} {who} go to school?</h1>
      <p style={{ ...SUB, marginTop: 10 }}>Search by name. For most schools we’ll put the term dates and holidays straight onto your calendar.</p>
      {picked ? (
        <div
          style={{
            marginTop: 18, display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px', borderRadius: 16, background: T.purpleSoft,
          }}
        >
          <span style={{ fontSize: 22 }} aria-hidden="true">🏫</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '600 15.5px var(--font-sans)', color: T.purpleDeep }}>{picked.name}</div>
            {meta(picked) && <div style={{ font: '500 13px var(--font-sans)', color: T.ink3, marginTop: 2 }}>{meta(picked)}</div>}
          </div>
          <button
            type="button"
            onClick={() => update({ school: null })}
            style={{ border: 0, background: 'transparent', cursor: 'pointer', font: '600 13.5px var(--font-sans)', color: T.purpleDeep, padding: '6px 2px' }}
          >
            Change
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 18 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); pick(results[0]); } }}
              placeholder="e.g. St Mary’s Primary"
              autoCapitalize="words"
              autoCorrect="off"
              aria-label="School name"
              ref={inputRef}
              onFocus={focusIn}
              onBlur={focusOut}
              style={inputStyle}
            />
          </div>
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {results.map((r) => (
                <button
                  key={r.urn || r.name}
                  type="button"
                  // Keep the input focused through the tap: a blur first
                  // would bring the footer back mid-gesture.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(r)}
                  style={{
                    textAlign: 'left', padding: '12px 14px', borderRadius: 16, cursor: 'pointer',
                    border: `1.5px solid ${T.line2}`, background: T.surface,
                  }}
                >
                  <div style={{ font: '600 15px var(--font-sans)', color: T.ink }}>{r.name}</div>
                  {meta(r) && <div style={{ font: '500 12.5px var(--font-sans)', color: T.ink3, marginTop: 2 }}>{meta(r)}</div>}
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p style={{ ...SUB, marginTop: 12, fontSize: 14 }}>
              Can’t find it? Skip for now - you can add any school, with its own term dates, on the School page.
            </p>
          )}
          {searching && <p style={{ ...SUB, marginTop: 12, fontSize: 13, color: T.ink3 }}>Searching…</p>}
        </>
      )}
    </>
  );
}

export function HouseStep({ d, update, onEnter, joinLink }) {
  return (
    <>
      <p style={EYEBROW}>Step 5 of 6</p>
      <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>Every home needs a name.</h1>
      {/* Above the field, not below it: the keyboard opens with the screen
          and swallows anything under the input - the join escape hatch has
          to be visible before typing starts. */}
      {joinLink}
      <div style={{ marginTop: 18 }}>
        <Field
          value={d.house}
          onChange={(v) => update({ house: v })}
          onEnter={onEnter}
          placeholder="e.g. The Carters"
          suggestions={houseSuggestions(d.you)}
          onSuggest={(s) => update({ house: s })}
        />
      </div>
    </>
  );
}

/* ── House-sign reward ─ shown for 1500ms on submitting the household name,
   then auto-advances. Cheap, and it makes a 12-screen flow feel like it's
   going somewhere. */
export function HouseSignOverlay({ name, onDone, reduced }) {
  useEffect(() => {
    const t = setTimeout(onDone, reduced ? 200 : 1500);
    return () => clearTimeout(t);
  }, [onDone, reduced]);

  return (
    <div
      className="ob-v4"
      role="status"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(240,231,221,.72)', backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 26,
      }}
    >
      <div
        className={reduced ? '' : 'ob-pop'}
        style={{
          background: T.surface, borderRadius: R.card, boxShadow: SHADOW.cardLg,
          padding: '30px 34px', textAlign: 'center',
        }}
      >
        <img
          src="/onboarding-v4/logomark-purple.png" alt="" aria-hidden="true"
          style={{ width: 46, height: 37, objectFit: 'contain', margin: '0 auto' }}
        />
        <p style={{ fontFamily: T.title, fontWeight: 400, fontSize: 28, color: T.ink, marginTop: 12 }}>{name}</p>
        <p
          style={{
            font: '700 10.5px var(--font-sans)', letterSpacing: '.14em',
            textTransform: 'uppercase', color: T.ink3, marginTop: 8,
          }}
        >
          Est. 2026 · Powered by Housemait
        </p>
      </div>
    </div>
  );
}
