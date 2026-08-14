import { useEffect, useState } from 'react';
import api from '../../../lib/api';
import {
  detectCountryFromTimezone, detectCountryFromLocaleCookie, detectCountryFromLocaleRegion,
  SUPPORTED_COUNTRIES, COUNTRY_LABELS,
} from '../../../lib/country';
import { readLocaleCookie } from '../../../hooks/useLocale';
import { getStorefrontCountry } from '../../../lib/revenuecat';
import { Title, Em, Kicker, Lead, PrimaryButton, Segmented } from './_ui';
import { inputStyle, labelStyle } from './_styles';

// Flag emoji from an ISO code (regional indicator pairs); OTHER gets a globe.
function flagFor(code) {
  if (!code || code === 'OTHER') return '🌍';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1F1A5 + c.charCodeAt(0)));
}

// Step 5. Name a new household or join an existing one by code. Mirrors
// SetupHousehold.jsx (same endpoints + country cascade), but keeps the user in
// the flow: on success it stores the session and advances to invite.
export default function HouseholdStep({ auth, form, update, next, setError }) {
  const [mode, setMode] = useState(form.hhMode || 'new');
  const [name, setName] = useState(form.hhName || '');
  const [joinCode, setJoinCode] = useState(form.joinCode || '');
  const [loading, setLoading] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  // Detected country + whether the signals disagreed (signing up away from
  // home). Detection runs on mount so the confirmation line can render
  // BEFORE the user submits; a travelling signup sees "Setting you up for
  // the UK · change" instead of silently becoming a Spanish household
  // (the Maxine mis-country, 2026-08-10).
  const [country, setCountry] = useState(form.hhCountry || null);
  const [mismatch, setMismatch] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Cascade by how well each signal survives travel: Apple ID
      // storefront (home), device language region (home), marketing-page
      // cookie (deliberate), timezone (wherever the phone is standing).
      const detected =
        (await getStorefrontCountry())
        || detectCountryFromLocaleRegion()
        || detectCountryFromLocaleCookie(readLocaleCookie())
        || detectCountryFromTimezone(timezone);
      if (cancelled) return;
      setCountry((prev) => prev || detected);
      setMismatch(detected !== detectCountryFromTimezone(timezone));
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function switchMode(m) { if (m !== mode) { setMode(m); update({ hhMode: m }); setError(''); } }

  function pickCountry(code) {
    setCountry(code);
    update({ hhCountry: code });
    setShowPicker(false);
  }

  async function createHousehold(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Please give your household a name.'); return; }
    setLoading(true);
    try {
      const chosen = country || detectCountryFromTimezone(timezone);
      const { data } = await api.post('/auth/create-household', { name: name.trim(), timezone, country: chosen });
      update({ hhName: name.trim() });
      auth.login(data);
      next();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function joinHousehold(e) {
    e.preventDefault();
    setError('');
    if (!joinCode.trim()) { setError('Please enter the invite code.'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/attach-to-household', { code: joinCode.trim() });
      update({ hhName: data?.household?.name || '' });
      auth.login(data);
      next();
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Kicker>Your home base</Kicker>
      <Title>{mode === 'new' ? <>Name your <Em>household.</Em></> : <>Join your <Em>household.</Em></>}</Title>
      <Lead>{mode === 'new' ? 'This is the shared space everyone joins.' : 'Ask whoever set things up for the invite code.'}</Lead>

      <div style={{ margin: '24px 0 16px' }}>
        <Segmented
          value={mode}
          onChange={switchMode}
          options={[{ key: 'new', label: 'Start new' }, { key: 'join', label: 'Join existing' }]}
        />
      </div>

      {mode === 'new' ? (
        <form onSubmit={createHousehold} style={{ textAlign: 'left' }}>
          <label htmlFor="ob-hh-name" style={labelStyle}>Household name</label>
          <input id="ob-hh-name" type="text" value={name} onChange={(e) => { setName(e.target.value); update({ hhName: e.target.value }); }} placeholder="e.g. The Carters" autoFocus style={inputStyle} />

          {/* Country confirmation: always shown once detected (one glance when
              we're right, one tap when we're wrong), with the full picker on
              "change". Especially load-bearing when mismatch is true - the
              user is signing up away from home. */}
          {country && (
            <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-warm-grey)', lineHeight: 1.5 }}>
              {showPicker ? (
                <div>
                  <label htmlFor="ob-hh-country" style={{ ...labelStyle, marginBottom: 6 }}>Country</label>
                  <select
                    id="ob-hh-country"
                    value={country}
                    onChange={(e) => pickCountry(e.target.value)}
                    style={{ ...inputStyle, height: 44 }}
                  >
                    {SUPPORTED_COUNTRIES.map((c) => (
                      <option key={c} value={c}>{COUNTRY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <span>
                  Setting you up for {country === 'OTHER' ? 'your country' : COUNTRY_LABELS[country]} {flagFor(country)}
                  {' · '}
                  <button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--color-plum, #6B3FA0)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    change
                  </button>
                  {mismatch && country !== 'OTHER' && (
                    <span> — looks like you're travelling, so we've used your home country.</span>
                  )}
                </span>
              )}
            </div>
          )}

          <PrimaryButton type="submit" disabled={loading || !name.trim()} style={{ marginTop: 18 }}>
            {loading ? 'Creating…' : 'Create household'}
          </PrimaryButton>
        </form>
      ) : (
        <form onSubmit={joinHousehold} style={{ textAlign: 'left' }}>
          <label htmlFor="ob-hh-code" style={labelStyle}>Invite code</label>
          <input
            id="ob-hh-code" type="text" value={joinCode}
            onChange={(e) => { const v = e.target.value.toUpperCase(); setJoinCode(v); update({ joinCode: v }); }}
            placeholder="Enter invite code" autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textAlign: 'center', letterSpacing: '0.18em', fontWeight: 700, textTransform: 'uppercase' }}
          />
          <PrimaryButton type="submit" disabled={loading || !joinCode.trim()} style={{ marginTop: 18 }}>
            {loading ? 'Joining…' : 'Join household'}
          </PrimaryButton>
        </form>
      )}

      <p style={{ marginTop: 14, fontSize: 12.5, color: 'var(--color-warm-grey)', lineHeight: 1.5 }}>
        {mode === 'new' ? 'You can invite the family on the next step.' : 'The code lives on their Family page.'}
      </p>
    </div>
  );
}
