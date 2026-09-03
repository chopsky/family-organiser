/**
 * Win-moment WhatsApp ask - the pairing offer made at the moment the app
 * has just done something worth texting it about, instead of on a screen
 * at the end of onboarding that people skip in 14 seconds (median, Sept
 * 2026 telemetry: 30 saw it, 3 tapped, link rate unchanged at ~45%).
 *
 * Shown ONLY when `show` flips true at a delight peak - term dates just
 * imported, a meal plan just landed, the first event just saved - and only
 * to people who aren't linked. Same discipline as ReferralNudge: at most
 * once a fortnight per device, two dismissals = never again.
 *
 * The button goes to /connect-whatsapp - the standalone pairing surface
 * (OTP or one-tap deep link with the code prefilled, QR on desktop) - so
 * web sign-ups, who never see the onboarding screen, get asked too.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LAST_KEY = 'housemait_wa_nudge_last';
const DISMISS_KEY = 'housemait_wa_nudge_dismissed';
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;

function capsAllow() {
  try {
    if (Number(localStorage.getItem(DISMISS_KEY) || 0) >= 2) return false;
    const last = Number(localStorage.getItem(LAST_KEY) || 0);
    return !last || Date.now() - last > FORTNIGHT_MS;
  } catch {
    return false;
  }
}

// The line that makes it concrete: what they could text RIGHT NOW, given
// what just happened. Generic asks are what the onboarding screen already
// failed with.
function copyFor(context, detail) {
  switch (context) {
    case 'school':
      return {
        title: `Ask it "when's half term?"`,
        body: `It knows ${detail?.schoolName ? `${detail.schoolName}'s` : 'the school'} dates now. Text the question from WhatsApp and it answers - no app needed.`,
      };
    case 'meals':
      return {
        title: 'Text "what\'s for dinner?" from the shop',
        body: 'Your meal plan lives in WhatsApp too - ask for the plan, or say "add the ingredients to the list".',
      };
    case 'event':
    default:
      return {
        title: 'Next time, just text it',
        body: '"Dentist Thursday at 3" in WhatsApp is the whole job. Photos of letters and voice notes work too.',
      };
  }
}

export default function WhatsAppWinNudge({ show, context = 'event', detail = null }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  // Caps are read once at mount (the page mounts seconds before any win
  // lands), so visibility is a plain derivation - no state set from an effect.
  const capsOk = useMemo(() => capsAllow(), []);
  const visible = Boolean(show) && capsOk && !hidden && !user?.whatsapp_linked;

  // Stamp the fortnight clock the first time it actually shows.
  useEffect(() => {
    if (!visible) return;
    try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* private mode */ }
  }, [visible]);

  if (!visible) return null;

  const { title, body } = copyFor(context, detail);
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Number(localStorage.getItem(DISMISS_KEY) || 0) + 1));
    } catch { /* private mode */ }
  };

  return (
    <div
      className="rounded-2xl p-4 mt-4 flex items-start gap-3"
      style={{ background: '#E9F6EE', boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}
      role="region"
      aria-label="Connect WhatsApp"
    >
      <span className="text-xl leading-6" aria-hidden="true">💬</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-bark m-0">{title}</p>
        <p className="text-xs text-cocoa mt-0.5">{body}</p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/connect-whatsapp')}
            className="text-white font-semibold text-xs px-4 py-2 rounded-xl transition-colors"
            style={{ background: '#1FA855' }}
          >
            Connect WhatsApp · 20 seconds
          </button>
          <button type="button" onClick={dismiss} className="text-xs font-medium text-cocoa hover:opacity-70">
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
