/**
 * The in-app AI disclosure + permission card (App Review 5.1.1(i)/5.1.2(i)).
 *
 * Shown once per device before the first AI-touching action: the chat
 * panel and the term-dates import sheet both render it via their own
 * gates. Copy rules: name the actual processors, say exactly what is
 * sent, say what it's used for, and state the no-training commitment -
 * all of which mirror sections 4-5 of the privacy policy.
 */
import { recordAiConsent } from '../lib/aiConsent';
import { IconSparkles } from './Icons';

export default function AiConsentNotice({ onAgree, onNotNow, context = 'chat' }) {
  const whatGoes = context === 'school'
    ? 'the school website address, PDF or photo of the letter you provide'
    : 'the messages you type and any photos or documents you share here';

  return (
    <div className="bg-white rounded-3xl p-6 max-w-sm w-full" style={{ boxShadow: 'var(--shadow-lg)' }}>
      <div
        className="flex items-center justify-center"
        style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--color-plum-light)', marginBottom: 12 }}
      >
        <IconSparkles className="h-5 w-5" style={{ color: 'var(--color-plum)' }} />
      </div>
      <h3 className="text-[17px] font-semibold text-charcoal">Before the assistant gets to work</h3>
      <p className="text-[13.5px] text-warm-grey leading-relaxed mt-2">
        To work out what to add for your family, {whatGoes} are sent to our AI partners,{' '}
        <strong className="text-charcoal font-semibold">Google (Gemini)</strong> and{' '}
        <strong className="text-charcoal font-semibold">Anthropic (Claude)</strong>. They process it only
        to produce the answer and are contractually barred from training their models on it.
      </p>
      <p className="text-[13.5px] text-warm-grey leading-relaxed mt-2">
        The full detail is in our{' '}
        <a href="https://housemait.com/privacy" target="_blank" rel="noreferrer" className="text-plum font-semibold underline">
          Privacy Policy
        </a>.
      </p>
      <button
        type="button"
        onClick={() => { recordAiConsent(); onAgree(); }}
        className="w-full h-12 rounded-xl bg-plum text-white text-sm font-semibold mt-4 active:scale-[0.99] transition-transform"
      >
        Agree and continue
      </button>
      <button
        type="button"
        onClick={onNotNow}
        className="w-full h-11 rounded-xl text-plum text-sm font-semibold mt-1.5"
      >
        Not now
      </button>
    </div>
  );
}
