import { useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import SocialButtons from '../components/SocialButtons';
import TurnstileWidget from '../components/TurnstileWidget';

export default function Signup() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [turnstileToken, setTurnstileToken] = useState(null);
  const turnstileRef            = useRef(null);
  const { login }               = useAuth();
  const navigate                = useNavigate();
  const [searchParams]          = useSearchParams();
  const inviteToken             = searchParams.get('invite');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password || !name.trim()) {
      setError('All fields are required.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        email: email.trim(),
        password,
        name: name.trim(),
        inviteToken: inviteToken || undefined,
        turnstile_token: turnstileToken,
      });

      if (data.token) {
        // Invite flow — auto-joined
        login(data);
        navigate('/dashboard');
      } else {
        // Normal flow — needs email verification
        navigate('/check-email');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong.');
      // Turnstile tokens are single-use. The backend already consumed
      // ours validating this submission — even though the request
      // ultimately failed (weak password, email taken, etc), the token
      // is dead and re-submitting with it would trip "Bot verification
      // failed". Clear and reset so the next submit gets a fresh one.
      setTurnstileToken(null);
      turnstileRef.current?.reset();
    } finally {
      setLoading(false);
    }
  }

  function handleSocialSuccess(data) {
    login(data);
    navigate(data.household ? '/dashboard' : '/setup');
  }

  return (
    <div className="min-h-screen bg-oat px-4 py-8 md:py-12 flex flex-col items-center">
      <div className="my-auto w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/housemait-logomark.png" alt="Housemait" className="h-12 mx-auto mb-4" />
          <h1 className="text-bark" style={{ fontFamily: "'Instrument Serif', serif", fontWeight: 400, fontSize: 42, lineHeight: 1.1, letterSpacing: '-0.015em' }}>Your calmer family life<br /><em style={{ fontStyle: 'italic', color: '#6B2FB8' }}>starts here.</em></h1>
          {inviteToken && (
            <p className="text-primary mt-2 font-medium">You've been invited to join a household!</p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
          <ErrorBanner message={error} onDismiss={() => setError('')} />

          <SocialButtons inviteToken={inviteToken} onSuccess={handleSocialSuccess} onError={setError} />

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-border" /></div>
            <div className="relative flex justify-center text-sm"><span className="bg-white px-4 text-cocoa">or sign up with email</span></div>
          </div>

          <form onSubmit={handleSubmit} autoComplete="on" className="space-y-4">
            <div>
              <label htmlFor="signup-name" className="block text-sm font-medium text-bark mb-1">Name</label>
              <input
                id="signup-name"
                name="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah"
                className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="given-name"
              />
            </div>
            <div>
              <label htmlFor="signup-email" className="block text-sm font-medium text-bark mb-1">Email</label>
              <input
                id="signup-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="signup-password" className="block text-sm font-medium text-bark mb-1">Password</label>
              <input
                id="signup-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                autoComplete="new-password"
              />
            </div>
            <TurnstileWidget ref={turnstileRef} onChange={setTurnstileToken} />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-3 rounded-2xl transition-colors"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-cocoa mt-6">
          Already have an account? <Link to="/login" className="text-primary font-medium hover:underline">Log in</Link>
        </p>
      </div>
    </div>
  );
}
