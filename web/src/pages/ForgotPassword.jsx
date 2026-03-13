import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';

export default function ForgotPassword() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch {
      setSent(true); // Always show success to prevent email enumeration
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/Curata-Symbol-white.png" alt="Curata" className="h-16 mx-auto mb-4 bg-emerald-600 rounded-2xl p-2" />
        </div>
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Reset your password</h2>
          <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send you a reset link.</p>

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {sent ? (
            <div className="text-center">
              <div className="text-4xl mb-3">📧</div>
              <p className="text-gray-600 mb-4">If that email is registered, we've sent a reset link.</p>
              <Link to="/login" className="text-emerald-600 font-medium hover:underline">Back to login</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                autoComplete="email"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          <Link to="/login" className="text-emerald-600 font-medium hover:underline">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
