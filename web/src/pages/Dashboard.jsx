import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import Spinner from '../components/Spinner';
import ErrorBanner from '../components/ErrorBanner';

function StatCard({ emoji, label, value, to }) {
  return (
    <Link
      to={to}
      className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:shadow-md transition-shadow"
    >
      <span className="text-3xl">{emoji}</span>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
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

  useEffect(() => {
    api.get('/digest')
      .then(({ data }) => setDigest(data))
      .catch(() => setError('Could not load dashboard data.'))
      .finally(() => setLoading(false));
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
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          👋 Hello, {user?.name}!
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard emoji="🛒" label="Shopping items" value={shoppingCount}       to="/shopping" />
        <StatCard emoji="⚠️" label="Overdue / due today" value={outstandingCount} to="/tasks"    />
        <StatCard emoji="📅" label="Coming up"      value={upcomingCount}       to="/tasks"    />
        <StatCard emoji="🏠" label={`${household?.name ?? ''} members`}
                  value={digest?.members?.length ?? 0}                          to="/settings" />
      </div>

      {/* Natural-language input */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-800 mb-3">➕ Add items or tasks</h2>
        <form onSubmit={handleNlSubmit} className="flex gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. Buy milk and remind Jake to do homework"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <button
            type="button"
            onClick={startVoice}
            title="Voice input"
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-3 py-2 text-lg transition-colors"
          >
            🎤
          </button>
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            {sending ? '…' : 'Add'}
          </button>
        </form>
        {nlResult && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">{nlResult}</p>
        )}
      </div>

      {/* Outstanding tasks */}
      {outstandingCount > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">⚠️ Needs attention</h2>
          <ul className="space-y-2">
            {(digest.outstanding ?? []).slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <span className="text-red-500 mt-0.5">●</span>
                <span className="text-gray-700">
                  {t.title}
                  {t.assigned_to_name && (
                    <span className="text-gray-400"> · {t.assigned_to_name}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {outstandingCount > 5 && (
            <Link to="/tasks" className="text-orange-500 text-sm mt-2 block hover:underline">
              + {outstandingCount - 5} more →
            </Link>
          )}
        </div>
      )}

      {/* Members */}
      {digest?.members?.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">👨‍👩‍👧 Household</h2>
          <div className="flex flex-wrap gap-2">
            {digest.members.map((m) => (
              <span
                key={m.id}
                className="bg-orange-50 text-orange-600 rounded-full px-3 py-1 text-sm font-medium"
              >
                {m.name}
                {m.role === 'admin' && <span className="ml-1 text-orange-400 text-xs">admin</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
