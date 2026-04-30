import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import { IconSettings, IconUser, IconCalendar } from '../components/Icons';
import { TrialIndicatorSubtle } from '../components/TrialIndicator';
import { useSubscription } from '../context/SubscriptionContext';
import { isIos } from '../lib/platform';

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

/**
 * Settings → Plan card. Renders subscription state + the right CTA for
 * the current status. Extracted into its own component so the Settings
 * page layout stays readable; it only reads from SubscriptionContext
 * and doesn't need any props.
 *
 *   • internal  → "Internal account — unlimited access"
 *   • trialing  → "Free trial · X days left" + Subscribe CTA
 *   • active    → Plan name + "Manage subscription" (opens Stripe Portal)
 *   • expired   → "Your subscription has ended" + Subscribe CTA
 *   • cancelled → same as expired
 *   • loading   → subtle loading state (no spinner — this card is ambient)
 */
function PlanSection() {
  const { isActive, isTrialing, isExpired, isInternal, plan, daysRemaining, trialEndsAt, loading } = useSubscription();
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');

  // App Store guideline 3.1.1: don't surface ANY plan / subscription /
  // pricing / entitlement state on iOS. Even the "Internal" badge or a
  // bare "Active" string has been called out by reviewers as "accessing
  // paid content". Hide the section entirely; iOS users manage billing
  // on web (or not at all). See SubscriptionContext for the matching
  // backend short-circuit.
  // Hook calls must come first (rules-of-hooks), so we early-return here.
  if (isIos()) return null;

  // NB: there's no "trial reminder emails" toggle here. PECR covers us
  // as long as the email-footer unsubscribe link works, and the footer
  // link already flips trial_emails_enabled=false via /api/unsubscribe.
  // Surfacing a duplicate toggle in Settings didn't add value and gave
  // users two ways to disable (one of which only they'd discover).
  // If you ever want to re-add it, the PATCH /api/settings/settings
  // endpoint still accepts trial_emails_enabled — just wire a UI back.

  async function openCustomerPortal() {
    if (portalLoading) return;
    setPortalLoading(true);
    setPortalError('');
    try {
      const { data } = await api.post('/subscription/portal');
      if (!data?.url) throw new Error('Portal URL missing');
      window.location.href = data.url;
    } catch (err) {
      console.error('[Settings] portal open failed:', err);
      setPortalError(err.response?.data?.error || 'Could not open the portal. Try again?');
      setPortalLoading(false);
    }
  }

  // Don't render anything while we don't know the state yet — the subtle
  // indicator in My profile covers the "I know nothing" case silently.
  if (loading && !isActive && !isTrialing && !isExpired && !isInternal) return null;

  return (
    <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
      <h2 className="font-semibold text-bark mb-3">Plan</h2>

      {isInternal && (
        <p className="text-sm text-cocoa">
          <span className="inline-block bg-plum-light text-plum font-semibold text-xs px-2 py-0.5 rounded mr-2">
            Internal
          </span>
          Unlimited access. No billing applies to this household.
        </p>
      )}

      {!isInternal && isTrialing && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-cocoa">
              <strong className="text-plum font-semibold">Free trial</strong>
              {daysRemaining != null && (
                <span> · {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} left</span>
              )}
              {trialEndsAt && (
                <span className="text-warm-grey">
                  {' '}(ends {new Intl.DateTimeFormat('en-GB', {
                    day: 'numeric', month: 'long', timeZone: 'Europe/London',
                  }).format(new Date(trialEndsAt))})
                </span>
              )}
            </p>
            {/* On iOS, no subscribe steering text — App Review rejected
                "Subscribe on housemait.com" as anti-steering. iOS users
                see only the entitlement status; they're expected to find
                the website themselves if they want to subscribe. */}
            {!isIos() && (
              <p className="text-xs text-warm-grey mt-1">
                Subscribe any time to avoid interruption.
              </p>
            )}
          </div>
          {!isIos() && (
            <Link
              to="/subscribe"
              className="inline-flex items-center px-4 py-2 rounded-xl bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
            >
              Subscribe
            </Link>
          )}
        </div>
      )}

      {!isInternal && isActive && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-cocoa">
              <strong className="text-emerald font-semibold">Active</strong>
              {/* On iOS, show only the entitlement status — no plan name,
                  no price, no Stripe portal link. App Review rejected the
                  "Annual plan (£49.90/year)" string + "housemait.com"
                  steering as Guideline 3.1.1 violations. */}
              {!isIos() && plan && (
                <span className="text-charcoal">
                  {' '}· {plan === 'annual' ? 'Annual plan (£49.90/year)' : 'Monthly plan (£4.99/month)'}
                </span>
              )}
            </p>
            {!isIos() && (
              <p className="text-xs text-warm-grey mt-1">
                Update card, switch plans, or cancel anytime from the Stripe portal.
              </p>
            )}
          </div>
          {!isIos() && (
            <button
              type="button"
              onClick={openCustomerPortal}
              disabled={portalLoading}
              className="inline-flex items-center px-4 py-2 rounded-xl border-[1.5px] border-plum text-plum hover:bg-plum-light text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {portalLoading ? 'Opening…' : 'Manage subscription'}
            </button>
          )}
        </div>
      )}

      {!isInternal && isExpired && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-cocoa">
              <strong className="text-coral font-semibold">Subscription ended</strong>
            </p>
            <p className="text-xs text-warm-grey mt-1">
              {isIos()
                ? "Your data's still here."
                : "Your data's still here. Subscribe to unlock everything again."}
            </p>
          </div>
          {!isIos() && (
            <Link
              to="/subscribe"
              className="inline-flex items-center px-4 py-2 rounded-xl bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
            >
              Subscribe
            </Link>
          )}
        </div>
      )}

      {portalError && (
        <p className="text-sm text-coral mt-3">{portalError}</p>
      )}
    </div>
  );
}

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
  const [deleteTypedConfirm, setDeleteTypedConfirm] = useState(''); // must equal "DELETE"
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

  // External (inbound) calendar feeds — Cozi/FamilyWall-style read-only
  // subscriptions to the user's Apple/Google/Outlook calendar via iCal URL.
  // Replaces the old two-way sync entirely.
  const [externalFeeds, setExternalFeeds] = useState([]);
  const [loadingExternalFeeds, setLoadingExternalFeeds] = useState(false);
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedName, setNewFeedName] = useState('');
  const [addingFeed, setAddingFeed] = useState(false);
  const [feedActionId, setFeedActionId] = useState(null); // id of feed currently being refreshed/removed

  // Receipt email forwarding state
  const [receiptEmail, setReceiptEmail] = useState('');
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [regeneratingReceipt, setRegeneratingReceipt] = useState(false);

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
  // Fetch existing feed token on mount without creating one. We need this
  // for the mutual-exclusivity warning: if both feed and connections are
  // active, surface a banner so the user can pick one. Calling the regular
  // /feed-token endpoint would auto-create the token, so we use the
  // dedicated /status endpoint that returns null when none exists.
  useEffect(() => {
    api.get('/calendar/feed-token/status')
      .then(({ data }) => {
        if (data?.exists) {
          setFeedUrl(data.feedUrl);
        }
      })
      .catch(() => {});
  }, []);

  // (Two-way sync removed — the loadConnections + OAuth callback handler
  // for ?connected=<provider> are no longer needed. Inbound subscriptions
  // are managed via the read-only feed flow further down in this file.)

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
    if (deleteTypedConfirm !== 'DELETE') {
      setDeleteError('Type DELETE (in capitals) to confirm.');
      return;
    }
    if (!deleteConfirmed) {
      setDeleteError('Please confirm you understand this cannot be undone.');
      return;
    }
    setDeleting(true);
    try {
      // Backend requires BOTH the password and the literal string
      // "DELETE" — matches the two-factor feel of a destructive action.
      await api.delete('/auth/account', { data: { password: deletePassword, confirmation: 'DELETE' } });
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

  /**
   * Revoke the feed token. Used both by the "Disable feed" button under
   * the feed URL (added when a two-way sync is also active) and by the
   * mutual-exclusivity banner's "remove feed" action.
   */
  async function handleRemoveFeed() {
    if (!window.confirm('Disable the read-only calendar feed? Anyone subscribed to the feed URL will stop receiving updates.')) return;
    setError('');
    setLoadingFeed(true);
    try {
      await api.delete('/calendar/feed-token');
      setFeedUrl('');
      setSuccess('Calendar feed disabled.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not disable calendar feed.');
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

  // ── External feed subscriptions (read-only inbound) ────────────────────────
  async function loadExternalFeeds() {
    setLoadingExternalFeeds(true);
    try {
      const { data } = await api.get('/calendar/external-feeds');
      setExternalFeeds(data?.feeds || []);
    } catch {
      // Non-fatal: leave the list empty
    } finally {
      setLoadingExternalFeeds(false);
    }
  }
  useEffect(() => { loadExternalFeeds(); }, []);

  async function handleAddExternalFeed(e) {
    e.preventDefault();
    if (!newFeedUrl.trim() || !newFeedName.trim()) {
      setError('URL and name are required.');
      return;
    }
    setAddingFeed(true);
    setError('');
    try {
      const { data } = await api.post('/calendar/external-feeds', {
        feed_url: newFeedUrl.trim(),
        display_name: newFeedName.trim(),
      });
      setExternalFeeds(prev => [...prev, data.feed]);
      const stats = data.refresh;
      const summary = stats
        ? `Subscribed — pulled ${stats.fetched} event${stats.fetched === 1 ? '' : 's'}.`
        : 'Subscribed.';
      setSuccess(summary);
      setNewFeedUrl('');
      setNewFeedName('');
      setShowAddFeed(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add calendar feed.');
    } finally {
      setAddingFeed(false);
    }
  }

  async function handleRefreshExternalFeed(id) {
    setFeedActionId(id);
    setError('');
    try {
      const { data } = await api.post(`/calendar/external-feeds/${id}/refresh`);
      const stats = data?.refresh || {};
      setSuccess(
        `Refreshed: ${stats.created || 0} new, ${stats.updated || 0} updated, ${stats.deleted || 0} removed.`
      );
      // Update last_synced_at locally so the UI reflects the new state without a re-fetch.
      setExternalFeeds(prev => prev.map(f => f.id === id
        ? { ...f, last_synced_at: new Date().toISOString(), last_error: null, consecutive_failures: 0 }
        : f
      ));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not refresh feed.');
      // Re-load to pick up the failure counter the server bumped.
      loadExternalFeeds();
    } finally {
      setFeedActionId(null);
    }
  }

  async function handleRemoveExternalFeed(id) {
    if (!window.confirm('Remove this calendar subscription? Its events will disappear from Housemait. You can re-add the URL anytime.')) return;
    setFeedActionId(id);
    setError('');
    try {
      await api.delete(`/calendar/external-feeds/${id}`);
      setExternalFeeds(prev => prev.filter(f => f.id !== id));
      setSuccess('Calendar subscription removed.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove feed.');
    } finally {
      setFeedActionId(null);
    }
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


  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1
        className="flex text-[36px] font-normal leading-none text-bark items-center gap-2"
        style={{ fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif' }}
      >
        <div
          className="hidden md:flex"
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '12px',
            background: '#f1eef8',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <IconSettings className="h-5 w-5 text-plum" />
        </div>
        Settings
      </h1>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* My profile */}
      {(() => {
        const me = members.find((m) => m.id === user?.id);
        const ac = avatarColors[me?.color_theme || user?.color_theme] || avatarColors.teal;
        return (
          <div className="bg-linen rounded-2xl p-5 shadow-[0_2px_8px_rgba(107,63,160,0.06)]">
            <div className="flex items-start justify-between mb-3">
              <h2 className="font-semibold text-bark">My profile</h2>
              {/* Subtle trial indicator — renders nothing unless the household
                  is trialing. Safe to leave always-mounted; the component
                  guards its own visibility. */}
              <TrialIndicatorSubtle />
            </div>
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

      {/* Plan / subscription */}
      <PlanSection />

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
                className="inline-flex items-center gap-2 bg-[#51ad50] hover:bg-[#418c40] disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors whitespace-nowrap"
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
            <div className="flex gap-3">
              <button
                onClick={handleRegenerateFeed}
                disabled={loadingFeed}
                className="text-xs text-cocoa hover:text-error transition-colors"
              >
                {loadingFeed ? 'Regenerating…' : 'Regenerate URL'}
              </button>
              <button
                onClick={handleRemoveFeed}
                disabled={loadingFeed}
                className="text-xs text-cocoa hover:text-error transition-colors"
              >
                Disable feed
              </button>
            </div>
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

        {/* External feed subscriptions (read-only inbound) */}
        <div className="mt-5 pt-5 border-t border-cream-border">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-bark">Subscribed calendars</p>
            {!showAddFeed && (
              <button
                onClick={() => setShowAddFeed(true)}
                className="text-xs text-primary hover:text-primary-pressed font-medium"
              >
                + Add calendar
              </button>
            )}
          </div>
          <p className="text-xs text-cocoa mb-3">
            Show events from another calendar (Apple, Google, Outlook, school, sports) inside Housemait. Read-only — edits happen in the source calendar.
          </p>

          {showAddFeed && (
            <form onSubmit={handleAddExternalFeed} className="border border-cream-border rounded-2xl p-3 space-y-2 mb-3">
              <input
                type="text"
                placeholder="Calendar name (e.g. Work, School, Sasha's iCloud)"
                value={newFeedName}
                onChange={(e) => setNewFeedName(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                type="url"
                placeholder="https://… or webcal://… (iCal feed URL)"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-xs text-cocoa">
                <span className="font-medium">Apple:</span> sign in at <a href="https://www.icloud.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">iCloud.com</a> &rarr; Calendar &rarr; click the share icon next to your calendar &rarr; tick &ldquo;Public Calendar&rdquo; &rarr; copy URL.<br />
                <span className="font-medium">Google:</span> <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">calendar.google.com</a> &rarr; Settings for my calendars &rarr; pick a calendar &rarr; Integrate calendar &rarr; copy &ldquo;Secret address in iCal format&rdquo;.<br />
                <span className="font-medium">Outlook:</span> <a href="https://outlook.live.com/calendar" target="_blank" rel="noopener noreferrer" className="text-primary underline">outlook.live.com/calendar</a> &rarr; Settings &rarr; Shared calendars &rarr; Publish a calendar &rarr; pick &ldquo;Can view all details&rdquo; &rarr; copy ICS URL.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={addingFeed}
                  className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors"
                >
                  {addingFeed ? 'Adding…' : 'Subscribe'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddFeed(false); setNewFeedUrl(''); setNewFeedName(''); }}
                  className="text-sm text-cocoa hover:text-bark px-3"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {!showAddFeed && externalFeeds.length === 0 && !loadingExternalFeeds && (
            <p className="text-xs text-cocoa italic">No calendars subscribed yet.</p>
          )}

          {externalFeeds.length > 0 && (
            <ul className="space-y-2">
              {externalFeeds.map((feed) => (
                <li key={feed.id} className="bg-white border border-cream-border rounded-2xl px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-bark truncate">{feed.display_name}</p>
                      <p className="text-xs text-cocoa truncate">
                        {feed.last_synced_at
                          ? `Last refreshed ${new Date(feed.last_synced_at).toLocaleString()}`
                          : 'Never refreshed'}
                        {feed.last_error && ' · last error: ' + feed.last_error}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleRefreshExternalFeed(feed.id)}
                        disabled={feedActionId === feed.id}
                        className="text-xs text-primary hover:text-primary-pressed disabled:opacity-50"
                      >
                        {feedActionId === feed.id ? '…' : 'Refresh'}
                      </button>
                      <button
                        onClick={() => handleRemoveExternalFeed(feed.id)}
                        disabled={feedActionId === feed.id}
                        className="text-xs text-error hover:text-error/80 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
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
            setDeleteTypedConfirm('');
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

              {/* Typed-DELETE confirmation — matches the spec's two-step
                  destructive-action pattern (Phase 8 / GDPR). Input is
                  case-sensitive; the backend also enforces this. */}
              <div>
                <label className="block text-xs font-semibold text-bark mb-1.5">
                  Type <span className="font-mono bg-cream px-1.5 py-0.5 rounded">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteTypedConfirm}
                  onChange={(e) => setDeleteTypedConfirm(e.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                  disabled={deleting}
                  placeholder="DELETE"
                  className="w-full border border-cream-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition-all text-bark font-mono tracking-widest"
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
                  disabled={
                    deleting ||
                    !deletePassword ||
                    deleteTypedConfirm !== 'DELETE' ||
                    !deleteConfirmed
                  }
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
