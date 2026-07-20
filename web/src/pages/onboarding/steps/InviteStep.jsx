import { useEffect, useRef, useState } from 'react';
import api from '../../../lib/api';
import { Title, Em, Kicker, Lead, PrimaryButton, Ghost } from './_ui';
import { inputStyle } from './_styles';

// Vibrant per-member avatar colours (brand palette).
const AVATAR_COLOURS = ['#D8788A', '#5B8DE0', '#D89B3A', '#6BA368', '#6C3DD9', '#B05B9E'];
const initialOf = (s) => (s || '?').trim().charAt(0).toUpperCase() || '?';
// Dedupe key: an adult by email (their natural id), a kid by name.
const dupKey = (e) => `${e.kind}:${(e.kind === 'adult' ? (e.email || e.label) : e.label || '').trim().toLowerCase()}`;
const dedupe = (list) => {
  const seen = new Set();
  return (list || []).filter((e) => { const k = dupKey(e); if (seen.has(k)) return false; seen.add(k); return true; });
};

// Step 6. Populate the household: invite grown-ups by email (/household/invite)
// and add kids by first name (/household/dependents). Invited members are
// mirrored into form.invited so the finish screen can show the avatar stack.
// Joiners (non-admin) get a "you're in" confirmation instead. Everything is
// skippable.
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
  const addInvited = (entry) => update({ invited: dedupe([...invited, entry]) });

  // Seed the chips from the household's REAL members + pending invites once on
  // mount. Without this, reopening the browser mid-flow showed an empty list,
  // so re-adding "Bobby" created a fresh dependent every time. Source of truth
  // is the server; merged with anything added this session and de-duplicated.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!isAdmin || seededRef.current) return;
    seededRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const [hhRes, invRes] = await Promise.all([
          api.get('/household'),
          api.get('/household/invites').catch(() => ({ data: { invites: [] } })),
        ]);
        if (cancelled) return;
        const fromMembers = (hhRes.data?.members || [])
          .filter((m) => m.id !== user?.id)
          .map((m) => ({ kind: m.member_type === 'dependent' ? 'kid' : 'adult', label: m.name, email: m.email || undefined }));
        const fromInvites = (invRes.data?.invites || [])
          .map((iv) => ({ kind: 'adult', label: iv.name || iv.email, email: iv.email }));
        update({ invited: dedupe([...(form.invited || []), ...fromMembers, ...fromInvites]) });
      } catch { /* leave the in-session list as-is on failure */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleInvite(e) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em) return;
    setError('');
    if (invited.some((p) => p.kind === 'adult' && (p.email || '').toLowerCase() === em)) {
      setError(`${em} has already been invited.`); return;
    }
    setSending(true);
    try {
      await api.post('/household/invite', { email: em, name: name.trim() || null });
      addInvited({ kind: 'adult', label: name.trim() || em.split('@')[0], email: em });
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
    if (invited.some((p) => p.kind === 'kid' && p.label.trim().toLowerCase() === n.toLowerCase())) {
      setError(`You've already added ${n}.`); return;
    }
    setAddingKid(true);
    try {
      await api.post('/household/dependents', { name: n, dependent_kind: 'child' });
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
        <p style={{ fontSize: 15, color: 'var(--color-cocoa)', lineHeight: 1.55, margin: '16px auto 0', maxWidth: 380 }}>
          You've joined <strong style={{ color: 'var(--color-charcoal)' }}>{household?.name || 'your household'}</strong>. Tasks, lists and the calendar are all shared, so you'll see whatever the family adds. Let's finish up.
        </p>
        <PrimaryButton onClick={next} style={{ marginTop: 26 }}>Continue →</PrimaryButton>
      </div>
    );
  }

  const hasAny = invited.length > 0;

  return (
    <div>
      <Kicker>Share the load</Kicker>
      <Title>Who's <Em>in the house?</Em></Title>
      <Lead>Inviting people is what makes it <i>shared</i>, not just another list only you can see.</Lead>

      {hasAny && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', margin: '20px 0 4px' }}>
          {invited.map((m, i) => (
            <span key={`${m.label}-${i}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px 6px 6px', borderRadius: 99, background: '#fff', border: '1px solid var(--color-cream-border)' }}>
              <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, background: m.kind === 'kid' ? '#D89B3A' : AVATAR_COLOURS[i % AVATAR_COLOURS.length] }}>{initialOf(m.label)}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-charcoal)' }}>{m.label}</span>
              {m.kind === 'kid' && <span style={{ fontSize: 11, color: 'var(--color-warm-grey)' }}>kid</span>}
            </span>
          ))}
        </div>
      )}

      {/* Grown-ups */}
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-plum)', textAlign: 'left', margin: '24px 0 10px' }}>The grown-ups</p>
      <form onSubmit={handleInvite} style={{ textAlign: 'left' }}>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name (optional)" autoComplete="off" aria-label="Their name" style={{ ...inputStyle, marginBottom: 10 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="partner@email.com" autoComplete="off" aria-label="Their email" style={{ ...inputStyle, flex: 1 }} />
          <PrimaryButton type="submit" disabled={sending || !email.trim()} style={{ width: 'auto', padding: '0 20px', fontSize: 14 }}>{sending ? 'Sending…' : 'Invite'}</PrimaryButton>
        </div>
      </form>

      {/* Kids */}
      <p style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-plum)', textAlign: 'left', margin: '22px 0 10px' }}>The kids</p>
      <form onSubmit={handleAddKid} style={{ display: 'flex', gap: 10 }}>
        <input aria-label="Child's first name" type="text" value={childName} onChange={(e) => setChildName(e.target.value)} placeholder="First name" autoComplete="off" style={{ ...inputStyle, flex: 1 }} />
        <PrimaryButton type="submit" disabled={addingKid || !childName.trim()} style={{ width: 'auto', padding: '0 20px', fontSize: 14 }}>{addingKid ? 'Adding…' : 'Add'}</PrimaryButton>
      </form>
      <p style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-warm-grey)', textAlign: 'left' }}>Kids get their own chores and rewards, no email needed.</p>

      <PrimaryButton onClick={next} style={{ marginTop: 24 }}>{hasAny ? `Continue with ${invited.length}` : 'Continue'}</PrimaryButton>
      {!hasAny && <Ghost onClick={next}>Skip for now</Ghost>}
    </div>
  );
}
