import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import SocialButtons from '../components/SocialButtons';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const { login }               = useAuth();
  const navigate                = useNavigate();
  const [searchParams]          = useSearchParams();

  const verified = searchParams.get('verified') === 'true';
  const tokenError = searchParams.get('error');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        email: email.trim(),
        password,
      });
      login(data);
      navigate(data.household ? '/dashboard' : '/setup');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  function handleSocialSuccess(data) {
    login(data);
    navigate(data.household ? '/dashboard' : '/setup');
  }

  return (
    <div className="min-h-screen bg-oat flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/Curata-favicon.png" alt="Curata" className="h-16 mx-auto mb-4 rounded-2xl" />
          <h1 className="text-3xl font-bold text-bark">Curata</h1>
          <p className="text-cocoa mt-2">Shopping lists, tasks & reminders — together.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
          {verified && (
            <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2 mb-4">Email verified! You can now log in.</p>
          )}
          {tokenError === 'invalid-token' && (
            <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2 mb-4">Invalid or expired verification link.</p>
          )}

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <SocialButtons onSuccess={handleSocialSuccess} onError={setError} />

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-border" /></div>
            <div className="relative flex justify-center text-sm"><span className="bg-white px-4 text-cocoa">or log in with email</span></div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-bark mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-bark mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="current-password"
              />
              <div className="text-right mt-1">
                <Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              {loading ? 'Logging in...' : 'Log in'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-cocoa mt-6">
          Don't have an account? <Link to="/signup" className="text-primary font-medium hover:underline">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
