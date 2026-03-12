import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';

export default function Login() {
  const [code, setCode]     = useState('');
  const [name, setName]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const { login }           = useAuth();
  const navigate            = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!code.trim() || !name.trim()) {
      setError('Please enter your household code and your name.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/join', {
        code: code.trim().toUpperCase(),
        name: name.trim(),
      });
      login(data);
      navigate('/dashboard');
    } catch (err) {
      const msg = err.response?.data?.error;
      if (err.response?.status === 404) setError('Household code not found. Check the code and try again.');
      else setError(msg || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo / hero */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🏠</div>
          <h1 className="text-3xl font-bold text-gray-900">Family Organiser</h1>
          <p className="text-gray-500 mt-2">Shopping lists, tasks & reminders — together.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6">Join your household</h2>

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Household code
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. ABC123"
                maxLength={10}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-lg font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="off"
                autoCapitalize="characters"
              />
              <p className="text-xs text-gray-400 mt-1">
                Ask a family member or check the Telegram bot for your code.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Your name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah"
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoComplete="given-name"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-3 rounded-lg transition-colors mt-2"
            >
              {loading ? 'Joining…' : 'Join household →'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          New household? Set one up via the Telegram bot with /create
        </p>
      </div>
    </div>
  );
}
