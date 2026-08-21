/**
 * Notification centre.
 *
 * Push is fire-and-forget: the OS truncates a long body and tapping the
 * alert used to open the app with the message nowhere to be found. Every
 * push we send is recorded server-side; this reads them back in full.
 *
 * Deep links reuse the `data.type` the pushes already carry, so a tapped
 * event reminder lands on the calendar and a kid's note lands on Notes.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import PageHeader from '../components/ui/PageHeader';
import Spinner from '../components/Spinner';

// data.type → where tapping the notification should take you. Types with
// no entry simply aren't tappable (the full text is the whole point).
const ROUTE_FOR_TYPE = {
  morning_brief: '/',
  evening_brief: '/',
  holiday_pause: '/',
  event_reminder: '/calendar',
  calendar_reminders: '/calendar',
  task_assigned: '/tasks',
  shopping_updated: '/lists',
  meal_plan_updated: '/meals',
  kid_note: '/notes',
  subscription_reminder: '/settings',
};

function whenLabel(iso) {
  const then = new Date(iso);
  const now = new Date();
  const mins = Math.round((now - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) return then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return then.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/notifications')
      .then(({ data }) => {
        if (cancelled) return;
        setItems(data?.notifications || []);
        // Opening the centre IS reading it - mark everything read and tell
        // the rest of the app so the bell's dot clears immediately.
        if ((data?.unread || 0) > 0) {
          api.post('/notifications/read', {})
            .then(() => window.dispatchEvent(new CustomEvent('housemait:notifications-read')))
            .catch(() => {});
        }
      })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, []);

  if (items === null) return <Spinner />;

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        kicker="Notifications"
        title="What you've missed"
        subtitle="Everything we've sent you in the last 30 days, in full."
      />

      {items.length === 0 ? (
        <div className="bg-linen rounded-2xl p-8 text-center">
          <div className="text-3xl mb-2" aria-hidden="true">🔔</div>
          <p className="text-sm font-semibold text-bark m-0">Nothing yet</p>
          <p className="text-xs text-cocoa mt-1">
            Reminders, briefs and family updates will collect here so you can read them in full.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => {
            const route = ROUTE_FOR_TYPE[n.type];
            const unread = !n.read_at;
            const inner = (
              <>
                <div className="flex items-baseline gap-2">
                  {unread && (
                    <span
                      className="w-[7px] h-[7px] rounded-full flex-shrink-0"
                      style={{ background: 'var(--color-coral)' }}
                      aria-label="Unread"
                    />
                  )}
                  <span className="text-sm font-semibold text-bark flex-1 min-w-0">{n.title}</span>
                  <span className="text-[11px] text-cocoa flex-shrink-0">{whenLabel(n.created_at)}</span>
                </div>
                <p className="text-xs text-cocoa mt-1 leading-relaxed whitespace-pre-line m-0">
                  {n.body}
                </p>
              </>
            );
            return route ? (
              <button
                key={n.id}
                type="button"
                onClick={() => navigate(route)}
                className="w-full text-left bg-linen rounded-2xl p-4 hover:bg-[#F3EEE5] transition-colors"
              >
                {inner}
              </button>
            ) : (
              <div key={n.id} className="bg-linen rounded-2xl p-4">{inner}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
