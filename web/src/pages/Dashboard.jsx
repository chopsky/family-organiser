import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import TrialIndicatorCard from '../components/TrialIndicator';
import { WriteGate } from '../components/SubscribePrompt';
import { loadCached } from '../lib/offlineCache';

// ── Avatar colour map (same as Layout.jsx) ──────────────────────
const avatarColors = {
  red: 'bg-red text-white',
  'burnt-orange': 'bg-burnt-orange text-white',
  amber: 'bg-amber text-white',
  gold: 'bg-gold text-white',
  leaf: 'bg-leaf text-white',
  emerald: 'bg-emerald text-white',
  teal: 'bg-teal text-white',
  sky: 'bg-sky text-white',
  cobalt: 'bg-cobalt text-white',
  indigo: 'bg-indigo text-white',
  purple: 'bg-purple text-white',
  magenta: 'bg-magenta text-white',
  rose: 'bg-rose text-white',
  terracotta: 'bg-terracotta text-white',
  moss: 'bg-moss text-white',
  slate: 'bg-slate text-white',
  sage: 'bg-sage text-white',
  plum: 'bg-plum text-white',
  coral: 'bg-coral text-white',
  lavender: 'bg-indigo text-white',
};

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

// ── AI Chat Input ───────────────────────────────────────────────
function DashboardAiInput() {
  const aiInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);

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

  // Web Speech API — supported in Safari (incl. iOS WKWebView from iOS
  // 14.5+), Chrome, Edge. Each recognized phrase replaces the input
  // value; users can submit normally with the send button or by
  // pressing Enter. Tapping the mic again while recording stops it.
  // SpeechRecognitionSupported is browser-only so we re-detect each
  // click to avoid SSR / first-render issues.
  function handleMicClick() {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      // Tell the user gently rather than failing silently.
      alert('Voice input is not supported in this browser. Try Chrome or Safari.');
      return;
    }
    const recognition = new SR();
    recognition.lang = navigator.language || 'en-GB';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (aiInputRef.current) {
        aiInputRef.current.value = transcript;
        aiInputRef.current.focus();
      }
    };
    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);
    recognitionRef.current = recognition;
    setIsRecording(true);
    recognition.start();
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
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-warm-grey hover:text-primary rounded-lg hover:bg-plum-light/50 transition-colors"
            title="Attach image"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
          </button>
          {/* Voice input via the Web Speech API. Properly functional
              (transcribes one phrase into the input) so it doesn't
              trip App Review Guideline 2.1(a) like the old non-
              functional placeholder did. Falls back to an explanatory
              alert on unsupported browsers. */}
          <button
            type="button"
            onClick={handleMicClick}
            className={`p-2 rounded-lg transition-colors ${isRecording ? 'text-coral bg-coral/10' : 'text-warm-grey hover:text-primary hover:bg-plum-light/50'}`}
            title={isRecording ? 'Stop recording' : 'Voice input'}
            aria-pressed={isRecording}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
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
    try {
      await api.patch(`/tasks/${task.id}`, { completed: !task.completed });
      const { data } = await api.get('/digest');
      setDigest(data);
    } catch {
      // silently fail
    }
  }

  if (loading) return <Spinner />;

  const now = new Date();
  // Dropped the year to match the kicker format the greeting uses
  // (e.g. "SATURDAY 18 APRIL · 3 EVENTS"). CSS text-transform: uppercase
  // handles the all-caps rendering.
  const todayStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayEvents = digest?.todayEvents ?? [];
  const eventCount = todayEvents.length;
  const members = digest?.members ?? [];
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
  // the household roster — anyone removed from the household post-hoc
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
    const ac = avatarColors[member.color_theme] || avatarColors.sage;
    if (member.avatar_url) {
      return <img src={member.avatar_url} alt={member.name} className="w-8 h-8 rounded-full object-cover" />;
    }
    return (
      <div className={`w-8 h-8 rounded-full ${ac} flex items-center justify-center text-xs font-bold`}>
        {member.name?.[0]?.toUpperCase()}
      </div>
    );
  }

  const EVENT_DOT_CYCLE = ['bg-plum', 'bg-coral', 'bg-[#E0A458]', 'bg-sage'];
  function getEventDotColor(ev, index = 0) {
    return EVENT_DOT_CYCLE[index % EVENT_DOT_CYCLE.length];
  }


  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Greeting — kicker (date + event count) above, serif headline below.
          Matches the Housemait editorial greeting style. */}
      <div>
        <p
          style={{
            color: 'var(--color-plum)',
            marginBottom: '6px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {todayStr}
          {eventCount > 0 && <span> · {eventCount} event{eventCount !== 1 ? 's' : ''}</span>}
        </p>
        <h1
          // Responsive sizing via Tailwind arbitrary values — mobile gets
          // the cosier 36px treatment, desktop the full 56px editorial
          // headline. Inline styles cover properties Tailwind can't express
          // with utilities here (custom font family + weight).
          className="text-[42px] md:text-[52px] leading-[1.05] md:leading-[1.02] tracking-[-0.8px] md:tracking-[-1px]"
          style={{
            fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif',
            fontWeight: 400,
            margin: 0,
          }}
        >
          {getGreeting()},
          <br />
          <i>{user?.name}</i>.
        </h1>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Trial reminder card — only renders when the household is trialing
          and has ≤10 days remaining. Silently no-ops otherwise (active,
          expired, internal testers, or the first 20 days of the trial). */}
      <TrialIndicatorCard />

      {/* AI chat input — replaced with a subscribe prompt for expired
          households so typing into a broken input doesn't turn into a
          jarring 402 → redirect moment. */}
      <WriteGate size="lg" message="Subscribe to create events, tasks, and more with AI">
        <DashboardAiInput />
      </WriteGate>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Card 1 — Today's schedule */}
        <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-sans font-semibold text-bark">Today's schedule</h2>
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
                    <div key={ev.id || i} className="flex items-center gap-3 px-3 py-2.5 bg-cream rounded-xl">
                      <span className={`w-[3px] h-7 rounded-full shrink-0 ${barColor}`} />
                      <span className="text-[0.8125rem] font-bold text-bark shrink-0 tabular-nums w-10">{formatTime(ev.start_time)}</span>
                      <p className="text-sm text-bark truncate flex-1 min-w-0">{ev.title}</p>
                      {visibleAvatars.length > 0 && (
                        <div className="shrink-0 flex -space-x-2">
                          {visibleAvatars.map(m => (
                            <div key={m.id} className="ring-2 ring-cream rounded-full">
                              {getMemberAvatar(m)}
                            </div>
                          ))}
                          {overflowCount > 0 && (
                            <div className="ring-2 ring-cream rounded-full w-8 h-8 bg-linen text-cocoa text-[11px] font-semibold flex items-center justify-center">
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

        {/* Card 2 — Tasks */}
        <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-sans font-semibold text-bark">Tasks</h2>
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

        {/* Card 3 — Grocery list */}
        <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-sans font-semibold text-bark">Grocery list</h2>
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
                  aligned]. Cap at 5 rows so the dashboard card stays compact —
                  the 'N items' line at the bottom tells the user how many more
                  there are. */}
              <div className="flex flex-col" style={{ gap: 6 }}>
                {shoppingItems.slice(0, 5).map((item) => {
                  const badge = getCatBadge(item.aisle_category || item.category || 'Other');
                  return (
                    <div key={item.id} className="flex items-center" style={{ gap: 10, padding: '4px 0' }}>
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

        {/* Card 4 — Today's meals */}
        <div className="bg-linen rounded-2xl p-5" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-sans font-semibold text-bark">Today's meals</h2>
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
      {nlModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-linen w-full sm:w-[440px] sm:rounded-2xl rounded-t-2xl shadow-lg border border-cream-border p-5">
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
        </div>
      )}
    </div>
  );
}
