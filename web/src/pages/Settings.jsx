import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconSettings, IconUser, IconCalendar } from '../components/Icons';

export default function Settings() {
  const { household, user, isAdmin, login, logout, token } = useAuth();
  const navigate = useNavigate();

  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');

  const [members, setMembers]         = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // WhatsApp link state
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappCode, setWhatsappCode] = useState('');
  const [sendingWhatsappCode, setSendingWhatsappCode] = useState(false);
  const [verifyingWhatsapp, setVerifyingWhatsapp] = useState(false);
  const [whatsappCodeSent, setWhatsappCodeSent] = useState(false);
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false);

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
  const [selectingProvider, setSelectingProvider] = useState(null);
  const [availableCalendars, setAvailableCalendars] = useState([]);
  const [calendarSelections, setCalendarSelections] = useState({});
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

  async function handleSendWhatsappCode(e) {
    e.preventDefault();
    setError('');
    if (!whatsappPhone.trim()) { setError('Please enter your phone number.'); return; }
    setSendingWhatsappCode(true);
    try {
      await api.post('/auth/whatsapp-send-code', { phone: whatsappPhone.trim() });
      setWhatsappCodeSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send verification code.');
    } finally {
      setSendingWhatsappCode(false);
    }
  }

  async function handleVerifyWhatsapp(e) {
    e.preventDefault();
    setError('');
    if (!whatsappCode.trim()) { setError('Please enter the verification code.'); return; }
    setVerifyingWhatsapp(true);
    try {
      await api.post('/auth/whatsapp-verify-code', { code: whatsappCode.trim() });
      setSuccess('WhatsApp connected!');
      setWhatsappCodeSent(false);
      setWhatsappPhone('');
      setWhatsappCode('');
      loadMembers();
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid code. Please try again.');
    } finally {
      setVerifyingWhatsapp(false);
    }
  }

  async function handleDisconnectWhatsapp() {
    setError('');
    setDisconnectingWhatsapp(true);
    try {
      await api.post('/auth/whatsapp-disconnect');
      setSuccess('WhatsApp disconnected.');
      loadMembers();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not disconnect WhatsApp.');
    } finally {
      setDisconnectingWhatsapp(false);
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
      const [calsRes, subsRes] = await Promise.allSettled([
        api.get(`/calendar/connections/${provider}/calendars`),
        api.get(`/calendar/connections/${provider}/subscriptions`),
      ]);
      if (calsRes.status === 'rejected') throw calsRes.reason;
      const cals = calsRes.value.data.calendars ?? [];
      const subs = subsRes.status === 'fulfilled' ? (subsRes.value.data.subscriptions ?? []) : [];
      setAvailableCalendars(cals);
      setExistingSubscriptions(subs);

      const hasExistingSubs = subs.length > 0;
      const selections = {};
      for (const cal of cals) {
        const existing = subs.find((s) => s.external_calendar_id === cal.id);
        selections[cal.id] = {
          enabled: existing ? existing.sync_enabled : !hasExistingSubs,
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
          category: cal.suggestedCategory || 'general',
          visibility: calendarSelections[cal.id].visibility,
        }));
      const { data } = await api.post(`/calendar/connections/${selectingProvider}/subscriptions`, { calendars });
      const newCount = (data.newImports || 0);
      const removedCount = (data.removed || 0);
      let msg = 'Calendar selections saved.';
      if (newCount > 0) msg += ` Importing ${newCount} calendar${newCount > 1 ? 's' : ''} — this may take a few minutes.`;
      if (removedCount > 0) msg += ` Removed ${removedCount} calendar${removedCount > 1 ? 's' : ''}.`;
      setSuccess(msg);
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
      <h1 className="text-2xl font-semibold text-bark flex items-center gap-2"><IconSettings className="h-6 w-6" /> Settings</h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Connect WhatsApp */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Connect WhatsApp
        </h2>
        {members.find((m) => m.id === user?.id)?.whatsapp_linked ? (
          <div className="space-y-3">
            <p className="text-sm text-success bg-success/10 rounded-2xl px-3 py-2">
              WhatsApp connected! You'll receive reminders and can message the bot.
            </p>
            <button
              onClick={handleDisconnectWhatsapp}
              disabled={disconnectingWhatsapp}
              className="text-sm text-cocoa hover:text-error transition-colors"
            >
              {disconnectingWhatsapp ? 'Disconnecting…' : 'Disconnect WhatsApp'}
            </button>
          </div>
        ) : whatsappCodeSent ? (
          <form onSubmit={handleVerifyWhatsapp} className="space-y-3">
            <p className="text-sm text-cocoa">
              A verification code has been sent to your WhatsApp. Enter it below:
            </p>
            <input
              type="text"
              value={whatsappCode}
              onChange={(e) => setWhatsappCode(e.target.value)}
              placeholder="Enter 6-digit code"
              maxLength={6}
              className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-center text-lg tracking-widest"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={verifyingWhatsapp}
                className="flex-1 bg-[#25D366] hover:bg-[#1DA851] disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
              >
                {verifyingWhatsapp ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => { setWhatsappCodeSent(false); setWhatsappCode(''); }}
                className="px-4 py-2.5 rounded-2xl text-sm text-cocoa hover:bg-oat transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-cocoa mb-3">
              Link your WhatsApp to receive daily reminders and manage your household via chat.
            </p>
            <form onSubmit={handleSendWhatsappCode} className="flex gap-2">
              <input
                type="tel"
                value={whatsappPhone}
                onChange={(e) => setWhatsappPhone(e.target.value)}
                placeholder="+44 7700 900000"
                className="flex-1 border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent text-sm"
              />
              <button
                type="submit"
                disabled={sendingWhatsappCode}
                className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1DA851] disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors whitespace-nowrap"
              >
                {sendingWhatsappCode ? 'Sending…' : 'Send code'}
              </button>
            </form>
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
                          <div className="flex items-center gap-3 mt-2 ml-7">
                            {cal.suggestedCategory && cal.suggestedCategory !== 'general' && (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                cal.suggestedCategory === 'birthday'
                                  ? 'bg-purple-100 text-purple-700'
                                  : 'bg-red-100 text-red-700'
                              }`}>
                                {cal.suggestedCategory === 'birthday' ? 'Birthdays' : 'Public Holidays'}
                              </span>
                            )}
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
                    {savingSubscriptions ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Signed in as */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-2 flex items-center gap-2"><IconUser className="h-4 w-4" /> You</h2>
        <p className="text-sm text-cocoa">
          Signed in as <span className="font-medium">{user?.name}</span>
          <span className="text-cocoa"> ({user?.role})</span>
        </p>
      </div>

      {/* Log out */}
      <button
        onClick={() => { logout(); navigate('/'); }}
        className="w-full py-3 rounded-2xl border border-error/30 text-error font-semibold text-sm hover:bg-error/5 transition-colors"
      >
        Log out
      </button>
    </div>
  );
}
