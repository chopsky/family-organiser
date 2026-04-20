/**
 * Step 4 — calendar sync. Same pattern as ConnectWhatsApp: sell the feature,
 * point at Settings (where the real OAuth flows live), let the user skip.
 *
 * Connecting Apple / Google / Microsoft calendars is an OAuth redirect flow
 * that leaves the wizard, so we can't do it inline without losing progress.
 * The "Set up calendar sync" link opens Settings in a new tab.
 */

import { Link } from 'react-router-dom';
import { serifHeading, serifHeadingStyle, kicker, primaryBtn, skipLink } from './_styles';

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
        <Provider label="Apple" emoji="" />
        <Provider label="Google" emoji="" />
        <Provider label="Microsoft" emoji="" />
      </div>

      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          to="/settings"
          className={primaryBtn}
          target="_blank"
          rel="noopener noreferrer"
        >
          Set up calendar sync
        </Link>
        <button type="button" onClick={next} className={primaryBtn + ' bg-cocoa hover:bg-bark'}>
          Maybe later →
        </button>
      </div>
      <p className="mt-3 text-center">
        <button type="button" onClick={next} className={skipLink}>
          Skip for now
        </button>
      </p>
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
