/**
 * Onboarding v4 — post-auth WhatsApp pairing phase.
 *
 * Sits between sign-up and the celebration screen, because this is the
 * FIRST moment the pairing can actually run: an account now exists to
 * bind the number to. The old pre-auth step could only record intent,
 * its button read as if it had connected, and the deferred "Finish
 * linking" button on the crowded done screen quietly lost ~70% of
 * households. Here the button does what it says: open WhatsApp with a
 * prefilled code, send it, and the screen flips to Connected the moment
 * the webhook consumes the code.
 *
 * Never a gate: pairing unavailable (503 / no Twilio) advances silently,
 * "Maybe later" always shows, and everything here is recoverable from
 * Settings. Joiners pass through too - the second adult is the most
 * valuable link there is, and the removed step never reached them.
 */
import { useEffect, useRef, useState } from 'react';
import api from '../../lib/api';
import { T, SHADOW, R } from './tokens';
import { Mark, Ghost, Tick, TOP_GAP } from './ui';

const POLL_MS = 2500;
const MAX_POLL_MS = 11 * 60 * 1000;
const DONE_HOLD_MS = 1600;

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink,
};
const SUB = { fontSize: 15, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty' };
const EYEBROW = {
  font: '700 11.5px Inter, system-ui, sans-serif', letterSpacing: '.16em',
  textTransform: 'uppercase', color: T.purple,
};

export default function WhatsAppLinkScreen({ onDone, reduced }) {
  // init → offer → waiting → linked → (onDone)  |  init failure → onDone
  const [stage, setStage] = useState('init');
  const [pairing, setPairing] = useState(null);
  const [expired, setExpired] = useState(false);
  const pollStartRef = useRef(null);
  const doneRef = useRef(false);
  const finish = () => { if (!doneRef.current) { doneRef.current = true; onDone(); } };

  const init = async () => {
    setExpired(false);
    try {
      const { data } = await api.post('/auth/whatsapp-init-pairing');
      if (!data?.deep_link) { finish(); return; }
      setPairing(data);
      setStage('offer');
    } catch {
      // 503 (WhatsApp not configured) or transient: never a gate - the
      // user can pair from Settings later.
      finish();
    }
  };

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while waiting; the webhook consuming the code is the truth.
  useEffect(() => {
    if (stage !== 'waiting' || !pairing?.code) return undefined;
    pollStartRef.current = pollStartRef.current || Date.now();
    const id = setInterval(async () => {
      if (Date.now() - pollStartRef.current > MAX_POLL_MS) {
        clearInterval(id);
        setExpired(true);
        setStage('offer');
        return;
      }
      try {
        const { data } = await api.get('/auth/whatsapp-pairing-status', { params: { code: pairing.code } });
        if (data?.linked) {
          clearInterval(id);
          setStage('linked');
        } else if (data?.expired) {
          clearInterval(id);
          setExpired(true);
          setStage('offer');
        }
      } catch { /* transient - next tick retries */ }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [stage, pairing?.code]);

  // Linked: let the tick land, then move on to the celebration.
  useEffect(() => {
    if (stage !== 'linked') return undefined;
    const id = setTimeout(finish, reduced ? 400 : DONE_HOLD_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Nothing to show while the code is minted - it's one fast request, and
  // failure exits to the celebration without a flash of broken UI.
  if (stage === 'init') return <div className="ob-v4" style={{ minHeight: '100dvh', background: T.bg }} />;

  return (
    <div className="ob-v4" style={{ minHeight: '100dvh', background: T.bg, display: 'flex', flexDirection: 'column', padding: `${TOP_GAP} 26px calc(env(safe-area-inset-bottom, 0px) + 22px)` }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}><Mark size={30} /></div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', maxWidth: 340, margin: '0 auto', width: '100%' }}>
        {stage === 'linked' ? (
          <div className={reduced ? '' : 'ob-in'}>
            <div style={{ width: 58, height: 58, borderRadius: '50%', background: T.green, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <Tick size={26} />
            </div>
            <h1 style={{ ...H1, fontSize: 32 }}>WhatsApp linked.</h1>
            <p style={{ ...SUB, marginTop: 10 }}>
              Text Housemait any time - it&rsquo;s the same assistant everywhere.
            </p>
          </div>
        ) : (
          <>
            <p style={EYEBROW}>One last thing</p>
            <h1 style={{ ...H1, fontSize: 34, marginTop: 10 }}>
              Text your house, <span style={{ color: T.purple }}>like a friend.</span>
            </h1>
            <p style={{ ...SUB, marginTop: 12 }}>
              &ldquo;Swimming Tuesday at 4&rdquo; - on the calendar. A photo of the school
              letter - dates sorted. Link WhatsApp and Housemait is just another chat.
            </p>

            {stage === 'waiting' && (
              <div style={{ marginTop: 22, background: '#fff', borderRadius: R.bubble, padding: '14px 16px', boxShadow: SHADOW.card, textAlign: 'left', display: 'flex', gap: 11, alignItems: 'center' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: T.green, flex: 'none' }} className={reduced ? '' : 'ob-pulse'} />
                <p style={{ fontSize: 13.5, lineHeight: 1.45, color: T.ink2, margin: 0 }}>
                  Waiting for your message&hellip; in WhatsApp, just tap <strong style={{ color: T.ink }}>send</strong> - the code&rsquo;s already typed for you.
                </p>
              </div>
            )}
            {expired && stage === 'offer' && (
              <p style={{ fontSize: 13, color: T.ink3, marginTop: 16 }}>
                That code expired - tap the button for a fresh one.
              </p>
            )}
          </>
        )}
      </div>

      {stage !== 'linked' && (
        <div style={{ maxWidth: 340, margin: '0 auto', width: '100%' }}>
          <a
            href={pairing?.deep_link}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => { if (expired) { e.preventDefault(); init(); return; } pollStartRef.current = Date.now(); setStage('waiting'); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              width: '100%', minHeight: 50, padding: 15, borderRadius: R.cta,
              background: T.green, color: '#fff', textDecoration: 'none',
              font: '700 16.5px Inter, system-ui, sans-serif', boxShadow: SHADOW.whatsapp,
            }}
          >
            <img src="/onboarding-v4/whatsapp-white.svg" alt="" aria-hidden="true" style={{ width: 22, height: 22 }} />
            {stage === 'waiting' ? 'Open WhatsApp again' : 'Link WhatsApp'}
          </a>
          <Ghost onClick={finish}>Maybe later</Ghost>
        </div>
      )}
    </div>
  );
}
