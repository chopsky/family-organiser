import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import TurnstileWidget from '../components/TurnstileWidget';

export default function Support() {
  const { user } = useAuth();

  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot — must stay empty
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [sent, setSent]       = useState(false);
  const [turnstileToken, setTurnstileToken] = useState(null);

  // Pre-fill name & email if the user is logged in.
  useEffect(() => {
    if (user?.name && !name) setName(user.name);
    if (user?.email && !email) setEmail(user.email);
    // We deliberately don't depend on `name`/`email` so this runs once when
    // the user object hydrates and never overrides whatever the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim() || !email.trim() || !message.trim()) {
      setError('Name, email and message are all required.');
      return;
    }

    setLoading(true);
    try {
      await api.post('/contact', {
        name: name.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
        website, // honeypot, sent through to satisfy the API contract
        turnstile_token: turnstileToken,
      });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-oat flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/housemait-logomark.png" alt="Housemait" className="h-12 mx-auto mb-4" />
          <h1
            className="text-bark"
            style={{
              fontFamily: "'Instrument Serif', serif",
              fontWeight: 400,
              fontSize: 42,
              lineHeight: 1.1,
              letterSpacing: '-0.015em',
            }}
          >
            How can we <em style={{ fontStyle: 'italic', color: '#6B2FB8' }}>help?</em>
          </h1>
          <p className="text-cocoa mt-2">
            Drop us a note and we'll get back to you within one working day.
          </p>
        </div>

        {sent ? (
          <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8 text-center">
            <div
              className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: '#EDF5EE', color: '#7DAE82' }}
              aria-hidden="true"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </div>
            <h2
              className="text-bark"
              style={{
                fontFamily: "'Instrument Serif', serif",
                fontWeight: 400,
                fontSize: 28,
                lineHeight: 1.15,
                letterSpacing: '-0.015em',
              }}
            >
              Message received.
            </h2>
            <p className="text-cocoa mt-2 text-sm">
              Thanks {name.split(' ')[0] || 'there'} — we'll be in touch at <strong>{email}</strong> soon.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-cream-border p-8">
            <ErrorBanner message={error} onDismiss={() => setError('')} />

            <form onSubmit={handleSubmit} autoComplete="on" className="space-y-4">
              {/* Honeypot — visually hidden, but a real input. Bots fill it; humans don't. */}
              <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
                <label htmlFor="contact-website">Website</label>
                <input
                  id="contact-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="contact-name" className="block text-sm font-medium text-bark mb-1">Name</label>
                <input
                  id="contact-name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="contact-email" className="block text-sm font-medium text-bark mb-1">Email</label>
                <input
                  id="contact-email"
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
                <label htmlFor="contact-subject" className="block text-sm font-medium text-bark mb-1">
                  Subject <span className="text-cocoa font-normal">(optional)</span>
                </label>
                <input
                  id="contact-subject"
                  name="subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="What's it about?"
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                />
              </div>
              <div>
                <label htmlFor="contact-message" className="block text-sm font-medium text-bark mb-1">Message</label>
                <textarea
                  id="contact-message"
                  name="message"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what's going on…"
                  className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent resize-y"
                />
              </div>
              <TurnstileWidget onChange={setTurnstileToken} />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-3 rounded-2xl transition-colors"
              >
                {loading ? 'Sending…' : 'Send message'}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-sm text-cocoa mt-6">
          Or email us directly at{' '}
          <a href="mailto:support@housemait.com" className="text-primary font-medium hover:underline">
            support@housemait.com
          </a>
        </p>
        <p className="text-center text-sm text-cocoa mt-3">
          <Link to="/" className="hover:underline">← Back to housemait.com</Link>
        </p>
      </div>
    </div>
  );
}
