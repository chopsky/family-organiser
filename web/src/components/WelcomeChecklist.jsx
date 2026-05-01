/**
 * WelcomeChecklist — first-week activation card on the Dashboard.
 *
 * Renders a small "do these three things to get the most out of
 * Housemait" card during the user's first 7 days. Three items:
 *
 *   1. Connect WhatsApp           → /settings#whatsapp
 *   2. Add your first event/task  → /calendar
 *   3. Invite a family member     → /family
 *
 * Each item auto-detects its done state and renders a sage checkmark
 * once satisfied. The whole card hides when:
 *   • All three items are done (auto-celebrate-and-disappear)
 *   • User explicitly dismisses it (× button → localStorage flag)
 *   • The user's `created_at` is more than 7 days old (existing
 *     households shouldn't see it on every login)
 *
 * Why localStorage rather than a backend `dismissed_welcome_at`
 * timestamp: dismissal is per-device, low-stakes, and a future
 * feature change will probably re-introduce a different welcome card
 * anyway. No reason to round-trip a row to the DB for a one-shot UI
 * preference.
 *
 * iOS-safety: nothing in this component references subscriptions,
 * pricing, billing, or trial mechanics. Safe under App Store
 * guideline 3.1.1 with no isIos() guard required.
 *
 * Props:
 *   hasContent  — true if the household has any events or tasks yet.
 *                 Driven from Dashboard's existing data fetch — saves
 *                 a redundant network round-trip.
 *   memberCount — number of household members. > 1 means an invite
 *                 has already landed.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DISMISSED_KEY = 'housemait-welcome-dismissed';
const ACTIVATION_WINDOW_DAYS = 7;

function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeLocalSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* private mode */ }
}

export default function WelcomeChecklist({ hasContent, memberCount }) {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(() => safeLocalGet(DISMISSED_KEY) === 'true');

  // Within-window guard: only render for accounts created in the last
  // ACTIVATION_WINDOW_DAYS days. created_at is exposed by authResponse()
  // in src/routes/auth.js — if it's missing (older clients, edge case)
  // we deliberately render nothing rather than guess.
  const withinWindow = (() => {
    if (!user?.created_at) return false;
    const created = new Date(user.created_at).getTime();
    if (!Number.isFinite(created)) return false;
    const ageMs = Date.now() - created;
    return ageMs >= 0 && ageMs < ACTIVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  })();

  const items = [
    {
      key: 'whatsapp',
      label: 'Connect WhatsApp',
      sub: 'Add events and lists by message — one of the biggest wins.',
      to: '/settings#whatsapp',
      done: !!user?.whatsapp_linked,
    },
    {
      key: 'first-content',
      label: 'Add your first event or task',
      sub: "Once you've got something on the calendar, the rest follows.",
      to: '/calendar',
      done: !!hasContent,
    },
    {
      key: 'invite',
      label: 'Invite a family member',
      sub: 'The mental load gets lighter the moment someone else is in.',
      to: '/family',
      done: memberCount > 1,
    },
  ];

  const allDone = items.every((it) => it.done);

  // Note: `allDone` short-circuits AFTER hooks have run, so the rules-of-
  // hooks contract holds. Same applies to the dismissed / window guards.
  useEffect(() => {
    if (allDone) {
      // Persist dismissal once the user reaches all-done so we don't
      // re-show the card if a state flips back briefly (e.g. an item
      // gets deleted — unlikely, but defensive).
      safeLocalSet(DISMISSED_KEY, 'true');
    }
  }, [allDone]);

  if (dismissed || allDone || !withinWindow) return null;

  function handleDismiss() {
    safeLocalSet(DISMISSED_KEY, 'true');
    setDismissed(true);
  }

  const completedCount = items.filter((it) => it.done).length;

  return (
    <section
      className="rounded-2xl border border-plum/15 p-5 md:p-6"
      style={{
        background: 'linear-gradient(135deg, var(--color-plum-light) 0%, #FBF8F3 100%)',
      }}
      aria-label="Get started with Housemait"
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p
            className="text-[11px] font-bold tracking-[0.1em] uppercase mb-1"
            style={{ color: 'var(--color-plum)' }}
          >
            Quick start · {completedCount} of {items.length} done
          </p>
          <h2
            className="text-charcoal text-[22px] md:text-[26px] leading-tight m-0"
            style={{
              fontFamily: '"Instrument Serif", Georgia, serif',
              fontWeight: 400,
              letterSpacing: '-0.015em',
            }}
          >
            Three quick things to get the most out of Housemait
          </h2>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss welcome checklist"
          className="shrink-0 w-8 h-8 rounded-full bg-white/70 hover:bg-white border border-light-grey flex items-center justify-center text-warm-grey hover:text-charcoal transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <ul className="flex flex-col gap-2.5">
        {items.map((it) => (
          <li key={it.key}>
            <Link
              to={it.to}
              className="group flex items-start gap-3 rounded-xl bg-white border border-light-grey px-4 py-3 hover:border-plum hover:shadow-sm transition-all"
            >
              {/* Status indicator — sage filled circle when done, hollow plum
                  ring when pending. The sage choice matches the rest of the
                  app's "completed" visual language (shopping checkboxes etc). */}
              <span
                className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 transition-colors ${
                  it.done
                    ? 'bg-sage text-white border border-sage'
                    : 'bg-white text-plum border-[1.5px] border-plum/30 group-hover:border-plum'
                }`}
                aria-hidden="true"
              >
                {it.done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="block w-1.5 h-1.5 rounded-full bg-plum/40" />
                )}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className={`text-[14px] font-semibold ${
                    it.done ? 'text-warm-grey line-through' : 'text-charcoal'
                  }`}
                >
                  {it.label}
                </p>
                <p className="text-[12px] text-warm-grey mt-0.5">{it.sub}</p>
              </div>
              <svg
                className="shrink-0 mt-2 text-warm-grey/60 group-hover:text-plum transition-colors"
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
