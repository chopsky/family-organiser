import { useState } from 'react';
import api from '../../../lib/api';
import { detectCountryFromTimezone, detectCountryFromLocaleCookie } from '../../../lib/country';
import { readLocaleCookie } from '../../../hooks/useLocale';
import { getStorefrontCountry } from '../../../lib/revenuecat';
import { Title, Em, Kicker, PrimaryButton, Segmented } from './_ui';
import { inputStyle, labelStyle } from './_styles';

// Step 5. Name a new household or join an existing one by code. Mirrors
// SetupHousehold.jsx (same endpoints + the country-detection cascade), but
// keeps the user in the flow: on success it stores the session and advances to
// the invite step instead of navigating away.
export default function HouseholdStep({ auth, form, update, next, setError }) {
  const [mode, setMode] = useState(form.hhMode || 'new');
  const [name, setName] = useState(form.hhName || '');
  const [joinCode, setJoinCode] = useState(form.joinCode || '');
  const [loading, setLoading] = useState(false);

  function switchMode(m) { if (m !== mode) { setMode(m); update({ hhMode: m }); setError(''); } }

  async function createHousehold(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Please give your household a name.'); return; }
    setLoading(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
      // Same authoritative cascade as SetupHousehold: storefront > locale cookie
      // > timezone (see that file for the full rationale).
      const country =
        (await getStorefrontCountry())
        || detectCountryFromLocaleCookie(readLocaleCookie())
        || detectCountryFromTimezone(timezone);
      const { data } = await api.post('/auth/create-household', { name: name.trim(), timezone, country });
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
    if (!joinCode.trim()) { setError('Please enter the join code.'); return; }
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
      <Kicker>Your home</Kicker>
      <Title>{mode === 'new' ? <>Name your <Em>household.</Em></> : <>Join your <Em>household.</Em></>}</Title>
      <p style={{ fontSize: 15, color: 'var(--color-cocoa)', lineHeight: 1.5, margin: '12px 0 22px' }}>
        {mode === 'new' ? 'You can change it any time.' : 'Ask whoever set things up for the join code.'}
      </p>

      <Segmented
        value={mode}
        onChange={switchMode}
        options={[{ key: 'new', label: 'Start new' }, { key: 'join', label: 'Join existing' }]}
      />

      {mode === 'new' ? (
        <form onSubmit={createHousehold} style={{ textAlign: 'left', marginTop: 18 }}>
          <label htmlFor="ob-hh-name" style={labelStyle}>Household name</label>
          <input id="ob-hh-name" type="text" value={name} onChange={(e) => { setName(e.target.value); update({ hhName: e.target.value }); }} placeholder="e.g. The Smiths" autoFocus style={inputStyle} />
          <PrimaryButton type="submit" disabled={loading} style={{ marginTop: 16 }}>
            {loading ? 'Creating…' : 'Create household'}
          </PrimaryButton>
        </form>
      ) : (
        <form onSubmit={joinHousehold} style={{ textAlign: 'left', marginTop: 18 }}>
          <label htmlFor="ob-hh-code" style={labelStyle}>Join code</label>
          <input
            id="ob-hh-code" type="text" value={joinCode}
            onChange={(e) => { const v = e.target.value.toUpperCase(); setJoinCode(v); update({ joinCode: v }); }}
            placeholder="e.g. SMITH-FAM" autoFocus autoComplete="off" autoCapitalize="characters" spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.05em', textTransform: 'uppercase' }}
          />
          <PrimaryButton type="submit" disabled={loading} style={{ marginTop: 16 }}>
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
