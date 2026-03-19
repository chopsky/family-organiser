import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';
import { IconCart, IconAlert, IconCalendar, IconUsers, IconPlus, IconMic } from '../components/Icons';

function StatCard({ icon, label, value, to }) {
  return (
    <Link
      to={to}
      className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5 flex items-center gap-4 hover:shadow-md transition-shadow"
    >
      <div className="w-10 h-10 rounded-full bg-secondary/30 text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-bark">{value}</p>
        <p className="text-sm text-cocoa">{label}</p>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { user, household } = useAuth();
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  // Natural-language input
  const [text, setText]         = useState('');
  const [sending, setSending]   = useState(false);
  const [nlResult, setNlResult] = useState('');
  const [schoolData, setSchoolData] = useState([]);

  useEffect(() => {
    api.get('/digest')
      .then(({ data }) => setDigest(data))
      .catch(() => setError('Could not load dashboard data.'))
      .finally(() => setLoading(false));

    // Load school activities for this week
    api.get('/schools')
      .then(({ data }) => setSchoolData(data.schools || []))
      .catch(() => {});
  }, []);

  async function handleNlSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    setNlResult('');
    try {
      const { data } = await api.post('/classify', { text: text.trim() });
      setNlResult(data.result?.response_message || 'Done!');
      setText('');
      // Refresh digest
      const { data: d2 } = await api.get('/digest');
      setDigest(d2);
    } catch {
      setNlResult('Could not process that. Please try again.');
    } finally {
      setSending(false);
    }
  }

  // Voice input (Web Speech API)
  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Voice input not supported in this browser.'); return; }
    const rec = new SpeechRecognition();
    rec.lang = 'en-GB';
    rec.interimResults = false;
    rec.onresult = (e) => setText(e.results[0][0].transcript);
    rec.start();
  }

  if (loading) return <Spinner />;

  const outstandingCount = digest?.outstanding?.length ?? 0;
  const upcomingCount    = digest?.upcoming?.length    ?? 0;
  const shoppingCount    = digest?.shoppingCount       ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-semibold text-bark">
          Hey, {user?.name}! 👋
        </h1>
        <p className="text-cocoa text-sm mt-1">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard icon={<IconCart className="h-5 w-5" />}     label="Shopping items"     value={shoppingCount}       to="/shopping" />
        <StatCard icon={<IconAlert className="h-5 w-5" />}    label="Overdue / due today" value={outstandingCount} to="/tasks"    />
        <StatCard icon={<IconCalendar className="h-5 w-5" />} label="Coming up"          value={upcomingCount}       to="/tasks"    />
        <StatCard icon={<IconUsers className="h-5 w-5" />}    label={`${household?.name ?? ''} members`}
                  value={digest?.members?.length ?? 0}                                                              to="/settings" />
      </div>

      {/* Natural-language input */}
      <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
        <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">
          <IconPlus className="h-4 w-4" /> Add items or tasks
        </h2>
        <form onSubmit={handleNlSubmit} className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Buy milk and remind Jake to do homework"
            className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="button"
            onClick={startVoice}
            title="Voice input"
            className="bg-oat hover:bg-sand text-bark rounded-2xl px-3 py-2 transition-colors"
          >
            <IconMic className="h-5 w-5" />
          </button>
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white rounded-2xl px-4 py-2 text-sm font-medium transition-colors"
          >
            {sending ? '…' : 'Add'}
          </button>
        </form>
        {nlResult && (
          <p className="mt-3 text-sm text-success bg-success/10 rounded-lg px-3 py-2">{nlResult}</p>
        )}
      </div>

      {/* Outstanding tasks */}
      {outstandingCount > 0 && (
        <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
          <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">
            <IconAlert className="h-4 w-4" /> Needs attention
          </h2>
          <ul className="space-y-2">
            {(digest.outstanding ?? []).slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <span className="text-error mt-0.5">●</span>
                <span className="text-bark">
                  {t.title}
                  {t.assigned_to_name && (
                    <span className="text-cocoa"> · {t.assigned_to_name}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {outstandingCount > 5 && (
            <Link to="/tasks" className="text-primary text-sm mt-2 block hover:underline">
              + {outstandingCount - 5} more →
            </Link>
          )}
        </div>
      )}

      {/* School this week */}
      {schoolData.some(s => s.children?.length > 0) && (() => {
        const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const today = new Date();
        const todayDow = (today.getDay() + 6) % 7; // 0=Mon
        const allActivities = [];
        schoolData.forEach(s => {
          (s.children || []).forEach(c => {
            (c.activities || []).forEach(a => {
              allActivities.push({ ...a, child_name: c.name, child_color: c.color_theme });
            });
          });
        });
        // Group by day for the week
        const weekDays = [0, 1, 2, 3, 4].map(d => ({
          day: DAY_LABELS[d],
          isToday: d === todayDow,
          activities: allActivities.filter(a => a.day_of_week === d),
        }));
        const hasAnyActivities = allActivities.length > 0;
        if (!hasAnyActivities) return null;
        return (
          <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
            <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">
              🏫 School this week
            </h2>
            <div className="grid grid-cols-5 gap-2">
              {weekDays.map(({ day, isToday, activities }) => (
                <div key={day} className={`text-center rounded-xl p-2 ${isToday ? 'bg-plum-light border border-plum/20' : ''}`}>
                  <div className={`text-xs font-semibold mb-1 ${isToday ? 'text-plum' : 'text-cocoa'}`}>{day}</div>
                  {activities.length > 0 ? (
                    <div className="space-y-1">
                      {activities.map((a, i) => (
                        <div key={i} className="text-[11px] text-bark">
                          <span className="font-medium">{a.child_name}</span>
                          <div className="text-cocoa">{a.activity}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-cocoa">—</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Members */}
      {digest?.members?.length > 0 && (
        <div className="bg-linen rounded-2xl shadow-sm border border-cream-border p-5">
          <h2 className="font-semibold text-bark mb-3 flex items-center gap-2">
            <IconUsers className="h-4 w-4" /> Household
          </h2>
          <div className="flex flex-wrap gap-2">
            {digest.members.map((m) => (
              <span
                key={m.id}
                className="bg-secondary/30 text-primary rounded-full px-3 py-1 text-sm font-medium"
              >
                {m.name}
                {m.role === 'admin' && <span className="ml-1 text-primary text-xs">admin</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
