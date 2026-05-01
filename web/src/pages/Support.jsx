/**
 * Public /support page — the contact form for users who can't (or
 * haven't yet) signed in. Logged-in users get a richer experience at
 * /help (FAQ + the same form embedded).
 *
 * Kept deliberately as a thin chrome wrapper around <ContactForm /> so
 * both routes share the form's behaviour exactly. If the form ever
 * changes, edit ContactForm.jsx — this file should rarely need touching.
 */

import { Link } from 'react-router-dom';
import ContactForm from '../components/ContactForm';

export default function Support() {
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
            How can we{' '}
            <em style={{ fontStyle: 'italic', color: '#6B2FB8' }}>help?</em>
          </h1>
          <p className="text-cocoa mt-2">
            Drop us a note and we'll get back to you within one working day.
          </p>
        </div>

        <ContactForm />

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
