/**
 * Onboarding v4 — post-auth WhatsApp pairing phase.
 * Design: design_handoff_whatsapp_connect (high-fidelity).
 *
 * Benefit-led pitch ("Text it once. It's handled.") over a self-playing
 * mock WhatsApp conversation - a one-line event, a photo of a school
 * letter, a voice note for the shopping list, a question about half term -
 * then the green CTA. Four exchanges in ~3.5s: the earlier cut showed one
 * and left the chat half empty; the original four-beat cut took 5.5s and
 * most people had gone before it finished. The demo uses the household's
 * own children's names when the kids step supplied them. Plays once per
 * screen entry; reduced motion renders every bubble instantly.
 *
 * Deliberate omissions per the handoff: no back button, no progress bar,
 * no logo - the screen opens straight onto the header.
 *
 * The pairing logic is unchanged from the first cut: an account exists
 * now, so "Link WhatsApp" opens the real deep link with the code
 * prefilled, the status poll flips the CTA to the connected row when the
 * webhook consumes it, and the screen advances itself. Skip always
 * offered; pairing unavailable (503) advances silently; expired codes
 * re-mint without following the stale link. Joiners pass through too.
 */
import { useEffect, useRef, useState } from 'react';
import api from '../../lib/api';
import { T, SHADOW, R } from './tokens';
import { Mark, TOP_GAP } from './ui';

const POLL_MS = 2500;
const MAX_POLL_MS = 11 * 60 * 1000;
const DONE_HOLD_MS = 1600;
const BUSY_LABEL_MS = 2500;

// WhatsApp-mimicry surfaces for the chat demo - deliberately local, not
// app tokens: they exist to look like WhatsApp, nowhere else.
const WA = {
  paper: '#E8E0D1', header: '#F6F1E8', sent: '#DCF0C5',
  check: '#4FB3E8', wave: '#57A05B',
  ink: '#1A1620', hairline: 'rgba(26,22,32,0.09)',
};

const H1 = {
  fontFamily: T.title, fontWeight: 400, fontSize: 33, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink, marginTop: 8,
};
const EYEBROW = {
  font: '700 11.5px var(--font-sans)', letterSpacing: '.16em',
  textTransform: 'uppercase', color: T.purple,
};

/* ── Chat demo pieces (spec'd verbatim from the handoff) ─────────────── */

const waTime = (t, me) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, float: 'right', margin: '7px -2px -2px 10px', fontSize: 10.5, fontWeight: 500, color: T.ink3 }}>
    {t}
    {me && (
      <svg width="14" height="9" viewBox="0 0 18 11" fill="none" stroke={WA.check} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 6l3 3 6-7" /><path d="M8 6l3 3 6-7" />
      </svg>
    )}
  </span>
);

function WaBubble({ me, wide, animate, children }) {
  return (
    <div className={animate ? 'ob-bub' : ''} style={{ display: 'flex', justifyContent: me ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: wide ? '88%' : '80%', padding: '8px 10px', borderRadius: 13,
          fontSize: 13.5, lineHeight: 1.42, color: WA.ink,
          background: me ? WA.sent : '#fff', boxShadow: '0 1px 2px rgba(26,22,32,0.10)',
          borderBottomRightRadius: me ? 4 : 13, borderBottomLeftRadius: me ? 13 : 4,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function LetterPhoto() {
  return (
    <div>
      <div style={{ width: 148, borderRadius: 9, background: '#FDFBF6', border: '1px solid rgba(26,22,32,0.08)', padding: '10px 11px 8px', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: T.purpleSoft, border: '1px solid rgba(109,56,173,0.3)' }} />
          <span style={{ height: 4, width: 62, borderRadius: 3, background: 'rgba(26,22,32,0.18)' }} />
        </div>
        {[92, 100].map((w, i) => <div key={i} style={{ height: 4, width: `${w}%`, borderRadius: 3, background: 'rgba(26,22,32,0.10)', marginTop: 4 }} />)}
        <div style={{ height: 4, width: '62%', borderRadius: 3, background: 'rgba(109,56,173,0.35)', marginTop: 4 }} />
        <div style={{ height: 4, width: '88%', borderRadius: 3, background: 'rgba(26,22,32,0.10)', marginTop: 4 }} />
      </div>
      Found in the book bag{waTime('17:58', true)}
    </div>
  );
}

function VoiceNote() {
  const bars = [4, 7, 11, 8, 13, 9, 5, 10, 14, 7, 4, 9, 12, 6, 4, 8, 5];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 2px', minWidth: 178 }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill={T.ink2} aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      <span style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1 }}>
        {bars.map((h, i) => <span key={i} style={{ width: 2.5, height: h, borderRadius: 2, background: i < 6 ? WA.wave : 'rgba(26,22,32,0.25)' }} />)}
      </span>
      <span style={{ fontSize: 11, fontWeight: 500, color: T.ink3 }}>0:06{waTime('17:59', true)}</span>
    </div>
  );
}

function WaTyping() {
  return (
    <div className="ob-bub" style={{ display: 'flex' }}>
      <div style={{ background: '#fff', borderRadius: 13, borderBottomLeftRadius: 4, padding: '11px 13px', display: 'flex', gap: 4, boxShadow: '0 1px 2px rgba(26,22,32,0.10)' }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: T.ink3, animation: `obDot 1.1s ${i * 0.15}s infinite` }} />)}
      </div>
    </div>
  );
}

// Delays are from the previous step; a typing indicator precedes each
// received bubble. Paced at reading speed: a sent bubble lands, the reply
// takes a beat, and the NEXT send waits long enough to read the reply
// (longer after the letter, the wordiest one). ~10s end to end. The CTA is
// live from the first frame, so the pace costs nobody anything - and the
// thread scrolls, so anything that has moved up can be read again. The
// 3.5s version pushed the first exchanges off the top before anyone could
// read them (founder's phone, 3 Sep).
const SEQ = [
  { kind: 'ask1', me: true, wait: 350 },
  { kind: 'ans1', wait: 1000 },
  { kind: 'photo', me: true, wait: 1700 },
  { kind: 'r1', wait: 1100 },
  { kind: 'voice', me: true, wait: 2100 },
  { kind: 'r2', wait: 1000 },
  { kind: 'ask2', me: true, wait: 1800 },
  { kind: 'ans2', wait: 1000 },
];

// Real names beat placeholders: the kids step ran two screens ago.
function demoNames(kids) {
  const names = (kids || []).map((k) => (typeof k === 'string' ? k : k?.name)).map((n) => String(n || '').trim()).filter(Boolean);
  return { kid1: names[0] || 'Mia', kid2: names[1] || names[0] || 'Arlo' };
}

function useSeq(reduced) {
  const [n, setN] = useState(reduced ? SEQ.length : 0);
  useEffect(() => {
    if (reduced || n >= SEQ.length) return undefined;
    const t = setTimeout(() => setN(n + 1), SEQ[n].wait);
    return () => clearTimeout(t);
  }, [n, reduced]);
  return { shown: SEQ.slice(0, n), typing: !reduced && n < SEQ.length && !SEQ[n].me, animate: !reduced };
}

function ChatDemo({ reduced, kids }) {
  const { shown, typing, animate } = useSeq(reduced);
  const { kid1, kid2 } = demoNames(kids);
  // A real thread: follows the newest bubble, but a reader who has scrolled
  // back up to re-read is left where they are.
  const scrollRef = useRef(null);
  const lastHeightRef = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wasFollowing = lastHeightRef.current === 0
      || lastHeightRef.current - el.scrollTop - el.clientHeight < 48;
    lastHeightRef.current = el.scrollHeight;
    if (!wasFollowing) return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [shown.length, typing, reduced]);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 22, overflow: 'hidden', background: WA.paper, boxShadow: '0 18px 44px -20px rgba(26,22,32,0.38), 0 0 0 1px rgba(26,22,32,0.06)' }}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: WA.header, borderBottom: `1px solid ${WA.hairline}` }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: T.purpleSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Mark size={20} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: WA.ink }}>Housemait</span>
          <span style={{ display: 'block', fontSize: 11.5, color: T.ink3 }}>online</span>
        </span>
        <svg width="17" height="17" viewBox="0 0 24 24" fill={T.ink3} aria-hidden="true"><circle cx="12" cy="5" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="12" cy="19" r="1.9" /></svg>
      </div>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
       <div style={{ minHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, padding: 12 }}>
        {shown.map((it, k) => {
          if (it.kind === 'ask1') return <WaBubble key={k} me animate={animate}>Dentist for {kid1}, Thu 3pm{waTime('17:57', true)}</WaBubble>;
          if (it.kind === 'ans1') return <WaBubble key={k} animate={animate}>Done: {kid1} · Dentist · Thu 3:00pm. I&rsquo;ll nudge you at 2:30. 🦷{waTime('17:57')}</WaBubble>;
          if (it.kind === 'photo') return <WaBubble key={k} me wide animate={animate}><LetterPhoto /></WaBubble>;
          if (it.kind === 'voice') return <WaBubble key={k} me animate={animate}><VoiceNote /></WaBubble>;
          if (it.kind === 'r1') {
            return (
              <WaBubble key={k} wide animate={animate}>
                <div>Letter read. {kid2}&rsquo;s autumn term, filed:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '7px 0 2px' }}>
                  {[['📅', 'Swimming gala · Tue 4:00pm'], ['🔔', 'Trip money £6 · nudge Thu']].map(([e, t]) => (
                    <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: T.purpleSoft, color: T.purpleDeep, borderRadius: 9, padding: '5px 9px', fontSize: 12, fontWeight: 600 }}>{e} {t}</span>
                  ))}
                </div>
                On the family calendar, so everyone can see it.{waTime('17:58')}
              </WaBubble>
            );
          }
          if (it.kind === 'r2') return <WaBubble key={k} animate={animate}>Milk, nappies and a card for Gran are on the list. Whoever shops next will see them. 🥛{waTime('17:59')}</WaBubble>;
          if (it.kind === 'ask2') return <WaBubble key={k} me animate={animate}>When&rsquo;s half term?{waTime('18:01', true)}</WaBubble>;
          return <WaBubble key={k} animate={animate}>Half term is Mon 26 to Fri 30 Oct. {kid2}&rsquo;s back on Monday 2 Nov.{waTime('18:01')}</WaBubble>;
        })}
        {typing && <WaTyping />}
       </div>
      </div>
    </div>
  );
}

/* ── The screen ──────────────────────────────────────────────────────── */

export default function WhatsAppLinkScreen({ onDone, reduced, outcome = null, kids = null }) {
  // init → offer → waiting → linked → (onDone)  |  init failure → onDone
  const [stage, setStage] = useState('init');
  const [pairing, setPairing] = useState(null);
  const [expired, setExpired] = useState(false);
  // "Opening WhatsApp…" per the design, then back to an actionable label -
  // the real flow returns from WhatsApp unlinked more often than the
  // prototype's faked 1s success.
  const [busyLabel, setBusyLabel] = useState(false);
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

  // Linked: let the connected row land, then move on to the celebration.
  useEffect(() => {
    if (stage !== 'linked') return undefined;
    const id = setTimeout(finish, reduced ? 400 : DONE_HOLD_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // The design's busy state, bounded: label reverts once WhatsApp has had
  // its moment, so a returning-unlinked user sees a live button again.
  useEffect(() => {
    if (!busyLabel) return undefined;
    const id = setTimeout(() => setBusyLabel(false), BUSY_LABEL_MS);
    return () => clearTimeout(id);
  }, [busyLabel]);

  // Nothing to show while the code is minted - one fast request, and
  // failure exits to the celebration without a flash of broken UI.
  if (stage === 'init') return <div className="ob-v4" style={{ minHeight: '100dvh', background: T.bg }} />;

  // height, not minHeight: the chat card is a fixed window that clips older
  // bubbles (flex: 1, minHeight: 0). A stretchy wrapper let the thread push
  // the button off the bottom of the screen (founder's phone, 3 Sep).
  return (
    <div className="ob-v4" style={{ height: '100dvh', overflow: 'hidden', background: T.bg, display: 'flex', flexDirection: 'column', padding: `0 24px calc(env(safe-area-inset-bottom, 0px) + 14px)`, boxSizing: 'border-box' }}>
      {/* Header - deliberately no back button, progress bar or logo. */}
      <div style={{ flexShrink: 0, paddingTop: TOP_GAP, paddingBottom: 16 }}>
        <p style={EYEBROW}>One last thing</p>
        <h1 style={H1}>Text it once. <span style={{ color: T.purple }}>It&rsquo;s handled.</span></h1>
        <p style={{ fontSize: 15, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty', marginTop: 9 }}>
          {outcome?.school?.termDates
            ? <>Try it straight away: text <b style={{ color: T.ink }}>&ldquo;when&rsquo;s half term?&rdquo;</b> and it already knows {outcome.school.name}&rsquo;s dates.</>
            : <>Housemait lives in your WhatsApp. Send plans, school letters or voice notes
          like you&rsquo;d send them to a friend. Filed for the whole family.</>}
        </p>
      </div>

      <ChatDemo reduced={reduced} kids={kids} />

      <div style={{ flexShrink: 0, paddingTop: 14 }}>
        {expired && stage === 'offer' && (
          <p style={{ fontSize: 12, fontWeight: 500, color: T.ink3, textAlign: 'center', margin: '0 0 8px' }}>
            That code expired. Tap the button for a fresh one.
          </p>
        )}
        {stage === 'linked' ? (
          <div
            role="status"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 16, borderRadius: 17, background: T.okBg, color: T.okInk, font: '700 16px var(--font-sans)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>
            WhatsApp linked. Say hi anytime
          </div>
        ) : (
          <a
            href={pairing?.deep_link}
            target="_blank"
            rel="noreferrer"
            aria-label="Link WhatsApp - opens WhatsApp with your pairing code prefilled"
            onClick={(e) => {
              if (expired) { e.preventDefault(); init(); return; }
              pollStartRef.current = Date.now();
              setBusyLabel(true);
              setStage('waiting');
            }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              width: '100%', padding: 16, borderRadius: 17, textDecoration: 'none',
              background: T.green, color: '#fff', font: '700 16.5px var(--font-sans)',
              boxShadow: SHADOW.whatsapp, opacity: busyLabel ? 0.75 : 1,
              pointerEvents: busyLabel ? 'none' : 'auto',
            }}
          >
            <img src="/onboarding-v4/whatsapp-white.svg" alt="" aria-hidden="true" style={{ width: 24, height: 24, display: 'block', flexShrink: 0 }} />
            {busyLabel ? 'Opening WhatsApp…' : stage === 'waiting' ? 'Open WhatsApp again' : 'Link WhatsApp'}
          </a>
        )}
        <div style={{ font: '500 12px var(--font-sans)', color: T.ink3, textAlign: 'center', marginTop: 10 }}>
          Opens WhatsApp · takes 20 seconds · unlink anytime
        </div>
        {/* The skip stays (never trap anyone) but no longer competes with
            the button: quieter, smaller, under the fine print. */}
        {stage !== 'linked' && (
          <button
            type="button"
            onClick={finish}
            style={{ width: '100%', padding: '10px 12px 4px', border: 0, background: 'transparent', font: '500 13px var(--font-sans)', color: T.ink3, cursor: 'pointer' }}
          >
            Maybe later
          </button>
        )}
      </div>
    </div>
  );
}
