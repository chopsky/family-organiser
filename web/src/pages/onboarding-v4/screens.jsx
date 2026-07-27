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
import { useEffect } from 'react';
import { T, SHADOW, R } from './tokens';
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
  font: '700 11.5px Inter, system-ui, sans-serif', letterSpacing: '.16em',
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
              font: '500 13.5px Inter, system-ui, sans-serif', color: T.ink,
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
          <span style={{ display: 'block', font: '700 14.5px Inter, system-ui, sans-serif', color: T.ink }}>All handled</span>
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
          Free for 30 days · no card needed
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
export function HouseStep({ d, update, onEnter }) {
  return (
    <>
      <p style={EYEBROW}>Step 5 of 6</p>
      <h1 style={{ ...H1, fontSize: 34, marginTop: 8 }}>Every home needs a name.</h1>
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
            font: '700 10.5px Inter, system-ui, sans-serif', letterSpacing: '.14em',
            textTransform: 'uppercase', color: T.ink3, marginTop: 8,
          }}
        >
          Est. 2026 · Powered by Housemait
        </p>
      </div>
    </div>
  );
}
