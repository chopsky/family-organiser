import { useState } from 'react';
import api from '../../../lib/api';
import { FEED_PROVIDERS } from '../../../lib/feedProviders';
import { Title, Em, Kicker, Lead, PrimaryButton, Ghost } from './_ui';
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
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9h18M8 3v3M16 3v3" /></svg>
);

// Step 8. Subscribe to one external calendar by URL (Apple/Google/Outlook),
// reusing the shared FEED_PROVIDERS instructions and POST
// /calendar/external-feeds. The soft skip simply does not subscribe: a
// household with zero feeds keeps showing the dashboard CalendarSetupNudge, so
// the user is re-prompted later rather than lost (the README's "re-prompt"
// flag, satisfied without new state).
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '18px 0 4px', padding: '11px 16px', borderRadius: 12, background: 'var(--color-plum-light)', color: 'var(--color-plum-dark)', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
          {provider.linkLabel} ↗
        </a>

        <ol style={{ textAlign: 'left', margin: '16px 0 4px', paddingLeft: 0, listStyle: 'none' }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 12 }}>
              <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: 'var(--color-plum)', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <span style={{ fontSize: 14, color: 'var(--color-cocoa)', lineHeight: 1.45 }}>{s}</span>
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
      <Kicker>Connect your calendar</Kicker>
      <Title>Bring your <Em>calendars in.</Em></Title>
      <Lead>This is what makes Housemait click: every appointment in one place, next to the family's tasks and school dates. Connect one now, add more anytime.</Lead>

      <div style={{ display: 'flex', gap: 12, margin: '28px 0 4px' }}>
        {PROVIDERS.map((p) => (
          <button key={p.id} type="button" onClick={() => choose(p)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '18px 8px 14px', borderRadius: 18, cursor: 'pointer', fontFamily: 'inherit', background: '#fff', border: '1.5px solid var(--color-cream-border)' }}>
            <span style={{ width: 48, height: 48, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: TILE[p.id]?.colour || 'var(--color-plum)' }}><CalGlyph /></span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-charcoal)', textAlign: 'center', lineHeight: 1.2 }}>{TILE[p.id]?.name || p.label}</span>
          </button>
        ))}
      </div>

      <PrimaryButton onClick={next} style={{ marginTop: 22 }}>Continue</PrimaryButton>
      <div style={{ fontSize: 12.5, color: 'var(--color-warm-grey)', textAlign: 'center', margin: '14px 0 -2px', lineHeight: 1.45 }}>Housemait works best once it can see your events.</div>
      <Ghost onClick={next}>I'll connect later</Ghost>
    </div>
  );
}
