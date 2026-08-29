/**
 * App-level AI consent gate (App Review 5.1.1(i)/5.1.2(i), second pass).
 *
 * The per-surface gates (chat panel, term-dates import) were not enough:
 * the reviewer reached an AI feature they didn't front. This gate makes
 * the ask unmissable and universal instead:
 *
 *  - On first entry into the signed-in shell (per device, adult mode),
 *    the disclosure modal shows over whatever page loaded.
 *  - "Not now" defers it for the SESSION - but any explicit AI action
 *    (meal suggestions, recipe import, and the per-surface gates) re-asks
 *    at that moment via ensureAiConsent(), so nothing reaches an AI
 *    provider without an answered ask.
 *
 * Mounted once in Layout. Child Mode never sees it - consent is an
 * adult's to give, and kid surfaces don't touch the AI anyway.
 */
import { useEffect, useRef, useState } from 'react';
import AiConsentNotice from './AiConsentNotice';
import {
  hasAiConsent, consentDeferredThisSession, deferConsentThisSession, registerConsentGate,
} from '../lib/aiConsent';

export default function AiConsentGate() {
  const [open, setOpen] = useState(() => !hasAiConsent() && !consentDeferredThisSession());
  const resolversRef = useRef([]);

  useEffect(() => registerConsentGate(() => new Promise((resolve) => {
    resolversRef.current.push(resolve);
    setOpen(true);
  })), []);

  if (!open) return null;

  const settle = (answer) => {
    setOpen(false);
    const pending = resolversRef.current;
    resolversRef.current = [];
    pending.forEach((r) => r(answer));
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-5" style={{ background: 'rgba(26,22,32,0.42)' }}>
      <AiConsentNotice
        context="app"
        onAgree={() => settle(true)}
        onNotNow={() => { deferConsentThisSession(); settle(false); }}
      />
    </div>
  );
}
