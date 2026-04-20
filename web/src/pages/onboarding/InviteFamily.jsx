/**
 * Step 2 — invite family members. Inline form that posts to the existing
 * POST /api/household/invite endpoint. The user can send multiple invites
 * before advancing, or skip entirely. Admin-only; if the user isn't an
 * admin (e.g. they joined an existing household via invite) the form
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
          You've joined <strong>{household?.name || 'your household'}</strong>. The
          admins can invite more members from Family Setup whenever they like.
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
          Step 1 — invite family
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          Who's <i>in the house</i>?
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          Housemait works best when everyone's on it — shared shopping lists,
          tasks that can be assigned, a calendar you can all add to. Invite
          them now, or add them later from Family Setup.
        </p>
      </div>

      <form onSubmit={handleInvite} className="mt-8 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-bark mb-1.5">
            Their name <span className="text-cocoa font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lynn"
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
            placeholder="lynn@example.com"
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
        <div className="mt-5 p-4 rounded-xl bg-sage-light border border-sage/30">
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

      <div className="mt-8 text-center flex items-center justify-center gap-4">
        <button type="button" onClick={next} className={primaryBtn}>
          {sent.length > 0 ? 'Done, next →' : 'I\'ll invite later →'}
        </button>
      </div>
      {sent.length === 0 && (
        <p className="mt-3 text-center">
          <button type="button" onClick={next} className={skipLink}>
            Skip for now
          </button>
        </p>
      )}
    </div>
  );
}
