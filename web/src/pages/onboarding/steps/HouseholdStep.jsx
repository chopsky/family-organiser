import { useState, useRef, useEffect } from 'react';
import api from '../../../lib/api';
import { detectCountryFromTimezone, detectCountryFromLocaleCookie } from '../../../lib/country';
import { readLocaleCookie } from '../../../hooks/useLocale';
import { getStorefrontCountry } from '../../../lib/revenuecat';
import { FAMILY_ROLES } from '../../../lib/familyRoles';
import { Title, Em, Kicker, Lead, PrimaryButton, Segmented } from './_ui';
import { inputStyle, labelStyle } from './_styles';

// Step 5. Name a new household or join an existing one by code. Mirrors
// SetupHousehold.jsx (same endpoints + country cascade), but keeps the user in
// the flow: on success it stores the session and advances to invite.
//
// New households also get an OPTIONAL "make it feel like home" moment — a family
// photo (household avatar) + the creator's family role. Both reuse existing
// endpoints (no new fields), are entirely skippable, and are uploaded
// best-effort AFTER the household is created so they can never block activation.
export default function HouseholdStep({ auth, form, update, next, setError }) {
  const [mode, setMode] = useState(form.hhMode || 'new');
  const [name, setName] = useState(form.hhName || '');
  const [joinCode, setJoinCode] = useState(form.joinCode || '');
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState(form.hhRole || '');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const fileRef = useRef(null);

  // Revoke the object URL when it changes or the step unmounts (avoids a leak).
  useEffect(() => {
    if (!photoPreview) return undefined;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  function switchMode(m) { if (m !== mode) { setMode(m); update({ hhMode: m }); setError(''); } }

  function onPickPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    setError('');
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  }

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
      auth.login(data); // writes the new token to localStorage synchronously → api picks it up

      // Optional personalisation — best-effort, never blocks entering the app.
      if (photoFile) {
        try {
          const fd = new FormData();
          fd.append('avatar', photoFile);
          await api.post('/household/avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch { /* keep going — they can add a photo later on the Family page */ }
      }
      if (role.trim()) {
        try { await api.patch('/household/profile', { family_role: role.trim() }); }
        catch { /* keep going — role is editable later in Settings */ }
      }

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

  const initial = (name.trim().charAt(0) || '').toUpperCase();

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

          {/* Optional: family photo (household avatar) + the creator's role. */}
          <label style={{ ...labelStyle, marginTop: 18 }}>Family photo <span style={{ color: 'var(--color-warm-grey)', fontWeight: 400 }}>(optional)</span></label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 2 }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={photoPreview ? 'Change family photo' : 'Add a family photo'}
              style={{
                width: 64, height: 64, borderRadius: 16, flexShrink: 0, cursor: 'pointer', overflow: 'hidden',
                border: photoPreview ? 'none' : '1.5px dashed rgba(26,22,32,0.22)',
                background: photoPreview ? 'transparent' : 'var(--color-plum-light, #F3EDFC)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                color: 'var(--color-plum)', position: 'relative',
              }}
            >
              {photoPreview
                ? <img src={photoPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (initial
                  ? <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-plum)' }}>{initial}</span>
                  : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>)}
            </button>
            <div style={{ fontSize: 12.5, color: 'var(--color-warm-grey)', lineHeight: 1.5 }}>
              {photoPreview ? 'Looks great — tap to change.' : 'Shown at the top of your family home screen.'}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} style={{ display: 'none' }} />
          </div>

          <label htmlFor="ob-hh-role" style={{ ...labelStyle, marginTop: 18 }}>Your role in the family <span style={{ color: 'var(--color-warm-grey)', fontWeight: 400 }}>(optional)</span></label>
          <select
            id="ob-hh-role"
            value={role}
            onChange={(e) => { setRole(e.target.value); update({ hhRole: e.target.value }); }}
            style={{ ...inputStyle, appearance: 'auto', color: role ? 'var(--color-charcoal)' : 'var(--color-warm-grey)' }}
          >
            <option value="">Choose your role…</option>
            {FAMILY_ROLES.map((r) => <option key={r} value={r} style={{ color: 'var(--color-charcoal)' }}>{r}</option>)}
          </select>

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
