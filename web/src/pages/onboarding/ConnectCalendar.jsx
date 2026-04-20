/**
 * Step 4 — calendar sync. Informational only.
 *
 * Unlike WhatsApp we can't inline this: connecting Apple / Google / Microsoft
 * calendars is an OAuth redirect flow that leaves the app entirely, and our
 * RequireAuth guard bounces any /settings visit back to /onboarding until the
 * wizard is done. So this step describes the feature, tells the user where
 * it lives, and moves on. They set it up after landing on the dashboard.
 */

import { serifHeading, serifHeadingStyle, kicker, primaryBtn } from './_styles';

export default function ConnectCalendar({ next }) {
  return (
    <div>
      <div className="text-center">
        <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
          Step 3 — calendar
        </p>
        <h1 className={serifHeading} style={serifHeadingStyle}>
          One calendar, <i>for the whole family</i>.
        </h1>
        <p className="text-cocoa mt-5 max-w-md mx-auto">
          Sync your Apple, Google, or Microsoft calendar so Housemait knows what's
          already on. New events you add here flow back to your phone's calendar
          too — so you never miss a reminder.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-3">
        <Provider label="Apple" />
        <Provider label="Google" />
        <Provider label="Microsoft" />
      </div>

      <div className="mt-8 p-4 rounded-xl bg-cream border border-cream-border text-sm text-cocoa">
        <p>
          <strong className="text-bark">You can connect it after this.</strong>{' '}
          Once you're in the app, open <strong>Settings → Calendar sync</strong> to
          link any of the three — it takes about 30 seconds.
        </p>
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        <button type="button" onClick={next} className={primaryBtn}>
          Got it, continue →
        </button>
      </div>
    </div>
  );
}

function Provider({ label }) {
  return (
    <div className="aspect-square rounded-xl bg-white border border-cream-border flex items-center justify-center">
      <span className="text-sm font-semibold text-bark">{label}</span>
    </div>
  );
}
