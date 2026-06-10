/**
 * Step 2 - who's in the house. Two lightweight ways to populate the
 * household:
 *   - invite the grown-ups by email (POST /api/household/invite), and
 *   - add the kids by first name (POST /api/household/dependents), which
 *     creates dependent members.
 *
 * Capturing the kids here is the root data the whole kids feature set needs
 * (school term dates, weekly activities, school-prep reminders, and the
 * setup-completion nudge all key off member_type === 'dependent'). It's kept
 * to a single name field so it adds almost no friction; school setup itself
 * stays in Family Setup. Everything is skippable.
 *
 * Admin-only; if the user joined an existing household via invite the form
 * hides and the step becomes a "you're all in" confirmation.
 */

import { useState } from 'react';
import api from '../../lib/api';
import { serifHeading, serifHeadingStyle, kicker, primaryBtn, inputBase, skipLink } from './_styles';

export default function InviteFamily({ user, household, next, setError }) {
  const isAdmin = user?.role === 'admin';

  const [name, setName]         = useState('');
  const [email, setEmail]       = useState('');
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState([]); // list of successfully-invited emails

  // Kids (dependents) - added by first name, no email/invite needed.
  const [childName, setChildName] = useState('');
  const [addingKid, setAddingKid] = useState(false);
  const [kids, setKids]           = useState([]); // names of added dependents

  async function handleInvite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setError('');
    setSending(true);
    try {
      await api.post('/household/invite', {
        email: email.trim().toLowerCase(),
        name: name.trim() || null,
      });
      setSent((prev) => [...prev, email.trim()]);
      setEmail('');
      setName('');
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
      setKids((prev) => [...prev, n]);
      setChildName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add them.');
    } finally {
      setAddingKid(false);
    }
  }

  // Joined-an-existing-household users skip the form and just move on.
  if (!isAdmin) {
    return (
      <div className="text-center">
        <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
          Your household
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          You're in.
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          You've joined <strong>{household?.name || 'your household'}</strong>.
          You'll see whatever your family adds - tasks, shopping lists, the
          calendar - all shared. Let's finish setting up your account.
        </p>
        <button type="button" onClick={next} className={primaryBtn + ' mt-8'}>
          Continue →
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center">
        <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
          Invite family
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          Who's <i>in the house</i>?
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          Invite the grown-ups by email, and add the kids by name. This is
          what powers shared lists, assignable tasks, school reminders and
          term dates. You can always do more later in Family Setup.
        </p>
      </div>

      {/* Grown-ups - invited by email so they get their own login. */}
      <p className={kicker + ' mt-8 mb-2'} style={{ color: 'var(--color-plum)' }}>The grown-ups</p>
      <form onSubmit={handleInvite} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-bark mb-1.5">
            Their name <span className="text-cocoa font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sarah"
            className={inputBase}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-bark mb-1.5">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="sarah@example.com"
            className={inputBase}
            autoComplete="off"
            required
          />
        </div>
        <button
          type="submit"
          disabled={sending || !email.trim()}
          className={primaryBtn + ' w-full'}
        >
          {sending ? 'Sending…' : 'Send invite'}
        </button>
      </form>

      {sent.length > 0 && (
        <div className="mt-4 p-4 rounded-xl bg-sage-light border border-sage/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-2">
            Invites sent
          </p>
          <ul className="text-sm text-bark space-y-0.5">
            {sent.map((e) => (
              <li key={e}>✓ {e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Kids - added as dependents by first name. No email needed. This is
          the root data the school/term-date features rely on. */}
      <p className={kicker + ' mt-7 mb-2'} style={{ color: 'var(--color-plum)' }}>The kids</p>
      <form onSubmit={handleAddKid} className="flex gap-2">
        <input
          type="text"
          value={childName}
          onChange={(e) => setChildName(e.target.value)}
          placeholder="e.g. Oliver"
          className={inputBase + ' flex-1'}
          autoComplete="off"
          aria-label="Child's first name"
        />
        <button
          type="submit"
          disabled={addingKid || !childName.trim()}
          className={primaryBtn}
          style={{ paddingLeft: 20, paddingRight: 20 }}
        >
          {addingKid ? 'Adding…' : 'Add'}
        </button>
      </form>
      <p className="mt-2 text-xs text-cocoa">
        Just their first name for now. You can add their school and term dates later.
      </p>

      {kids.length > 0 && (
        <div className="mt-4 p-4 rounded-xl bg-sage-light border border-sage/30">
          <p className="text-xs font-semibold uppercase tracking-wide text-success mb-2">
            Added
          </p>
          <ul className="text-sm text-bark space-y-0.5">
            {kids.map((k, i) => (
              <li key={`${k}-${i}`}>✓ {k}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 text-center flex items-center justify-center gap-4">
        <button type="button" onClick={next} className={primaryBtn}>
          {sent.length > 0 || kids.length > 0 ? 'Done, next →' : 'Add these later →'}
        </button>
      </div>
      {sent.length === 0 && kids.length === 0 && (
        <p className="mt-3 text-center">
          <button type="button" onClick={next} className={skipLink}>
            Skip for now
          </button>
        </p>
      )}
    </div>
  );
}
