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
      const { data } = await api.post('/auth/create-household', { name: name.trim() });
      login(data);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/Curata-Symbol-white.png" alt="Curata" className="h-16 mx-auto mb-4 bg-emerald-600 rounded-2xl p-2" />
          <h1 className="text-2xl font-bold text-gray-900">Welcome to Curata!</h1>
          <p className="text-gray-500 mt-2">Create your household to get started.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Create a household</h2>
          <p className="text-sm text-gray-500 mb-4">
            Give your household a name — you can change it later.
          </p>

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <form onSubmit={handleCreate} className="space-y-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. The Shapiros"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              {loading ? 'Creating...' : 'Create household'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Once created, you can invite family members from Settings.
        </p>
      </div>
    </div>
  );
}
