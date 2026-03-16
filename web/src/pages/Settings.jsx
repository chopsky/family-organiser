import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconSettings, IconHome, IconMail, IconPhone, IconUsers, IconUser, IconCalendar } from '../components/Icons';

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

  // Calendar feed state
  const [feedUrl, setFeedUrl] = useState('');
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);

  // Calendar connections state
  const [calConnections, setCalConnections] = useState([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [appleEmail, setAppleEmail] = useState('');
  const [applePassword, setApplePassword] = useState('');
  const [connectingApple, setConnectingApple] = useState(false);
  const [showAppleForm, setShowAppleForm] = useState(false);
  const [appleError, setAppleError] = useState('');

  // Calendar subscription selection state
  const [selectingProvider, setSelectingProvider] = useState(null); // 'google' | 'microsoft' | 'apple' | null
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [calendarSelections, setCalendarSelections] = useState({}); // { calId: { enabled, category, visibility } }
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [savingSubscriptions, setSavingSubscriptions] = useState(false);
  const [existingSubscriptions, setExistingSubscriptions] = useState([]);

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

  // Load calendar connections
  function loadConnections() {
    setLoadingConnections(true);
    api.get('/calendar/connections')
      .then(({ data }) => setCalConnections(data.connections ?? []))
      .catch(() => {})
      .finally(() => setLoadingConnections(false));
  }

  useEffect(() => { loadConnections(); }, []);

  // Handle OAuth callback redirects (e.g. ?connected=google)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const connected = searchParams.get('connected');
    const connError = searchParams.get('error');
    if (connected) {
      setSuccess(`${connected.charAt(0).toUpperCase() + connected.slice(1)} Calendar connected!`);
      loadConnections();
      searchParams.delete('connected');
      setSearchParams(searchParams, { replace: true });
    }
    if (connError) {
      setError(`Failed to connect calendar. Please try again.`);
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

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

  async function handleGetFeedUrl() {
    setError('');
    setLoadingFeed(true);
    try {
      const { data } = await api.get('/calendar/feed-token');
      setFeedUrl(data.feedUrl);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not get calendar feed URL.');
    } finally {
      setLoadingFeed(false);
    }
  }

  async function handleRegenerateFeed() {
    if (!window.confirm('Regenerate your calendar feed URL? The old URL will stop working.')) return;
    setError('');
    setLoadingFeed(true);
    setFeedCopied(false);
    try {
      const { data } = await api.post('/calendar/feed-token');
      setFeedUrl(data.feedUrl);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not regenerate feed URL.');
    } finally {
      setLoadingFeed(false);
    }
  }

  function handleCopyFeed() {
    navigator.clipboard.writeText(feedUrl).then(() => {
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 2000);
    });
  }

  async function handleConnectGoogle() {
    try {
      const { data } = await api.get('/calendar/connect/google');
      window.location.href = data.url;
    } catch (err) {
      setError('Could not start Google Calendar connection.');
    }
  }

  async function handleConnectMicrosoft() {
    try {
      const { data } = await api.get('/calendar/connect/microsoft');
      window.location.href = data.url;
    } catch (err) {
      setError('Could not start Microsoft Calendar connection.');
    }
  }

  async function handleConnectApple(e) {
    e.preventDefault();
    if (!appleEmail.trim() || !applePassword.trim()) {
      setAppleError('Email and app-specific password are required.');
      return;
    }
    setConnectingApple(true);
    setAppleError('');
    try {
      await api.post('/calendar/connect/apple', {
        email: appleEmail.trim(),
        appPassword: applePassword.trim(),
      }, { timeout: 30000 });
      setSuccess('Apple Calendar connected!');
      setShowAppleForm(false);
      setAppleEmail('');
      setApplePassword('');
      setAppleError('');
      loadConnections();
    } catch (err) {
      const msg = err.code === 'ECONNABORTED'
        ? 'Connection timed out. Please try again.'
        : err.response?.data?.error || 'Could not connect Apple Calendar.';
      setAppleError(msg);
    } finally {
      setConnectingApple(false);
    }
  }

  async function openCalendarSelection(provider) {
    setSelectingProvider(provider);
    setLoadingCalendars(true);
    try {
      const [calsRes, subsRes] = await Promise.all([
        api.get(`/calendar/connections/${provider}/calendars`),
        api.get(`/calendar/connections/${provider}/subscriptions`),
      ]);
      const cals = calsRes.data.calendars ?? [];
      const subs = subsRes.data.subscriptions ?? [];
      setAvailableCalendars(cals);
      setExistingSubscriptions(subs);

      // Build selections map: merge existing subscriptions with available calendars
      const selections = {};
      for (const cal of cals) {
        const existing = subs.find((s) => s.external_calendar_id === cal.id);
        selections[cal.id] = {
          enabled: existing ? existing.sync_enabled : true,
          category: existing ? existing.category : cal.suggestedCategory || 'general',
          visibility: existing ? existing.visibility : 'family',
        };
      }
      setCalendarSelections(selections);
    } catch {
      setError('Could not load calendars.');
      setSelectingProvider(null);
    } finally {
      setLoadingCalendars(false);
    }
  }

  async function saveCalendarSubscriptions() {
    setSavingSubscriptions(true);
    try {
      const calendars = availableCalendars
        .filter((cal) => calendarSelections[cal.id]?.enabled)
        .map((cal) => ({
          external_calendar_id: cal.id,
          display_name: cal.displayName,
          category: calendarSelections[cal.id].category,
          visibility: calendarSelections[cal.id].visibility,
        }));
      await api.post(`/calendar/connections/${selectingProvider}/subscriptions`, { calendars });
      setSuccess('Calendars saved! Importing events...');
      setSelectingProvider(null);
    } catch {
      setError('Could not save calendar selections.');
    } finally {
      setSavingSubscriptions(false);
    }
  }

  async function handleDisconnect(provider) {
    if (!window.confirm(`Disconnect ${provider.charAt(0).toUpperCase() + provider.slice(1)} Calendar?`)) return;
    try {
      await api.delete(`/calendar/connections/${provider}`);
      setCalConnections(prev => prev.filter(c => c.provider !== provider));
    } catch (err) {
      setError('Could not disconnect calendar.');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-bark flex items-center gap-2"><IconSettings className="h-6 w-6" /> Settings</h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Household card */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-4 flex items-center gap-2"><IconHome className="h-4 w-4" /> Household</h2>

        {isAdmin ? (
          <form onSubmit={handleSave} className="space-y-4">
            {success && (
              <p className="text-sm text-success bg-success/10 rounded-2xl px-3 py-2">{success}</p>
            )}
            <div>
              <label className="text-sm font-medium text-bark block mb-1">Household name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-bark block mb-1">Daily reminder time</label>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => setReminderTime(e.target.value)}
                className="border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-xs text-cocoa mt-1">Telegram reminders are sent at this time each day.</p>
            </div>
            <div>
              <label className="text-sm font-medium text-bark block mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-linen"
              >
                {Intl.supportedValuesOf('timeZone').map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <p className="text-xs text-cocoa mt-1">Reminders use this timezone.</p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        ) : (
          <div className="space-y-2 text-sm text-cocoa">
            <p><span className="font-medium text-bark">Name:</span> {household?.name}</p>
            <p><span className="font-medium text-bark">Reminder time:</span> {household?.reminder_time?.slice(0, 5)}</p>
            <p><span className="font-medium text-bark">Timezone:</span> {(household?.timezone ?? 'Africa/Johannesburg').replace(/_/g, ' ')}</p>
            <p className="text-xs text-cocoa mt-2">Only admins can change household settings.</p>
          </div>
        )}
      </div>

      {/* Invite Members (admin only) */}
      {isAdmin && (
        <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
          <h2 className="font-semibold text-bark mb-3 flex items-center gap-2"><IconMail className="h-4 w-4" /> Invite Members</h2>
          <p className="text-sm text-cocoa mb-3">
            Send an email invite to add someone to your household.
          </p>

          <form onSubmit={handleInvite} className="flex gap-2 mb-4">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={inviting}
              className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors whitespace-nowrap"
            >
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </form>

          {inviteSuccess && (
            <p className="text-sm text-success bg-success/10 rounded-2xl px-3 py-2 mb-3">{inviteSuccess}</p>
          )}

          {pendingInvites.length > 0 && (
            <div>
              <p className="text-xs font-medium text-cocoa uppercase tracking-wider mb-2">Pending invites</p>
              <ul className="space-y-1">
                {pendingInvites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between text-sm text-cocoa bg-oat rounded-2xl px-3 py-2">
                    <span>{inv.email}</span>
                    <span className="text-xs text-cocoa">
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
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2"><IconPhone className="h-4 w-4" /> Connect Telegram</h2>
        {members.find((m) => m.id === user?.id)?.telegram_chat_id ? (
          <p className="text-sm text-success bg-success/10 rounded-2xl px-3 py-2">
            Telegram connected! You'll receive reminders and can add items via the bot.
          </p>
        ) : (
          <>
            <p className="text-sm text-cocoa mb-3">
              Link your Telegram account to receive daily reminders and add items via the Curata bot.
            </p>
            {telegramLink ? (
              <a
                href={telegramLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
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
                className="inline-flex items-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
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

      {/* Calendar Sync */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2"><IconCalendar className="h-4 w-4" /> Calendar Sync</h2>
        <p className="text-sm text-cocoa mb-3">
          Subscribe to your household calendar in Apple Calendar, Google Calendar, or Outlook.
        </p>

        {feedUrl ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={feedUrl}
                className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-sm bg-oat text-cocoa select-all"
                onClick={(e) => e.target.select()}
              />
              <button
                onClick={handleCopyFeed}
                className="bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors whitespace-nowrap"
              >
                {feedCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="text-xs text-cocoa space-y-1">
              <p className="font-medium text-cocoa">How to subscribe:</p>
              <p><span className="font-medium">Apple Calendar:</span> File &rarr; New Calendar Subscription &rarr; paste URL</p>
              <p><span className="font-medium">Google Calendar:</span> Settings &rarr; Add calendar &rarr; From URL &rarr; paste URL</p>
              <p><span className="font-medium">Outlook:</span> Add calendar &rarr; Subscribe from web &rarr; paste URL</p>
            </div>
            <button
              onClick={handleRegenerateFeed}
              disabled={loadingFeed}
              className="text-xs text-cocoa hover:text-error transition-colors"
            >
              {loadingFeed ? 'Regenerating…' : 'Regenerate URL'}
            </button>
          </div>
        ) : (
          <button
            onClick={handleGetFeedUrl}
            disabled={loadingFeed}
            className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
          >
            {loadingFeed ? 'Generating…' : 'Generate Calendar Feed'}
          </button>
        )}

        {/* Two-Way Sync Connections */}
        <div className="mt-5 pt-5 border-t border-cream-border">
          <p className="text-sm font-medium text-bark mb-3">Two-way sync</p>
          <p className="text-xs text-cocoa mb-3">
            Connect your external calendar for automatic two-way sync. Changes in either app will be reflected in the other.
          </p>

          <div className="space-y-2">
            {/* Google */}
            {calConnections.find(c => c.provider === 'google') ? (
              <div className="bg-success/10 rounded-2xl px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-success flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Google Calendar connected
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => openCalendarSelection('google')} className="text-xs text-primary hover:text-primary-pressed">Manage calendars</button>
                    <button onClick={() => handleDisconnect('google')} className="text-xs text-error hover:text-error">Disconnect</button>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={handleConnectGoogle} className="w-full flex items-center justify-center gap-2 border border-cream-border rounded-2xl px-4 py-2.5 text-sm font-medium text-bark hover:bg-oat transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Connect Google Calendar
              </button>
            )}

            {/* Microsoft */}
            {calConnections.find(c => c.provider === 'microsoft') ? (
              <div className="bg-success/10 rounded-2xl px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-success flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                    Microsoft Calendar connected
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => openCalendarSelection('microsoft')} className="text-xs text-primary hover:text-primary-pressed">Manage calendars</button>
                    <button onClick={() => handleDisconnect('microsoft')} className="text-xs text-error hover:text-error">Disconnect</button>
                  </div>
                </div>
              </div>
            ) : (
              <button onClick={handleConnectMicrosoft} className="w-full flex items-center justify-center gap-2 border border-cream-border rounded-2xl px-4 py-2.5 text-sm font-medium text-bark hover:bg-oat transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                Connect Microsoft / Outlook
              </button>
            )}

            {/* Apple */}
            {calConnections.find(c => c.provider === 'apple') ? (
              <div className="bg-success/10 rounded-2xl px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-success flex items-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                    Apple Calendar connected
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => openCalendarSelection('apple')} className="text-xs text-primary hover:text-primary-pressed">Manage calendars</button>
                    <button onClick={() => handleDisconnect('apple')} className="text-xs text-error hover:text-error">Disconnect</button>
                  </div>
                </div>
              </div>
            ) : showAppleForm ? (
              <form onSubmit={handleConnectApple} className="border border-cream-border rounded-2xl p-3 space-y-2">
                <p className="text-xs text-cocoa">
                  Use an app-specific password from <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">appleid.apple.com</a> &rarr; Sign-In and Security &rarr; App-Specific Passwords.
                </p>
                {appleError && (
                  <p className="text-xs text-error bg-error/10 rounded-xl px-3 py-2">{appleError}</p>
                )}
                <input
                  type="email"
                  placeholder="Apple ID email"
                  value={appleEmail}
                  onChange={(e) => setAppleEmail(e.target.value)}
                  className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <input
                  type="password"
                  placeholder="App-specific password"
                  value={applePassword}
                  onChange={(e) => setApplePassword(e.target.value)}
                  className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={connectingApple} className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors">
                    {connectingApple ? 'Connecting…' : 'Connect'}
                  </button>
                  <button type="button" onClick={() => setShowAppleForm(false)} className="text-sm text-cocoa hover:text-bark">Cancel</button>
                </div>
              </form>
            ) : (
              <button onClick={() => setShowAppleForm(true)} className="w-full flex items-center justify-center gap-2 border border-cream-border rounded-2xl px-4 py-2.5 text-sm font-medium text-bark hover:bg-oat transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                Connect Apple Calendar
              </button>
            )}
          </div>

          {/* Calendar Selection Panel */}
          {selectingProvider && (
            <div className="mt-4 border border-cream-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-bark">
                  Select calendars to sync ({selectingProvider.charAt(0).toUpperCase() + selectingProvider.slice(1)})
                </h3>
                <button onClick={() => setSelectingProvider(null)} className="text-xs text-cocoa hover:text-bark">Close</button>
              </div>

              {loadingCalendars ? (
                <Spinner />
              ) : availableCalendars.length === 0 ? (
                <p className="text-xs text-cocoa">No calendars found.</p>
              ) : (
                <div className="space-y-2">
                  {availableCalendars.map((cal) => {
                    const sel = calendarSelections[cal.id] || {};
                    return (
                      <div key={cal.id} className={`rounded-xl border border-cream-border p-3 ${sel.enabled ? 'bg-linen' : 'bg-oat opacity-60'}`}>
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={sel.enabled ?? true}
                            onChange={(e) => setCalendarSelections((prev) => ({
                              ...prev,
                              [cal.id]: { ...prev[cal.id], enabled: e.target.checked },
                            }))}
                            className="w-4 h-4 rounded accent-primary"
                          />
                          <span className="text-sm font-medium text-bark flex-1">{cal.displayName}</span>
                        </div>
                        {sel.enabled && (
                          <div className="flex gap-3 mt-2 ml-7">
                            <select
                              value={sel.category || 'general'}
                              onChange={(e) => setCalendarSelections((prev) => ({
                                ...prev,
                                [cal.id]: { ...prev[cal.id], category: e.target.value },
                              }))}
                              className="text-xs border border-cream-border rounded-xl px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                            >
                              <option value="general">General</option>
                              <option value="birthday">Birthdays</option>
                              <option value="public_holiday">Public Holidays</option>
                            </select>
                            <select
                              value={sel.visibility || 'family'}
                              onChange={(e) => setCalendarSelections((prev) => ({
                                ...prev,
                                [cal.id]: { ...prev[cal.id], visibility: e.target.value },
                              }))}
                              className="text-xs border border-cream-border rounded-xl px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                            >
                              <option value="family">Visible to family</option>
                              <option value="personal">Only me</option>
                            </select>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!loadingCalendars && availableCalendars.length > 0 && (
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setSelectingProvider(null)} className="text-sm text-cocoa hover:text-bark px-3 py-1.5">Cancel</button>
                  <button
                    onClick={saveCalendarSubscriptions}
                    disabled={savingSubscriptions}
                    className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white text-sm font-medium px-4 py-2 rounded-2xl transition-colors"
                  >
                    {savingSubscriptions ? 'Saving…' : 'Save & Import'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Members */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2"><IconUsers className="h-4 w-4" /> Members</h2>
        {loadingMembers ? <Spinner /> : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-secondary/30 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                  {m.name[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-bark">{m.name}</p>
                  <p className="text-xs text-cocoa">
                    {m.role}
                    {m.telegram_chat_id && ' · Telegram connected'}
                  </p>
                </div>
                {m.id === user?.id && (
                  <span className="text-xs bg-secondary/30 text-primary px-2 py-0.5 rounded-full">You</span>
                )}
                {isAdmin && m.id !== user?.id && m.role !== 'admin' && (
                  <button
                    onClick={() => handleRemoveMember(m)}
                    className="text-xs text-error hover:text-error transition-colors"
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
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-2 flex items-center gap-2"><IconUser className="h-4 w-4" /> You</h2>
        <p className="text-sm text-cocoa">
          Signed in as <span className="font-medium">{user?.name}</span>
          <span className="text-cocoa"> ({user?.role})</span>
        </p>
      </div>
    </div>
  );
}
