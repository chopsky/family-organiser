import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';

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
  return d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
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
    api.get('/digest')
      .then(({ data }) => setDigest(data))
      .catch(() => setError('Could not load dashboard data.'))
      .finally(() => setLoading(false));

    api.get('/schools')
      .then(({ data }) => setSchoolData(data.schools || []))
      .catch(() => {});
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
  const todayStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayEvents = digest?.todayEvents ?? [];
  const eventCount = todayEvents.length;
  const members = digest?.members ?? [];
  const outstanding = digest?.outstanding ?? [];
  const shoppingItems = (digest?.shoppingItems ?? []).filter(i => !i.completed);
  const weekMeals = digest?.weekMeals ?? [];

  // Group shopping by aisle category (max 4 groups for the dashboard)
  const shoppingByAisle = {};
  shoppingItems.forEach(item => {
    const cat = item.aisle_category || item.category || 'Other';
    if (!shoppingByAisle[cat]) shoppingByAisle[cat] = [];
    shoppingByAisle[cat].push(item);
  });
  const shoppingGroups = Object.entries(shoppingByAisle).slice(0, 4);

  // This week's dinners — today + next 3 days
  const DAY_LABELS_FULL = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekDinners = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const meal = weekMeals.find(m => m.date === dateStr && m.category?.toLowerCase() === 'dinner');
    return {
      label: DAY_LABELS_FULL[d.getDay()],
      dateStr,
      isToday: dateStr === todayDate,
      meal,
    };
  });

  // Find member info for events
  function getMemberForEvent(ev) {
    return members.find(m => m.name === ev.assigned_to_name);
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

  function getEventDotColor(ev) {
    const member = getMemberForEvent(ev);
    if (member?.color_theme) return dotColors[member.color_theme] || 'bg-sage';
    // Unassigned / synced events default to sage
    return 'bg-sage';
  }

  // Shopping list last updated info
  const lastUpdatedItem = shoppingItems.length > 0 ? shoppingItems.reduce((latest, item) => {
    if (!latest) return item;
    return (item.updated_at || item.created_at) > (latest.updated_at || latest.created_at) ? item : latest;
  }, null) : null;
  const lastUpdatedBy = lastUpdatedItem?.added_by_name || lastUpdatedItem?.created_by_name;
  const lastUpdatedAt = lastUpdatedItem?.updated_at || lastUpdatedItem?.created_at;
  const lastUpdatedAgo = lastUpdatedAt ? (() => {
    const mins = Math.round((now - new Date(lastUpdatedAt)) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  })() : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="font-display font-semibold text-bark" style={{ fontSize: 28 }}>
          {getGreeting()}, {user?.name}! 👋
        </h1>
        <p className="text-cocoa text-sm mt-1">
          {todayStr}
          {eventCount > 0 && <span> · {eventCount} event{eventCount !== 1 ? 's' : ''} today</span>}
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Quick action pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setNlMode('event'); setNlText(''); setNlResult(''); setNlModalOpen(true); }}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-linen border border-cream-border rounded-full text-sm font-medium text-bark hover:shadow-sm hover:border-primary/30 transition-all"
        >
          <span className="text-primary">+</span> Add event
        </button>
        <button
          onClick={() => { setNlMode('task'); setNlText(''); setNlResult(''); setNlModalOpen(true); }}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-linen border border-cream-border rounded-full text-sm font-medium text-bark hover:shadow-sm hover:border-primary/30 transition-all"
        >
          <span className="text-primary">+</span> Add task
        </button>
        <button
          onClick={() => navigate('/shopping')}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-linen border border-cream-border rounded-full text-sm font-medium text-bark hover:shadow-sm hover:border-primary/30 transition-all"
        >
          <svg className="h-4 w-4 text-sage" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
          Grocery list
        </button>
        <button
          onClick={() => navigate('/receipt')}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-linen border border-cream-border rounded-full text-sm font-medium text-bark hover:shadow-sm hover:border-primary/30 transition-all"
        >
          <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
          Scan receipt
        </button>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Card 1 — Today's schedule */}
        <div className="bg-linen rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-bark">Today's schedule</h2>
            <Link to="/calendar" className="text-xs font-medium text-primary hover:underline">View calendar →</Link>
          </div>
          {todayEvents.length === 0 ? (
            <p className="text-sm text-cocoa py-4 text-center">No events today</p>
          ) : (
            <div className="space-y-2">
              {todayEvents
                .sort((a, b) => new Date(a.start_time || a.date) - new Date(b.start_time || b.date))
                .slice(0, 6)
                .map((ev, i) => {
                  const member = getMemberForEvent(ev);
                  return (
                    <div key={ev.id || i} className="flex items-center gap-3 px-4 py-3.5 bg-cream rounded-xl">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getEventDotColor(ev)}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-bark truncate">{ev.title}</p>
                        <p className="text-xs text-cocoa">{formatTime(ev.start_time)}</p>
                      </div>
                      {member && getMemberAvatar(member)}
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Card 2 — Tasks */}
        <div className="bg-linen rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-bark">Tasks</h2>
            <Link to="/tasks" className="text-xs font-medium text-primary hover:underline">View all →</Link>
          </div>
          {outstanding.length === 0 ? (
            <p className="text-sm text-cocoa py-4 text-center">All caught up!</p>
          ) : (
            <ul className="space-y-1">
              {outstanding.slice(0, 5).map((task) => (
                <li key={task.id} className="flex items-start gap-3 py-2">
                  <button
                    onClick={() => toggleTask(task)}
                    className={`shrink-0 mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                      task.completed
                        ? 'bg-sage border-sage text-white'
                        : 'border-cream-border hover:border-primary'
                    }`}
                  >
                    {task.completed && (
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    )}
                  </button>
                  <span className={`text-sm ${task.completed ? 'line-through text-cocoa/60' : 'text-bark'}`}>
                    {task.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Card 3 — Grocery list */}
        <div className="bg-linen rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-bark">Grocery list</h2>
            <Link to="/shopping" className="text-xs font-medium text-primary hover:underline">Open list →</Link>
          </div>
          {shoppingItems.length === 0 ? (
            <p className="text-sm text-cocoa py-4 text-center">Shopping list is empty</p>
          ) : (
            <>
              <div className="flex flex-col" style={{ gap: 6 }}>
                {shoppingGroups.map(([cat, items]) => {
                  const badge = getCatBadge(cat);
                  return (
                    <div key={cat} className="flex items-center" style={{ gap: 10, padding: '6px 0' }}>
                      <span
                        className={`shrink-0 uppercase tracking-wide ${badge.bg} ${badge.text}`}
                        style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, letterSpacing: '0.05em' }}
                      >
                        {badge.label}
                      </span>
                      <span style={{ fontSize: 13 }} className="text-bark">
                        {items.slice(0, 3).map(i => i.item).join(', ')}
                        {items.length > 3 && <span className="text-cocoa"> +{items.length - 3}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-cream-border, #E8E5EC)', fontSize: 12, color: 'var(--warm-grey, #6B6774)' }}>
                <p>
                  {shoppingItems.length} item{shoppingItems.length !== 1 ? 's' : ''}
                  {lastUpdatedBy && lastUpdatedAgo && (
                    <span> · Updated by {lastUpdatedBy} {lastUpdatedAgo}</span>
                  )}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Card 4 — This week's meals */}
        <div className="bg-linen rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-bark">This week's meals</h2>
            <Link to="/meals" className="text-xs font-medium text-primary hover:underline">Plan meals →</Link>
          </div>
          <div className="space-y-2">
            {weekDinners.map((day) => (
              <div
                key={day.dateStr}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${day.isToday ? 'bg-plum-light' : 'bg-cream'}`}
              >
                <span className={`text-[11px] font-bold w-8 shrink-0 ${day.isToday ? 'text-primary' : 'text-cocoa'}`}>
                  {day.label}
                </span>
                {day.meal ? (
                  <div className="flex-1 flex items-center justify-between min-w-0">
                    <span className="text-sm font-medium text-bark truncate">{day.meal.meal_name}</span>
                    {(day.meal.recipe?.prep_time_mins || day.meal.prep_time_mins) && (
                      <span className="shrink-0 text-[10px] font-medium text-sage bg-sage-light px-2 py-0.5 rounded-full ml-2">
                        {day.meal.recipe?.prep_time_mins || day.meal.prep_time_mins} min
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-sm italic text-cocoa/60">Not planned yet</span>
                )}
              </div>
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
