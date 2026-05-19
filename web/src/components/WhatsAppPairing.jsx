/**
 * WhatsAppPairing — pull-push linking widget.
 *
 * The previous "send me a code by SMS-to-WhatsApp" flow needed a
 * Meta-approved Authentication Content Template, which requires Meta
 * Business Verification (unreachable for sole traders without a
 * registered company). This flow inverts the direction: the server
 * mints a short pairing code, the user opens WhatsApp and sends it to
 * the bot themselves, and the inbound webhook (src/routes/whatsapp.js)
 * links their number on receipt.
 *
 * No templates, no Meta approval, works in every country immediately.
 *
 * Used by:
 *   • Onboarding wizard (pages/onboarding/ConnectWhatsApp.jsx)
 *   • Settings → Notifications → Connect WhatsApp accordion
 *
 * Props:
 *   onSuccess(linkedPhone) — called once the bot has linked the number
 *   onError(msg)           — surface API failures to the parent
 *   autoStart=true         — if false, render only the "Connect" button
 *   compact=false          — denser layout (used inside Settings)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../lib/api';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_DURATION_MS = 11 * 60 * 1000; // a little longer than the 10-min server TTL

export default function WhatsAppPairing({ onSuccess, onError, autoStart = true, compact = false }) {
  const [stage, setStage] = useState(autoStart ? 'init' : 'idle'); // idle | init | waiting | done | error
  const [pairing, setPairing] = useState(null); // { code, message, bot_number, deep_link }
  const pollRef = useRef(null);
  const pollStartedAtRef = useRef(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  async function start() {
    setStage('init');
    try {
      const { data } = await api.post('/auth/whatsapp-init-pairing');
      setPairing(data);
      setStage('waiting');
      pollStartedAtRef.current = Date.now();
    } catch (err) {
      setStage('error');
      onErrorRef.current?.(err.response?.data?.error || 'Could not start WhatsApp pairing.');
    }
  }

  // Auto-start on first mount when autoStart is true.
  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-shot status check, used both inside the interval and on
  // foreground events (so the user doesn't have to wait up to ~2.5s
  // after returning from WhatsApp to see the success state).
  const pollOnce = useCallback(async () => {
    if (!pairing?.code) return;
    if (Date.now() - (pollStartedAtRef.current || 0) > MAX_POLL_DURATION_MS) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setStage('error');
      onErrorRef.current?.('Pairing code expired. Tap Generate a new code to try again.');
      return;
    }
    try {
      const { data } = await api.get('/auth/whatsapp-pairing-status', {
        params: { code: pairing.code },
      });
      if (data?.linked) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setStage('done');
        onSuccessRef.current?.(data.phone || null);
      } else if (data?.expired) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setStage('error');
        onErrorRef.current?.('Pairing code expired. Tap Generate a new code to try again.');
      }
    } catch {
      /* transient — caller will retry on next tick */
    }
  }, [pairing?.code]);

  // Background interval poll while in the waiting stage.
  useEffect(() => {
    if (stage !== 'waiting' || !pairing?.code) return undefined;
    pollRef.current = setInterval(pollOnce, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [stage, pairing?.code, pollOnce]);

  // When the app/tab returns to the foreground (user came back from
  // WhatsApp), poll immediately. iOS suspends the JS engine while in
  // the background so the next setInterval tick can take ~2.5s to fire
  // — without this, the user sees the "waiting" state for an awkward
  // moment after their WhatsApp message has already been linked.
  useAppForegroundRefresh(() => {
    if (stage === 'waiting') pollOnce();
  }, { throttleMs: 0 });

  if (stage === 'idle') {
    return (
      <button
        type="button"
        onClick={start}
        className="inline-flex items-center gap-2 bg-primary hover:bg-primary-pressed text-white text-sm font-medium px-4 py-2 rounded-2xl transition-colors"
      >
        Connect WhatsApp
      </button>
    );
  }

  if (stage === 'init') {
    return <p className={`text-sm text-cocoa ${compact ? '' : 'py-2'}`}>Generating code…</p>;
  }

  if (stage === 'done') {
    return (
      <div className={`${compact ? 'py-1' : 'py-2'} text-sm text-success bg-success/10 rounded-xl px-3`}>
        ✅ WhatsApp linked! Look out for a welcome message in your chat with the bot.
      </div>
    );
  }

  if (stage === 'error') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-error">Pairing failed.</p>
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-2 border border-cream-border text-bark text-sm font-medium px-4 py-2 rounded-2xl hover:bg-oat transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  // stage === 'waiting' — show the code + tap-to-open button.
  return (
    <div className="space-y-3">
      <p className="text-sm text-cocoa">
        Open WhatsApp and send the bot this message:
      </p>
      <div className="flex items-center gap-3 bg-white border border-cream-border rounded-xl px-3 py-2.5">
        <span className="flex-1 text-base font-mono font-semibold text-bark tracking-wider">{pairing.message}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(pairing.message).catch(() => {})}
          className="text-xs text-cocoa hover:text-bark px-2 py-1"
          aria-label="Copy code"
        >
          Copy
        </button>
      </div>
      {pairing.deep_link && (
        <a
          href={pairing.deep_link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5a] text-white text-sm font-medium px-4 py-2.5 rounded-2xl transition-colors w-full"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Open WhatsApp to send
        </a>
      )}
      <p className="text-xs text-cocoa">
        Waiting for your message… we'll link automatically when it arrives. Code valid for 10 minutes.
      </p>
    </div>
  );
}
