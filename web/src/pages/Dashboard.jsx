import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import { DashboardSkeleton } from '../components/Skeleton';
import { BottomSheet } from '../components/BottomSheet';
import ErrorBanner from '../components/ErrorBanner';
import TrialIndicatorCard from '../components/TrialIndicator';
import { WriteGate } from '../components/SubscribePrompt';
import Avatar from '../components/ui/Avatar';
import { loadCached } from '../lib/offlineCache';
import { confirm as hapticConfirm } from '../lib/haptics';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
import { setBadgeCount } from '../lib/badge';
import WeatherStrip from '../components/WeatherStrip';
import AfterSchoolCard from '../components/AfterSchoolCard';
import { isIos } from '../lib/platform';

// ── Avatar colour map (same as Layout.jsx) ──────────────────────

// ── Event dot colour map ────────────────────────────────────────
const dotColors = {
  red: 'bg-red', 'burnt-orange': 'bg-burnt-orange', amber: 'bg-amber',
  gold: 'bg-gold', leaf: 'bg-leaf', emerald: 'bg-emerald', teal: 'bg-teal',
  sky: 'bg-sky', cobalt: 'bg-cobalt', indigo: 'bg-indigo', purple: 'bg-purple',
  magenta: 'bg-magenta', rose: 'bg-rose', terracotta: 'bg-terracotta',
  moss: 'bg-moss', slate: 'bg-slate', sage: 'bg-sage', plum: 'bg-plum',
  coral: 'bg-coral', lavender: 'bg-indigo',
  orange: 'bg-amber', blue: 'bg-sky', green: 'bg-sage', gray: 'bg-slate',
};

// ── Shopping aisle category badges (matches new aisle system) ───
const AISLE_BADGE = {
  'Produce':              { bg: 'bg-sage-light', text: 'text-[#4A7D50]', label: 'VEG' },
  'Meat & Seafood':       { bg: 'bg-coral-light', text: 'text-[#C4522A]', label: 'MEAT' },
  'Dairy & Eggs':         { bg: 'bg-plum-light', text: 'text-primary', label: 'DAIRY' },
  'Bakery':               { bg: 'bg-[#FFF4E6]', text: 'text-[#B8860B]', label: 'BAKERY' },
  'Pantry & Grains':      { bg: 'bg-[#FAEEDA]', text: 'text-[#854F0B]', label: 'PANTRY' },
  'Frozen Foods':         { bg: 'bg-[#E6F1FB]', text: 'text-[#185FA5]', label: 'FROZEN' },
  'Beverages':            { bg: 'bg-[#FDF0EB]', text: 'text-[#993C1D]', label: 'DRINKS' },
  'Household & Cleaning': { bg: 'bg-[#F3EDFC]', text: 'text-[#6B3FA0]', label: 'HOME' },
  'Personal Care':        { bg: 'bg-[#FDF0EB]', text: 'text-[#993C1D]', label: 'CARE' },
  'Other':                { bg: 'bg-oat',       text: 'text-cocoa',      label: 'OTHER' },
  // Legacy fallbacks
  'groceries':            { bg: 'bg-[#EDF5EE]', text: 'text-[#3A6B40]', label: 'GROCERY' },
  'household':            { bg: 'bg-[#F3EDFC]', text: 'text-[#6B3FA0]', label: 'HOME' },
};

function getCatBadge(cat) {
  if (!cat) return AISLE_BADGE.Other;
  return AISLE_BADGE[cat] || AISLE_BADGE[cat.toLowerCase()] || { bg: 'bg-oat', text: 'text-cocoa', label: cat.toUpperCase().slice(0, 6) };
}

// ── Helpers ─────────────────────────────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalMin = Math.round(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return hours === 1 ? '1 hr' : `${hours} hrs`;
  return hours === 1 ? `1 hr ${mins} min` : `${hours} hrs ${mins} min`;
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Friendly relative-date label for a task's due_date.
 * Returns { text, overdue } so the caller can red-tint overdue items.
 * Null due_date → null (no label to render).
 */
function formatTaskDueLabel(dueDateStr) {
  if (!dueDateStr) return null;
  // Parse as a local date (YYYY-MM-DD) so timezone doesn't shift it.
  const [y, m, d] = dueDateStr.split('T')[0].split('-').map(Number);
  if (!y || !m || !d) return null;
  const due = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays === 0) return { text: 'Today', overdue: false };
  if (diffDays === 1) return { text: 'Tomorrow', overdue: false };
  if (diffDays === -1) return { text: 'Yesterday', overdue: true };
  if (diffDays < -1) return { text: `${Math.abs(diffDays)} days overdue`, overdue: true };
  if (diffDays < 7) return { text: due.toLocaleDateString('en-GB', { weekday: 'long' }), overdue: false };
  return { text: due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), overdue: false };
}

// ── Calendar setup nudge ────────────────────────────────────────
// Soft banner giving a low-pressure entry point to calendar sync (the
// signup wizard deliberately has no calendar step - activation stays
// focused on WhatsApp pairing). Trigger is PER PERSON, not per household:
//
//   - iPhone app: shown until THIS user's phone feeds at least one
//     calendar - even when the rest of the household is already
//     connected. The whole point of device sync is each parent
//     connecting their own phone, so "someone else did it" must not
//     silence the prompt for the second parent.
//   - Web: shown only while the household has no calendar connections
//     at all (the web can't device-sync, so once anything is connected
//     there's nothing for this surface to add).
//
// Copy leads with the two-tap iPhone flow (the URL-subscription flow
// remains available inside Settings). Dismissal is per-user so one
// person's "Not now" doesn't hide it from everyone who shares the
// device... and the old pre-rename global key is still honoured so
// users who already dismissed it aren't re-prompted.
function CalendarSetupNudge() {
  const { user } = useAuth();
  const onIphone = isIos();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    // Dismissal checks first - cheap, no API call needed.
    try {
      if (localStorage.getItem('housemait_calendar_nudge_dismissed') === '1') return;
      if (localStorage.getItem(`housemait_calendar_nudge_dismissed:${user.id}`) === '1') return;
    } catch { return; }
    // Silently skips on transient API error (better to under-prompt than nag).
    api.get('/calendar/external-feeds')
      .then((res) => {
        const feeds = (res.data?.feeds || []).filter((f) => f.sync_enabled !== false);
        if (onIphone) {
          const minePresent = feeds.some((f) => f.source === 'device' && f.device_owner_user_id === user.id);
          if (!minePresent) setShow(true);
        } else if (feeds.length === 0) {
          setShow(true);
        }
      })
      .catch(() => { /* no-op */ });
  }, [user?.id, onIphone]);

  function dismiss() {
    try { localStorage.setItem(`housemait_calendar_nudge_dismissed:${user?.id}`, '1'); } catch { /* private mode */ }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      className="rounded-2xl p-4 mb-4 flex items-start gap-3"
      style={{ background: 'rgba(243, 237, 252, 0.55)', border: '1px solid rgba(107, 63, 160, 0.18)' }}
    >
      <div className="text-2xl leading-none mt-0.5" aria-hidden="true">📅</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-bark">
          {onIphone
            ? 'Put your calendar on the family calendar'
            : 'See work, school and family calendars in one place'}
        </p>
        <p className="text-xs text-cocoa mt-1 leading-relaxed">
          {onIphone
            ? 'Connect this iPhone’s calendars — iCloud, Google, Outlook — in two taps. Read-only: Housemait can never change or delete anything in them.'
            : 'Open Housemait on an iPhone to sync its calendars in two taps, or subscribe to a calendar by link right here.'}
        </p>
        <div className="mt-3 flex items-center gap-4">
          <Link to="/settings?section=calendars" className="text-xs font-semibold text-primary hover:underline">
            {onIphone ? 'Connect my calendars →' : 'Set up calendars →'}
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="text-xs text-cocoa hover:text-bark transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Promo "claim your discount" nudge ───────────────────────────
// Shown when the account signed up with a campaign promo (school-fair
// HILLELFEST etc.) and hasn't subscribed yet. Reminds them, through the
// trial, that a discount is waiting → /subscribe (web: auto-applied at
// checkout; iOS: the IosSubscribe "Redeem code" button). Dismissible.
function PromoClaimNudge() {
  const { user } = useAuth();
  const { isActive } = useSubscription();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('housemait_promo_nudge_dismissed') === '1'; } catch { return false; }
  });

  const promo = user?.signup_promo_code;
  if (!promo || isActive || dismissed) return null;

  function dismiss() {
    try { localStorage.setItem('housemait_promo_nudge_dismissed', '1'); } catch { /* private mode */ }
    setDismissed(true);
  }

  return (
    <div
      className="rounded-2xl p-4 mb-4 flex items-start gap-3"
      style={{ background: 'rgba(243, 237, 252, 0.7)', border: '1px solid rgba(107, 63, 160, 0.22)' }}
    >
      <div className="text-2xl leading-none mt-0.5" aria-hidden="true">🎁</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-bark">
          Your {promo} discount is ready
        </p>
        <p className="text-xs text-cocoa mt-1 leading-relaxed">
          Get 25% off your first year — plus 25% to the PTA — when you subscribe to the annual plan.
        </p>
        <div className="mt-3 flex items-center gap-4">
          <Link to="/subscribe" className="text-xs font-semibold text-primary hover:underline">
            Claim my discount →
          </Link>
          <button
            type="button"
            onClick={dismiss}
            className="text-xs text-cocoa hover:text-bark transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Chat Input ───────────────────────────────────────────────
function DashboardAiInput() {
  const aiInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  function handleAiSubmit(e) {
    e.preventDefault();
    const text = aiInputRef.current?.value?.trim();
    if (!text) return;
    aiInputRef.current.value = '';
    window.dispatchEvent(new CustomEvent('openChatWidget', { detail: { message: text } }));
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    window.dispatchEvent(new CustomEvent('openChatWidget', { detail: {} }));
    setTimeout(() => {
      const chatFileInput = document.querySelector('[data-chat-file-input]');
      if (chatFileInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        chatFileInput.files = dt.files;
        chatFileInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 500);
  }

  // Voice input. We record audio with MediaRecorder and transcribe it
  // server-side (Whisper), rather than the Web Speech API - which is NOT
  // available in the iOS Capacitor WKWebView (webkitSpeechRecognition is
  // undefined there), so the old approach did nothing on the iOS app.
  // MediaRecorder + getUserMedia DO work in WKWebView (Info.plist grants
  // NSMicrophoneUsageDescription). Tap once to start, again to stop.
  async function handleMicClick() {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    if (isTranscribing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert('Voice input isn’t available on this device.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('[voice] mic permission/error:', err);
      alert('I couldn’t access the microphone. Allow microphone access for Housemait in Settings, then try again.');
      return;
    }
    // iOS WKWebView supports audio/mp4, not webm; desktop Chrome prefers webm.
    const mime = MediaRecorder.isTypeSupported?.('audio/webm') ? 'audio/webm'
      : MediaRecorder.isTypeSupported?.('audio/mp4') ? 'audio/mp4'
      : '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
      const type = rec.mimeType || mime || 'audio/mp4';
      const ext = type.includes('webm') ? 'webm' : type.includes('wav') ? 'wav' : 'mp4';
      const blob = new Blob(chunks, { type });
      if (!blob.size) return;
      setIsTranscribing(true);
      try {
        const fd = new FormData();
        fd.append('audio', blob, `voice.${ext}`);
        const { data } = await api.post('/chat/transcribe', fd);
        const text = (data?.text || '').trim();
        if (text && aiInputRef.current) {
          const cur = aiInputRef.current.value;
          aiInputRef.current.value = cur ? `${cur} ${text}` : text;
          aiInputRef.current.focus();
        }
      } catch (err) {
        console.error('[voice] transcription failed:', err);
        alert('Sorry, I couldn’t transcribe that. Please try again.');
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current = rec;
    setIsRecording(true);
    rec.start();
  }

  return (
    <form onSubmit={handleAiSubmit}>
      <div
        className="flex items-center bg-white rounded-2xl overflow-hidden"
        style={{
          border: '1px solid rgba(26, 22, 32, 0.05)',
          boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.05) 0px 6px 18px',
        }}
      >
        <input
          ref={aiInputRef}
          type="text"
          placeholder="What can I help you with?"
          className="flex-1 px-4 py-4 text-base text-charcoal bg-transparent focus:outline-none placeholder:text-warm-grey"
        />
        <div className="flex items-center gap-1 pr-3">
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileSelect} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-warm-grey hover:text-primary rounded-lg hover:bg-plum-light/50 transition-colors"
            title="Attach image"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          {/* Voice input: record audio + transcribe server-side (Whisper).
              Works in the iOS WKWebView, unlike the Web Speech API. */}
          <button
            type="button"
            onClick={handleMicClick}
            disabled={isTranscribing}
            className={`p-2 rounded-lg transition-colors disabled:opacity-60 ${isRecording ? 'text-coral bg-coral/10' : 'text-warm-grey hover:text-primary hover:bg-plum-light/50'}`}
            title={isTranscribing ? 'Transcribing…' : isRecording ? 'Stop recording' : 'Voice input'}
            aria-pressed={isRecording}
          >
            {isTranscribing ? (
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
          <button
            type="submit"
            className="p-2 text-white bg-plum hover:bg-plum/90 rounded-full transition-colors"
            title="Send"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </button>
        </div>
      </div>
    </form>
  );
}

// ── Dashboard ───────────────────────────────────────────────────
export default function Dashboard() {
  const { user, household } = useAuth();
  const navigate = useNavigate();
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [schoolData, setSchoolData] = useState([]);

  // NL input state (kept for quick action modals later)
  const [nlModalOpen, setNlModalOpen] = useState(false);
  const [nlMode, setNlMode] = useState('event'); // 'event' | 'task'
  const [nlText, setNlText] = useState('');
  const [nlSending, setNlSending] = useState(false);
  const [nlResult, setNlResult] = useState('');

  // Pull-to-refresh: refetches digest + schools. No-op on web.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      api.get('/digest').then(r => setDigest(r.data)).catch(() => {}),
      api.get('/schools').then(r => {
        const s = r.data?.schools;
        setSchoolData(Array.isArray(s) ? s : []);
      }).catch(() => {}),
    ]);
  }, []);
  const ptr = usePullToRefresh(refreshAll);

  // Refresh when the app comes back to foreground (iOS). Throttled
  // to 30s so quick app-switches don't volley refreshes.
  useAppForegroundRefresh(refreshAll);

  useEffect(() => {
    loadCached('digest', () => api.get('/digest').then(r => r.data), setDigest)
      .catch(() => setError('Could not load dashboard data.'))
      .finally(() => setLoading(false));

    loadCached(
      'schools',
      () => api.get('/schools').then(r => { const s = r.data?.schools; return Array.isArray(s) ? s : []; }),
      setSchoolData,
    ).catch(() => {});
  }, []);

  async function handleNlSubmit(e) {
    e.preventDefault();
    if (!nlText.trim()) return;
    setNlSending(true);
    setNlResult('');
    try {
      const prefix = nlMode === 'event' ? 'Add calendar event: ' : 'Add task: ';
      const { data } = await api.post('/classify', { text: prefix + nlText.trim() });
      setNlResult(data.result?.response_message || 'Done!');
      setNlText('');
      const { data: d2 } = await api.get('/digest');
      setDigest(d2);
      setTimeout(() => { setNlModalOpen(false); setNlResult(''); }, 1500);
    } catch {
      setNlResult('Could not process that. Please try again.');
    } finally {
      setNlSending(false);
    }
  }

  // Toggle task completion
  async function toggleTask(task) {
    hapticConfirm();
    try {
      await api.patch(`/tasks/${task.id}`, { completed: !task.completed });
      const { data } = await api.get('/digest');
      setDigest(data);
    } catch {
      // silently fail
    }
  }

  // Actionable-task count = tasks due today OR overdue. Drives both
  // the iOS app-icon badge AND the Tasks card heading - keeping them in
  // sync was the whole point of the badge-confusion fix (user reported
  // "badge says 14 but I can't see what they are"). The new semantic
  // matches Reminders.app / Things: the badge means "things needing
  // attention RIGHT NOW", not "every task on the books." Tasks with no
  // due_date or a future due_date don't contribute to the count.
  //
  // Computing this here (before any early return) keeps hook order
  // stable - the Rules of Hooks require it. Running useEffect AFTER an
  // early `if (loading) return` previously crashed with React #301
  // ("Max update depth exceeded") on iOS.
  const outstandingTasks = digest?.outstanding ?? [];
  const actionableCount = outstandingTasks.reduce((count, task) => {
    const label = formatTaskDueLabel(task.due_date);
    if (!label) return count;
    if (label.overdue || label.text === 'Today') return count + 1;
    return count;
  }, 0);

  // Update the iOS app-icon badge whenever the actionable count shifts.
  // No-op on web. MUST stay above the loading early-return so the
  // hook is called on every render (Rules of Hooks).
  useEffect(() => {
    setBadgeCount(actionableCount);
  }, [actionableCount]);

  if (loading) return <DashboardSkeleton />;

  const now = new Date();
  // Dropped the year to match the kicker format the greeting uses
  // (e.g. "SATURDAY 18 APRIL · 3 EVENTS"). CSS text-transform: uppercase
  // handles the all-caps rendering.
  const todayStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayEvents = digest?.todayEvents ?? [];
  const eventCount = todayEvents.length;
  const members = digest?.members ?? [];

  // "Up Next" card data: the soonest TIMED event today that hasn't started
  // yet. All-day events are excluded (no meaningful countdown). Hidden
  // entirely when nothing's left today, per the design brief (no empty
  // state). digest only carries today's events, so this is same-day.
  const nowMsUpNext = Date.now();
  const nextUp = todayEvents
    .filter(e => !e.all_day && e.start_time && new Date(e.start_time).getTime() >= nowMsUpNext)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))[0] || null;
  const outstanding = digest?.outstanding ?? [];
  const shoppingItems = (digest?.shoppingItems ?? []).filter(i => !i.completed);
  const weekMeals = digest?.weekMeals ?? [];

  // Today's meals by category
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const TODAY_MEAL_CATEGORIES = [
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'dinner', label: 'Dinner' },
    { key: 'snack', label: 'Snack' },
  ];
  const todayMeals = TODAY_MEAL_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    meals: weekMeals.filter(m => m.date === todayDate && m.category?.toLowerCase() === key),
  }));

  // Find member info for events
  function getMemberForEvent(ev) {
    return members.find(m => m.name === ev.assigned_to_name);
  }

  // Multi-assignee aware. Events created via the new "Select members"
  // UI store the full list in `ev.assignees`; older events only set
  // `assigned_to_name`. Returns members in source order, deduped against
  // the household roster - anyone removed from the household post-hoc
  // is silently dropped.
  function getMembersForEvent(ev) {
    if (Array.isArray(ev.assignees) && ev.assignees.length > 0) {
      const seen = new Set();
      const out = [];
      for (const a of ev.assignees) {
        const m = members.find(x => x.name === a.member_name);
        if (m && !seen.has(m.id)) { seen.add(m.id); out.push(m); }
      }
      if (out.length) return out;
    }
    const single = getMemberForEvent(ev);
    return single ? [single] : [];
  }

  function getMemberAvatar(member) {
    if (!member) return null;
    // Shared Avatar handles the broken-photo → coloured-initial fallback.
    return <Avatar member={member} size={28} />;
  }

  const EVENT_DOT_CYCLE = ['bg-plum', 'bg-coral', 'bg-[#E0A458]', 'bg-sage'];
  function getEventDotColor(ev, index = 0) {
    return EVENT_DOT_CYCLE[index % EVENT_DOT_CYCLE.length];
  }


  return (
    <div {...ptr.bindings} className="max-w-5xl mx-auto space-y-4">
      <PullIndicator state={ptr.state} />
      {/* Header - mirrors the shared PageHeader used on Tasks/Meals/Shopping:
          a plum uppercase kicker (here the date) on top, then the serif
          title, then a warm-grey subtitle. Only the h1 size stays larger -
          the home-screen greeting keeps its editorial 38/52px treatment. */}
      <div className="mb-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-plum mb-1.5">
          {todayStr}
          {eventCount > 0 && <span> · {eventCount} event{eventCount !== 1 ? 's' : ''}</span>}
        </div>
        <h1
          className="m-0 text-[38px] md:text-[52px] leading-[1.05] font-normal text-charcoal"
          style={{ fontFamily: '"Instrument Serif", serif', letterSpacing: '-0.01em' }}
        >
          {getGreeting()}, <i style={{ color: 'var(--color-plum)' }}>{user?.name}</i><span style={{ color: 'var(--color-plum)' }}>.</span>
        </h1>
      </div>

      {/* Weather widget - sits directly below the greeting and above the
          AI composer (per design handoff). Renders nothing when the
          household has no address set or the upstream is down. Tapping
          its AI-note row opens the composer via the same openChatWidget
          event the dashboard input uses. */}
      <WeatherStrip onOpenAI={() => window.dispatchEvent(new CustomEvent('openChatWidget', { detail: {} }))} />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Trial reminder card - only renders when the household is trialing
          and has ≤10 days remaining. Silently no-ops otherwise (active,
          expired, internal testers, or the first 20 days of the trial). */}
      <TrialIndicatorCard />

      {/* AI chat input - replaced with a subscribe prompt for expired
          households so typing into a broken input doesn't turn into a
          jarring 402 → redirect moment. */}
      <WriteGate size="lg" message="Subscribe to create events, tasks, and more with AI">
        <DashboardAiInput />
      </WriteGate>

      {/* "Up Next" card - the soonest upcoming timed event today, with a
          lead-up progress bar. Sits between the AI composer and the day's
          schedule (design handoff: docs/design_handoff_up_next_card,
          Variant A light). Hidden when nothing's left today. Taps through
          to the calendar. */}
      {nextUp && (() => {
        const startMs = new Date(nextUp.start_time).getTime();
        const inMins = Math.max(0, Math.round((startMs - Date.now()) / 60000));
        // Multi-assignee aware: events from the member picker store the
        // list in ev.assignees; older ones use assigned_to_name. (Using
        // the single-assignee helper here was the bug that hid the avatar.)
        const whoList = getMembersForEvent(nextUp);
        const who = whoList[0] || null;
        // "{Name} · {title}" for a single assignee (per the brief), avoiding
        // "Mason · Mason's tennis"; plain title for multiple / none.
        const title = (whoList.length === 1 && who && !((nextUp.title || '').toLowerCase().includes(who.name.toLowerCase())))
          ? `${who.name} · ${nextUp.title}`
          : (nextUp.title || 'Event');
        const when = inMins <= 0 ? 'now' : inMins < 60 ? `in ${inMins} min` : `at ${formatTime(nextUp.start_time)}`;
        const endStr = nextUp.end_time ? `–${formatTime(nextUp.end_time)}` : '';
        const sub = `${formatTime(nextUp.start_time)}${endStr}${nextUp.location ? ` · ${nextUp.location}` : ''}`;
        // Lead-up window = 60 min; bar fills as the event approaches.
        const progress = Math.min(1, Math.max(0, 1 - inMins / 60));
        return (
          <button
            type="button"
            onClick={() => navigate('/calendar')}
            aria-label={`Up next: ${title}, ${when}${nextUp.location ? `, ${nextUp.location}` : ''}. Opens calendar.`}
            className="block w-full text-left bg-white rounded-[20px] overflow-hidden transition-transform active:scale-[0.99]"
            style={{ border: '1px solid rgba(26,22,32,0.07)', boxShadow: '0 1px 2px rgba(26,22,32,0.04)' }}
          >
            <div className="flex items-center justify-between gap-3" style={{ padding: '16px 18px 14px' }}>
              <div className="min-w-0">
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--color-plum)', marginBottom: 2 }}>
                  Up next · {when}
                </div>
                <div className="truncate" style={{ fontSize: 18, fontWeight: 600, color: 'var(--charcoal, #2D2A33)' }}>{title}</div>
                <div className="truncate" style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 2 }}>{sub}</div>
              </div>
              {whoList.length > 0 && (
                <div className="flex shrink-0 -space-x-2">
                  {whoList.map((m) => (
                    <Avatar key={m.id} member={m} size={42} className="ring-2 ring-white" />
                  ))}
                </div>
              )}
            </div>
            <div style={{ height: 6, background: '#F3EEE5', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(progress * 100)}%`, height: '100%', background: 'var(--color-plum)' }} />
            </div>
          </button>
        );
      })()}

      {/* Soft calendar-setup nudge for households that haven't subscribed
          any external feed yet. Renders nothing once a feed exists or
          the user dismisses. Sits above the 2-column grid so it's the
          first thing a brand-new user sees but doesn't push existing
          content off the fold. */}
      <PromoClaimNudge />
      <CalendarSetupNudge />

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Card 1 - Today's schedule */}
        <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">Today's schedule</h2>
            <Link to="/calendar" className="text-xs font-medium text-primary hover:underline">Week →</Link>
          </div>
          {todayEvents.length === 0 ? (
            <p className="text-sm text-cocoa py-4 text-center">No events today</p>
          ) : (
            <div className="space-y-2">
              {todayEvents
                .sort((a, b) => new Date(a.start_time || a.date) - new Date(b.start_time || b.date))
                .slice(0, 4)
                .map((ev, i) => {
                  const assignees = getMembersForEvent(ev);
                  const primary = assignees[0];
                  const barColor = (primary && dotColors[primary.color_theme]) || getEventDotColor(ev, i);
                  // Stack up to 3 avatars; overflow shows "+N" pill.
                  const visibleAvatars = assignees.slice(0, 3);
                  const overflowCount = assignees.length - visibleAvatars.length;
                  return (
                    <div key={ev.id || i} className="flex items-center gap-2 px-3 py-2.5 bg-cream rounded-xl">
                      <span className={`w-[3px] h-7 rounded-full shrink-0 ${barColor}`} />
                      {/* All-day events render "All day" instead of the
                          formatted start_time - otherwise a midnight-UTC
                          row shows up as "01:00" in BST. Widened the
                          column to fit either label without truncating. */}
                      <span className="text-[0.8125rem] font-bold text-bark shrink-0 tabular-nums w-12">
                        {ev.all_day ? 'All day' : formatTime(ev.start_time)}
                      </span>
                      <p className="text-sm text-bark truncate flex-1 min-w-0">{ev.title}</p>
                      {visibleAvatars.length > 0 && (
                        <div className="shrink-0 flex -space-x-2">
                          {visibleAvatars.map(m => (
                            <div key={m.id} className="ring-2 ring-cream rounded-full">
                              {getMemberAvatar(m)}
                            </div>
                          ))}
                          {overflowCount > 0 && (
                            <div className="ring-2 ring-cream rounded-full w-7 h-7 bg-linen text-cocoa text-[11px] font-semibold flex items-center justify-center">
                              +{overflowCount}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* After School (mobile only) - kids' after-school activities + pickup,
            per design handoff. Sits between Today's schedule and Tasks. Renders
            null on desktop and when the household has no activities, so it won't
            occupy a grid cell in those cases. */}
        <AfterSchoolCard members={members} />

        {/* Card 2 - Tasks */}
        <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">
              Tasks
              {actionableCount > 0 && (
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}> · {actionableCount} due</span>
              )}
            </h2>
            <Link to="/tasks" className="text-xs font-medium text-primary hover:underline">View all →</Link>
          </div>
          {outstanding.length === 0 ? (
            <p className="text-sm text-cocoa py-4 text-center">All caught up!</p>
          ) : (
            <ul className="space-y-1">
              {outstanding.slice(0, 5).map((task) => {
                const assignee = task.assigned_to_name
                  ? members.find(m => m.name === task.assigned_to_name)
                  : null;
                const dueLabel = formatTaskDueLabel(task.due_date);
                return (
                  <li key={task.id} className="flex items-center gap-3 py-1">
                    <button
                      onClick={() => toggleTask(task)}
                      className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                        task.completed
                          ? 'bg-sage border-sage text-white'
                          : 'border-cream-border hover:border-primary'
                      }`}
                    >
                      {task.completed && (
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${task.completed ? 'line-through text-cocoa/60' : 'text-bark'}`}>
                        {task.title}
                      </p>
                      {dueLabel && (
                        <p className={`text-xs mt-0.5 ${dueLabel.overdue ? 'text-coral' : 'text-cocoa'}`}>
                          {dueLabel.text}
                        </p>
                      )}
                    </div>
                    {assignee && (
                      <div className="shrink-0">{getMemberAvatar(assignee)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Card 3 - Grocery list */}
        <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">
              Grocery list
              {shoppingItems.length > 0 && (
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}> · {shoppingItems.length} item{shoppingItems.length !== 1 ? 's' : ''}</span>
              )}
            </h2>
            <Link to="/shopping" className="text-xs font-medium text-primary hover:underline">Open list →</Link>
          </div>
          {shoppingItems.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-bark font-medium">Shopping list is empty</p>
              <p className="text-xs text-cocoa mt-1.5 leading-relaxed">
                Tap <Link to="/shopping" className="text-primary font-medium hover:underline">Open list →</Link> to
                add items, or message <span className="italic">"add milk and eggs to the list"</span> to the WhatsApp bot.
              </p>
            </div>
          ) : (
            <>
              {/* One item per row: [badge] [name (truncates)] [quantity, right-
                  aligned], with a hairline divider between rows. Cap at 5
                  rows so the dashboard card stays compact - the 'N items'
                  line at the bottom tells the user how many more there are. */}
              <div className="flex flex-col divide-y divide-[#1b14240f]">
                {shoppingItems.slice(0, 5).map((item) => {
                  const badge = getCatBadge(item.aisle_category || item.category || 'Other');
                  return (
                    <div key={item.id} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
                      <span
                        className={`shrink-0 uppercase tracking-wide ${badge.bg} ${badge.text}`}
                        style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.05em' }}
                      >
                        {badge.label}
                      </span>
                      <span className="flex-1 text-sm text-bark truncate capitalize">{item.item}</span>
                      {item.quantity && (
                        <span className="shrink-0 text-cocoa" style={{ fontSize: 12 }}>{item.quantity}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Card 4 - Today's meals */}
        <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">Today's meals</h2>
            <Link to="/meals" className="text-xs font-medium text-primary hover:underline">Plan meals →</Link>
          </div>
          <div className="space-y-2">
            {todayMeals.map(({ key, label, meals }) => (
              meals.length === 0 ? (
                <Link
                  key={key}
                  to={`/meals?open=${key}&date=${todayDate}&return=dashboard`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-cream hover:bg-plum-light/60 transition-colors"
                >
                  <span className="text-[11px] font-bold w-16 shrink-0 text-cocoa uppercase">{label}</span>
                  <span className="text-sm italic text-cocoa/60 flex-1">Tap to add</span>
                  <span className="text-cocoa/60 text-lg leading-none">+</span>
                </Link>
              ) : (
                <div key={key} className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-plum-light">
                  <span className="text-[11px] font-bold w-16 shrink-0 text-primary uppercase pt-0.5">{label}</span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {meals.map((meal, i) => (
                      <div key={meal.id ?? `${key}-${i}`} className="flex items-center justify-between min-w-0">
                        <span className="text-sm font-medium text-bark truncate">{meal.meal_name}</span>
                        {(meal.recipe?.prep_time_mins || meal.prep_time_mins) && (
                          <span className="shrink-0 text-[10px] font-medium text-sage bg-sage-light px-2 py-0.5 rounded-full ml-2">
                            {meal.recipe?.prep_time_mins || meal.prep_time_mins} min
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      </div>

      {/* NL input modal */}
      <BottomSheet open={nlModalOpen} onDismiss={() => setNlModalOpen(false)} desktopWidthClass="sm:w-[440px]">
        <div className="p-5 pb-safe sm:pb-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-bark">
                {nlMode === 'event' ? 'Add event' : 'Add task'}
              </h3>
              <button onClick={() => setNlModalOpen(false)} className="text-cocoa hover:text-bark p-1 transition-colors">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <form onSubmit={handleNlSubmit}>
              <input
                type="text"
                value={nlText}
                onChange={(e) => setNlText(e.target.value)}
                placeholder={nlMode === 'event' ? "e.g. Dentist appointment Tuesday 3pm" : "e.g. Buy milk, remind Jake homework"}
                className="w-full border border-cream-border rounded-xl px-3 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent mb-3"
                autoFocus
              />
              {nlResult && (
                <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2 mb-3">{nlResult}</p>
              )}
              <button
                type="submit"
                disabled={nlSending || !nlText.trim()}
                className="w-full py-3 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                {nlSending ? 'Adding...' : nlMode === 'event' ? 'Add event' : 'Add task'}
              </button>
            </form>
        </div>
      </BottomSheet>
    </div>
  );
}
