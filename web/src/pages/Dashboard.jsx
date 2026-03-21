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

// ── Shopping category colours ───────────────────────────────────
const CATEGORY_BADGE = {
  fruit:          { bg: 'bg-[#E8F5E9]', text: 'text-[#388E3C]', label: 'FRUIT' },
  'fruit & veg':  { bg: 'bg-[#E8F5E9]', text: 'text-[#388E3C]', label: 'VEG' },
  vegetables:     { bg: 'bg-[#E8F5E9]', text: 'text-[#388E3C]', label: 'VEG' },
  veg:            { bg: 'bg-[#E8F5E9]', text: 'text-[#388E3C]', label: 'VEG' },
  meat:           { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'MEAT' },
  'meat & fish':  { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'MEAT' },
  fish:           { bg: 'bg-[#FFEBEE]', text: 'text-[#C62828]', label: 'FISH' },
  dairy:          { bg: 'bg-[#E3F2FD]', text: 'text-[#1565C0]', label: 'DAIRY' },
  bakery:         { bg: 'bg-[#FFF8E1]', text: 'text-[#F57F17]', label: 'BAKERY' },
  bread:          { bg: 'bg-[#FFF8E1]', text: 'text-[#F57F17]', label: 'BAKERY' },
  frozen:         { bg: 'bg-[#E0F7FA]', text: 'text-[#00838F]', label: 'FROZEN' },
  drinks:         { bg: 'bg-[#F3E5F5]', text: 'text-[#7B1FA2]', label: 'DRINKS' },
  snacks:         { bg: 'bg-[#FFF3E0]', text: 'text-[#E65100]', label: 'SNACKS' },
  household:      { bg: 'bg-[#ECEFF1]', text: 'text-[#455A64]', label: 'HOME' },
  toiletries:     { bg: 'bg-[#FCE4EC]', text: 'text-[#AD1457]', label: 'BATH' },
  other:          { bg: 'bg-oat',       text: 'text-cocoa',      label: 'OTHER' },
};

function getCatBadge(cat) {
  if (!cat) return CATEGORY_BADGE.other;
  return CATEGORY_BADGE[cat.toLowerCase()] || { bg: 'bg-oat', text: 'text-cocoa', label: cat.toUpperCase().slice(0, 6) };
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

  // Group shopping by category (max 4 groups for the dashboard)
  const shoppingByCategory = {};
  shoppingItems.forEach(item => {
    const cat = item.category || 'other';
    if (!shoppingByCategory[cat]) shoppingByCategory[cat] = [];
    shoppingByCategory[cat].push(item);
  });
  const shoppingGroups = Object.entries(shoppingByCategory).slice(0, 4);

  // This week's dinners (Mon–Sun)
  const monday = getMonday(now);
  const DAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const weekDinners = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const meal = weekMeals.find(m => m.date === dateStr && m.category?.toLowerCase() === 'dinner');
    return {
      label: DAY_LABELS[i],
      dateStr,
      isPast: dateStr < todayDate,
      isToday: dateStr === todayDate,
      meal,
    };
  }).filter(d => !d.isPast || d.isToday).slice(0, 4);

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
    if (member?.color_theme) return dotColors[member.color_theme] || 'bg-plum';
    return dotColors[ev.color] || 'bg-plum';
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
        <h1 className="text-2xl font-display font-semibold text-bark">
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
          <svg className="h-4 w-4 text-cocoa" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
          Grocery list
        </button>
        <button
          onClick={() => navigate('/shopping?scan=1')}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-linen border border-cream-border rounded-full text-sm font-medium text-bark hover:shadow-sm hover:border-primary/30 transition-all"
        >
          <svg className="h-4 w-4 text-cocoa" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M7 15h0M2 9.5h20" /></svg>
          Scan receipt
        </button>
      </div>

      {/* 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Card 1 — Today's schedule */}
        <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
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
                    <div key={ev.id || i} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-cream-border/60">
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
        <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
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
        <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-bark">Grocery list</h2>
            <Link to="/shopping" className="text-xs font-medium text-primary hover:underline">Open list →</Link>
          </div>
          {shoppingItems.length === 0 ? (
            <p className="text-sm text-cocoa py-4 text-center">Shopping list is empty</p>
          ) : (
            <>
              <div className="space-y-2.5">
                {shoppingGroups.map(([cat, items]) => {
                  const badge = getCatBadge(cat);
                  return (
                    <div key={cat} className="flex items-start gap-2.5">
                      <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${badge.bg} ${badge.text} mt-0.5`}>
                        {badge.label}
                      </span>
                      <span className="text-sm text-bark">
                        {items.slice(0, 3).map(i => i.item).join(', ')}
                        {items.length > 3 && <span className="text-cocoa"> +{items.length - 3}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-cream-border/50">
                <p className="text-xs text-cocoa">
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
        <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold text-bark">This week's meals</h2>
            <Link to="/meals" className="text-xs font-medium text-primary hover:underline">Plan meals →</Link>
          </div>
          <div className="space-y-0">
            {weekDinners.map((day) => {
              const mealColors = day.meal ? {
                bg: day.isToday ? 'bg-[#AED6F1]/20' : 'bg-white',
              } : {};
              return (
                <div
                  key={day.dateStr}
                  className={`flex items-center gap-3 py-2.5 border-b border-cream-border/50 last:border-0 ${day.isToday ? 'rounded-lg bg-[#AED6F1]/10 -mx-2 px-2' : ''}`}
                >
                  <span className={`text-[11px] font-bold w-8 shrink-0 ${day.isToday ? 'text-[#1F5F8B]' : 'text-cocoa'}`}>
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
              );
            })}
          </div>
        </div>
      </div>

      {/* Card 5 — School this week (full width) */}
      {schoolData.some(s => s.children?.length > 0) && (() => {
        const DAY_LABELS_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const todayDow = (now.getDay() + 6) % 7; // 0=Mon
        const allActivities = [];
        schoolData.forEach(s => {
          (s.children || []).forEach(c => {
            (c.activities || []).forEach(a => {
              allActivities.push({ ...a, child_name: c.name, child_color: c.color_theme });
            });
          });
        });
        const weekDays = [0, 1, 2, 3, 4].map(d => ({
          day: DAY_LABELS_FULL[d],
          isToday: d === todayDow,
          activities: allActivities.filter(a => a.day_of_week === d),
        }));
        if (allActivities.length === 0) return null;
        return (
          <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-bark flex items-center gap-2">
                🏫 School this week
              </h2>
              <Link to="/settings" className="text-xs font-medium text-primary hover:underline">View details →</Link>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {weekDays.map(({ day, isToday, activities }) => (
                <div key={day} className={`text-center rounded-xl p-2.5 transition-colors ${isToday ? 'bg-plum-light border border-plum/20' : 'bg-white/50'}`}>
                  <div className={`text-xs font-semibold mb-2 ${isToday ? 'text-plum' : 'text-cocoa'}`}>{day}</div>
                  {activities.length > 0 ? (
                    <div className="space-y-1.5">
                      {activities.map((a, i) => (
                        <div key={i} className="text-[11px] text-bark">
                          <span className="font-semibold">{a.child_name}</span>
                          <div className="text-cocoa">{a.activity}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-cocoa/50">—</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
