import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChildMode } from '../context/ChildModeContext';
import { CHILD_VISIBLE_ROUTES } from '../lib/childMode';
import api from '../lib/api';
import { lazy, Suspense } from 'react';
import { IconHome, IconCheck, IconCalendar, IconCamera, IconSettings, IconUsers, IconMore, IconUtensils, IconShield, IconFileText, IconX, IconHelp, IconList, IconGift, IconStar, IconSparkles } from './Icons';
import usePushNotifications from '../hooks/usePushNotifications';
import TrialEndedOverlay from './TrialEndedOverlay';
import OfflineBanner from './OfflineBanner';
import { tap as hapticTap } from '../lib/haptics';
import { onShortcutTapped } from '../lib/app-shortcuts';
import { syncDeviceCalendarsQuietly } from '../lib/deviceCalendar';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
const ChatWidget = lazy(() => import('./ChatWidget'));

// Desktop sidebar nav, split into labelled groups (the "Grouped" design).
// Mobile uses its own arrays (mobileNav / moreNav / moreTiles) below - this
// only drives the desktop <aside>.
const navGroups = [
  { label: null, items: [ // Home — no group heading
    { to: '/dashboard', label: 'Home', Icon: IconHome },
  ] },
  { label: 'Plan', items: [
    { to: '/calendar', label: 'Calendar',  Icon: IconCalendar },
    { to: '/tasks',    label: 'Tasks',     Icon: IconCheck    },
    { to: '/rewards',  label: 'Rewards',   Icon: IconGift     },
    { to: '/lists',    label: 'Lists',     Icon: IconList     },
    { to: '/meals',    label: 'Meal Plan', Icon: IconUtensils },
  ] },
  { label: 'Household', items: [
    { to: '/receipt',   label: 'Receipts',  Icon: IconCamera   },
    { to: '/documents', label: 'Documents', Icon: IconFileText },
    { to: '/family',    label: 'Family',    Icon: IconUsers    },
  ] },
  { label: 'Account', items: [
    { to: '/help',     label: 'Help',     Icon: IconHelp     },
    { to: '/settings', label: 'Settings', Icon: IconSettings },
  ] },
];

// Mobile bottom-tab order from the iOS design handoff: Home · Calendar ·
// Tasks · Shopping · More. Meal Plan, Receipt, Documents, Family and
// Settings live behind the More sheet (see `MoreSheet` below) - that's
// the design's deliberate pattern: keep the bottom bar to four
// destinations the user touches every day, plus a curated "More" set.
const mobileNav = [
  { to: '/dashboard',  label: 'Home',      Icon: IconHome     },
  { to: '/calendar',   label: 'Calendar',  Icon: IconCalendar },
  { to: '/tasks',      label: 'Tasks',     Icon: IconCheck    },
  { to: '/lists',      label: 'Lists',     Icon: IconList     },
  { to: '/settings',   label: 'Settings',  Icon: IconSettings },
];

// Routes considered "behind the More button" for active-tab styling.
// (The bottom-sheet redesign exposes these as feature tiles - from a
// navigation-state perspective they all live under More. Settings has
// its own tab, so it's not here.)
const moreNav = [
  { to: '/rewards' },
  { to: '/meals' },
  { to: '/family' },
  { to: '/documents' },
  { to: '/receipt' },
  { to: '/help' },
];

// Feature tiles filling the More sheet (2 columns × 3 rows). Everything
// that used to hide in the Account list is now a tile - Settings moved
// to its own bottom-nav tab and Log out lives at the foot of the
// Settings page. Accent colours come from the founder's mock and are
// tile-only, so they're inlined rather than promoted to Tailwind
// utilities.
const moreTiles = [
  {
    to: '/rewards',
    label: 'Rewards',
    sub: 'Stars & kid rewards',
    Icon: IconStar,
    bg: '#FBF1DE',
    fg: '#D89B3A',
  },
  {
    to: '/meals',
    label: 'Meal Plan',
    sub: 'Weekly dinners & recipes',
    Icon: IconUtensils,
    bg: '#FDEEE4',
    fg: '#D0693B',
  },
  {
    to: '/receipt',
    label: 'Receipts',
    sub: 'Scan & auto-match',
    Icon: IconSparkles,
    bg: '#EFE9FB',
    fg: '#6B3FA0',
  },
  {
    to: '/documents',
    label: 'Documents',
    sub: 'Household paperwork',
    Icon: IconFileText,
    bg: '#E2ECFA',
    fg: '#5B8DE0',
  },
  {
    to: '/family',
    label: 'Family Setup',
    sub: 'Members & household',
    Icon: IconUsers,
    bg: '#EDF5EE',
    fg: '#5F8F63',
  },
  {
    to: '/help',
    label: 'Help & Support',
    sub: 'Guides & contact us',
    Icon: IconHelp,
    bg: '#FBE7E7',
    fg: '#D25454',
  },
];

// One tab inside the floating pill. Per the handoff, the active state
// wraps BOTH the icon and its label in a single plum-light rounded pill
// (earlier iterations highlighted only the icon - the whole item must
// highlight). Active keeps the bolder-stroke icon treatment in place of
// filled variants, per our icon set.
function TabItem({ label, Icon, active }) {
  return (
    <span
      className={`flex flex-col items-center gap-[3px] ${active ? 'text-plum' : 'text-warm-grey'}`}
      style={{
        // 9px horizontal (not the handoff's 14px): six tabs share the pill
        // since Settings joined, and 14px overflows a 375px viewport.
        padding: '7px 9px 6px',
        borderRadius: 16,
        background: active ? 'var(--color-plum-light)' : 'transparent',
        transition: 'background .18s ease',
      }}
    >
      <Icon className="h-[23px] w-[23px]" strokeWidth={active ? 2.4 : 1.5} />
      <span className={`text-[10.5px] tracking-[0.01em] ${active ? 'font-bold' : 'font-semibold'}`}>{label}</span>
    </span>
  );
}

// Small non-interactive badge shown while Child Mode is active. Exported:
// the Dashboard's mobile greeting row renders it next to the avatar.
export function ChildModeChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-plum-light text-plum text-[10px] font-bold uppercase tracking-[0.08em] px-2 py-0.5">
      <IconShield className="h-3 w-3" /> Child
    </span>
  );
}

export default function Layout({ children }) {
  const { household, user, token, login, logout, isPlatformAdmin } = useAuth();
  const { enabled: childMode } = useChildMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [members, setMembers] = useState([]);

  // Register for push notifications on iOS
  usePushNotifications(user);

  // Close "More" sheet on navigation
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  // iOS home-screen quick actions - when the user long-presses the
  // app icon and picks "Add Task" / "View Calendar" / etc., the
  // plugin fires the click listener registered in native-shell.js
  // at boot. That listener buffers the route at module scope; here
  // we register our handler so live taps fire immediately AND any
  // cold-launch route gets drained to navigate() on the next tick.
  // No-op on web.
  useEffect(() => {
    const unsubscribe = onShortcutTapped((route) => {
      if (route) navigate(route);
    });
    return unsubscribe;
  }, [navigate]);

  // Device calendar sync (iOS app only; no-op elsewhere / when no calendars
  // are selected). Runs once at launch and again on each foreground, so the
  // household's copy of the user's device calendars stays fresh whenever the
  // app is actually used. Server-side hash-skip makes repeats nearly free.
  useEffect(() => { syncDeviceCalendarsQuietly(); }, []);
  useAppForegroundRefresh(syncDeviceCalendarsQuietly, { throttleMs: 5 * 60 * 1000 });

  // Esc-to-close + body-scroll-lock while the More sheet is open. The
  // sheet itself eats taps via stopPropagation; the backdrop click is
  // wired in the JSX below.
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e) { if (e.key === 'Escape') setMoreOpen(false); }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [moreOpen]);

  // Sync user profile and members on mount and route changes
  useEffect(() => {
    if (!user?.id) return;
    api.get('/household')
      .then(({ data }) => {
        if (data.members) setMembers(data.members);
        const me = data.members?.find(m => m.id === user.id);
        if (me && (
          (me.color_theme && me.color_theme !== user.color_theme) ||
          (me.avatar_url !== undefined && me.avatar_url !== user.avatar_url) ||
          // avatar_id (the illustrated avatars) was never synced onto `user`,
          // so a user whose avatar is an illustration showed only their initial
          // in the mobile header. Sync it too.
          (me.avatar_id !== undefined && me.avatar_id !== user.avatar_id)
        )) {
          // Pass the FRESH household from the API response, not the
          // closure `household` from useAuth(). The closure value was
          // captured at this render - but the effect resolves later,
          // and another tab/path may have updated the household in
          // between (most often the household avatar upload, which
          // would otherwise get overwritten back to null here).
          login({ token, user: { ...user, color_theme: me.color_theme || user.color_theme, avatar_url: me.avatar_url || null, avatar_id: me.avatar_id || null }, household: data.household || household });
        }
      })
      .catch(() => {});

    // Sync browser timezone to backend once per session (fire-and-forget)
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tzSynced = sessionStorage.getItem('tz_synced');
    if (browserTz && !tzSynced) {
      sessionStorage.setItem('tz_synced', '1');
      api.patch('/household/profile', { timezone: browserTz }).catch(() => {});
    }

  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only sync on mount/login, not every nav

  function handleLogout() {
    logout();
    navigate('/');
  }

  const isMoreActive = moreNav.some(n => location.pathname === n.to);

  function renderNavLink({ to, label, Icon }) {
    return (
      <NavLink
        key={to}
        to={to}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2.5 rounded-[10px] text-sm transition-colors duration-150 ${
            isActive
              ? 'text-white font-semibold'
              : 'font-medium text-warm-grey hover:bg-[#F3EEE5] hover:text-charcoal'
          }`
        }
        style={({ isActive }) => (isActive
          ? { background: 'var(--color-plum)', boxShadow: '0 2px 8px rgba(109,56,173,0.3)' }
          : undefined)}
      >
        {/* Icon inherits currentColor: white when active, warm-grey otherwise. */}
        <Icon className="h-[18px] w-[18px]" />
        {label}
      </NavLink>
    );
  }

  // Pages whose columns scroll internally (pinned headers, only the lists
  // scroll) need a bounded-height flex chain instead of the page growing the
  // window. Constrain the shell + content wrapper for just these routes so
  // every other page keeps its normal window scroll.
  const appHeight = ['/tasks', '/lists', '/rewards'].includes(location.pathname);
  const isDashboard = location.pathname === '/dashboard';

  // Child Mode trims the nav to the kid-safe routes. Desktop groups drop empty;
  // the mobile bar swaps Lists out for Rewards and loses the More button.
  const visibleGroups = childMode
    ? navGroups.map((g) => ({ ...g, items: g.items.filter((i) => CHILD_VISIBLE_ROUTES.includes(i.to)) })).filter((g) => g.items.length)
    : navGroups;
  const visibleMobileNav = childMode
    ? [
      ...mobileNav.filter((i) => CHILD_VISIBLE_ROUTES.includes(i.to)),
      { to: '/rewards', label: 'Rewards', Icon: IconGift },
      // No More button in Child Mode, so Settings (PIN-gated, the exit path)
      // gets its own tab.
      { to: '/settings', label: 'Settings', Icon: IconSettings },
    ]
    : mobileNav;

  return (
    <div
      className={`app-shell bg-cream flex flex-col md:flex-row ${appHeight ? 'overflow-hidden' : 'min-h-screen'}`}
      style={appHeight ? { height: '100dvh' } : undefined}
    >
      {/* ── Desktop Sidebar ── */}
      <aside
        className="hidden md:flex w-60 bg-white flex-col fixed inset-y-0 left-0 z-30"
      >
        {/* Logo */}
        <div className="px-6 flex flex-wrap items-center gap-x-2.5 gap-y-1.5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 35px)', paddingBottom: '30px' }}>
          <img src="/housemait-logo-web.svg" alt="Housemait" className="h-6 w-auto" />
          {childMode && <ChildModeChip />}
          {!childMode && isPlatformAdmin && (
            <Link to="/admin" className="ml-auto text-warm-grey hover:text-plum transition-colors" title="Admin Dashboard" aria-label="Admin Dashboard">
              <IconShield className="h-5 w-5" />
            </Link>
          )}
        </div>

        {/* Grouped nav - labelled sections; active item is a solid-brand pill. */}
        <nav className="flex-1 px-3 flex flex-col gap-[18px] overflow-y-auto">
          {visibleGroups.map((g) => (
            <div key={g.label || g.items[0]?.to}>
              {g.label && (
                <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ink-2)]">
                  {g.label}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {g.items.map(renderNavLink)}
              </div>
            </div>
          ))}
        </nav>

      </aside>

      {/* ── Mobile Top Bar ──────────────────────────────────────────
           Wordmark logo + avatar-as-settings. Shown ONLY on the dashboard;
           every other page hides it so the page's own H1 leads. Off the
           dashboard we keep a sticky cream strip the height of the iOS
           status-bar inset, so content never slides under the notch.
           (Settings stays reachable via the More tab.) */}
      {/* Mobile top strip: just the safe-area backing on every page. The
          dashboard's old logo header is gone - its greeting row (kicker +
          title + avatar) now renders inside Dashboard itself, which owns
          the event-count data the kicker needs. */}
      <div className="md:hidden sticky top-0 z-30 safe-top" style={{ background: 'var(--color-cream)' }} aria-hidden="true" />

      {/* ── Main Content ── */}
      <main className={`flex-1 md:ml-60 min-w-0 overflow-x-hidden${appHeight ? ' flex flex-col min-h-0' : ''}`}>
        <OfflineBanner />
        {/* Mobile reserves room for the floating AI chat button (≈152px tall,
            bottom-right) so it never covers content. Window-scrolling pages get
            pb-40 directly. The inner-scroll appHeight pages (Tasks/Lists/
            Rewards) instead keep a full-height viewport (pb-0) and pad the
            bottom of their OWN scroll area, so the gap only shows once you
            reach the end - not permanently. Desktop has no bottom bar, pb-9. */}
        <div className={`px-4 md:px-8 pt-4 md:pt-9 ${appHeight ? 'pb-0' : 'pb-40'} md:pb-9 ${appHeight ? 'flex-1 min-h-0 overflow-hidden' : ''}`}>
          {children}
        </div>
      </main>

      {/* ── Mobile Bottom Tab Bar ──────────────────────────────────
          Floating frosted pill from the floating-nav design handoff:
          the bar sits inset from the screen edges rather than flush to
          the bottom, and page content fades out beneath it through the
          wrapper's cream gradient. The wrapper ignores taps so the faded
          margin around the pill still scrolls/clicks the page. */}
      <div
        className="md:hidden fixed bottom-0 inset-x-0 z-30 pointer-events-none"
        style={{
          padding: '18px 16px',
          // The handoff's flat 22px doesn't cover the iPhone home
          // indicator - grow with the safe area but never shrink below it.
          paddingBottom: 'max(22px, calc(env(safe-area-inset-bottom, 0px) + 8px))',
          background: 'linear-gradient(to top, rgba(251,248,243,0.9) 55%, rgba(251,248,243,0))',
        }}
      >
        <nav
          className="pointer-events-auto flex items-center justify-around"
          style={{
            padding: '10px 8px',
            borderRadius: 26,
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.6)',
            boxShadow: '0 10px 30px rgba(26,22,32,0.14), 0 1px 0 rgba(255,255,255,0.7) inset',
          }}
        >
          {visibleMobileNav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => { hapticTap(); }}
              className="flex-1 max-w-[64px] flex flex-col items-center"
            >
              {({ isActive }) => <TabItem label={label} Icon={Icon} active={isActive} />}
            </NavLink>
          ))}

          {/* More tab - opens the redesigned bottom sheet. The sheet itself
              is rendered outside the <nav> so it can take the full viewport
              instead of being clipped by the tab bar. The button matches
              the layout/sizing of the NavLinks above so the row stays
              visually balanced. */}
          {!childMode && (
          <button
            onClick={() => setMoreOpen(v => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            className="flex-1 max-w-[64px] flex flex-col items-center"
          >
            <TabItem label="More" Icon={IconMore} active={isMoreActive || moreOpen} />
          </button>
          )}
        </nav>
      </div>

      {/* ── More bottom sheet ──────────────────────────────────────
          A native-feeling iOS-style sheet: backdrop fades in over 250ms;
          panel slides up with `cubic-bezier(0.32, 0.72, 0, 1)` over 320ms.
          Designed mobile-first - it auto-hides on ≥768px where the
          desktop sidebar already exposes everything in this menu. */}
      {!childMode && moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}

      {/* Floating AI chat button + panel. Hidden on the dashboard, which has
          its own AI composer, so the FAB isn't redundant there. */}
      {!childMode && !isDashboard && <Suspense fallback={null}><ChatWidget /></Suspense>}

      {/* Trial-ended overlay - only renders for expired households who
          haven't dismissed it this session. Scoped to Layout so it
          never appears on the Subscribe / Login / Signup routes (which
          don't use Layout). */}
      <TrialEndedOverlay />
    </div>
  );
}

/**
 * MoreSheet - iOS-style bottom sheet exposed from the last tab on mobile.
 *
 * Anatomy (top → bottom):
 *   • Drag handle (5×40 pill)
 *   • Header row: "More" title + circular X close button
 *   • 2×3 grid of feature tiles (Rewards / Meal Plan / Receipts /
 *     Documents / Family Setup / Help & Support) - nothing else. The old
 *     Account list is gone: Settings is a bottom-nav tab and Log out
 *     lives at the foot of the Settings page.
 *
 * Layout in the source tree maps to the Housemait iOS design handoff
 * (`design_handoff_housemait_ios/README.md` § "More sheet"). Tile accent
 * colours are inlined because they're tile-only and not reused elsewhere
 * - promoting them to Tailwind utilities would just add noise.
 *
 * Animation: a `mounted` flag flips on the next frame so the slide-up
 * transition runs from `translateY(100%)` → `translateY(0)`. Reduced
 * motion is honoured via `motion-reduce:` Tailwind variants on the
 * panel transition.
 *
 * Dismissal:
 *   • Tap the X button
 *   • Tap the backdrop above the sheet
 *   • Press Esc (wired one level up in Layout)
 *   • Tap any nav link inside the sheet (parent's pathname effect)
 *   • Drag the handle / header bar downward past ~100 px or with a
 *     downward flick - the iOS-native gesture users expect when they
 *     see a drag handle pill at the top.
 *
 * The drag listener is scoped to the handle + header strip so touches
 * inside the FAQ tile grid (below) remain tappable. `touchAction: 'none'`
 * on the drag region tells the browser this surface doesn't scroll, so
 * we can `setDragOffset` without fighting native scroll behaviour.
 *
 * dragRef holds gesture state that doesn't need to drive re-renders
 * (start coords, timestamps). `dragOffset` lives in state because the
 * panel transform reads it on render.
 */
function MoreSheet({ onClose }) {
  const [mounted, setMounted] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  // `isDragging` lives in state because the panel's `transition` prop
  // depends on it (none while dragging, spring-easing otherwise) and
  // reading mutable values off a ref during render violates React's
  // ref-stability contract. Drag start/end each cause exactly one
  // additional render - negligible. Frame-by-frame finger tracking
  // happens via `dragOffset` (also state) inside onDragMove.
  const [isDragging, setIsDragging] = useState(false);
  // Stable per-gesture state we don't want to render on (start coords
  // and timestamp). Mutated synchronously inside the touch handlers.
  const dragRef = useRef({ startY: 0, startTime: 0 });

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function onDragStart(e) {
    const touch = e.touches?.[0];
    if (!touch) return;
    dragRef.current = { startY: touch.clientY, startTime: Date.now() };
    setIsDragging(true);
  }

  function onDragMove(e) {
    if (!isDragging) return;
    const touch = e.touches?.[0];
    if (!touch) return;
    const dy = touch.clientY - dragRef.current.startY;
    // Downward drags only - clamp upward delta to 0 so the sheet stays
    // glued to translateY(0) at rest. Some sheet libraries allow a small
    // overscroll above the resting position; we deliberately don't.
    setDragOffset(Math.max(0, dy));
  }

  function onDragEnd() {
    if (!isDragging) return;
    const elapsed = Date.now() - dragRef.current.startTime;
    const distance = dragOffset;
    // velocity in px/ms - anything > ~0.6 reads as a deliberate flick
    // even if the absolute distance is small. Tuned by feel against
    // Apple's bottom-sheet gesture in Maps.
    const velocity = elapsed > 0 ? distance / elapsed : 0;

    setIsDragging(false);

    if (distance > 100 || velocity > 0.6) {
      // Dismiss. Don't reset dragOffset - the sheet is about to unmount
      // anyway, and resetting would cause a brief reverse animation
      // before the parent's `moreOpen=false` removes us from the tree.
      onClose();
    } else {
      // Snap back. The transition kicks in (isDragging just flipped to
      // false) so the panel springs back to translateY(0).
      setDragOffset(0);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="More"
      className="md:hidden fixed inset-0 z-[60] flex items-end"
      style={{
        background: mounted ? 'rgba(45,42,51,0.45)' : 'rgba(45,42,51,0)',
        transition: 'background 250ms ease',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-cream flex flex-col motion-reduce:transition-none"
        style={{
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          maxHeight: '88vh',
          transform: mounted
            ? `translateY(${dragOffset}px)`
            : 'translateY(100%)',
          transition: isDragging
            ? 'none'
            : 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
          boxShadow: '0 -10px 30px rgba(0,0,0,0.12)',
        }}
      >
        {/* Drag handle + header - touch listeners scoped here so touches
            inside the FAQ tile grid below stay tappable. touchAction:none
            tells the browser not to interpret this region as scrollable
            content, which would otherwise fight our setDragOffset. */}
        <div
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
          style={{ touchAction: 'none' }}
        >
          {/* Drag handle pill */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-[5px] w-10 rounded-full bg-light-grey" />
          </div>

          {/* Header row */}
          <div className="flex items-center justify-between px-5 pt-1 pb-3">
          <h2
            className="text-[24px] font-bold text-charcoal m-0"
          >
            More
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-10 h-10 rounded-full bg-[#F1EEE9] flex items-center justify-center text-charcoal/70 hover:text-charcoal active:scale-95 transition-transform"
          >
            <IconX className="h-[18px] w-[18px]" />
          </button>
          </div>
        </div>

        {/* Scrollable body - only flexes when content overflows the
            88vh cap (rare on a phone, common on a small landscape view). */}
        <div className="flex-1 overflow-y-auto">
          {/* 2×3 feature tiles - the whole sheet */}
          <div className="grid grid-cols-2 gap-3 px-5 pt-1 pb-4">
            {moreTiles.map(({ to, label, sub, Icon, bg, fg }) => (
              <NavLink
                key={to}
                to={to}
                className="bg-white rounded-2xl border border-light-grey p-4 flex flex-col gap-3.5 items-start text-left active:scale-[0.98] transition-transform"
                style={{ minHeight: 130 }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: bg, color: fg }}
                >
                  <Icon className="h-[22px] w-[22px]" />
                </div>
                <div>
                  <div className="text-[14px] font-bold text-charcoal leading-tight">
                    {label}
                  </div>
                  <div className="text-[11px] text-warm-grey mt-0.5">
                    {sub}
                  </div>
                </div>
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
