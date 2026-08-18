/**
 * Win-moment referral strip - shown ONLY at delight peaks (the AI meal plan
 * just landed, a school letter just imported), never at random. Rules that
 * keep it from becoming noise:
 *
 *   - The API is the rollout gate: outside the pilot /referrals/mine says
 *     enabled:false and this renders nothing (response cached module-level
 *     so multiple surfaces don't refetch).
 *   - Shown at most once a fortnight per device (localStorage stamp).
 *   - Two explicit dismissals = never again on this device.
 *
 * Mount it with `show` flipping true at the peak; it decides the rest.
 */

import { useEffect, useState } from 'react';
import api from '../lib/api';
import { share } from '../lib/share';

const LAST_KEY = 'housemait_ref_nudge_last';
const DISMISS_KEY = 'housemait_ref_nudge_dismissed';
const FORTNIGHT_MS = 14 * 24 * 60 * 60 * 1000;

let cachedMine = null; // { enabled, code, share_url, ... } | null
let cachedAt = 0;

async function fetchMine() {
  if (cachedMine && Date.now() - cachedAt < 5 * 60 * 1000) return cachedMine;
  try {
    const { data } = await api.get('/referrals/mine');
    cachedMine = data || { enabled: false };
    cachedAt = Date.now();
  } catch {
    cachedMine = { enabled: false };
    cachedAt = Date.now();
  }
  return cachedMine;
}

function capsAllow() {
  try {
    if (Number(localStorage.getItem(DISMISS_KEY) || 0) >= 2) return false;
    const last = Number(localStorage.getItem(LAST_KEY) || 0);
    return !last || Date.now() - last > FORTNIGHT_MS;
  } catch {
    return false;
  }
}

export default function ReferralNudge({ show, context = 'sorted' }) {
  const [mine, setMine] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!show || !capsAllow()) return;
    let cancelled = false;
    fetchMine().then((data) => {
      if (cancelled || !data?.enabled || !data.code) return;
      setMine(data);
      try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch { /* private mode */ }
    });
    return () => { cancelled = true; };
  }, [show]);

  if (!show || !mine || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Number(localStorage.getItem(DISMISS_KEY) || 0) + 1));
    } catch { /* private mode */ }
  };

  const shareNow = async () => {
    const ok = await share({
      title: 'A month of Housemait, on us',
      text: `We've been using Housemait to keep all our family stuff in one place - calendar, lists, meals, even school letters over WhatsApp. They've given me a free month to share with another family - here's the link: ${mine.share_url}`,
      url: mine.share_url,
      dialogTitle: 'Give a friend a month of Housemait',
    });
    if (ok) { setShared(true); setTimeout(() => setHidden(true), 1800); }
  };

  return (
    <div
      className="rounded-2xl p-4 mt-4 flex items-start gap-3 bg-plum-light"
      style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}
    >
      <span className="text-xl leading-6" aria-hidden="true">🎁</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-bark m-0">
          {context === 'meals' ? 'Meal plan sorted!' : 'That was easy, right?'} Know a family who&apos;d love this?
        </p>
        <p className="text-xs text-cocoa mt-0.5">
          Give them a free month of Housemait - and get a month free yourself when they join.
        </p>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={shareNow}
            className="bg-primary text-white font-semibold text-xs px-4 py-2 rounded-xl hover:bg-primary-pressed transition-colors"
          >
            {shared ? 'Link copied!' : 'Share a free month'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="text-xs font-medium text-cocoa hover:opacity-70"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
