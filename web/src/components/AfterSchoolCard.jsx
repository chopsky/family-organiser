/**
 * AfterSchoolCard - dashboard widget showing the kids' after-school
 * activities for a chosen weekday, with the pickup person.
 *
 * Recreated from /docs/design_handoff_after_school (design reference, not
 * copied). Mon-Fri day selector (defaults to today / next school day),
 * each row: start time, child-coloured activity glyph, activity name,
 * "{child}" sub-line, and PICKUP {parent} + avatar on the right.
 *
 * Data: GET /api/schools (children + their child_weekly_schedule rows,
 * which carry day_of_week, activity, time_start/end, pickup_member_id).
 * Child + pickup names/colours are resolved from the dashboard's members
 * list (passed in). Mobile-only and hidden entirely when the household
 * has no after-school activities at all - the per-day "No clubs" empty
 * state only shows when some days DO have clubs.
 *
 * Placed between the Today's-schedule and Tasks cards on the dashboard.
 */

import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

// color_theme -> hex (mirrors Tasks.jsx MEMBER_COLORS / the brand avatar
// palette). Drives the tinted icon tile + glyph colour.
const MEMBER_HEX = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
  coral: '#E8724A', plum: '#6B3FA0', sage: '#7DAE82',
};
const hexFor = (m) => MEMBER_HEX[m?.color_theme] || '#7DAE82';

const INK = '#1A1620';
const INK2 = '#4A4453';
const INK3 = '#8A8493';
const BRAND = 'var(--color-plum)';
const SOFT = '#F3EEE5';

// ── Activity glyphs (line icons, 24px viewBox, 1.7px stroke) ──
const wrap = (children, p) => (
  <svg width={p.size || 20} height={p.size || 20} viewBox="0 0 24 24" fill="none" stroke={p.color || 'currentColor'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const AS_ICONS = {
  ball: (p = {}) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 3l2.6 4.5h-5.2L12 3zM3.3 9.6l4.8.6 1.6 5-4 2.6-2.4-8.2zM20.7 9.6l-2.4 8.2-4-2.6 1.6-5 4.8-.6zM8.5 19.5L12 16l3.5 3.5" /></>, p),
  tennis: (p = {}) => wrap(<><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6a13 13 0 0 0 0 12.8M18.4 5.6a13 13 0 0 1 0 12.8" /></>, p),
  art: (p = {}) => wrap(<><path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-1 2-2 0-1.4-1-1.6-1-2.8 0-.8.7-1.2 1.6-1.2H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><circle cx="7.5" cy="11" r="1" /><circle cx="11" cy="7.5" r="1" /><circle cx="15.5" cy="8.5" r="1" /></>, p),
  ballet: (p = {}) => wrap(<><circle cx="12" cy="4.5" r="2" /><path d="M12 7v6M12 13l-4 8M12 13l4 8M7 10l5 3 5-3" /></>, p),
  code: (p = {}) => wrap(<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />, p),
  swim: (p = {}) => wrap(<><circle cx="15" cy="7" r="2" /><path d="M5 13l4-2.5 3 2 2.5-1.5M3 17.5c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1M8.5 11.5L12 8l-2-1.5" /></>, p),
  music: (p = {}) => wrap(<><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="17.5" cy="15.5" r="2.5" /><path d="M9 17.5V6l11-2v9.5" /><path d="M9 9l11-2" /></>, p),
  gym: (p = {}) => wrap(<path d="M2 9v6M5 7v10M19 7v10M22 9v6M5 12h14" />, p),
  // generic fallback
  star: (p = {}) => wrap(<path d="M12 3l2.5 5.6 6 .6-4.5 4 1.3 6L12 16.8 6.7 19.2l1.3-6-4.5-4 6-.6L12 3z" />, p),
};

// Map a free-text activity name to a glyph key.
function iconFor(name) {
  const n = (name || '').toLowerCase();
  if (/foot|soccer|rugby|netball|hockey|cricket|\bball\b/.test(n)) return 'ball';
  if (/tennis|badminton|squash/.test(n)) return 'tennis';
  if (/art|paint|draw|craft|pottery/.test(n)) return 'art';
  if (/ballet|dance|dancing/.test(n)) return 'ballet';
  if (/cod(e|ing)|computer|ict|programming|robot/.test(n)) return 'code';
  if (/swim|water polo|diving/.test(n)) return 'swim';
  if (/choir|music|sing|band|orchestra|instrument/.test(n)) return 'music';
  if (/gym|\bpe\b|sport|athletic|fitness/.test(n)) return 'gym';
  return 'star';
}

function timeOf(a) {
  const t = a.time_start || a.time_end || null;
  return t ? t.substring(0, 5) : '';
}

function Avatar({ member, size = 26 }) {
  if (!member) return null;
  if (member.avatar_url) {
    return <img src={member.avatar_url} alt={member.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: hexFor(member), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 600, fontSize: size * 0.42, letterSpacing: -0.2, flexShrink: 0,
    }}>{member.name?.[0]?.toUpperCase()}</div>
  );
}

export default function AfterSchoolCard({ members = [], onOpenCalendar }) {
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
    api.get('/schools')
      .then((res) => {
        if (cancelled) return;
        const schools = res.data?.schools || [];
        const flat = [];
        for (const s of schools) {
          for (const child of (s.children || [])) {
            for (const a of (child.activities || [])) {
              flat.push({ ...a, child_id: a.child_id || child.id });
            }
          }
        }
        setActivities(flat);
      })
      .catch(() => { if (!cancelled) setActivities([]); });
    return () => { cancelled = true; };
  }, [isMobile]);

  const memberById = useMemo(() => {
    const map = {};
    for (const m of members) map[m.id] = m;
    return map;
  }, [members]);

  // Days (0=Mon..4=Fri) that have at least one activity.
  const daysWithClubs = useMemo(() => {
    const set = new Set();
    for (const a of (activities || [])) if (a.day_of_week >= 0 && a.day_of_week <= 4) set.add(a.day_of_week);
    return set;
  }, [activities]);

  // Default selected day: today if Mon-Fri, else Monday.
  const [dayIdx, setDayIdx] = useState(() => {
    const d = (new Date().getDay() + 6) % 7; // 0=Mon..6=Sun
    return d <= 4 ? d : 0;
  });

  if (!isMobile) return null;
  if (!activities || activities.length === 0) return null; // hide when no clubs at all

  const items = activities
    .filter(a => a.day_of_week === dayIdx)
    .sort((a, b) => timeOf(a).localeCompare(timeOf(b)));

  return (
    <div
      style={{
        background: '#fff', borderRadius: 22, padding: 18,
        boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)',
      }}
    >
      {/* Header */}
      <div className="flex items-end justify-between" style={{ marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: INK3, marginBottom: 4 }}>The kids</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: -0.2 }}>After school</div>
        </div>
        <button
          type="button"
          onClick={onOpenCalendar}
          className="flex items-center gap-1"
          style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', color: BRAND, fontWeight: 600, fontSize: 13 }}
        >
          Calendar ›
        </button>
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
            const Icon = AS_ICONS[iconFor(a.activity)] || AS_ICONS.star;
            const t = timeOf(a);
            return (
              <div
                key={a.id}
                className="flex items-center"
                style={{ gap: 12 }}
                aria-label={`${a.activity}${kid ? `, ${kid.name}` : ''}${t ? `, ${t}` : ''}${picker ? `, pickup ${picker.name}` : ''}`}
              >
                <div style={{ width: 42, flexShrink: 0, fontSize: 13, fontWeight: 600, color: INK3, fontVariantNumeric: 'tabular-nums' }}>{t}</div>
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
