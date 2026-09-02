/**
 * Onboarding v4 screen 08 — calendars.
 *
 * Two views: the provider list, and the connect flow for one provider. The
 * step is never a gate — the user can arrive, connect nothing, and carry on.
 *
 * Three things here differ from the prototype on purpose:
 *
 * 1. Connecting really connects. The prototype accepted any string starting
 *    with https:// and faked a 900ms success. This calls the server, which
 *    fetches AND parses the feed, so a link that 404s or returns a login page
 *    fails on this screen rather than looking fine and pulling nothing for the
 *    next six months.
 * 2. Paste never invents a URL. The prototype substituted a plausible fake
 *    address when the clipboard was empty, which would have produced a
 *    "connected" calendar that did not exist.
 * 3. The sync promise matches the cron. SYNC_CADENCE_COPY is the single source
 *    of truth, wired to the schedule in src/jobs/scheduler.js.
 *
 * The pasted address is a bearer credential, so it is held in memory only
 * (lib/onboardingDraft) and shown back masked, never in full.
 */
import { useState } from 'react';
import ProviderLogo from '../../components/ProviderLogo';
import { T, SHADOW, R } from './tokens';
import { Tick, Cta, Ghost } from './ui';
import { CAL_PROVIDERS, connectCalendar, readClipboardUrl, SYNC_CADENCE_COPY } from '../../lib/calendarConnect';

const H1 = {
  fontFamily: T.title, fontWeight: 400, lineHeight: 1.08,
  letterSpacing: '-.015em', textWrap: 'balance', color: T.ink,
};
const SUB = { fontSize: 15, lineHeight: 1.45, color: T.ink2, textWrap: 'pretty' };
const EYEBROW = {
  font: '700 11.5px var(--font-sans)', letterSpacing: '.16em',
  textTransform: 'uppercase', color: T.purple,
};

/** The grey reassurance strips. Small print that people actually read. */
function Reassure({ emoji, children }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 9, marginTop: 14,
        padding: '12px 14px', borderRadius: R.field, background: 'rgba(26,22,32,.035)',
      }}
    >
      <span style={{ fontSize: 15, flexShrink: 0 }} aria-hidden="true">{emoji}</span>
      <span style={{ fontSize: 12.5, color: T.ink2, lineHeight: 1.4 }}>{children}</span>
    </div>
  );
}

/* ── 08a The provider list ─────────────────────────────────────────────────
   Apple sits first: it is the only provider whose steps can be finished
   entirely on the phone, so at least one route through this screen doesn't
   send someone off to find a laptop. */
export function CalendarList({ d, onConnect }) {
  const cals = d.cals || {};
  return (
    <>
      <p style={EYEBROW}>Step 6 of 6</p>
      <h1 style={{ ...H1, fontSize: 32, marginTop: 8 }}>
        One shared <span style={{ color: T.purple }}>family view.</span>
      </h1>
      <p style={{ ...SUB, marginTop: 8 }}>
        Bring in the calendars you already use, so nobody has to check three apps
        to find out what’s happening.
      </p>

      <div style={{ background: T.surface, borderRadius: R.card, boxShadow: SHADOW.card, padding: '4px 15px', marginTop: 18 }}>
        {CAL_PROVIDERS.map((p, i) => {
          const on = Boolean(cals[p.id]);
          return (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0',
                borderBottom: i < CAL_PROVIDERS.length - 1 ? `1px solid ${T.line}` : 'none',
              }}
            >
              <span
                style={{
                  width: 40, height: 40, borderRadius: R.tile, flexShrink: 0, background: '#fff',
                  border: '1px solid rgba(26,22,32,.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <ProviderLogo id={p.id} size={24} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: '700 15px var(--font-sans)', color: T.ink }}>{p.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: T.ink3 }}>
                  {on ? `${cals[p.id].eventCount ?? 0} events found` : p.sub}
                </span>
              </span>
              {on ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '700 13px var(--font-sans)', color: T.okInk }}>
                  <span style={{ width: 21, height: 21, borderRadius: '50%', background: '#6BA368', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Tick size={12} />
                  </span>
                  On
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onConnect(p.id)}
                  style={{
                    minHeight: 44, padding: '9px 18px', borderRadius: R.pill, border: 0,
                    background: T.purpleSoft, color: T.purpleDeep,
                    font: '700 13px var(--font-sans)', cursor: 'pointer',
                  }}
                >
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>

      <Reassure emoji="🔒">
        Read only, and one way for now. Housemait checks for changes {SYNC_CADENCE_COPY} and
        never edits your calendar.
      </Reassure>
    </>
  );
}

/* ── 08b Connect one provider ──────────────────────────────────────────────
   Paste is the primary input and the field is the fallback: typing a published
   webcal URL on a phone is close to impossible. */
export function CalendarConnect({ providerId, onDone, onCancel }) {
  const provider = CAL_PROVIDERS.find((p) => p.id === providerId);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!provider) return null;

  const paste = async () => {
    const text = await readClipboardUrl();
    if (!text) {
      // Never substitute a fake address to keep the demo moving - that is
      // exactly how you end up with a calendar that reports "connected" and
      // has nothing behind it.
      setErr('Nothing calendar-shaped on the clipboard yet. Copy the link first, then tap Paste.');
      return;
    }
    setUrl(text);
    setErr('');
  };

  const go = async () => {
    setBusy(true);
    setErr('');
    const result = await connectCalendar(provider, { url });
    setBusy(false);
    if (result.ok) onDone(provider.id, url, result);
    else setErr(result.error);
  };

  return (
    <>
      <p style={{ ...EYEBROW, fontSize: 11 }}>Connect {provider.label}</p>
      <h1 style={{ ...H1, fontSize: 30, marginTop: 7 }}>
        Grab the <span style={{ color: T.purple }}>link.</span>
      </h1>

      <a
        href={provider.open.url}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14, minHeight: 44,
          padding: '12px 16px', borderRadius: R.field, border: '1.5px solid rgba(109,56,173,.28)',
          background: T.surface, color: T.purpleDeep, font: '700 15px var(--font-sans)',
          textDecoration: 'none', boxShadow: '0 8px 20px -14px rgba(26,22,32,.45)',
        }}
      >
        <ProviderLogo id={provider.id} size={18} />
        {provider.open.label}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 17L17 7M9 7h8v8" />
        </svg>
      </a>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        {provider.steps.map((s, k) => (
          <div key={s} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <span
              style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: T.purple,
                color: '#fff', font: '700 12px var(--font-sans)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {k + 1}
            </span>
            <span style={{ fontSize: 14.5, lineHeight: 1.4, color: T.ink2 }}>{s}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.45, color: T.ink3, marginTop: 11 }}>{provider.note}</p>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <input
          value={url}
          onChange={(e) => { setUrl(e.target.value); setErr(''); }}
          placeholder={provider.placeholder}
          aria-label={`${provider.label} address`}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          style={{
            flex: 1, minWidth: 0, minHeight: 44, padding: '15px 16px', borderRadius: R.field,
            border: `1.5px solid ${err ? '#C2543F' : T.line2}`, background: T.surface,
            fontSize: 14, color: T.ink, outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={paste}
          style={{
            flexShrink: 0, minHeight: 44, padding: '0 18px', borderRadius: R.field, border: 0,
            background: T.ink, color: '#fff', font: '700 14.5px var(--font-sans)', cursor: 'pointer',
          }}
        >
          Paste
        </button>
      </div>
      {err && (
        <p role="alert" style={{ fontSize: 12.5, lineHeight: 1.4, color: T.danger, marginTop: 8 }}>{err}</p>
      )}

      <Reassure emoji="⚠️">{provider.warn}</Reassure>
      <Reassure emoji="🔒">
        Read only, and one way for now. Housemait checks for changes {SYNC_CADENCE_COPY} and
        never edits your calendar.
      </Reassure>

      {/* Footer lives here rather than in the shell: this sub-screen's back
          action is "pick a different calendar", not the flow's own back. */}
      <div style={{ marginTop: 18 }}>
        <Cta disabled={busy || !url.trim()} onClick={go}>
          {busy ? 'Checking the link…' : 'Connect calendar'}
        </Cta>
        <Ghost onClick={onCancel}>Choose a different calendar</Ghost>
      </div>
    </>
  );
}
