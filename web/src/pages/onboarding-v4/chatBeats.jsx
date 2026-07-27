/**
 * Onboarding v4 screens — batch 2: the two chat beats.
 *
 * Screen 03 (personalised plan) and screen 09 (the "just text it" demo). These
 * are the only two conversational screens in the flow, and deliberately so: a
 * full chat onboarding was considered and rejected (slow to read, hard to skim,
 * hard to go back in). Chat appears exactly where the product's own killer
 * feature IS conversational, and nowhere else.
 *
 * Pacing comes from useScript and must not be sped up - the pause is what makes
 * it read as a reply rather than a slideshow.
 */
import { useState } from 'react';
import { T, SHADOW, R } from './tokens';
import { PAINS, PAINS_FALLBACK, planOpener } from './content';
import { Bubble, Typing } from './ui';
import useScript from './useScript';

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink,
};
const SUB = { fontSize: 15, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty' };

/* ── 03 Your plan ──────────────────────────────────────────────────────────
   The single most important screen in the flow: it pays back the pain picker
   immediately, proving that screen was not a data grab. Every row here comes
   from something the user actually ticked. */
export function PlanBeat({ d, reduced, onDone }) {
  const picked = (d.pains || []).length ? d.pains : PAINS_FALLBACK;
  const benefits = picked
    .map((id) => PAINS.find((p) => p.id === id))
    .filter(Boolean);

  const script = [
    { from: 'bot', text: planOpener(picked.length), wait: 700 },
    { from: 'bot', text: 'Right then. Here’s what I’ll take off your hands:', wait: 900 },
    { from: 'bot', card: true, wait: 900 },
  ];
  const { shown, typing } = useScript(script, onDone, reduced);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 9, paddingTop: 4 }}>
      {shown.map((item, i) => (
        item.card ? (
          <div
            key="card"
            className={reduced ? '' : 'ob-bub'}
            style={{
              marginLeft: 37, // aligns under the bubbles, past the avatar
              background: T.surface, borderRadius: R.card, boxShadow: SHADOW.card,
              overflow: 'hidden',
            }}
          >
            {benefits.map((b, n) => (
              <div
                key={b.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 14px',
                  borderTop: n === 0 ? 'none' : `1px solid ${T.line}`,
                }}
              >
                <span
                  style={{
                    width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: T.purpleSoft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
                  }}
                >
                  {b.emoji}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', font: '700 14.5px Inter, system-ui, sans-serif', color: T.ink }}>{b.ben.t}</span>
                  <span style={{ display: 'block', fontSize: 13, color: T.ink2, marginTop: 1, lineHeight: 1.4 }}>{b.ben.d}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Bubble key={i} from="bot">{item.text}</Bubble>
        )
      ))}
      {typing && <Typing />}
    </div>
  );
}

/** The two "filed it here" chips inside Housemait's reply on screen 09. */
function FiledPills() {
  const pill = (bg, color) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px',
    borderRadius: R.pill, background: bg, color, font: '600 12px Inter, system-ui, sans-serif',
  });
  return (
    <span style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      <span style={pill(T.purpleSoft, T.purpleDeep)}>📅 Calendar</span>
      <span style={pill('#EAF3EA', T.okInk)}>🛒 Shop list</span>
    </span>
  );
}

/* ── 09 Just ask ───────────────────────────────────────────────────────────
   Demo first, then ask, at the peak of perceived value. The user bubble
   deliberately echoes "Dentist Tue 3pm" from the splash pile - the chaos the
   flow opened with, now handled. */
export function AskBeat({ d, reduced, onDone }) {
  const script = [
    { from: 'me', text: 'Dentist for Arlo Tue 3pm, and we’re out of milk' },
    { from: 'bot', reply: true, wait: 1000 },
  ];
  const { shown, typing, done } = useScript(script, onDone, reduced);
  const name = (d.you || '').trim();

  return (
    <>
      <h1 style={{ ...H1, fontSize: 34 }}>
        Or just <span style={{ color: T.purple }}>text it to us.</span>
      </h1>
      <p style={{ ...SUB, marginTop: 8 }}>
        Say what’s happening in plain English, in the app or on WhatsApp.
        Housemait files it for the whole family.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 20 }}>
        {shown.map((item, i) => (
          <Bubble key={i} from={item.from}>
            {item.reply ? (
              <>
                Done. Dentist is on the family calendar for Tuesday, milk’s on the
                shop list{name ? `, ${name}` : ''}.
                <FiledPills />
              </>
            ) : item.text}
          </Bubble>
        ))}
        {typing && <Typing />}
      </div>

      {/* Social proof appears exactly once in the flow, here, where a stranger's
          endorsement supports a permission request. */}
      {done && (
        <div
          className={reduced ? '' : 'ob-in'}
          style={{ marginTop: 22, textAlign: 'center', animationDelay: '.15s' }}
        >
          <p style={{ color: T.gold, letterSpacing: '2.5px', fontSize: 13 }}>★★★★★</p>
          <p style={{ fontSize: 13, color: T.ink2, marginTop: 6 }}>“It’s like having a PA for the house.”</p>
          <p style={{ fontSize: 13, color: T.ink3, marginTop: 2 }}>Dan, dad of three</p>
        </div>
      )}
    </>
  );
}

/**
 * Screen 09 footer. Captures INTENT only.
 *
 * A WhatsApp link is a column on users, and there is no user yet - the bot
 * resolves inbound messages by phone->user lookup, so pre-account there is
 * nothing to bind a number to. The prototype's "WhatsApp connected" success
 * state would therefore be a lie here. Instead we take the yes, say plainly
 * when it happens, and fire the real pairing immediately after sign-up.
 */
export function WhatsAppFooter({ on, onConnect, onSkip }) {
  const [busy, setBusy] = useState(false);

  if (on) {
    return (
      <div
        style={{
          background: T.okBg, color: T.okInk, borderRadius: R.cta, padding: '14px 16px',
          textAlign: 'center', font: '700 15px Inter, system-ui, sans-serif',
        }}
      >
        WhatsApp it is
        <span style={{ display: 'block', font: '500 12.5px Inter, system-ui, sans-serif', marginTop: 2 }}>
          We’ll link it the moment your account’s saved.
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => { setBusy(true); onConnect(); }}
        style={{
          width: '100%', minHeight: 44, padding: 16, borderRadius: R.cta, border: 0,
          background: T.green, color: '#fff', font: '700 16.5px Inter, system-ui, sans-serif',
          boxShadow: SHADOW.whatsapp, cursor: busy ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}
      >
        <img src="/onboarding-v4/whatsapp-white.svg" alt="" aria-hidden="true" style={{ width: 24, height: 24 }} />
        {busy ? 'One moment…' : 'Connect WhatsApp'}
      </button>
      {!busy && (
        <button
          type="button"
          onClick={onSkip}
          style={{
            width: '100%', minHeight: 44, padding: 13, border: 0, background: 'transparent',
            font: '600 14.5px Inter, system-ui, sans-serif', color: T.ink2, cursor: 'pointer',
          }}
        >
          I don’t use WhatsApp
        </button>
      )}
    </>
  );
}
