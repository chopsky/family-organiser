import { useState } from 'react';
import api from '../../../lib/api';
import { Title, Em, Kicker, PrimaryButton, Ghost } from './_ui';
import { inputStyle, labelStyle } from './_styles';

// Vibrant per-member avatar colours (brand palette).
const AVATAR_COLOURS = ['#6B3FA0', '#E8724A', '#7DAE82', '#E0A458', '#5BA3D0', '#B05B9E'];
const initialOf = (s) => (s || '?').trim().charAt(0).toUpperCase() || '?';

// Step 6. Populate the household: invite grown-ups by email
// (POST /household/invite) and add kids by first name
// (POST /household/dependents). Invited members are mirrored into form.invited
// so the finish screen can show the avatar stack. Joiners (non-admin) get a
// "you're in" confirmation instead. Everything is skippable.
export default function InviteStep({ auth, form, update, next, setError }) {
  const user = auth.user;
  const household = auth.household;
  const isAdmin = user?.role === 'admin';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [childName, setChildName] = useState('');
  const [addingKid, setAddingKid] = useState(false);

  const invited = form.invited || [];
  const addInvited = (entry) => update({ invited: [...invited, entry] });

  async function handleInvite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setSending(true);
    try {
      await api.post('/household/invite', { email: email.trim().toLowerCase(), name: name.trim() || null });
      addInvited({ kind: 'adult', label: name.trim() || email.trim() });
      setEmail(''); setName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send the invite.');
    } finally {
      setSending(false);
    }
  }

  async function handleAddKid(e) {
    e.preventDefault();
    const n = childName.trim();
    if (!n) return;
    setError('');
    setAddingKid(true);
    try {
      await api.post('/household/dependents', { name: n, family_role: 'Child' });
      addInvited({ kind: 'kid', label: n });
      setChildName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add them.');
    } finally {
      setAddingKid(false);
    }
  }

  // Joiners just confirm and move on - they inherit the existing household.
  if (!isAdmin) {
    return (
      <div>
        <Kicker>Your household</Kicker>
        <Title>You're <Em>in.</Em></Title>
        <p style={{ fontSize: 16, color: 'var(--color-cocoa)', lineHeight: 1.55, margin: '16px auto 0', maxWidth: 400 }}>
          You've joined <strong style={{ color: 'var(--color-charcoal)' }}>{household?.name || 'your household'}</strong>. Tasks, lists and the calendar are all shared, so you'll see whatever the family adds. Let's finish up.
        </p>
        <PrimaryButton onClick={next} style={{ marginTop: 26 }}>Continue →</PrimaryButton>
      </div>
    );
  }

  const hasAny = invited.length > 0;

  return (
    <div>
      <Kicker>Invite family</Kicker>
      <Title>Who's <Em>in the house?</Em></Title>
      <p style={{ fontSize: 15, color: 'var(--color-cocoa)', lineHeight: 1.5, margin: '12px 0 0' }}>
        Invite the grown-ups by email and add the kids by name. This is what powers shared lists, assignable tasks and school reminders. You can always do more later.
      </p>

      {hasAny && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', margin: '20px 0 4px' }}>
          {invited.map((m, i) => (
            <span key={`${m.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 999, background: '#fff', border: '1px solid var(--color-cream-border)' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12.5, fontWeight: 700, background: AVATAR_COLOURS[i % AVATAR_COLOURS.length] }}>{initialOf(m.label)}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-charcoal)' }}>{m.label}</span>
              <span style={{ fontSize: 11, color: 'var(--color-warm-grey)' }}>{m.kind === 'kid' ? 'child' : 'invited'}</span>
            </span>
          ))}
        </div>
      )}

      {/* Grown-ups */}
      <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-plum)', textAlign: 'left', margin: '24px 0 10px' }}>The grown-ups</p>
      <form onSubmit={handleInvite} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label htmlFor="ob-inv-name" style={labelStyle}>Their name <span style={{ fontWeight: 400, color: 'var(--color-warm-grey)' }}>(optional)</span></label>
          <input id="ob-inv-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah" autoComplete="off" style={inputStyle} />
        </div>
        <div>
          <label htmlFor="ob-inv-email" style={labelStyle}>Email</label>
          <input id="ob-inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="sarah@example.com" autoComplete="off" style={inputStyle} />
        </div>
        <PrimaryButton type="submit" disabled={sending || !email.trim()}>{sending ? 'Sending…' : 'Send invite'}</PrimaryButton>
      </form>

      {/* Kids */}
      <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-plum)', textAlign: 'left', margin: '24px 0 10px' }}>The kids</p>
      <form onSubmit={handleAddKid} style={{ display: 'flex', gap: 10 }}>
        <input aria-label="Child's first name" type="text" value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="e.g. Oliver" autoComplete="off" style={{ ...inputStyle, flex: 1 }} />
        <PrimaryButton type="submit" disabled={addingKid || !childName.trim()} style={{ width: 'auto', padding: '13px 22px', fontSize: 15 }}>{addingKid ? 'Adding…' : 'Add'}</PrimaryButton>
      </form>
      <p style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-warm-grey)', textAlign: 'left' }}>Just a first name for now. School and term dates come later.</p>

      <PrimaryButton onClick={next} style={{ marginTop: 26 }}>{hasAny ? 'Done, next →' : 'Add these later →'}</PrimaryButton>
      {!hasAny && <Ghost onClick={next}>Skip for now</Ghost>}
    </div>
  );
}
