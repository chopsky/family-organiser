import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';

export default function SetupHousehold() {
  const [name, setName]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const { login }             = useAuth();
  const navigate              = useNavigate();

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) { setError('Please enter a household name.'); return; }
    setLoading(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
      const { data } = await api.post('/auth/create-household', { name: name.trim(), timezone });
      login(data);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-oat flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/Curata-favicon.png" alt="Curata" className="h-16 mx-auto mb-4 rounded-2xl" />
          <h1 className="text-2xl font-bold text-bark">Welcome to Curata!</h1>
          <p className="text-cocoa mt-2">Create your household to get started.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
          <h2 className="text-lg font-semibold text-bark mb-4">Create a household</h2>
          <p className="text-sm text-cocoa mb-4">
            Give your household a name — you can change it later.
          </p>

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <form onSubmit={handleCreate} className="space-y-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Shapiros"
              className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              {loading ? 'Creating...' : 'Create household'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-cocoa mt-6">
          Once created, you can invite family members from Settings.
        </p>
      </div>
    </div>
  );
}
