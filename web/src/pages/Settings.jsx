import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';

export default function Settings() {
  const { household, user, isAdmin, login, token } = useAuth();

  const [name, setName]               = useState(household?.name ?? '');
  const [reminderTime, setReminderTime] = useState(
    household?.reminder_time?.slice(0, 5) ?? '08:00'
  );
  const [timezone, setTimezone]       = useState(
    household?.timezone ?? 'Africa/Johannesburg'
  );
  const [saving, setSaving]           = useState(false);
  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');

  const [members, setMembers]         = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // Invite state
  const [inviteEmail, setInviteEmail]   = useState('');
  const [inviting, setInviting]         = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [pendingInvites, setPendingInvites] = useState([]);

  // Telegram link state
  const [telegramLink, setTelegramLink] = useState('');
  const [linkingTelegram, setLinkingTelegram] = useState(false);

  function loadMembers() {
    return api.get('/household')
      .then(({ data }) => setMembers(data.members ?? []))
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  useEffect(() => { loadMembers(); }, []);

  useEffect(() => {
    if (isAdmin) {
      api.get('/household/invites')
        .then(({ data }) => setPendingInvites(data.invites ?? []))
        .catch(() => {});
    }
  }, [isAdmin]);

  async function handleRemoveMember(member) {
    if (!window.confirm(`Remove ${member.name} from the household?`)) return;
    try {
      await api.delete(`/household/members/${member.id}`);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove member.');
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!name.trim()) { setError('Household name cannot be empty.'); return; }
    setSaving(true);
    try {
      const { data } = await api.patch('/settings/settings', {
        name: name.trim(),
        reminder_time: reminderTime + ':00',
        timezone,
      });
      setSuccess('Settings saved!');
      // Update stored household
      login({ token, user, household: data.household });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite(e) {
    e.preventDefault();
    setError(''); setInviteSuccess('');
    if (!inviteEmail.trim()) { setError('Email is required.'); return; }
    setInviting(true);
    try {
      await api.post('/household/invite', { email: inviteEmail.trim() });
      setInviteSuccess(`Invite sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      // Refresh pending invites
      const { data } = await api.get('/household/invites');
      setPendingInvites(data.invites ?? []);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send invite.');
    } finally {
      setInviting(false);
    }
  }

  async function handleConnectTelegram() {
    setError('');
    setLinkingTelegram(true);
    try {
      const { data } = await api.post('/auth/telegram-link-token');
      setTelegramLink(data.deepLink);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not generate Telegram link.');
    } finally {
      setLinkingTelegram(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">⚙️ Settings</h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Household card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">🏠 Household</h2>

        {isAdmin ? (
          <form onSubmit={handleSave} className="space-y-4">
            {success && (
              <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{success}</p>
            )}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Household name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Daily reminder time</label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
              <p className="text-xs text-gray-400 mt-1">Telegram reminders are sent at this time each day.</p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
              >
                {Intl.supportedValuesOf('timeZone').map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Reminders use this timezone.</p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : (
          <div className="space-y-2 text-sm text-gray-600">
            <p><span className="font-medium text-gray-700">Name:</span> {household?.name}</p>
            <p><span className="font-medium text-gray-700">Reminder time:</span> {household?.reminder_time?.slice(0, 5)}</p>
            <p><span className="font-medium text-gray-700">Timezone:</span> {(household?.timezone ?? 'Africa/Johannesburg').replace(/_/g, ' ')}</p>
            <p className="text-xs text-gray-400 mt-2">Only admins can change household settings.</p>
          </div>
        )}
      </div>

      {/* Invite Members (admin only) */}
      {isAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">✉️ Invite Members</h2>
          <p className="text-sm text-gray-500 mb-3">
            Send an email invite to add someone to your household.
          </p>

          <form onSubmit={handleInvite} className="flex gap-2 mb-4">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <button
              type="submit"
              disabled={inviting}
              className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
            >
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </form>

          {inviteSuccess && (
            <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 mb-3">{inviteSuccess}</p>
          )}

          {pendingInvites.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Pending invites</p>
              <ul className="space-y-1">
                {pendingInvites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                    <span>{inv.email}</span>
                    <span className="text-xs text-gray-400">
                      expires {new Date(inv.expires_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Connect Telegram */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">📱 Connect Telegram</h2>
        {members.find((m) => m.id === user?.id)?.telegram_chat_id ? (
          <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
            Telegram connected! You'll receive reminders and can add items via the bot.
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-3">
              Link your Telegram account to receive daily reminders and add items via the Curata bot.
            </p>
            {telegramLink ? (
              <a
                href={telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.96 6.504-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                Open in Telegram
              </a>
            ) : (
              <button
                onClick={handleConnectTelegram}
                disabled={linkingTelegram}
                className="inline-flex items-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] disabled:bg-gray-300 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.96 6.504-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                {linkingTelegram ? 'Generating link…' : 'Connect Telegram'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Members */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">👨‍👩‍👧 Members</h2>
        {loadingMembers ? <Spinner /> : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm shrink-0">
                  {m.name[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">{m.name}</p>
                  <p className="text-xs text-gray-400">
                    {m.role}
                    {m.telegram_chat_id && ' · 📱 Telegram connected'}
                  </p>
                </div>
                {m.id === user?.id && (
                  <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">You</span>
                )}
                {isAdmin && m.id !== user?.id && m.role !== 'admin' && (
                  <button
                    onClick={() => handleRemoveMember(m)}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Signed in as */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-2">👤 You</h2>
        <p className="text-sm text-gray-600">
          Signed in as <span className="font-medium">{user?.name}</span>
          <span className="text-gray-400"> ({user?.role})</span>
        </p>
      </div>
    </div>
  );
}
