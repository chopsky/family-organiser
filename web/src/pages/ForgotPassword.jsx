import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import TurnstileWidget from '../components/TurnstileWidget';
import { localeHomePath } from '../hooks/useLocale';

export default function ForgotPassword() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState('');
  const [turnstileToken, setTurnstileToken] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Please enter your email.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', {
        email: email.trim(),
        turnstile_token: turnstileToken,
      });
      setSent(true);
    } catch {
      setSent(true); // Always show success to prevent email enumeration
    } finally {
      setLoading(false);
    }
  }

  // paddingTop accommodates the iOS status bar via env(safe-area-inset-top).
  // Desktop has no safe area so it's effectively just 2rem on web.
  return (
    <div
      className="min-h-screen bg-oat px-4 pb-8 md:pb-12 flex flex-col items-center"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 2rem)' }}
    >
      <div className="my-auto w-full max-w-md">
        <div className="text-center mb-8">
          <Link to={localeHomePath()} aria-label="Housemait home" className="inline-block">
            <img src="/housemait-logomark.png" alt="Housemait" className="h-16 mx-auto mb-4 rounded-2xl" />
          </Link>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
          <h2 className="text-xl font-semibold text-bark mb-2">Reset your password</h2>
          <p className="text-sm text-cocoa mb-6">Enter your email and we'll send you a reset link.</p>

          <ErrorBanner message={error} onDismiss={() => setError('')} />

          {sent ? (
            <div className="text-center">
              <div className="text-4xl mb-3">📧</div>
              <p className="text-cocoa mb-4">If that email is registered, we've sent a reset link.</p>
              <Link to="/login" className="text-primary font-medium hover:underline">Back to login</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="email"
              />
              <TurnstileWidget onChange={setTurnstileToken} />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-3 rounded-2xl transition-colors"
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>
        {!sent && (
          <p className="text-center text-sm text-cocoa mt-6">
            <Link to="/login" className="text-primary font-medium hover:underline">Back to login</Link>
          </p>
        )}

        <p className="text-center text-xs text-cocoa/70 mt-6">
          <Link to="/terms" className="hover:text-primary hover:underline">Terms of Service</Link>
          <span className="mx-2">·</span>
          <Link to="/privacy" className="hover:text-primary hover:underline">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}
