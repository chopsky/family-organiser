import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';

export default function ResetPassword() {
  const [password, setPassword]   = useState('');
  const [confirm, setConfirm]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState(false);
  const navigate                  = useNavigate();
  const [searchParams]            = useSearchParams();
  const token                     = searchParams.get('token');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!password || password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-oat flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8 max-w-md text-center">
          <p className="text-error mb-4">Invalid reset link.</p>
          <Link to="/forgot-password" className="text-primary font-medium hover:underline">Request a new one</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-oat flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/housemait-logomark.png" alt="Housemait" className="h-16 mx-auto mb-4 rounded-2xl" />
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
          <h2 className="text-xl font-semibold text-bark mb-6">Set a new password</h2>
          <ErrorBanner message={error} onDismiss={() => setError('')} />
          {success ? (
            <p className="text-success bg-success/10 rounded-lg px-3 py-2">Password updated! Redirecting to login...</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-bark mb-1">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-bark mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Same password again"
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  autoComplete="new-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-3 rounded-2xl transition-colors"
              >
                {loading ? 'Updating...' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
