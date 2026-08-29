/**
 * Onboarding v4 screens — the plan chat beat.
 *
 * Screen 03 (personalised plan) is the flow's one conversational screen: a
 * full chat onboarding was considered and rejected (slow to read, hard to
 * skim, hard to go back in). The old screen 09 WhatsApp beat moved out when
 * pairing became the post-auth 'whatsapp' phase (whatsappLinkScreen.jsx) -
 * the pitch now lives where the link can actually happen.
 *
 * Pacing comes from useScript and must not be sped up - the pause is what
 * makes it read as a reply rather than a slideshow.
 */
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

