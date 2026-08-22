/**
 * Home-screen setup nudges — "finish moving in".
 *
 * A quiet prompt for the setup steps people skip during onboarding. Two
 * presentations, one rule:
 *
 *   more than one task left  → tinted tile grid (2 columns on phone, one row
 *                              on desktop)
 *   exactly one task left    → a single full-width tinted bar
 *   none left                → a brief "All moved in." if the last one was
 *                              COMPLETED, nothing at all if it was dismissed;
 *                              then gone for good
 *
 * Two rules that matter more than the layout:
 *
 * 1. Completion is DERIVED from real state — a second adult in the household,
 *    WhatsApp linked, a calendar connected, notification permission granted.
 *    Never from the tile being tapped. Do that and the tile lies: it would
 *    tick itself off for someone who opened the invite sheet and closed it
 *    again, and it would fail to notice the same task being completed in
 *    Settings. Tiles deep-link to the real flows and reflect their outcome.
 *
 * 2. Dismissal is per-task, per-USER, permanent. Stored server-side rather
 *    than in localStorage — every other nudge in this app dismisses per
 *    device, so dismissing on your phone leaves it sitting on your laptop.
 *    A one-person household has nobody to invite, and the × has to stick.
 *
 * Reminders is NATIVE-APP-only, not "small screen"-only. There is no web
 * push in this app, so in any browser — a desktop one, or a desktop one
 * narrowed to phone width, or Safari on an actual phone — that tile could
 * never tick itself off; the permission it keys off exists only inside the
 * iOS/Android app. A viewport check looked right on real phones and then
 * showed the tile to anyone who resized a desktop window. A tile that can
 * never complete is exactly the nagging this design exists to avoid, so
 * browsers get three tasks.
 *
 * Design handoff: design_handoff_nudges/README.md. Values there are exact;
 * the reference JSX is a prototype and was not ported.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion';
import { getNotificationPermission } from '../lib/notificationPermission';
import { Capacitor } from '@capacitor/core';
import api from '../lib/api';

// Fixed order. The grid reflows as tiles leave; it never re-sorts.
const TASKS = [
  { id: 'invite', label: 'Invite your family', to: '/family' },
  // Settings, not the standalone /connect-whatsapp screen: both connect tiles
  // should land in the same place, and Settings keeps them next to the state
  // they change (and, on iOS, opens as the section popup).
  { id: 'wa', label: 'Connect WhatsApp', to: '/settings?section=whatsapp' },
  { id: 'cal', label: 'Add your calendars', to: '/settings?section=calendars' },
  { id: 'rem', label: 'Turn on reminders', to: '/settings?section=notifications', nativeOnly: true },
  // Only offered once the household has a CHILD dependent - a school nudge
  // for a couple with no kids is noise, and the tile appearing right after
  // they add their first child is the moment it is most likely to land.
  // Placed after the connect tiles, before reminders: the "get things in"
  // tasks belong together. NOT gated on children - forwarding is just as
  // useful for bookings, orders and appointments.
  // 'emails-to-ai' is the real Settings slug (IOS_SECTIONS). A made-up
  // one fails SILENTLY - the deep-link effect returns early and the
  // tile just lands on Settings with nothing open.
  { id: 'inbox', label: 'Claim your inbox', to: '/settings?section=emails-to-ai' },
  { id: 'school', label: "Add their school", to: '/school', needsChild: true },
];

// Flat tint fill, no border, no shadow. All content in the tint's fg.
const TINT = {
  invite: { bg: 'var(--color-plum-light)', fg: 'var(--color-plum-dark)' },
  wa: { bg: '#E5F0E2', fg: '#2E6B44' },
  cal: { bg: '#E2ECFA', fg: '#2E5799' },
  rem: { bg: '#FBF1DE', fg: '#8A5F1E' },
  school: { bg: '#F3EDFC', fg: '#5A3488' },
  inbox: { bg: '#FAECE7', fg: '#993C1D' },
};

const CELEBRATION_HOLD_MS = 1600;
const CELEBRATION_FADE_MS = 450;

function Glyph({ id, fg, size }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: fg, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  if (id === 'wa') {
    return <svg {...common}><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" /></svg>;
  }
  if (id === 'cal') {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18" />
      </svg>
    );
  }
  if (id === 'rem') {
    return (
      <svg {...common}>
        <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
        <path d="M13.7 20a2 2 0 0 1-3.4 0" />
      </svg>
    );
  }
  if (id === 'inbox') {
    // Envelope, matching the onboarding step's demo card.
    return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M4 7l8 6 8-6" /></svg>;
  }
  if (id === 'school') {
    return (
      <svg {...common}>
        <path d="M12 4 2 9l10 5 10-5-10-5z" />
        <path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" />
        <path d="M22 9v5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function Tick({ fg, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={fg}
      strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l5 5L20 6" />
    </svg>
  );
}

function DismissX({ fg, onClick, label, hideUntilHover }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={hideUntilHover ? 'hm-nudge-x' : undefined}
      style={{
        position: 'absolute', top: 9, right: 9, width: 26, height: 26,
        borderRadius: '50%', border: 0, background: 'transparent',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/**
 * Which of the four are already done, from real app state.
 *
 * `members` comes from the dashboard digest, so invite/wa/dismissals cost no
 * extra request. Calendars need one call. Notification permission is read
 * WITHOUT prompting — the OS dialog is one-shot and must never be spent on a
 * render.
 */
function useDerivedCompletion(members) {
  const { user } = useAuth();
  const [calConnected, setCalConnected] = useState(null);
  const [notifGranted, setNotifGranted] = useState(null);
  const [schoolAdded, setSchoolAdded] = useState(null);
  const [inviteSent, setInviteSent] = useState(null);

  // Computed up here because two effects key off it. A second ADULT, not a
  // second row - dependents don't count as invited family.
  const soloAdult = members.length > 0
    && members.filter((m) => (m.member_type || 'account') === 'account').length < 2;

  useEffect(() => {
    // The invite tile's task is INVITING, and sending the invite is the last
    // act the user controls - completion must not wait on the partner
    // opening their email (live 2026-07-31: sent an invite, came back, tile
    // still there). A pending invite therefore counts as done. Checked only
    // while there is a single adult; once a second account exists the
    // members list answers by itself.
    if (!soloAdult) return undefined;
    let cancelled = false;
    api.get('/household/invites')
      .then((res) => { if (!cancelled) setInviteSent((res.data?.invites || []).length > 0); })
      // Same lean as every check here: on error assume done.
      .catch(() => { if (!cancelled) setInviteSent(true); });
    return () => { cancelled = true; };
  }, [soloAdult]);

  // Legacy dependents predate dependent_kind and are all children - a null
  // kind must count, or every pre-split family loses the school nudge.
  const hasChild = members.some(
    (m) => m.member_type === 'dependent' && (m.dependent_kind || 'child') === 'child',
  );

  useEffect(() => {
    // Fetched only for households the tile can apply to; for everyone else
    // the answer is irrelevant and the request would be pure noise. Re-runs
    // when a child is added mid-session, which is exactly when the tile
    // should appear.
    // No reset on the way OUT of eligibility: while there is no child the
    // task is filtered from the list and readiness ignores this value, so a
    // stale answer is unreachable.
    if (!hasChild) return undefined;
    let cancelled = false;
    api.get('/schools')
      .then((res) => { if (!cancelled) setSchoolAdded((res.data?.schools || []).length > 0); })
      // Same lean as the calendar check: on error assume done - under-
      // prompting beats nagging someone who has already added the school.
      .catch(() => { if (!cancelled) setSchoolAdded(true); });
    return () => { cancelled = true; };
  }, [hasChild]);

  useEffect(() => {
    let cancelled = false;
    api.get('/calendar/external-feeds')
      .then((res) => {
        if (cancelled) return;
        const feeds = (res.data?.feeds || []).filter((f) => f.sync_enabled !== false);
        setCalConnected(feeds.length > 0);
      })
      // On a transient error, assume connected: under-prompting beats nagging
      // someone who has already done it.
      .catch(() => { if (!cancelled) setCalConnected(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getNotificationPermission().then((p) => {
      if (!cancelled) setNotifGranted(p === 'granted');
    });
    return () => { cancelled = true; };
  }, []);

  // Claimed = the household holds a memorable alias. Derived, never from
  // tapping the tile: claiming in Settings or during onboarding must tick
  // it off too. A household with only the hex token counts as unclaimed -
  // that token is exactly what nobody can dictate over the phone.
  const { household } = useAuth();
  const inboxClaimed = Boolean(household?.email_alias);

  const me = members.find((m) => m.id === user?.id) || null;

  // A second ADULT, not a second row. getHouseholdMembers returns dependents
  // too, so a solo parent who added one child during onboarding would
  // otherwise see "Invite your family" tick itself off without inviting
  // anyone.
  const adults = members.filter((m) => (m.member_type || 'account') === 'account');

  return {
    invite: adults.length >= 2 || inviteSent === true,
    wa: !!me?.whatsapp_linked,
    cal: calConnected,
    rem: notifGranted,
    school: schoolAdded,
    inbox: inboxClaimed,
    hasChild,
    // Null anywhere means "not known yet" - hold the whole component back
    // rather than flash a tile that is about to vanish. The school answer
    // only gates readiness for households the tile applies to.
    ready: calConnected !== null && notifGranted !== null && members.length > 0
      && (!hasChild || schoolAdded !== null)
      && (!soloAdult || inviteSent !== null),
    dismissed: Array.isArray(me?.setup_nudges_dismissed) ? me.setup_nudges_dismissed : [],
  };
}

/* ── local dismissal echo ──────────────────────────────────────────────────
   Keyed per user so a shared device can't leak one person's dismissals into
   another's dashboard. Complements (never replaces) users.setup_nudges_
   dismissed: entries are added only after the server confirmed the write. */
const echoKey = (userId) => `hm_setup_nudges_echo:${userId || 'anon'}`;
function readDismissEcho(userId) {
  try { return JSON.parse(localStorage.getItem(echoKey(userId)) || '[]'); } catch { return []; }
}
function writeDismissEcho(userId, id) {
  try {
    const cur = new Set(readDismissEcho(userId));
    cur.add(id);
    localStorage.setItem(echoKey(userId), JSON.stringify([...cur]));
  } catch { /* private mode etc. - the server row still holds the truth */ }
}

export default function SetupNudges({ members = [] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const reducedMotion = usePrefersReducedMotion();
  const derived = useDerivedCompletion(members);

  // Locally-dismissed ids, merged over the server list. Two jobs: the tile
  // leaves on tap rather than after the digest refreshes, and - via the
  // localStorage echo - a dismissal this device made SURVIVES navigation.
  // The dashboard paints cache-first, so returning to it renders a digest
  // snapshot that can predate the dismissal; without the echo, the tile the
  // user just killed walks back in until the fresh fetch lands. The echo is
  // written only after the server accepts the write, and only ever UNIONED
  // with the server list - it can't mask another device's state, and server
  // truth still wins for everything else. (Live 2026-07-31: X'd tile
  // reappeared on navigate-away-and-back.)
  const [justDismissed, setJustDismissed] = useState(() => readDismissEcho(user?.id));
  const [fading, setFading] = useState(false);
  const [gone, setGone] = useState(false);
  const celebratedRef = useRef(false);

  // isMobile (viewport width) is for LAYOUT only. Task eligibility uses the
  // platform: width says nothing about whether push permission can exist.
  const isNative = useMemo(() => { try { return Capacitor.isNativePlatform(); } catch { return false; } }, []);
  const tasks = useMemo(
    () => TASKS.filter((t) => (!t.nativeOnly || isNative) && (!t.needsChild || derived.hasChild)),
    [isNative, derived.hasChild],
  );

  const dismissed = useMemo(
    () => new Set([...derived.dismissed, ...justDismissed]),
    [derived.dismissed, justDismissed],
  );

  const remaining = tasks.filter((t) => !derived[t.id] && !dismissed.has(t.id));
  // Celebrate only when the last one was COMPLETED. If it was dismissed the
  // component just disappears - congratulating someone for opting out would
  // be the wrong note entirely.
  const allComplete = tasks.length > 0 && tasks.every((t) => derived[t.id]);

  // "All moved in." marks the MOMENT of finishing, not the state of being
  // finished. Without this it replayed on every visit to the dashboard:
  // leaving unmounts the component, coming back remounts it with everything
  // already complete, and the celebration fired again from scratch.
  //
  // So: only celebrate if we actually watched them finish - if this mount ever
  // saw an unfinished state. Set during render rather than in an effect,
  // because an effect runs after paint and the celebration would flash for a
  // frame before being suppressed, which is the same bug just briefer. React
  // re-runs the component before committing, so this costs no extra paint.
  const [sawUnfinished, setSawUnfinished] = useState(false);
  if (derived.ready && !allComplete && !sawUnfinished) setSawUnfinished(true);

  useEffect(() => {
    if (!allComplete || !sawUnfinished || celebratedRef.current) return;
    celebratedRef.current = true;
    // Reduce Motion collapses both delays to zero rather than branching: the
    // celebration is skipped entirely instead of held-then-faded, and the
    // state changes still happen in a callback rather than during the effect.
    const hold = reducedMotion ? 0 : CELEBRATION_HOLD_MS;
    const fade = reducedMotion ? 0 : CELEBRATION_FADE_MS;
    const t1 = setTimeout(() => setFading(true), hold);
    const t2 = setTimeout(() => setGone(true), hold + fade);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [allComplete, sawUnfinished, reducedMotion]);

  function dismiss(id) {
    setJustDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]));
    api.post('/household/setup-nudges/dismiss', { task: id })
      // Echo only a CONFIRMED write: an echoed-but-never-stored dismissal
      // would hide the tile on this device forever while other devices keep
      // showing it - the exact split-brain the server column exists to end.
      .then(() => writeDismissEcho(user?.id, id))
      // Local state already hid it; a failed write means it returns next load,
      // which is better than pretending and better than an error the user
      // can do nothing about.
      .catch(() => { /* no-op */ });
  }

  if (gone || !derived.ready) return null;
  // Finished on an earlier visit: nothing to show, and nothing to celebrate.
  if (allComplete && !sawUnfinished) return null;
  if (!remaining.length && !allComplete) return null;

  const transition = reducedMotion ? 'none' : `opacity ${CELEBRATION_FADE_MS}ms ease`;

  // ── Celebration / single bar ──────────────────────────────────────────
  if (allComplete || remaining.length === 1) {
    const task = remaining[0];
    const tint = allComplete ? TINT.wa : TINT[task.id];
    return (
      <div style={{ opacity: fading ? 0 : 1, transition }}>
        <div
          className={allComplete ? undefined : 'hm-nudge'}
          onClick={allComplete ? undefined : () => navigate(task.to)}
          role={allComplete ? undefined : 'button'}
          tabIndex={allComplete ? undefined : 0}
          onKeyDown={allComplete ? undefined : (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(task.to); }
          }}
          style={{
            position: 'relative',
            borderRadius: isMobile ? 22 : 18,
            background: tint.bg,
            padding: isMobile ? '15px 16px' : '15px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 13 : 14,
            cursor: allComplete ? 'default' : 'pointer',
          }}
        >
          {allComplete ? (
            <>
              <Tick fg={tint.fg} />
              <div style={{ fontSize: isMobile ? 14.5 : 15, fontWeight: 600, color: tint.fg }}>All moved in.</div>
            </>
          ) : (
            <>
              <Glyph id={task.id} fg={tint.fg} size={isMobile ? 23 : 24} />
              {isMobile ? (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: tint.fg, letterSpacing: -0.1 }}>{task.label}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 500, color: tint.fg, opacity: 0.65, marginTop: 1 }}>1 step left</div>
                </div>
              ) : (
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: tint.fg, letterSpacing: -0.1 }}>{task.label}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: tint.fg, opacity: 0.65 }}>1 step left</span>
                </div>
              )}
              <DismissX
                fg={tint.fg}
                label={`Dismiss ${task.label}`}
                hideUntilHover={!isMobile}
                onClick={(e) => { e.stopPropagation(); dismiss(task.id); }}
              />
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Tiles ─────────────────────────────────────────────────────────────
  // Phone: ONE side-scrolling row (founder call 2026-08-21, the Ring
  // pattern). Six tiles in two columns ran to three rows and pushed the
  // whole dashboard below the fold; a single row gives ~230px back.
  //
  // The row deliberately BLEEDS to the screen edge: the half-visible tile
  // at the right is the only thing telling anyone it scrolls. Hence the
  // negative right margin cancelling the page gutter, with the padding
  // restored inside so the last tile can sit under the edge.
  //
  // The trade, stated plainly: a grid shows every remaining task at once,
  // a scroller hides everything past the second. Acceptable because these
  // are a gentle nudge, not a checklist someone is working through - but
  // it IS the reason to watch whether later tiles get tapped less.
  //
  // Desktop keeps its single row: it already fits, and there is no gutter
  // to bleed into.
  // Must equal the page padding (Layout's px-4 = 16px on mobile) so the
  // row bleeds to the true screen edge. Bleed too little and the peek is
  // clipped by the gutter; too much and the tiles sit past the edge.
  const GUTTER = 16;
  return (
    <div
      style={isMobile ? {
        display: 'flex',
        gap: 10,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollSnapType: 'x proximity',
        marginRight: -GUTTER,
        paddingRight: GUTTER,
        paddingBottom: 2,
        scrollbarWidth: 'none',
      } : {
        display: 'grid',
        gridTemplateColumns: `repeat(${tasks.length}, 1fr)`,
        gap: 14,
      }}
    >
      {remaining.map((task) => {
        const tint = TINT[task.id];
        return (
          <div
            key={task.id}
            className="hm-nudge"
            onClick={() => navigate(task.to)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(task.to); }
            }}
            style={{
              position: 'relative',
              // Fixed width so tiles keep their size as others leave, and
              // so the last one is reliably clipped by the screen edge.
              // Proportional, not fixed px: at 116px three tiles plus their
              // gaps almost exactly filled a 17 Pro, leaving a ~10px sliver
              // that read as a rendering glitch rather than "there's more".
              // Fixed width, back from a proportional one: at 27% the tiles
              // were narrow enough that "Invite your family" broke onto
              // three lines and the row read as squashed. 110px keeps the
              // roomier look of the original 116 while still leaving a
              // visible slice of the next tile.
              ...(isMobile ? { flex: '0 0 110px', scrollSnapAlign: 'start' } : null),
              minHeight: isMobile ? 96 : 106,
              borderRadius: isMobile ? 22 : 20,
              padding: isMobile ? '14px 15px 13px' : '16px 18px 14px',
              background: tint.bg,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <DismissX
              fg={tint.fg}
              label={`Dismiss ${task.label}`}
              hideUntilHover={!isMobile}
              onClick={(e) => { e.stopPropagation(); dismiss(task.id); }}
            />
            <div style={{ height: isMobile ? 27 : 26, display: 'flex', alignItems: 'center' }}>
              <Glyph id={task.id} fg={tint.fg} size={isMobile ? 23 : 24} />
            </div>
            <div style={{
              // 13.5 on mobile: at 14.5 the longer labels needed a third
              // line once the tiles narrowed, which is what made the row
              // look cramped. Desktop is unchanged - it has the width.
              fontSize: isMobile ? 13.5 : 15,
              fontWeight: 600,
              color: tint.fg,
              lineHeight: 1.3,
              letterSpacing: -0.1,
              paddingRight: 6,
            }}>
              {task.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
