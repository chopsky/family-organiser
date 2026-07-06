/**
 * AfterSchoolCard - dashboard widget showing the kids' after-school
 * activities for a chosen weekday, with the pickup person.
 *
 * Recreated from /docs/design_handoff_after_school (design reference, not
 * copied). Mon-Fri day selector (defaults to today / next school day),
 * each row: start time, child-coloured activity glyph, activity name,
 * "{child}" sub-line, and PICKUP {parent} + avatar on the right.
 *
 * Data: GET /api/schools/activities (every child's child_weekly_schedule
 * rows for the household, which carry day_of_week, activity, time_start/end,
 * pickup_member_id). This household-wide endpoint is used instead of
 * GET /api/schools because, after the schools decoupling, a child can have no
 * school_id and so wouldn't appear under any school's children there.
 * Child + pickup names/colours are resolved from the dashboard's members
 * list (passed in). Mobile-only and hidden entirely when the household
 * has no after-school activities at all - the per-day "No clubs" empty
 * state only shows when some days DO have clubs.
 *
 * Placed between the Today's-schedule and Tasks cards on the dashboard.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { hexFor } from '../lib/memberColors';
import { ACTIVITY_ICONS, iconFor } from '../lib/activityIcons';
import Avatar from './ui/Avatar';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const INK = '#1A1620';
const INK2 = '#4A4453';
const INK3 = '#8A8493';
const BRAND = 'var(--color-plum)';
const SOFT = '#F3EEE5';

function timeOf(a) {
  const t = a.time_start || a.time_end || null;
  return t ? t.substring(0, 5) : '';
}

export default function AfterSchoolCard({ members = [] }) {
  const [activities, setActivities] = useState(null); // null = loading, [] = loaded-empty
  const [isMobile, setIsMobile] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : true),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia('(max-width: 767px)');
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isMobile) return undefined; // mobile-only: skip the fetch on desktop
    let cancelled = false;
    // Source from the household-wide activities endpoint, NOT GET /schools.
    // After the schools decoupling a child can have no school_id (single-school
    // household), so they no longer appear under any school's children in
    // GET /schools - their clubs would silently vanish from this card.
    api.get('/schools/activities')
      .then((res) => {
        if (cancelled) return;
        setActivities(res.data?.activities || []);
      })
      .catch(() => { if (!cancelled) setActivities([]); });
    return () => { cancelled = true; };
  }, [isMobile]);

  const memberById = useMemo(() => {
    const map = {};
    for (const m of members) map[m.id] = m;
    return map;
  }, [members]);

  // Days (0=Mon..6=Sun) that have at least one activity.
  const daysWithClubs = useMemo(() => {
    const set = new Set();
    for (const a of (activities || [])) if (a.day_of_week >= 0 && a.day_of_week <= 6) set.add(a.day_of_week);
    return set;
  }, [activities]);

  // Default selected day: today (all 7 days are selectable now that
  // weekends have their own columns).
  const [dayIdx, setDayIdx] = useState(() => (new Date().getDay() + 6) % 7); // 0=Mon..6=Sun

  if (!isMobile) return null;
  if (!activities || activities.length === 0) return null; // hide when no clubs at all

  // The Mon-Sun selector reads as THIS week, so resolve the selected
  // weekday to its concrete date - that's what term windows and per-date
  // skips ("no swimming today") are checked against.
  const selectedDate = (() => {
    const now = new Date();
    const ourToday = (now.getDay() + 6) % 7;
    const d = new Date(now);
    d.setDate(now.getDate() + (dayIdx - ourToday));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const items = activities
    .filter(a => a.day_of_week === dayIdx
      && (!a.start_date || selectedDate >= a.start_date)
      && (!a.end_date || selectedDate <= a.end_date)
      && !a.skips?.includes(selectedDate))
    // Per-date override: this week's occurrence may have a one-off
    // time/pickup that replaces the series values.
    .map((a) => {
      const ov = a.overrides?.[selectedDate];
      return ov
        ? { ...a, time_start: ov.time_start, time_end: ov.time_end, pickup_member_id: ov.pickup_member_id }
        : a;
    })
    .sort((a, b) => timeOf(a).localeCompare(timeOf(b)));

  return (
    <div
      className="p-4.5"
      style={{
        background: '#fff', borderRadius: 22,
        boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <h2 className="text-base font-sans font-semibold text-bark">Extracurricular</h2>
        <Link to="/calendar" className="text-xs font-medium text-primary hover:underline">Calendar →</Link>
      </div>

      {/* Day selector */}
      <div className="flex" style={{ gap: 6, marginBottom: 14 }} role="tablist">
        {DAYS.map((d, i) => {
          const active = i === dayIdx;
          const has = daysWithClubs.has(i);
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setDayIdx(i)}
              className="flex flex-col items-center"
              style={{
                flex: 1, padding: '8px 0 7px', borderRadius: 12, border: 0, cursor: 'pointer', gap: 5,
                background: active ? BRAND : SOFT, transition: 'background .15s ease',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: active ? '#fff' : INK2 }}>{d}</span>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: has ? (active ? 'rgba(255,255,255,0.85)' : BRAND) : 'transparent' }} />
            </button>
          );
        })}
      </div>

      {/* Activities for the selected day */}
      {items.length === 0 ? (
        <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 13, color: INK3, fontStyle: 'italic' }}>
          No clubs — straight home.
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: 10 }}>
          {items.map((a) => {
            const kid = memberById[a.child_id];
            const picker = a.pickup_member_id ? memberById[a.pickup_member_id] : null;
            const kidColor = hexFor(kid);
            const Icon = ACTIVITY_ICONS[iconFor(a.activity)] || ACTIVITY_ICONS.star;
            // Show start over end as a compact two-line range. Falls back to
            // whichever single time exists (start preferred) when only one is
            // set, so a club with no end time still reads cleanly.
            const start = a.time_start ? a.time_start.substring(0, 5) : '';
            const end = a.time_end ? a.time_end.substring(0, 5) : '';
            const topTime = start || end;
            const showEnd = start && end; // only stack the end line when both exist
            const timeLabel = showEnd ? `${start} to ${end}` : topTime;
            return (
              <div
                key={a.id}
                className="flex items-center"
                style={{ gap: 12 }}
                aria-label={`${a.activity}${kid ? `, ${kid.name}` : ''}${timeLabel ? `, ${timeLabel}` : ''}${picker ? `, pickup ${picker.name}` : ''}`}
              >
                <div style={{ width: 48, flexShrink: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK3 }}>{topTime}</div>
                  {showEnd && (
                    <div style={{ fontSize: 11, fontWeight: 500, color: INK3, opacity: 0.6 }}>{end}</div>
                  )}
                </div>
                <div style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: kidColor + '1F', color: kidColor }}>
                  <Icon size={20} color={kidColor} />
                </div>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <div className="truncate" style={{ fontSize: 14, fontWeight: 600, color: INK }}>{a.activity}</div>
                  <div className="truncate" style={{ fontSize: 12, color: INK3 }}>{kid?.name || 'Child'}</div>
                </div>
                {picker && (
                  <div className="flex items-center" style={{ gap: 6, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK3, lineHeight: 1.3 }}>Pickup</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: INK2, lineHeight: 1.2 }}>{picker.name}</div>
                    </div>
                    <Avatar member={picker} size={26} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
