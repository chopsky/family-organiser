import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import SocialButtons from '../components/SocialButtons';

export default function Login() {
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [resendState, setResendState] = useState('idle'); // idle | sending | sent
  const { login }                 = useAuth();
  const navigate                  = useNavigate();
  const [searchParams]            = useSearchParams();

  const verified = searchParams.get('verified') === 'true';
  const tokenError = searchParams.get('error');
  const needsVerification = error.toLowerCase().includes('verify your email');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResendState('idle');
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
      navigate(postLoginRoute(data));
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (!email.trim() || resendState === 'sending') return;
    setResendState('sending');
    try {
      await api.post('/auth/resend-verification', { email: email.trim() });
      setResendState('sent');
    } catch {
      // Endpoint always returns 200 to prevent enumeration, so only network errors land here
      setResendState('sent');
    }
  }

  function handleSocialSuccess(data) {
    login(data);
    navigate(postLoginRoute(data));
  }

  // Shared router for every post-login path:
  //   1. No household yet → create one first
  //   2. Household exists but onboarding wizard not done → run wizard
  //   3. Otherwise → straight to the dashboard
  function postLoginRoute(data) {
    if (!data.household) return '/setup';
    if (!data.user?.onboarded_at) return '/onboarding';
    return '/dashboard';
  }

  return (
    <div className="min-h-screen bg-oat flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/housemait-logomark.png" alt="Housemait" className="h-12 mx-auto mb-4" />
          <h1 className="text-bark" style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 42, lineHeight: 1.1, letterSpacing: '-0.015em' }}>Welcome <em style={{ fontStyle: 'italic', color: '#6B2FB8' }}>back.</em></h1>
          <p className="text-cocoa mt-2">Running the home, made pain-free.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
          {verified && (
            <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2 mb-4">Email verified! You can now log in.</p>
          )}
          {tokenError === 'invalid-token' && (
            <p className="text-sm text-error bg-error/10 rounded-lg px-3 py-2 mb-4">Invalid or expired verification link.</p>
          )}

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {needsVerification && resendState !== 'sent' && (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendState === 'sending' || !email.trim()}
              className="text-sm text-primary hover:underline disabled:opacity-50 disabled:no-underline mb-4"
            >
              {resendState === 'sending' ? 'Sending…' : 'Resend verification email'}
            </button>
          )}
          {resendState === 'sent' && (
            <p className="text-sm text-success bg-success/10 rounded-lg px-3 py-2 mb-4">
              If that email is registered and unverified, a new verification link has been sent. Check your inbox.
            </p>
          )}

          <SocialButtons onSuccess={handleSocialSuccess} onError={setError} />

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-border" /></div>
            <div className="relative flex justify-center text-sm"><span className="bg-white px-4 text-cocoa">or log in with email</span></div>
          </div>

          <form onSubmit={handleSubmit} autoComplete="on" className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-bark mb-1">Email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="username"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-bark mb-1">Password</label>
              <input
                id="login-password"
                name="password"
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
