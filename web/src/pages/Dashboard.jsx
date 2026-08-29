import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChildMode } from '../context/ChildModeContext';
import { useSubscription } from '../context/SubscriptionContext';
import api from '../lib/api';
import { maybeRequestEarnedReview } from '../lib/appReview';
import { getItemEmoji } from '../lib/shopping-constants';
import { isAndroid } from '../lib/platform';
import Spinner from '../components/Spinner';
import { DashboardSkeleton } from '../components/Skeleton';
import { BottomSheet } from '../components/BottomSheet';
import ErrorBanner from '../components/ErrorBanner';
import TrialIndicatorCard from '../components/TrialIndicator';
import { WriteGate } from '../components/SubscribePrompt';
import Avatar from '../components/ui/Avatar';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { confirm as hapticConfirm } from '../lib/haptics';
import { usePullToRefresh, PullIndicator } from '../hooks/usePullToRefresh';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
import { setBadgeCount } from '../lib/badge';
import WeatherStrip from '../components/WeatherStrip';
import AfterSchoolCard from '../components/AfterSchoolCard';
import SetupNudges from '../components/SetupNudges';
import { useIsMobile } from '../hooks/useMediaQuery';

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
  if (diffDays < 7) return { text: due.toLocaleDateString('en-GB', { weekday: 'short' }), overdue: false };
  return { text: due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), overdue: false };
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
  // Android has no in-app purchase flow yet (Google Play Billing pending),
  // so a discount CTA pointing at /subscribe would dead-end - hide it.
  if (isAndroid()) return null;
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

/**
 * The referred family's own gift card: their bonus month is pending and
 * this answers "what do I need to do to unlock it?" with directional
 * guidance (never the mechanical thresholds - those stay unpublished).
 * "Connect WhatsApp" is named because it's the instant-qualify signal
 * AND our most valuable onboarding action - the gift month doubles as
 * an activation incentive. Disappears on activation or lapse (the API
 * stops returning a pending `incoming`); dismissable per device.
 */
function GiftStepMark({ done }) {
  return done ? (
    <span
      className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: '#7DAE82' }}
      aria-hidden="true"
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  ) : (
    <span
      className="w-4 h-4 rounded-full flex-shrink-0"
      style={{ border: '1.5px solid rgba(138,95,30,0.45)' }}
      aria-hidden="true"
    />
  );
}

function ReferralGiftCard() {
  const [incoming, setIncoming] = useState(null);
  const [dismissedPending, setDismissedPending] = useState(() => {
    try { return localStorage.getItem('housemait_gift_card_dismissed') === '1'; } catch { return false; }
  });
  const [dismissedLanded, setDismissedLanded] = useState(() => {
    try { return localStorage.getItem('housemait_gift_landed_dismissed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    // Landed can arrive even after the pending card was dismissed - good
    // news doesn't stay muted - so only both dismissals skip the fetch.
    if (dismissedPending && dismissedLanded) return;
    let cancelled = false;
    api.get('/referrals/mine')
      .then(({ data }) => {
        if (!cancelled && data?.incoming) setIncoming(data.incoming);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dismissedPending, dismissedLanded]);

  if (!incoming) return null;

  function dismissPending() {
    try { localStorage.setItem('housemait_gift_card_dismissed', '1'); } catch { /* private mode */ }
    setDismissedPending(true);
  }
  function dismissLanded() {
    try { localStorage.setItem('housemait_gift_landed_dismissed', '1'); } catch { /* private mode */ }
    setDismissedLanded(true);
  }

  if (incoming.status === 'activated') {
    if (dismissedLanded) return null;
    return (
      <div
        className="rounded-2xl p-4 mb-4 flex items-start gap-3"
        style={{ background: '#EDF5EE', border: '1px solid rgba(63,107,68,0.25)' }}
      >
        <div className="text-2xl leading-none mt-0.5" aria-hidden="true">🎉</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: '#3F6B44' }}>
            Your free month has landed
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: '#3F6B44', opacity: 0.85 }}>
            30 extra days added on top of your trial. Enjoy!
          </p>
          <button
            type="button"
            onClick={dismissLanded}
            className="mt-2 text-xs font-semibold hover:underline"
            style={{ color: '#3F6B44' }}
          >
            Nice one
          </button>
        </div>
      </div>
    );
  }

  if (incoming.status !== 'pending' || dismissedPending) return null;

  const whatsappDone = !!incoming.whatsapp_linked;
  const actionDone = !!incoming.has_action;
  const oneToGo = whatsappDone !== actionDone;

  return (
    <div
      className="rounded-2xl p-4 mb-4 flex items-start gap-3"
      style={{ background: '#FBF1DE', border: '1px solid rgba(138,95,30,0.22)' }}
    >
      <div className="text-2xl leading-none mt-0.5" aria-hidden="true">🎁</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: '#8A5F1E' }}>
          {oneToGo ? 'One step to go' : 'Your bonus month is waiting'}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <GiftStepMark done={whatsappDone} />
          {whatsappDone ? (
            <span className="text-xs line-through" style={{ color: '#8A5F1E', opacity: 0.65 }}>
              Connect WhatsApp
            </span>
          ) : (
            <Link to="/settings?section=whatsapp" className="text-xs font-semibold hover:underline" style={{ color: '#8A5F1E' }}>
              Connect WhatsApp →
            </Link>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <GiftStepMark done={actionDone} />
          <span
            className={actionDone ? 'text-xs line-through' : `text-xs${whatsappDone ? ' font-semibold' : ''}`}
            style={{ color: '#8A5F1E', opacity: actionDone ? 0.65 : 1 }}
          >
            Add your first thing: an event, a list item, or your family
          </span>
        </div>
        {!whatsappDone && (
          <p className="mt-2 text-[11px] italic leading-relaxed" style={{ color: '#8A5F1E', opacity: 0.75 }}>
            Not a WhatsApp family? It unlocks after a couple of days of normal use instead.
          </p>
        )}
        <button
          type="button"
          onClick={dismissPending}
          className="mt-2 text-xs text-cocoa hover:text-bark transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ── Notification bell ───────────────────────────────────────────
// Opens the notification centre, with the coral unread dot from the
// design system. The tab bar's five slots are sacred, so the entry
// point lives in the Dashboard header.

function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => api.get('/notifications')
      .then(({ data }) => { if (!cancelled) setUnread(data?.unread || 0); })
      .catch(() => {});
    load();
    // The centre marks everything read on open; clear the dot without a refetch.
    const clear = () => setUnread(0);
    window.addEventListener('housemait:notifications-read', clear);
    return () => {
      cancelled = true;
      window.removeEventListener('housemait:notifications-read', clear);
    };
  }, []);

  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      className="relative flex-shrink-0 w-10 h-10 rounded-full bg-linen flex items-center justify-center hover:bg-[#F3EEE5] transition-colors"
      style={{ border: '1px solid rgba(26,22,32,0.07)' }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-plum)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {unread > 0 && (
        <span
          className="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full"
          style={{ background: 'var(--color-coral)', border: '1.5px solid var(--color-white)' }}
        />
      )}
    </Link>
  );
}

// ── Holiday-pause card ──────────────────────────────────────────
// When a child's term-windowed weekly activities slip past their end_date
// they pause silently - right for school clubs, wrong for the gym lesson
// that runs all year. This card appears once per gap and lets a parent
// keep individual activities running by clearing their window (an
// activity with no window expands every week forever - see
// activity-occurrences on the server). Untouched rows stay paused, so
// ignoring the card is safe and identical to the old behaviour.

const HOLIDAY_PAUSE_LOOKBACK_DAYS = 60;
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Weekend activities first: Saturday/Sunday things (private lessons, gym,
// swimming) are the likely holiday-runners, so they surface above the fold.
const DAY_SORT = [5, 6, 0, 1, 2, 3, 4];

function HolidayPauseCard({ members }) {
  const [rows, setRows] = useState(null); // grouped rows, null = loading/none
  const [gapKey, setGapKey] = useState('');
  const [expanded, setExpanded] = useState({});
  const [kept, setKept] = useState({});
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/schools/activities')
      .then(({ data }) => {
        if (cancelled) return;
        const today = new Date().toISOString().slice(0, 10);
        const floor = new Date(Date.now() - HOLIDAY_PAUSE_LOOKBACK_DAYS * 86_400_000)
          .toISOString().slice(0, 10);
        const paused = (data?.activities || []).filter(
          (a) => a.end_date && a.end_date < today && a.end_date >= floor,
        );
        if (paused.length === 0) return;
        const maxEnd = paused.reduce((m, a) => (a.end_date > m ? a.end_date : m), '');
        try {
          // >= not ===: keeping an activity running can REMOVE the row
          // holding the newest end_date, shifting maxEnd - a strict match
          // resurrected cards the user had already dismissed. A dismissal
          // covers this gap and every earlier one; only a genuinely NEWER
          // term-end brings the card back.
          // Device memory OR the household's server-side answer - one
          // adult dismissing on any device answers for everyone.
          const localUpTo = localStorage.getItem('housemait_holiday_pause_dismissed') || '';
          const serverUpTo = data?.holiday_pause_dismissed_upto || '';
          const dismissedUpTo = localUpTo > serverUpTo ? localUpTo : serverUpTo;
          if (dismissedUpTo >= maxEnd) { setDismissed(true); return; }
          // Never-dismissed cards still retire themselves: after 14 days
          // on screen the question has been declined by inaction, and
          // "paused" is the safe default anyway.
          const seenKey = `housemait_holiday_pause_seen_${maxEnd}`;
          const firstSeen = Number(localStorage.getItem(seenKey) || 0);
          if (!firstSeen) {
            localStorage.setItem(seenKey, String(Date.now()));
          } else if (Date.now() - firstSeen > 14 * 86_400_000) {
            setDismissed(true);
            return;
          }
        } catch { /* private mode */ }
        // Group by child, collapse same-name rows (wraparound care runs
        // Mon/Tue/Wed as three DB rows - one question, one answer).
        const byChild = new Map();
        for (const a of paused) {
          const list = byChild.get(a.child_id) || [];
          const key = (a.activity || '').trim().toLowerCase();
          const existing = list.find((r) => r.key === key);
          if (existing) {
            existing.ids.push(a.id);
            existing.days.push(a.day_of_week);
          } else {
            list.push({
              key,
              name: (a.activity || '').trim(),
              ids: [a.id],
              days: [a.day_of_week],
              time: a.time_start ? a.time_start.slice(0, 5) : null,
            });
          }
          byChild.set(a.child_id, list);
        }
        for (const list of byChild.values()) {
          list.sort((a, b) => DAY_SORT.indexOf(a.days[0]) - DAY_SORT.indexOf(b.days[0]));
        }
        setGapKey(maxEnd);
        setRows(byChild);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (dismissed || !rows || rows.size === 0) return null;

  function dismiss() {
    try { localStorage.setItem('housemait_holiday_pause_dismissed', gapKey); } catch { /* private mode */ }
    // Record for the whole household too (fire-and-forget; pre-migration
    // the server quietly no-ops and this stays per-device).
    api.post('/schools/activities/holiday-pause-dismiss', { up_to: gapKey }).catch(() => {});
    setDismissed(true);
  }

  async function keepRunning(row) {
    setKept((k) => ({ ...k, [row.key + row.ids[0]]: true }));
    for (const id of row.ids) {
      try {
        await api.patch(`/schools/activities/${id}`, {
          start_date: null,
          end_date: null,
          term_label: null,
        });
      } catch { /* one failed row shouldn't undo the optimistic flip; the Family page shows truth */ }
    }
  }

  function dayLabel(days) {
    const sorted = [...new Set(days)].sort((a, b) => DAY_SORT.indexOf(a) - DAY_SORT.indexOf(b));
    if (sorted.length === 1) return DAY_LABELS[sorted[0]] || '';
    const labels = sorted.map((d) => DAY_LABELS[d] || '');
    return `${labels.slice(0, -1).join(', ')} + ${labels[labels.length - 1]}`;
  }

  const anyKept = Object.keys(kept).length > 0;

  return (
    <div
      className="rounded-2xl p-4 mb-4"
      style={{ background: '#FBF1DE', border: '1px solid rgba(138,95,30,0.22)' }}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none mt-0.5" aria-hidden="true">🎒</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium" style={{ color: '#8A5F1E' }}>
            Paused for the holidays
          </p>
          <p className="text-xs mt-0.5 leading-relaxed" style={{ color: '#8A5F1E', opacity: 0.85 }}>
            These stopped when the term ended. Do any keep running?
          </p>
        </div>
      </div>
      {[...rows.entries()].map(([childId, list]) => {
        const child = (members || []).find((m) => m.id === childId);
        const showAll = !!expanded[childId];
        const visible = showAll ? list : list.slice(0, 4);
        const hidden = list.length - visible.length;
        return (
          <div key={childId} className="mt-3">
            {rows.size > 1 && (
              <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#5C3F12' }}>
                {child?.name || 'Activities'}
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {visible.map((row) => {
                const isKept = kept[row.key + row.ids[0]];
                return (
                  <div
                    key={row.key + row.ids[0]}
                    className="flex items-center justify-between gap-2 rounded-[10px] px-2.5 py-2"
                    style={{ background: isKept ? '#EDF5EE' : 'rgba(255,255,255,0.55)' }}
                  >
                    <span className="text-xs min-w-0 truncate" style={{ color: isKept ? '#3F6B44' : '#5C3F12' }}>
                      <span className="font-medium">{row.name}</span>
                      {' · '}{dayLabel(row.days)}{row.time && !isKept ? ` ${row.time}` : ''}
                    </span>
                    {isKept ? (
                      <span
                        className="text-[11px] font-semibold rounded-lg px-2.5 py-1 flex-shrink-0"
                        style={{ color: '#3F6B44', background: 'rgba(125,174,130,0.25)' }}
                      >
                        Runs all year ✓
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => keepRunning(row)}
                        className="text-[11px] font-semibold rounded-lg px-2.5 py-1 flex-shrink-0 bg-white"
                        style={{ color: '#8A5F1E', border: '1.5px solid rgba(138,95,30,0.35)' }}
                      >
                        Keep running
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [childId]: true }))}
                className="mt-1.5 text-[11px] font-semibold"
                style={{ color: '#8A5F1E' }}
              >
                Show {hidden} more
              </button>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={dismiss}
        className="mt-3 text-xs text-cocoa hover:text-bark transition-colors"
      >
        {anyKept ? 'Done' : "They're all paused, thanks"}
      </button>
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
        const { data } = await api.post('/chat/transcribe', fd, { timeout: 120000 });
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
  const { enabled: childMode } = useChildMode();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hid = household?.id;

  // Cache-first: the digest (today's events, tasks, shopping, meals, members)
  // and schools paint instantly from the persisted cache on a cold launch, then
  // revalidate in the background - so opening the app feels instant.
  const { data: digest, isPending, isError } = useQuery({
    queryKey: ['digest', hid],
    queryFn: () => api.get('/digest').then(r => r.data),
    enabled: !!hid,
  });
  // Warm the schools cache in the background (read on other screens); the
  // dashboard itself doesn't render it, so we don't bind the result.
  useQuery({
    queryKey: ['schools', hid],
    queryFn: () => api.get('/schools').then(r => { const s = r.data?.schools; return Array.isArray(s) ? s : []; }),
    enabled: !!hid,
  });
  const loading = isPending;
  const [errorDismissed, setErrorDismissed] = useState(false);
  const error = isError && !errorDismissed ? 'Could not load dashboard data.' : '';

  // NL input state (kept for quick action modals later)
  const [nlModalOpen, setNlModalOpen] = useState(false);
  const [nlMode, setNlMode] = useState('event'); // 'event' | 'task'
  const [nlText, setNlText] = useState('');

  // On mobile the meals week strip scrolls horizontally from Monday -
  // centre today's chip once the dashboard has rendered, so late-week
  // days don't start off-screen. Direct scrollLeft (not scrollIntoView)
  // so the page never jumps vertically. No-op on desktop, where the
  // strip is a 7-col grid. Keyed on `loading`: the strip only exists
  // after the skeleton gives way to the real layout.
  const mealsStripRef = useRef(null);
  useEffect(() => {
    if (loading) return;
    const c = mealsStripRef.current;
    const t = c?.querySelector('[data-today="1"]');
    if (c && t && c.scrollWidth > c.clientWidth) {
      c.scrollLeft = Math.max(0, t.offsetLeft - c.offsetLeft - (c.clientWidth - t.clientWidth) / 2);
    }
  }, [loading]);
  const [nlSending, setNlSending] = useState(false);
  const [nlResult, setNlResult] = useState('');

  // Pull-to-refresh + foreground refresh (iOS): revalidate digest + schools.
  // React Query does the initial fetch on mount, so there's no load effect.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['digest', hid] }),
      queryClient.invalidateQueries({ queryKey: ['schools', hid] }),
    ]);
  }, [queryClient, hid]);
  const ptr = usePullToRefresh(refreshAll);
  useAppForegroundRefresh(refreshAll);

  // Review prompt, earned by the wins engine (lib/appReview). Requested HERE
  // and nowhere else: the Dashboard is hidden in Child Mode (kids land on
  // /tasks), so whoever is looking at this screen is an adult. Small delay
  // so the sheet never races the page paint.
  useEffect(() => {
    const id = setTimeout(maybeRequestEarnedReview, 2000);
    return () => clearTimeout(id);
  }, []);

  // The AI chat overlay mutates digest data (events, tasks, shopping)
  // while this page stays mounted - refetch on its broadcast so the
  // cards don't sit stale behind the chat panel.
  useEffect(() => {
    const onDataChanged = () => { refreshAll(); };
    window.addEventListener('housemait:data-changed', onDataChanged);
    return () => window.removeEventListener('housemait:data-changed', onDataChanged);
  }, [refreshAll]);

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
      await queryClient.invalidateQueries({ queryKey: ['digest', hid] });
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
      await queryClient.invalidateQueries({ queryKey: ['digest', hid] });
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
  // Per-member progress on today's chores/routines for the "Today's tasks" card.
  const taskScores = digest?.taskScores ?? [];

  // This week's meals, one chip per day (Mon-Sun). Each chip lists ALL of
  // the day's planned meals in meal-time order (breakfast → snack);
  // tapping opens the planner on that date.
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const MEAL_ORDER = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
  const weekDays = (() => {
    const monday = getMonday(now);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayMeals = weekMeals
        .filter(m => m.date === date)
        .sort((a, b) => (MEAL_ORDER[a.category?.toLowerCase()] ?? 9) - (MEAL_ORDER[b.category?.toLowerCase()] ?? 9));
      return {
        date,
        dow: d.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase(),
        dm: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        dayMeals,
      };
    });
  })();

  // Resolve every household member assigned to an event, deduped, in source
  // order (anyone removed from the household post-hoc is silently dropped).
  // Events from the "Select members" picker store the list in the
  // event_assignees join table (surfaced as ev.assignees) - but most events
  // (synced calendars, quick-adds, recurring instances) only carry the row's
  // own assigned_to_names / assigned_to_ids arrays and have NO join rows, so we
  // must resolve those too, exactly the way to-dos do (getTaskAssignee). The
  // old code only checked ev.assignees + a singular ev.assigned_to_name that
  // isn't even a real column, which is why those events showed no avatar.
  function getMembersForEvent(ev) {
    const seen = new Set();
    const out = [];
    const push = (m) => { if (m && !seen.has(m.id)) { seen.add(m.id); out.push(m); } };

    if (Array.isArray(ev.assignees)) {
      for (const a of ev.assignees) push(members.find(x => x.name === a.member_name));
    }
    if (Array.isArray(ev.assigned_to_names)) {
      for (const nm of ev.assigned_to_names) push(members.find(x => x.name === nm));
    }
    if (Array.isArray(ev.assigned_to_ids)) {
      for (const id of ev.assigned_to_ids) push(members.find(x => x.id === id));
    }
    // Legacy singular fallback (very old rows).
    if (out.length === 0 && ev.assigned_to_name) push(members.find(m => m.name === ev.assigned_to_name));

    return out;
  }

  function getMemberAvatar(member, size = 28) {
    if (!member) return null;
    // Shared Avatar handles the broken-photo → coloured-initial fallback.
    return <Avatar member={member} size={size} />;
  }

  // Resolve a task's primary assignee. To-dos now store assignees as arrays
  // (assigned_to_names / assigned_to_ids); fall back to the legacy singular
  // assigned_to_name so older rows still match.
  function getTaskAssignee(task) {
    const names = Array.isArray(task.assigned_to_names) && task.assigned_to_names.length
      ? task.assigned_to_names
      : (task.assigned_to_name ? [task.assigned_to_name] : []);
    for (const nm of names) { const m = members.find(x => x.name === nm); if (m) return m; }
    const ids = Array.isArray(task.assigned_to_ids) ? task.assigned_to_ids : [];
    for (const id of ids) { const m = members.find(x => x.id === id); if (m) return m; }
    return null;
  }

  // Does this to-do pertain to the logged-in user (by member id or name)?
  function taskIsMine(task) {
    if (!user) return false;
    const ids = Array.isArray(task.assigned_to_ids) ? task.assigned_to_ids : [];
    if (ids.includes(user.id)) return true;
    const names = Array.isArray(task.assigned_to_names) && task.assigned_to_names.length
      ? task.assigned_to_names
      : (task.assigned_to_name ? [task.assigned_to_name] : []);
    return names.includes(user.name);
  }
  // To-do list card: float the user's own items to the top, then cap at 4.
  const visibleTodos = [
    ...outstanding.filter(taskIsMine),
    ...outstanding.filter((t) => !taskIsMine(t)),
  ].slice(0, 4);

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
          the home-screen greeting keeps its editorial 38/52px treatment.
          On mobile this block IS the page header (the Layout logo bar is
          gone). */}
      <div className="mb-4 md:mb-2 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-plum mb-2">
            {todayStr}
            {eventCount > 0 && <span> · {eventCount} event{eventCount !== 1 ? 's' : ''}</span>}
          </div>
          <h1
            className="m-0 text-[38px] md:text-[42px] leading-[1.05] font-normal text-charcoal"
            style={{ fontFamily: 'var(--font-serif-display)', letterSpacing: '-0.01em' }}
          >
            {getGreeting()},{' '}<br />{user?.name}. 👋
          </h1>
        </div>
        {!childMode && <NotificationBell />}
      </div>

      {/* Setup nudges - phone placement: first item in the feed, under the
          greeting and ABOVE the weather strip. Desktop puts it under the AI
          composer instead (below), so this is gated rather than CSS-hidden:
          mounting both would double every lookup the component makes. */}
      {!childMode && isMobile && <SetupNudges members={members} />}

      {/* Weather widget - sits directly below the greeting and above the
          AI composer (per design handoff). Renders nothing when the
          household has no address set or the upstream is down. Tapping
          its AI-note row opens the composer via the same openChatWidget
          event the dashboard input uses. */}
      <WeatherStrip onOpenAI={() => window.dispatchEvent(new CustomEvent('openChatWidget', { detail: {} }))} />

      <ErrorBanner message={error} onDismiss={() => setErrorDismissed(true)} />

      {/* Trial reminder card - only renders when the household is trialing
          and has ≤10 days remaining. Silently no-ops otherwise (active,
          expired, internal testers, or the first 20 days of the trial). */}
      <TrialIndicatorCard />

      {/* AI chat input - replaced with a subscribe prompt for expired
          households so typing into a broken input doesn't turn into a
          jarring 402 → redirect moment. */}
      <div style={{ marginTop: '22px' }}>
        <WriteGate size="lg" message="Subscribe to create events, tasks, and more with AI">
          <DashboardAiInput />
        </WriteGate>
      </div>

      {/* Setup nudges - desktop placement: directly under the AI composer,
          above the dashboard cards. Phone renders it above the weather strip
          instead (see above). */}
      {!childMode && !isMobile && <SetupNudges members={members} />}

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
        const endStr = nextUp.end_time ? ` – ${formatTime(nextUp.end_time)}` : '';
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
      {!childMode && <PromoClaimNudge />}
      {!childMode && <ReferralGiftCard />}
      {!childMode && <HolidayPauseCard members={members} />}

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Card 1 - Today's schedule */}
        <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">Today's schedule</h2>
            <Link to="/calendar" className="text-xs font-medium text-primary hover:underline">View more →</Link>
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
                    <div key={ev.id || i} className="flex items-center gap-3 px-3 py-2.5 bg-cream rounded-2xl">
                      <span className={`w-1 min-h-[2.25rem] rounded-full shrink-0 ${barColor}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-bark truncate leading-[1.45]">{ev.title}</p>
                        {/* All-day events render "All day" instead of the
                            formatted start_time - otherwise a midnight-UTC
                            row shows up as "01:00" in BST. */}
                        <p className="text-xs text-cocoa truncate mt-0.5 leading-[1.45]">
                          {ev.all_day ? 'All day' : (ev.end_time ? `${formatTime(ev.start_time)} – ${formatTime(ev.end_time)}` : formatTime(ev.start_time))}{ev.location ? ` · ${ev.location}` : ''}
                        </p>
                      </div>
                      {visibleAvatars.length > 0 && (
                        <div className="shrink-0 flex -space-x-2">
                          {visibleAvatars.map(m => (
                            <div key={m.id} className="ring-2 ring-cream rounded-full">
                              {getMemberAvatar(m, 40)}
                            </div>
                          ))}
                          {overflowCount > 0 && (
                            <div className="ring-2 ring-cream rounded-full w-10 h-10 bg-linen text-cocoa text-xs font-semibold flex items-center justify-center">
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

        {/* Card 2a - Today's tasks scorecard: per-member chores/routines
            progress (done/total + a progress bar in the member's colour). */}
        {taskScores.length > 0 && (
          <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-sans font-semibold text-bark">Today&apos;s tasks</h2>
              <Link to="/tasks" className="text-xs font-medium text-primary hover:underline">View all →</Link>
            </div>
            <ul className="flex flex-col gap-4">
              {taskScores.map((s) => {
                const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
                const barClass = dotColors[s.color_theme] || 'bg-plum';
                return (
                  <li key={s.member_id} className="flex items-center gap-3">
                    <div className="shrink-0">{getMemberAvatar(s, 40)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-sm font-semibold text-bark truncate">{s.name}</span>
                        <span className="shrink-0 text-xs font-semibold text-cocoa">{s.done}/{s.total}</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: '#EDE7DB' }}>
                        <div className={`h-full rounded-full ${barClass} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Card 2 - To-do list (outstanding to-dos; chores live in the scorecard above) */}
        <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">
              To-do list
              {actionableCount > 0 && (
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}> · {actionableCount} due</span>
              )}
            </h2>
            <Link to="/lists" className="text-xs font-medium text-primary hover:underline">View all →</Link>
          </div>
          {outstanding.length === 0 ? (
            <p className="text-sm text-cocoa py-4 text-center">All caught up!</p>
          ) : (
            <ul className="border-t border-[#1b14240f]">
              {visibleTodos.map((task) => {
                const assignee = getTaskAssignee(task);
                return (
                  <li key={task.id} className="flex items-center gap-3 py-2.5 border-b border-[#1b14240f]">
                    <button
                      onClick={() => toggleTask(task)}
                      className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                        task.completed
                          ? 'bg-sage border-sage text-white'
                          : 'border-cream-border hover:border-primary'
                      }`}
                    >
                      {task.completed && (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      )}
                    </button>
                    <p className={`flex-1 min-w-0 text-sm font-medium truncate ${task.completed ? 'line-through text-cocoa/60' : 'text-bark'}`}>
                      {task.title}
                    </p>
                    {assignee && (
                      <div className="shrink-0">{getMemberAvatar(assignee, 25)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Card 3 - Grocery list (hidden in Child Mode - Lists is off-limits) */}
        <div className={`${childMode ? 'hidden ' : ''}bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5`} style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">
              Grocery list
              {shoppingItems.length > 0 && (
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}> · {shoppingItems.length} item{shoppingItems.length !== 1 ? 's' : ''}</span>
              )}
            </h2>
            <Link to="/lists?list=shopping" className="text-xs font-medium text-primary hover:underline">Open list →</Link>
          </div>
          {shoppingItems.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-bark font-medium">Shopping list is empty</p>
              <p className="text-xs text-cocoa mt-1.5 leading-relaxed">
                Tap <Link to="/lists?list=shopping" className="text-primary font-medium hover:underline">Open list →</Link> to
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
                {shoppingItems.slice(0, 5).map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0">
                    {/* Per-item emoji (same lookup as the Lists page) instead
                        of an aisle badge - the aisle only matters in-store,
                        where the full list is already grouped by it. */}
                    <span className="shrink-0 w-6 text-center" style={{ fontSize: 16 }} aria-hidden="true">
                      {getItemEmoji(item.item, item.aisle_category || item.category)}
                    </span>
                    <span className="flex-1 text-sm text-bark truncate capitalize">{item.item}</span>
                    {item.quantity && (
                      <span className="shrink-0 text-cocoa" style={{ fontSize: 12 }}>{item.quantity}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

      </div>

      {/* This week's meals - a full-row card below the 2-column grid
          (dashboard handoff): one chip per day Mon-Sun showing the day's
          dinner (or first planned meal), today outlined in plum. Hidden in
          Child Mode - Meal Plan is off-limits. */}
      {!childMode && (
        <div className="bg-linen rounded-2xl p-4.5 md:p-6 md:pt-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-sans font-semibold text-bark">This week&apos;s meals</h2>
            <Link to="/meals" className="text-xs font-medium text-primary hover:underline">Plan meals →</Link>
          </div>
          <div ref={mealsStripRef} className="flex gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-7 md:overflow-visible md:pb-0">
            {weekDays.map(({ date, dow, dm, dayMeals }) => {
              const today = date === todayDate;
              return (
                <Link
                  key={date}
                  data-today={today ? '1' : undefined}
                  to={`/meals?open=dinner&date=${date}&return=dashboard`}
                  className={`flex-none w-32 md:w-auto rounded-xl p-3 transition-colors ${
                    today
                      ? 'bg-plum-light border-[1.5px] border-plum'
                      : 'bg-cream border-[1.5px] border-transparent hover:bg-plum-light/60'
                  }`}
                >
                  <div className={`text-[11px] font-bold uppercase tracking-[0.04em] ${today ? 'text-primary' : 'text-cocoa'}`}>{dow}</div>
                  <div className="text-xs text-cocoa mt-0.5">{dm}</div>
                  {dayMeals.length === 0 ? (
                    <div className="text-sm italic text-cocoa/60 mt-2">Not planned</div>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {dayMeals.slice(0, 3).map((m, i) => (
                        <div key={m.id ?? i} className="text-sm font-medium text-bark leading-snug line-clamp-1">{m.meal_name}</div>
                      ))}
                      {dayMeals.length > 3 && (
                        <div className="text-xs font-medium text-cocoa">+{dayMeals.length - 3} more</div>
                      )}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

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
