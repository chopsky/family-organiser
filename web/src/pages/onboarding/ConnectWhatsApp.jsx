/**
 * Step 3 — sell the WhatsApp integration, point the user at Settings, move on.
 *
 * Actual connection is a multi-stage flow (send code → verify) that lives in
 * Settings.jsx; duplicating it inline would double the surface area. Instead
 * this step is educational + a CTA that opens Settings in a new tab so the
 * wizard stays intact if the user wants to keep going afterwards.
 */

import { Link } from 'react-router-dom';
import { serifHeading, serifHeadingStyle, kicker, primaryBtn, skipLink } from './_styles';

export default function ConnectWhatsApp({ next }) {
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
          messaging the Housemait bot. It works the same way the rest of the family
          does: in their own chats, with updates shared across the household.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-3 text-sm text-bark">
        <Feature icon="🛒" text={`"We need milk and eggs" — adds to shopping`} />
        <Feature icon="📋" text={`"Remind me to book car service" — creates a task`} />
        <Feature icon="📅" text={`"Dentist on Tuesday at 3pm" — adds to the calendar`} />
        <Feature icon="📸" text="Send a receipt photo — matches items back to your list" />
      </div>

      <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          to="/settings"
          className={primaryBtn}
          // Opening in a new tab means the user returns here and can continue
          // the wizard from the same step without losing progress.
          target="_blank"
          rel="noopener noreferrer"
        >
          Connect WhatsApp
        </Link>
        <button type="button" onClick={next} className={primaryBtn + ' bg-cocoa hover:bg-bark'}>
          Maybe later →
        </button>
      </div>
      <p className="mt-3 text-center">
        <button type="button" onClick={next} className={skipLink}>
          I've connected it — continue
        </button>
      </p>
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
