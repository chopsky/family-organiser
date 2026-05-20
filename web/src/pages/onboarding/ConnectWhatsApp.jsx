/**
 * Step 2 - connect the user's WhatsApp number via pull-push pairing.
 *
 * Previously sent an OTP from the server to the user's WhatsApp via a
 * Twilio Authentication template. That template needs Meta Business
 * Verification (paperwork sole traders often can't produce), so we
 * inverted the flow: the server mints a short code, the user opens
 * WhatsApp themselves and sends it to the bot, and our inbound webhook
 * does the linking. See web/src/components/WhatsAppPairing.jsx and
 * src/routes/whatsapp.js for the moving parts.
 */

import { useState } from 'react';
import WhatsAppPairing from '../../components/WhatsAppPairing';
import {
  serifHeading, serifHeadingStyle, kicker, primaryBtn, skipLink,
} from './_styles';

export default function ConnectWhatsApp({ next, setError }) {
  const [stage, setStage] = useState('intro'); // intro | pairing | done

  // ── Intro screen - features + "Connect" / "Skip" ──────────────────────
  if (stage === 'intro') {
    return (
      <div>
        <div className="text-center">
          <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
            Step 2 - WhatsApp
          </p>
          <h1 className={serifHeading} style={serifHeadingStyle}>
            Manage everything from <i>WhatsApp</i>.
          </h1>
          <p className="text-cocoa mt-5 max-w-md mx-auto">
            Add tasks, tick things off, check your calendar, scan receipts - just by
            messaging the Housemait bot.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 text-sm text-bark">
          <Feature icon="🛒" text={`"We need milk and eggs" - adds to shopping`} />
          <Feature icon="📋" text={`"Remind me to book car service" - creates a task`} />
          <Feature icon="📅" text={`"Dentist on Tuesday at 3pm" - adds to the calendar`} />
          <Feature icon="📸" text="Send a receipt photo - matches items back to your list" />
        </div>

        <div className="mt-10 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => setStage('pairing')}
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

  // ── Pairing - show code + tap-to-WhatsApp + poll status ───────────────
  if (stage === 'pairing') {
    return (
      <div>
        <div className="text-center">
          <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
            Step 2 - WhatsApp
          </p>
          <h1 className={serifHeading} style={serifHeadingStyle}>
            Send us a <i>quick message</i>.
          </h1>
          <p className="text-cocoa mt-5 max-w-md mx-auto">
            Tap the button below to open WhatsApp with the message pre-typed.
            Just press Send - we&apos;ll do the rest.
          </p>
        </div>

        <div className="mt-8 max-w-md mx-auto">
          <WhatsAppPairing
            onSuccess={() => setStage('done')}
            onError={(msg) => setError?.(msg)}
          />
        </div>

        <p className="mt-6 text-center">
          <button type="button" onClick={next} className={skipLink}>
            Skip for now
          </button>
        </p>
      </div>
    );
  }

  // ── Success - continue to next step ────
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
        You&apos;re <i>chatting</i>.
      </h1>
      <p className="text-cocoa mt-5 max-w-md mx-auto">
        We&apos;ve sent you a welcome message. Pin the chat so it stays at the top.
      </p>

      <div className="mt-8 flex flex-col items-center gap-3">
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
