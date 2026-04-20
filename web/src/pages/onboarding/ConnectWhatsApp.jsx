/**
 * Step 3 — connect the user's WhatsApp number inline.
 *
 * Two-stage form: phone number → 6-digit verification code. Hits the
 * existing /api/auth/whatsapp-send-code and /api/auth/whatsapp-verify-code
 * endpoints that Settings.jsx uses. Once verified, the server has already
 * sent the welcome message + returned the bot number, so we offer the
 * "Open in WhatsApp" deep link and advance automatically on the next step.
 *
 * (The earlier revision linked out to /settings, but RequireAuth bounces
 * any /settings request back to /onboarding until the wizard is done, so
 * the link was creating a redirect loop. Inline flow is both kinder UX
 * and avoids that problem entirely.)
 */

import { useState } from 'react';
import api from '../../lib/api';
import {
  serifHeading, serifHeadingStyle, kicker, primaryBtn, inputBase, skipLink,
} from './_styles';

export default function ConnectWhatsApp({ next, setError }) {
  const [stage, setStage]     = useState('intro'); // intro | phone | code | done
  const [phone, setPhone]     = useState('');
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);
  const [botNumber, setBotNumber] = useState(null);

  async function handleSendCode(e) {
    e.preventDefault();
    if (!phone.trim()) return;
    setError('');
    setLoading(true);
    try {
      await api.post('/auth/whatsapp-send-code', { phone: phone.trim() });
      setStage('code');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e) {
    e.preventDefault();
    if (!code.trim()) return;
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/whatsapp-verify-code', { code: code.trim() });
      setBotNumber(data?.bot_number || null);
      setStage('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ── Intro screen — features + "Connect" / "Skip" ──────────────────────
  if (stage === 'intro') {
    return (
      <div>
        <div className="text-center">
          <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
            Step 2 — WhatsApp
          </p>
          <h1 className={serifHeading} style={serifHeadingStyle}>
            Manage everything from <i>WhatsApp</i>.
          </h1>
          <p className="text-cocoa mt-5 max-w-md mx-auto">
            Add tasks, tick things off, check your calendar, scan receipts — just by
            messaging the Housemait bot.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 text-sm text-bark">
          <Feature icon="🛒" text={`"We need milk and eggs" — adds to shopping`} />
          <Feature icon="📋" text={`"Remind me to book car service" — creates a task`} />
          <Feature icon="📅" text={`"Dentist on Tuesday at 3pm" — adds to the calendar`} />
          <Feature icon="📸" text="Send a receipt photo — matches items back to your list" />
        </div>

        <div className="mt-10 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => setStage('phone')}
            className={primaryBtn}
          >
            Connect WhatsApp
          </button>
          <button type="button" onClick={next} className={skipLink}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  // ── Phone input ───────────────────────────────────────────────────────
  if (stage === 'phone') {
    return (
      <div>
        <div className="text-center">
          <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
            Step 2 — WhatsApp
          </p>
          <h1 className={serifHeading} style={serifHeadingStyle}>
            Your <i>WhatsApp</i> number
          </h1>
          <p className="text-cocoa mt-5 max-w-md mx-auto">
            We'll send you a 6-digit code to verify. Use the full international
            format (e.g. <code>+44 7700 900 123</code>).
          </p>
        </div>

        <form onSubmit={handleSendCode} className="mt-8 space-y-3">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+44 7700 900 123"
            className={inputBase}
            autoComplete="tel"
            autoFocus
            required
          />
          <button
            type="submit"
            disabled={loading || !phone.trim()}
            className={primaryBtn + ' w-full'}
          >
            {loading ? 'Sending…' : 'Send code'}
          </button>
        </form>

        <p className="mt-6 text-center">
          <button type="button" onClick={next} className={skipLink}>
            Skip for now
          </button>
        </p>
      </div>
    );
  }

  // ── Code verification ─────────────────────────────────────────────────
  if (stage === 'code') {
    return (
      <div>
        <div className="text-center">
          <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
            Step 2 — WhatsApp
          </p>
          <h1 className={serifHeading} style={serifHeadingStyle}>
            Enter your <i>code</i>
          </h1>
          <p className="text-cocoa mt-5 max-w-md mx-auto">
            We just sent a 6-digit code to <strong>{phone}</strong> on WhatsApp.
          </p>
        </div>

        <form onSubmit={handleVerifyCode} className="mt-8 space-y-3">
          <input
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className={inputBase + ' text-center text-xl tracking-[0.3em] font-semibold'}
            autoFocus
            required
          />
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className={primaryBtn + ' w-full'}
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <p className="mt-6 text-center">
          <button
            type="button"
            onClick={() => { setStage('phone'); setCode(''); }}
            className={skipLink}
          >
            ← Use a different number
          </button>
        </p>
      </div>
    );
  }

  // ── Success — optional "Open in WhatsApp" deep link + continue ────────
  const waLink = botNumber
    ? `https://wa.me/${botNumber}?text=${encodeURIComponent('Hi')}`
    : null;

  return (
    <div className="text-center">
      <div
        className="mx-auto mb-8 flex items-center justify-center"
        style={{
          width: '72px', height: '72px', borderRadius: '20px',
          background: 'var(--color-sage-light)', fontSize: '32px',
        }}
        aria-hidden="true"
      >
        ✅
      </div>
      <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
        WhatsApp connected
      </p>
      <h1 className={serifHeading} style={serifHeadingStyle}>
        You're <i>chatting</i>.
      </h1>
      <p className="text-cocoa mt-5 max-w-md mx-auto">
        We've sent you a welcome message. Pin the chat so it stays at the top
        — and try sending "Hi" to test it out.
      </p>

      <div className="mt-8 flex flex-col items-center gap-3">
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className={primaryBtn + ' bg-[#25D366] hover:bg-[#1ebe5a]'}
          >
            Open in WhatsApp
          </a>
        )}
        <button type="button" onClick={next} className={primaryBtn}>
          Continue →
        </button>
      </div>
    </div>
  );
}

function Feature({ icon, text }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white border border-cream-border">
      <span className="text-lg leading-none mt-0.5">{icon}</span>
      <span>{text}</span>
    </div>
  );
}
