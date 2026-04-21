import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconUser, IconCalendar } from '../components/Icons';

const avatarColors = {
  red: 'bg-red text-white', 'burnt-orange': 'bg-burnt-orange text-white',
  amber: 'bg-amber text-white', gold: 'bg-gold text-white',
  leaf: 'bg-leaf text-white', emerald: 'bg-emerald text-white',
  teal: 'bg-teal text-white', sky: 'bg-sky text-white',
  cobalt: 'bg-cobalt text-white', indigo: 'bg-indigo text-white',
  purple: 'bg-purple text-white', magenta: 'bg-magenta text-white',
  rose: 'bg-rose text-white', terracotta: 'bg-terracotta text-white',
  moss: 'bg-moss text-white', slate: 'bg-slate text-white',
  sage: 'bg-sage text-white', plum: 'bg-plum text-white', coral: 'bg-coral text-white', lavender: 'bg-indigo text-white',
};

export default function Settings() {
  const { household, user, isAdmin, login, logout, token } = useAuth();
  const navigate = useNavigate();

  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');

  // ── Delete-account modal state ───────────────────────────────────
  // Password-gated destructive action. Stays closed until the user opens
  // the modal from the danger-zone section near the bottom of the page.
  const [deleteOpen, setDeleteOpen]         = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleting, setDeleting]             = useState(false);
  const [deleteError, setDeleteError]       = useState('');

  // Data export (GDPR Article 20 — right to portability)
  const [exporting, setExporting] = useState(false);

  // Active sessions (Settings → Active sessions)
  const [sessions, setSessions]             = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingSessionId, setRevokingSessionId] = useState(null);
  const [revokingAllOthers, setRevokingAllOthers] = useState(false);

  const [members, setMembers]         = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // Push notification preferences
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [loadingNotifPrefs, setLoadingNotifPrefs] = useState(true);
  const [savingNotifPref, setSavingNotifPref] = useState(null); // which key is saving

  // WhatsApp link state
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [whatsappCode, setWhatsappCode] = useState('');
  const [sendingWhatsappCode, setSendingWhatsappCode] = useState(false);
  const [verifyingWhatsapp, setVerifyingWhatsapp] = useState(false);
  const [whatsappCodeSent, setWhatsappCodeSent] = useState(false);
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false);
  const [whatsappBotNumber, setWhatsappBotNumber] = useState(null); // populated on load + after verify

  // Calendar feed state
  const [feedUrl, setFeedUrl] = useState('');
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);

  // Receipt email forwarding state
  const [receiptEmail, setReceiptEmail] = useState('');
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [regeneratingReceipt, setRegeneratingReceipt] = useState(false);

  // Calendar connections state
  const [calConnections, setCalConnections] = useState([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [appleEmail, setAppleEmail] = useState('');
  const [applePassword, setApplePassword] = useState('');
  const [connectingApple, setConnectingApple] = useState(false);
  const [showAppleForm, setShowAppleForm] = useState(false);
  const [appleError, setAppleError] = useState('');

  // Edit profile state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileRole, setProfileRole] = useState('');
  const [profileBirthday, setProfileBirthday] = useState('');
  const [profileColor, setProfileColor] = useState('teal');
  const [profileReminderTime, setProfileReminderTime] = useState('');
  const [profileAvatar, setProfileAvatar] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

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

  // Fetch the bot's WhatsApp number once so we can render the
  // "Open in WhatsApp" deep-link button for linked users.
  useEffect(() => {
    api.get('/auth/whatsapp-bot-info')
      .then(({ data }) => setWhatsappBotNumber(data?.bot_number || null))
      .catch(() => setWhatsappBotNumber(null));
  }, []);

  // Load notification preferences (native iOS/Android only)
  const isNative = Capacitor.isNativePlatform();
  useEffect(() => {
    if (!isNative) { setLoadingNotifPrefs(false); return; }
    api.get('/notifications/preferences')
      .then(({ data }) => setNotifPrefs(data))
      .catch(() => setNotifPrefs({ calendar_reminders: true, task_assigned: true, shopping_updated: true, meal_plan_updated: true, family_activity: true }))
      .finally(() => setLoadingNotifPrefs(false));
  }, []);

  async function toggleNotifPref(key) {
    if (!notifPrefs) return;
    const newVal = !notifPrefs[key];
    setSavingNotifPref(key);
    try {
      await api.put('/notifications/preferences', { ...notifPrefs, [key]: newVal });
      setNotifPrefs(prev => ({ ...prev, [key]: newVal }));
    } catch {
      setError('Could not update notification preference.');
    } finally {
      setSavingNotifPref(null);
    }
  }

  async function openEditProfile() {
    let me = members.find((m) => m.id === user?.id);
    // If members haven't loaded yet, fetch directly
    if (!me) {
      try {
        const { data } = await api.get('/household');
        if (data.members) setMembers(data.members);
        me = data.members?.find((m) => m.id === user?.id);
      } catch {
        // Fall back to auth context
      }
    }
    setProfileName(me?.name || user?.name || '');
    setProfileRole(me?.family_role || '');
    setProfileBirthday(me?.birthday || '');
    setProfileColor(me?.color_theme || user?.color_theme || 'sage');
    setProfileReminderTime(me?.reminder_time ? me.reminder_time.substring(0, 5) : '');
    setProfileAvatar(me?.avatar_url || user?.avatar_url || null);
    setEditingProfile(true);
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);
      const { data } = await api.post('/household/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfileAvatar(data.avatar_url);
      await loadMembers();
      login({ token, user: { ...user, avatar_url: data.avatar_url }, household });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true);
    try {
      await api.delete('/household/profile/avatar');
      setProfileAvatar(null);
      await loadMembers();
      login({ token, user: { ...user, avatar_url: null }, household });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSaveProfile() {
    if (!profileName.trim()) { setError('Name is required.'); return; }
    setSavingProfile(true);
    try {
      await api.patch('/household/profile', {
        name: profileName.trim(),
        family_role: profileRole.trim(),
        birthday: profileBirthday || null,
        color_theme: profileColor,
        reminder_time: profileReminderTime || null,
      });
      await loadMembers();
      const updatedUser = { ...user, name: profileName.trim(), color_theme: profileColor };
      login({ token, user: updatedUser, household });
      setEditingProfile(false);
      setSuccess('Profile updated!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  }

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
      const { data } = await api.post('/auth/whatsapp-verify-code', { code: whatsappCode.trim() });
      if (data?.bot_number) setWhatsappBotNumber(data.bot_number);
      setSuccess("WhatsApp connected! We've sent you a welcome message — tap the button below to open the chat.");
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

  // ── Active sessions ──────────────────────────────────────────────
  // Pulls the caller's live refresh tokens from /api/auth/sessions with
  // device + IP + last-used metadata, lets them revoke any of them, and
  // offers a 'sign out everywhere else' shortcut.

  function loadSessions() {
    setLoadingSessions(true);
    const refreshToken = (() => {
      try { return localStorage.getItem('refreshToken') || ''; } catch { return ''; }
    })();
    return api
      .get('/auth/sessions', {
        // Passed as a header so the server can mark the current row —
        // the raw token never appears in the response.
        headers: refreshToken ? { 'X-Refresh-Token': refreshToken } : {},
      })
      .then(({ data }) => setSessions(data.sessions || []))
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false));
  }

  useEffect(() => { loadSessions(); }, []);

  async function handleRevokeSession(sessionId, isCurrent) {
    if (isCurrent) {
      if (!window.confirm('This is your current session — revoking will sign you out of this browser. Continue?')) return;
    }
    setRevokingSessionId(sessionId);
    setError('');
    try {
      await api.delete(`/auth/sessions/${sessionId}`);
      if (isCurrent) {
        // Revoked the session we're using — force a fresh login. Clears
        // tokens locally too in case the refresh interceptor misses it.
        try { localStorage.removeItem('token'); localStorage.removeItem('refreshToken'); } catch { /* noop */ }
        window.location.href = '/login';
        return;
      }
      await loadSessions();
      setSuccess('Session revoked.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not revoke that session.');
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeAllOthers() {
    if (!window.confirm('Revoke every other device signed into your account? You\'ll stay signed in here.')) return;
    setRevokingAllOthers(true);
    setError('');
    try {
      await api.delete('/auth/sessions?except=current', {
        headers: (() => {
          try {
            const rt = localStorage.getItem('refreshToken');
            return rt ? { 'X-Refresh-Token': rt } : {};
          } catch { return {}; }
        })(),
      });
      await loadSessions();
      setSuccess('All other sessions revoked.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not revoke other sessions.');
    } finally {
      setRevokingAllOthers(false);
    }
  }

  // Turn a user-agent string into a short, readable label. UA parsing is
  // famously unreliable — we only try to catch the common cases and fall
  // back to "Unknown device" rather than risking nonsense.
  function describeDevice(ua) {
    if (!ua) return 'Unknown device';
    const s = String(ua);
    const platform =
      /iPad/i.test(s) ? 'iPad' :
      /iPhone/i.test(s) ? 'iPhone' :
      /Android/i.test(s) ? 'Android' :
      /Macintosh|Mac OS X/i.test(s) ? 'Mac' :
      /Windows/i.test(s) ? 'Windows' :
      /Linux/i.test(s) ? 'Linux' :
      '';
    const browser =
      /Capacitor/i.test(s) ? 'Housemait app' :
      /Edg\//i.test(s) ? 'Edge' :
      /Chrome\//i.test(s) && !/Edg\//i.test(s) ? 'Chrome' :
      /Firefox\//i.test(s) ? 'Firefox' :
      /Safari\//i.test(s) ? 'Safari' :
      'Browser';
    if (platform && browser) return `${browser} on ${platform}`;
    return platform || browser || 'Unknown device';
  }

  function formatWhen(iso) {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // ── Export my data (GDPR Article 20) ─────────────────────────────
  // Downloads a JSON file with every row Housemait holds about the user
  // and their household. The endpoint sets Content-Disposition; we also
  // do a belt-and-braces Blob + anchor download so Capacitor/iOS and any
  // odd browser picks it up reliably.
  async function handleExportData() {
    setError('');
    setSuccess('');
    setExporting(true);
    try {
      const { data } = await api.get('/auth/export');
      const filename = `housemait-export-${new Date().toISOString().split('T')[0]}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Give the browser a tick before revoking so the download kicks in.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSuccess('Export downloaded.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not generate your data export.');
    } finally {
      setExporting(false);
    }
  }

  // ── Delete account ───────────────────────────────────────────────
  // Re-posts the user's password to the server for re-auth, then the
  // server decides whether to delete just this user or the whole
  // household (sole-member case). On success we clear the local auth
  // state and send the user back to the landing page — from their
  // perspective they're logged out, because their session no longer
  // corresponds to a valid user row.
  async function handleDeleteAccount() {
    setDeleteError('');
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    if (!deleteConfirmed) {
      setDeleteError('Please confirm you understand this cannot be undone.');
      return;
    }
    setDeleting(true);
    try {
      await api.delete('/auth/account', { data: { password: deletePassword } });
      // Clear the auth context without calling the server's /auth/logout
      // endpoint — the refresh token we'd post there was just deleted with
      // the rest of our data, so attempting it would 404.
      logout();
      navigate('/', { replace: true });
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Could not delete your account. Please try again.');
    } finally {
      setDeleting(false);
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

  // Build receipt email address from household token — fetch fresh if not in context
  useEffect(() => {
    if (household?.inbound_email_token) {
      setReceiptEmail(`${household.inbound_email_token}@inbound.housemait.com`);
    } else {
      // Token might not be in the cached auth context — fetch fresh from API
      api.get('/household').then(({ data }) => {
        if (data.household?.inbound_email_token) {
          setReceiptEmail(`${data.household.inbound_email_token}@inbound.housemait.com`);
        }
      }).catch(() => {});
    }
  }, [household?.inbound_email_token]);

  function handleCopyReceiptEmail() {
    navigator.clipboard.writeText(receiptEmail).then(() => {
      setReceiptCopied(true);
      setTimeout(() => setReceiptCopied(false), 2000);
    });
  }

  async function handleRegenerateReceiptEmail() {
    if (!window.confirm('Regenerate your receipt email address? The old address will stop working.')) return;
    setRegeneratingReceipt(true);
    setReceiptCopied(false);
    try {
      const { data } = await api.post('/household/regenerate-email-address');
      setReceiptEmail(data.receipt_email);
      setSuccess('Receipt email address regenerated.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not regenerate receipt email.');
    } finally {
      setRegeneratingReceipt(false);
    }
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
    } catch (err) {
      const msg = err.response?.status === 404
        ? 'Calendar not connected. Please reconnect first.'
        : err.message?.includes('timed out')
          ? 'Connection to Apple timed out. Please try again.'
          : 'Could not load calendars. Please try again.';
      setError(msg);
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
    if (!window.confirm(`Disconnect ${provider.charAt(0).toUpperCase() + provider.slice(1)} Calendar? All synced events from this calendar will be removed.`)) return;
    try {
      await api.delete(`/calendar/connections/${provider}`);
      // Optimistically update, then verify from the server
      setCalConnections(prev => prev.filter(c => c.provider !== provider));
      setSuccess(`${provider.charAt(0).toUpperCase() + provider.slice(1)} Calendar disconnected.`);
      // Re-fetch to confirm it's actually gone
      await loadConnections();
    } catch (err) {
      setError('Could not disconnect calendar. Please try again.');
      // Re-fetch to show actual state
      await loadConnections();
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1
        className="text-[38px] font-normal leading-none text-bark"
        style={{ fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif' }}
      >
        Settings
      </h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* My profile */}
      {(() => {
        const me = members.find((m) => m.id === user?.id);
        const ac = avatarColors[me?.color_theme || user?.color_theme] || avatarColors.teal;
        return (
          <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
            <h2 className="font-semibold text-bark mb-3">My profile</h2>
            <div className="flex items-center gap-4">
              {(me?.avatar_url || user?.avatar_url) ? (
                <img src={me?.avatar_url || user?.avatar_url} alt={user?.name} className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className={`w-12 h-12 rounded-full ${ac} flex items-center justify-center font-bold text-lg`}>
                  {user?.name?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1">
                <p className="font-medium text-bark">{user?.name}</p>
                {me?.family_role && <p className="text-xs text-cocoa">{me.family_role}</p>}
              </div>
              <button
                onClick={openEditProfile}
                className="flex items-center gap-1.5 border border-cream-border text-cocoa font-medium px-4 py-2 rounded-xl text-sm hover:bg-oat transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
                Edit
              </button>
            </div>
          </div>
        );
      })()}

      {/* Connect WhatsApp */}
      <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          Connect WhatsApp
        </h2>
        {members.find((m) => m.id === user?.id)?.whatsapp_linked ? (
          <div className="space-y-3">
            <p className="text-sm text-success bg-success/10 rounded-2xl px-3 py-2">
              WhatsApp connected! You'll receive reminders and can message the bot.
            </p>
            {whatsappBotNumber && (
              <a
                href={`https://wa.me/${whatsappBotNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-2 rounded-2xl transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Open in WhatsApp
              </a>
            )}
            <button
              onClick={handleDisconnectWhatsapp}
              disabled={disconnectingWhatsapp}
              className="block text-sm text-cocoa hover:text-error transition-colors"
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
      <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
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

      {/* Email Forwarding */}
      <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">
          <svg className="h-4 w-4 text-plum" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          </svg>
          Email Forwarding
        </h2>
        <p className="text-sm text-cocoa mb-3">
          Forward any email to your household's unique address and our AI will automatically extract the details — receipts, flight bookings, school newsletters, appointment reminders, and more.
        </p>
        {receiptEmail ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={receiptEmail}
                className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-sm bg-oat text-cocoa select-all"
                onClick={(e) => e.target.select()}
              />
              <button
                onClick={handleCopyReceiptEmail}
                className="bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors whitespace-nowrap"
              >
                {receiptCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="text-xs text-cocoa space-y-1">
              <p className="font-medium text-cocoa">What you can forward:</p>
              <p>🛒 <strong>Receipts & orders</strong> — Tesco, Amazon, Deliveroo, Uber Eats → items added to shopping list</p>
              <p>✈️ <strong>Travel bookings</strong> — flights, hotels, train tickets → added to calendar</p>
              <p>🏫 <strong>School emails</strong> — newsletters, term dates, trips → events added to calendar</p>
              <p>🏥 <strong>Appointments</strong> — dentist, doctor, vet → added to calendar</p>
              <p>🍽️ <strong>Reservations</strong> — restaurants, events, tickets → added to calendar</p>
            </div>
            {isAdmin && (
              <button
                onClick={handleRegenerateReceiptEmail}
                disabled={regeneratingReceipt}
                className="text-xs text-cocoa hover:text-error transition-colors"
              >
                {regeneratingReceipt ? 'Regenerating...' : 'Regenerate address'}
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-cocoa">
            Your household does not have a forwarding email address yet. It will be generated automatically.
          </p>
        )}
      </div>

      {/* Signed in as */}
      <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
        <h2 className="font-semibold text-bark mb-2 flex items-center gap-2"><IconUser className="h-4 w-4" /> You</h2>
        <p className="text-sm text-cocoa">
          Signed in as <span className="font-medium">{user?.name}</span>
          <span className="text-cocoa"> ({user?.role})</span>
        </p>
      </div>

      {/* Schools (admin only) */}
      {isAdmin && <SchoolsSection />}

      {/* Push Notifications — native app only */}
      {isNative && <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
        <h2 className="font-semibold text-bark mb-1 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          Push Notifications
        </h2>
        <p className="text-xs text-cocoa mb-4">Choose which notifications you receive on your phone.</p>
        {loadingNotifPrefs ? (
          <div className="py-4 text-center text-sm text-cocoa">Loading...</div>
        ) : notifPrefs ? (
          <div className="space-y-1">
            {[
              { key: 'calendar_reminders', label: 'Calendar reminders', desc: 'New events and upcoming reminders' },
              { key: 'task_assigned', label: 'Task assignments', desc: 'When a task is assigned to you' },
              { key: 'shopping_updated', label: 'Shopping list updates', desc: 'When someone adds to the shopping list' },
              { key: 'meal_plan_updated', label: 'Meal plan changes', desc: 'When the meal plan is updated' },
              { key: 'family_activity', label: 'Family activity', desc: 'New members and household updates' },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between py-3 px-1">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-bark">{label}</p>
                  <p className="text-xs text-cocoa">{desc}</p>
                </div>
                <button
                  onClick={() => toggleNotifPref(key)}
                  disabled={savingNotifPref === key}
                  className={`relative shrink-0 ml-3 w-11 h-6 rounded-full transition-colors duration-200 ${
                    notifPrefs[key] ? 'bg-primary' : 'bg-sand'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                      notifPrefs[key] ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>}

      {/* Log out */}
      <button
        onClick={() => { logout(); navigate('/'); }}
        className="w-full py-3 rounded-2xl border border-error/30 text-error font-semibold text-sm hover:bg-error/5 transition-colors"
      >
        Log out
      </button>

      {/* Your data — GDPR right to portability (Article 20). Sits above
          the danger zone because it's a non-destructive action and should
          be the first thing users see in the "my rights" area. */}
      <section className="mt-2 rounded-2xl p-5 border border-cream-border bg-white">
        <h2 className="text-base font-semibold text-bark mb-1">Your data</h2>
        <p className="text-sm text-cocoa">
          Download a JSON file with every row Housemait holds about you and
          your household — tasks, events, shopping lists, notes, documents
          metadata, message history. Safe to generate any time; nothing is
          deleted.
        </p>
        <button
          type="button"
          onClick={handleExportData}
          disabled={exporting}
          className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl border border-cream-border text-bark hover:bg-cream font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? 'Preparing…' : 'Export my data'}
        </button>
      </section>

      {/* Active sessions — lets users see + revoke live refresh tokens.
          Sits between "Your data" (non-destructive GDPR surface) and the
          delete-account danger zone since it's security-adjacent but
          non-destructive to the account itself. */}
      <section className="mt-2 rounded-2xl p-5 border border-cream-border bg-white">
        <h2 className="text-base font-semibold text-bark mb-1">Active sessions</h2>
        <p className="text-sm text-cocoa">
          Everywhere you're signed into Housemait right now. Revoke any you
          don't recognise — the device gets signed out immediately.
        </p>

        <div className="mt-4 space-y-2">
          {loadingSessions ? (
            <p className="text-sm text-cocoa">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-cocoa">No active sessions found.</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-cream-border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-bark truncate">
                    {describeDevice(s.userAgent)}
                    {s.isCurrent && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-plum-light text-plum">
                        This session
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-cocoa mt-0.5">
                    {s.ipAddress || 'Unknown IP'} · Last used {formatWhen(s.lastUsedAt)}
                    {s.createdAt && <> · Signed in {formatWhen(s.createdAt)}</>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeSession(s.id, s.isCurrent)}
                  disabled={revokingSessionId === s.id}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-cream-border text-sm font-medium text-bark hover:bg-cream disabled:opacity-50 transition-colors"
                >
                  {revokingSessionId === s.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bulk action — show only when more than one session exists. */}
        {sessions.length > 1 && (
          <button
            type="button"
            onClick={handleRevokeAllOthers}
            disabled={revokingAllOthers}
            className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl border border-cream-border text-bark hover:bg-cream font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {revokingAllOthers ? 'Revoking…' : 'Revoke all other sessions'}
          </button>
        )}
      </section>

      {/* Danger zone — delete account. Placed last so it's below the
          mostly-safe Log out affordance and visually separated. */}
      <section
        className="mt-2 rounded-2xl p-5 border"
        style={{ borderColor: 'rgba(215, 99, 83, 0.25)', background: 'rgba(215, 99, 83, 0.04)' }}
      >
        <h2 className="text-base font-semibold text-bark mb-1">Delete account</h2>
        <p className="text-sm text-cocoa">
          Permanently delete your Housemait account. If you're the only
          member of your household, <strong className="text-bark">everything in it</strong>{' '}
          — tasks, events, shopping lists, notes, documents — will also be
          deleted. This cannot be undone.
        </p>
        <button
          onClick={() => {
            setDeleteOpen(true);
            setDeletePassword('');
            setDeleteConfirmed(false);
            setDeleteError('');
          }}
          className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-error hover:bg-error/90 text-white font-semibold text-sm transition-colors"
        >
          Delete my account
        </button>
      </section>

      {/* Delete Account Modal */}
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !deleting && setDeleteOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-bark">Delete your account?</h2>
              <button
                type="button"
                onClick={() => !deleting && setDeleteOpen(false)}
                className="text-cocoa hover:text-bark p-1"
                disabled={deleting}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-cocoa mb-4">
              This permanently deletes your Housemait account. If you're the only
              member of <strong className="text-bark">{household?.name || 'your household'}</strong>,
              the household and all its data will be deleted too.
            </p>

            {deleteError && (
              <div className="mb-3 p-3 rounded-lg bg-error/10 border border-error/30 text-sm text-error">
                {deleteError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleDeleteAccount();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-bark mb-1.5">
                  Your password
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  disabled={deleting}
                  className="w-full border border-cream-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition-all text-bark"
                />
              </div>

              <label className="flex items-start gap-3 text-sm text-bark cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deleteConfirmed}
                  onChange={(e) => setDeleteConfirmed(e.target.checked)}
                  disabled={deleting}
                  className="mt-1 h-4 w-4 accent-error"
                />
                <span>
                  I understand this cannot be undone.
                </span>
              </label>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-xl border border-cream-border text-bark font-medium text-sm hover:bg-cream transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleting || !deletePassword || !deleteConfirmed}
                  className="flex-1 py-3 rounded-xl bg-error hover:bg-error/90 disabled:bg-error/40 text-white font-semibold text-sm transition-colors"
                >
                  {deleting ? 'Deleting…' : 'Delete account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingProfile(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-bark">Edit profile</h2>
              <button onClick={() => setEditingProfile(false)} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Avatar upload */}
              <div className="flex flex-col items-center gap-2">
                {profileAvatar ? (
                  <img src={profileAvatar} alt={profileName} className="w-20 h-20 rounded-full object-cover" />
                ) : (
                  <div className={`w-20 h-20 rounded-full ${
                    avatarColors[profileColor] || avatarColors.teal
                  } flex items-center justify-center font-bold text-2xl`}>
                    {profileName?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className={`text-sm font-medium cursor-pointer ${uploadingAvatar ? 'text-cocoa' : 'text-primary hover:text-primary-pressed'} transition-colors`}>
                    {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} disabled={uploadingAvatar} className="hidden" />
                  </label>
                  {profileAvatar && (
                    <button type="button" onClick={handleAvatarRemove} disabled={uploadingAvatar} className="text-sm text-error hover:text-error/80 transition-colors">
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Name <span className="text-error">*</span></label>
                <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="Your name" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Family role</label>
                <input type="text" value={profileRole} onChange={(e) => setProfileRole(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="e.g. Father, Mother, Daughter" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Birthday</label>
                <input type="date" value={profileBirthday} onChange={(e) => setProfileBirthday(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1.5">Colour theme</label>
                <div className="grid grid-cols-8 gap-2.5">
                  {[
                    { key: 'red',           bg: 'bg-red',           ring: 'ring-red' },
                    { key: 'burnt-orange',  bg: 'bg-burnt-orange',  ring: 'ring-burnt-orange' },
                    { key: 'amber',         bg: 'bg-amber',         ring: 'ring-amber' },
                    { key: 'gold',          bg: 'bg-gold',          ring: 'ring-gold' },
                    { key: 'leaf',          bg: 'bg-leaf',          ring: 'ring-leaf' },
                    { key: 'emerald',       bg: 'bg-emerald',       ring: 'ring-emerald' },
                    { key: 'teal',          bg: 'bg-teal',          ring: 'ring-teal' },
                    { key: 'sky',           bg: 'bg-sky',           ring: 'ring-sky' },
                    { key: 'cobalt',        bg: 'bg-cobalt',        ring: 'ring-cobalt' },
                    { key: 'indigo',        bg: 'bg-indigo',        ring: 'ring-indigo' },
                    { key: 'purple',        bg: 'bg-purple',        ring: 'ring-purple' },
                    { key: 'magenta',       bg: 'bg-magenta',       ring: 'ring-magenta' },
                    { key: 'rose',          bg: 'bg-rose',          ring: 'ring-rose' },
                    { key: 'terracotta',    bg: 'bg-terracotta',    ring: 'ring-terracotta' },
                    { key: 'moss',          bg: 'bg-moss',          ring: 'ring-moss' },
                    { key: 'slate',         bg: 'bg-slate',         ring: 'ring-slate' },
                  ].map(({ key, bg, ring }) => (
                    <button key={key} type="button" onClick={() => setProfileColor(key)}
                      className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center transition-all ${profileColor === key ? `ring-2 ${ring} ring-offset-2` : 'hover:scale-110'}`}
                      title={key.charAt(0).toUpperCase() + key.slice(1)}
                    >
                      {profileColor === key && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white drop-shadow" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-bark mb-1">Daily reminder time</label>
                <input type="time" value={profileReminderTime} onChange={(e) => setProfileReminderTime(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
                <p className="text-xs text-cocoa mt-1">
                  {profileReminderTime ? 'Your personal reminder time.' : `Using household default (${household?.reminder_time?.slice(0, 5) || '08:00'}).`}
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setEditingProfile(false)} className="flex-1 border border-cream-border text-cocoa font-medium py-2.5 rounded-2xl hover:bg-sand transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveProfile} disabled={savingProfile} className="flex-1 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-2.5 rounded-2xl transition-colors">
                {savingProfile ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Schools management section for Settings (admin only).
 * Shows all linked schools with children, term date source, and calendar colour.
 */
function SchoolsSection() {
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/schools')
      .then(({ data }) => setSchools(data.schools || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (schools.length === 0) return null;

  return (
    <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
      <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">🏫 Schools</h2>
      <p className="text-xs text-cocoa mb-3">Schools connected to your household. Manage term dates and calendar feeds from the Family page.</p>
      <div className="space-y-3">
        {schools.map(school => (
          <div key={school.id} className="bg-white rounded-xl border border-cream-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-bark">{school.school_name}</p>
                <p className="text-xs text-cocoa">
                  {school.school_type && `${school.school_type} · `}
                  {school.local_authority && `${school.local_authority} · `}
                  {school.postcode}
                </p>
              </div>
              <div className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: school.colour || '#4A90D9' }} />
            </div>
            {/* Children at this school */}
            {school.children?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {school.children.map(c => (
                  <span key={c.id} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky/15 text-sky">
                    {c.name}{c.year_group ? ` · ${c.year_group}` : ''}
                  </span>
                ))}
              </div>
            )}
            {/* Term dates count */}
            <p className="text-[11px] text-cocoa mt-2">
              {school.term_dates?.length || 0} term dates · {school.ical_url ? 'iCal connected' : 'Manual dates'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
