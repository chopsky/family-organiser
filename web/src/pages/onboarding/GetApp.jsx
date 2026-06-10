/**
 * "Get the app" onboarding step - shown ONLY to people finishing onboarding
 * in a browser on an iPhone (see Onboarding.jsx for the gate). It never
 * appears inside the native app (you're already there) or on Android/desktop
 * (no app / a tap-through App Store link is useless).
 *
 * A pure value-led nudge: it sells what the web genuinely can't do - push
 * reminders, home-screen quick-add, widgets - then deep-links to the App
 * Store. "Maybe later" keeps it from ever blocking the finish of onboarding.
 */

import { APP_STORE_URL } from '../../lib/app-store';
import { serifHeading, serifHeadingStyle, kicker, skipLink } from './_styles';

const PERKS = [
  { icon: '🔔', title: 'Reminders that reach you', body: 'Push alerts for pickups, events and tasks - even when the app is closed.' },
  { icon: '⚡', title: 'Add things in a tap', body: 'A home-screen icon and quick-add shortcuts, so jotting something down takes seconds.' },
  { icon: '🏡', title: 'Your week at a glance', body: 'Home-screen widgets put today’s plan in front of you without opening anything.' },
];

export default function GetApp({ next }) {
  return (
    <div className="text-center">
      <p className={kicker} style={{ color: 'var(--color-plum)', marginBottom: 10 }}>
        One last thing
      </p>
      <h1 className={serifHeading} style={serifHeadingStyle}>
        Get the <i>full</i> Housemait.
      </h1>
      <p className="text-cocoa mt-4 max-w-md mx-auto">
        You’re on an iPhone - the app gives you everything the website can’t.
      </p>

      <ul className="mt-7 space-y-3 text-left max-w-sm mx-auto">
        {PERKS.map((p) => (
          <li
            key={p.title}
            className="flex items-start gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'rgba(107,63,160,0.05)', border: '1px solid rgba(107,63,160,0.10)' }}
          >
            <span aria-hidden="true" style={{ fontSize: 22, lineHeight: '28px' }}>{p.icon}</span>
            <span>
              <span className="block font-semibold text-bark text-sm">{p.title}</span>
              <span className="block text-cocoa text-[13px] leading-snug mt-0.5">{p.body}</span>
            </span>
          </li>
        ))}
      </ul>

      <a
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-8"
        aria-label="Download Housemait on the App Store"
      >
        <img
          src="/assets/app-store-badge.svg"
          alt="Download on the App Store"
          style={{ height: 52, width: 'auto' }}
        />
      </a>

      <div className="mt-6">
        <button type="button" onClick={next} className={skipLink}>
          Maybe later - continue on the web
        </button>
      </div>
    </div>
  );
}
