import { useState } from 'react';
import api from '../../../lib/api';
import { FEED_PROVIDERS } from '../../../lib/feedProviders';
import { Title, Em, Kicker, PrimaryButton, Ghost } from './_ui';
import { inputStyle } from './_styles';

// Friendly display order + a brand-ish tile colour per provider.
const TILE = {
  apple:   { colour: '#1A1620', name: 'Apple Calendar' },
  google:  { colour: '#4285F4', name: 'Google Calendar' },
  outlook: { colour: '#0F6CBD', name: 'Outlook Calendar' },
};
const PROVIDERS = ['apple', 'google', 'outlook']
  .map((id) => FEED_PROVIDERS.find((p) => p.id === id))
  .filter(Boolean);

const CalGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9h18M8 3v3M16 3v3" /></svg>
);

// Step 8. Subscribe to one external calendar by URL (Apple/Google/Outlook),
// reusing the shared FEED_PROVIDERS instructions and POST
// /calendar/external-feeds. The soft skip simply does not subscribe: a
// household with zero feeds keeps showing the dashboard CalendarSetupNudge, so
// the user is re-prompted later rather than lost.
export default function CalendarStep({ form, update, next, setError }) {
  const [provider, setProvider] = useState(() => PROVIDERS.find((p) => p.id === form.calProvider) || null);
  const [url, setUrl] = useState(form.calUrl || '');
  const [adding, setAdding] = useState(false);

  function choose(p) { setProvider(p); update({ calProvider: p.id }); setError(''); }

  async function connect(e) {
    e.preventDefault();
    if (!url.trim()) { setError('Paste the calendar link to connect.'); return; }
    setAdding(true);
    setError('');
    try {
      // display_name left empty: the backend names it from the feed's
      // X-WR-CALNAME. color is a sensible default; synced feeds inherit their
      // owner member's colour anyway.
      await api.post('/calendar/external-feeds', { feed_url: url.trim(), display_name: '', color: 'sky' });
      update({ calUrl: url.trim() });
      next();
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't reach that calendar. Check it's the iCal/webcal link and try again.");
    } finally {
      setAdding(false);
    }
  }

  // Provider chosen: show the instructions + paste field.
  if (provider) {
    const steps = provider.steps || [];
    return (
      <div>
        <Kicker>Connect {TILE[provider.id]?.name || provider.label}</Kicker>
        <Title>Grab the <Em>link.</Em></Title>

        <a href={provider.link} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '18px 0 4px', padding: '11px 16px', borderRadius: 12, background: 'var(--color-plum-light)', color: 'var(--color-plum-dark)', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
          {provider.linkLabel} ↗
        </a>

        <ol style={{ textAlign: 'left', margin: '16px 0 4px', paddingLeft: 0, listStyle: 'none', counterReset: 'ob-step' }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: 'var(--color-plum)', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <span style={{ fontSize: 14.5, color: 'var(--color-cocoa)', lineHeight: 1.45 }}>{s}</span>
            </li>
          ))}
        </ol>

        {provider.iosTip && (
          <p style={{ textAlign: 'left', fontSize: 12.5, color: 'var(--color-warm-grey)', margin: '0 0 14px', lineHeight: 1.45 }}>{provider.iosTip}</p>
        )}

        <form onSubmit={connect} style={{ marginTop: 6 }}>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={provider.placeholder} autoComplete="off" spellCheck={false} style={{ ...inputStyle, fontSize: 13.5 }} />
          <PrimaryButton type="submit" disabled={adding} style={{ marginTop: 14 }}>{adding ? 'Connecting…' : 'Connect calendar'}</PrimaryButton>
        </form>

        <Ghost onClick={() => { setProvider(null); update({ calProvider: null }); setError(''); }}>← Choose a different calendar</Ghost>
      </div>
    );
  }

  // No provider yet: the three tiles + soft skip.
  return (
    <div>
      <Kicker>One shared calendar</Kicker>
      <Title>See it all in <Em>one place.</Em></Title>
      <p style={{ fontSize: 15.5, color: 'var(--color-cocoa)', lineHeight: 1.5, margin: '14px auto 24px', maxWidth: 420 }}>
        Bring your existing calendar in, so everyone's plans live together. Pick where yours lives.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" onClick={() => choose(p)}
            style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '15px 18px', borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', background: '#fff', border: '1.5px solid var(--color-cream-border)' }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: TILE[p.id]?.colour || 'var(--color-plum)' }}><CalGlyph /></span>
            <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'var(--color-charcoal)' }}>{TILE[p.id]?.name || p.label}</span>
            <span style={{ color: 'var(--color-warm-grey)', fontSize: 20 }}>›</span>
          </button>
        ))}
      </div>

      <Ghost onClick={next}>I'll connect later</Ghost>
    </div>
  );
}
