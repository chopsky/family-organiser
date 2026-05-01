import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { lazy, Suspense } from 'react';
import { IconHome, IconCart, IconCheck, IconCalendar, IconCamera, IconSettings, IconUsers, IconMore, IconUtensils, IconShield, IconFileText, IconX, IconChevronRight, IconHelp } from './Icons';
import usePushNotifications from '../hooks/usePushNotifications';
import TrialEndedOverlay from './TrialEndedOverlay';
const ChatWidget = lazy(() => import('./ChatWidget'));

const mainNav = [
  { to: '/dashboard',  label: 'Home',     Icon: IconHome     },
  { to: '/shopping',   label: 'Shopping',  Icon: IconCart      },
  { to: '/tasks',      label: 'Tasks',     Icon: IconCheck     },
  { to: '/calendar',   label: 'Calendar',  Icon: IconCalendar  },
  { to: '/meals',      label: 'Meal Plan', Icon: IconUtensils  },
  { to: '/receipt',    label: 'Receipt',   Icon: IconCamera    },
  { to: '/documents',  label: 'Documents', Icon: IconFileText  },
  { to: '/family',     label: 'Family',    Icon: IconUsers     },
];

// Mobile bottom-tab order from the iOS design handoff: Home · Calendar ·
// Tasks · Shopping · More. Meal Plan, Receipt, Documents, Family and
// Settings live behind the More sheet (see `MoreSheet` below) — that's
// the design's deliberate pattern: keep the bottom bar to four
// destinations the user touches every day, plus a curated "More" set.
const mobileNav = [
  { to: '/dashboard',  label: 'Home',      Icon: IconHome     },
  { to: '/calendar',   label: 'Calendar',  Icon: IconCalendar },
  { to: '/tasks',      label: 'Tasks',     Icon: IconCheck    },
  { to: '/shopping',   label: 'Shopping',  Icon: IconCart     },
];

// Routes considered "behind the More button" for active-tab styling.
// (The bottom-sheet redesign exposes these as feature tiles + an account
// list, but from a navigation-state perspective they all live under More.)
const moreNav = [
  { to: '/meals' },
  { to: '/family' },
  { to: '/documents' },
  { to: '/receipt' },
  { to: '/settings' },
  { to: '/help' },
];

// 2×2 feature tiles that head the More sheet. Colours are taken from the
// Housemait iOS design handoff (warm amber / brand plum / sky blue / dusty
// rose) — they're tile-only accents, not part of the global token set, so
// they're inlined rather than promoted to Tailwind utilities.
const moreTiles = [
  {
    to: '/meals',
    label: 'Meal Plan',
    sub: 'Weekly dinners & recipes',
    Icon: IconUtensils,
    bg: '#FBF1DE',
    fg: '#D89B3A',
  },
  {
    to: '/receipt',
    label: 'Receipts',
    sub: 'Scan & auto-match',
    Icon: IconCamera,
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
    label: 'Family',
    sub: 'Members & settings',
    Icon: IconUsers,
    bg: '#FBE6EA',
    fg: '#D8788A',
  },
];

// Account section rows. Notifications, Connected apps and Privacy &
// data are intentionally omitted — they're all reachable from inside
// Settings, and surfacing them as separate rows promised destinations
// we don't yet deep-link cleanly. Help & support links to /help, which
// hosts the FAQ + contact form (logged-out users have /support).
const moreAccountRows = [
  { to: '/settings', label: 'Settings', bold: true },
  { to: '/help',     label: 'Help & support' },
];

const avatarColors = {
  red: 'bg-red text-white',
  'burnt-orange': 'bg-burnt-orange text-white',
  amber: 'bg-amber text-white',
  gold: 'bg-gold text-white',
  leaf: 'bg-leaf text-white',
  emerald: 'bg-emerald text-white',
  teal: 'bg-teal text-white',
  sky: 'bg-sky text-white',
  cobalt: 'bg-cobalt text-white',
  indigo: 'bg-indigo text-white',
  purple: 'bg-purple text-white',
  magenta: 'bg-magenta text-white',
  rose: 'bg-rose text-white',
  terracotta: 'bg-terracotta text-white',
  moss: 'bg-moss text-white',
  slate: 'bg-slate text-white',
  // Legacy fallbacks
  sage: 'bg-sage text-white',
  plum: 'bg-plum text-white',
  coral: 'bg-coral text-white',
  lavender: 'bg-indigo text-white',
};

export default function Layout({ children }) {
  const { household, user, token, login, logout, isPlatformAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [members, setMembers] = useState([]);

  // Register for push notifications on iOS
  usePushNotifications(user);

  // Close "More" sheet on navigation
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

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
          (me.avatar_url !== undefined && me.avatar_url !== user.avatar_url)
        )) {
          login({ token, user: { ...user, color_theme: me.color_theme || user.color_theme, avatar_url: me.avatar_url || null }, household });
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

  const avatarClass = avatarColors[user?.color_theme] || avatarColors.sage;

  function renderAvatar(size = 'w-8 h-8', textSize = 'text-sm') {
    if (user?.avatar_url) {
      return <img src={user.avatar_url} alt={user.name} className={`${size} rounded-full object-cover`} />;
    }
    return (
      <div className={`${size} rounded-full ${avatarClass} flex items-center justify-center font-bold ${textSize}`}>
        {user?.name?.[0]?.toUpperCase()}
      </div>
    );
  }

  const isMoreActive = moreNav.some(n => location.pathname === n.to);

  function renderNavLink({ to, label, Icon }) {
    return (
      <NavLink
        key={to}
        to={to}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-all duration-150 ${
            isActive
              ? 'bg-plum-light text-plum'
              : 'text-warm-grey hover:bg-cream hover:text-charcoal'
          }`
        }
      >
        <Icon className="h-5 w-5" />
        {label}
      </NavLink>
    );
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 bg-white border-r border-light-grey flex-col fixed inset-y-0 left-0 z-30">
        {/* Logo */}
        <div className="px-6 flex items-center gap-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 35px)', paddingBottom: '30px' }}>
          <img src="/housemait-logo.svg" alt="HouseMait" className="h-6" />
        </div>

        {/* Household pill */}
        {/* Main nav */}
        <nav className="flex-1 px-3 flex flex-col gap-0.5">
          {mainNav.map(renderNavLink)}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-light-grey flex items-center gap-2.5">
          {renderAvatar('w-8 h-8', 'text-xs')}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-charcoal truncate">{user?.name}</p>
            <p className="text-[11px] text-warm-grey capitalize">{user?.role || 'Member'}</p>
          </div>
          {isPlatformAdmin && (
            <Link to="/admin" className="text-warm-grey hover:text-plum transition-colors" title="Admin Dashboard">
              <IconShield className="h-5 w-5" />
            </Link>
          )}
          <Link to="/help" className="text-warm-grey hover:text-charcoal transition-colors" title="Help & support">
            <IconHelp className="h-5 w-5" />
          </Link>
          <Link to="/settings" className="text-warm-grey hover:text-charcoal transition-colors" title="Settings">
            <IconSettings className="h-5 w-5" />
          </Link>
        </div>
      </aside>

      {/* ── Mobile Top Bar ──────────────────────────────────────────
           Minimal: wordmark logo on the left, avatar-as-settings on the
           right. Page title/household name intentionally omitted — each
           page renders its own H1 at the top of the body so mobile gets
           the same editorial feel as desktop. */}
      <header className="md:hidden bg-cream border-b border-light-grey z-30 sticky top-0 safe-top">
        <div className="px-4 py-3 flex items-center justify-between">
          <Link to="/dashboard" className="shrink-0 flex items-center">
            <img src="/housemait-logo2.png" alt="Housemait" className="max-w-[140px] h-auto" />
          </Link>
          <Link to="/settings" className="shrink-0">
            {renderAvatar('w-8 h-8', 'text-xs')}
          </Link>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 md:ml-60 min-w-0 overflow-x-hidden">
        <div className="px-5 md:px-8 py-6 md:py-11 pb-28 md:pb-11 pt-8">
          {children}
        </div>
      </main>

      {/* ── Mobile Bottom Tab Bar ──────────────────────────────────
          Five tabs from the iOS design handoff: Home · Calendar · Tasks
          · Shopping · More. The background is a vertical cream gradient
          (opaque at the bottom, fading to transparent at the top) plus
          a saturated backdrop-blur — so page content visibly fades
          *under* the bar instead of slamming into a hard top border.
          The cream rgba values match Tailwind token `--color-cream`
          (#FBF8F3 → rgb 251,248,243).

          A `pointer-events-none` spacer over the gradient's top stripe
          would be overkill: the buttons themselves are the only
          interactive surfaces and they sit comfortably below the fade. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-start justify-around pt-2 safe-bottom"
        style={{
          background: 'linear-gradient(to top, rgba(251,248,243,0.95) 60%, rgba(251,248,243,0.6) 80%, rgba(251,248,243,0))',
          backdropFilter: 'blur(14px) saturate(180%)',
          WebkitBackdropFilter: 'blur(14px) saturate(180%)',
        }}
      >
        {mobileNav.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 max-w-[80px] flex flex-col items-center gap-[3px] py-1 ${
                isActive ? 'text-plum' : 'text-warm-grey'
              }`
            }
          >
            <Icon className="h-[26px] w-[26px]" />
            <span className="text-[11px] font-semibold tracking-[0.01em]">{label}</span>
          </NavLink>
        ))}

        {/* More tab — opens the redesigned bottom sheet. The sheet itself
            is rendered outside the <nav> so it can take the full viewport
            instead of being clipped by the tab bar. The button matches
            the layout/sizing of the NavLinks above so the row stays
            visually balanced. */}
        <button
          onClick={() => setMoreOpen(v => !v)}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={`flex-1 max-w-[80px] flex flex-col items-center gap-[3px] py-1 ${isMoreActive || moreOpen ? 'text-plum' : 'text-warm-grey'}`}
        >
          <IconMore className="h-[26px] w-[26px]" />
          <span className="text-[11px] font-semibold tracking-[0.01em]">More</span>
        </button>
      </nav>

      {/* ── More bottom sheet ──────────────────────────────────────
          A native-feeling iOS-style sheet: backdrop fades in over 250ms;
          panel slides up with `cubic-bezier(0.32, 0.72, 0, 1)` over 320ms.
          Designed mobile-first — it auto-hides on ≥768px where the
          desktop sidebar already exposes everything in this menu. */}
      {moreOpen && <MoreSheet onClose={() => setMoreOpen(false)} />}

      <Suspense fallback={null}><ChatWidget /></Suspense>

      {/* Trial-ended overlay — only renders for expired households who
          haven't dismissed it this session. Scoped to Layout so it
          never appears on the Subscribe / Login / Signup routes (which
          don't use Layout). */}
      <TrialEndedOverlay />
    </div>
  );
}

/**
 * MoreSheet — iOS-style bottom sheet exposed from the 5th tab on mobile.
 *
 * Anatomy (top → bottom):
 *   • Drag handle (5×40 pill)
 *   • Header row: "More" title + circular X close button
 *   • 2×2 grid of feature tiles (Meal Plan / Receipts / Documents / Family)
 *   • "Account" caption
 *   • Grouped list (Settings / Notifications / Connected apps /
 *     Privacy & data / Help & support)
 *
 * Layout in the source tree maps to the Housemait iOS design handoff
 * (`design_handoff_housemait_ios/README.md` § "More sheet"). Tile accent
 * colours are inlined because they're tile-only and not reused elsewhere
 * — promoting them to Tailwind utilities would just add noise.
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
 *     downward flick — the iOS-native gesture users expect when they
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
  // additional render — negligible. Frame-by-frame finger tracking
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
    // Downward drags only — clamp upward delta to 0 so the sheet stays
    // glued to translateY(0) at rest. Some sheet libraries allow a small
    // overscroll above the resting position; we deliberately don't.
    setDragOffset(Math.max(0, dy));
  }

  function onDragEnd() {
    if (!isDragging) return;
    const elapsed = Date.now() - dragRef.current.startTime;
    const distance = dragOffset;
    // velocity in px/ms — anything > ~0.6 reads as a deliberate flick
    // even if the absolute distance is small. Tuned by feel against
    // Apple's bottom-sheet gesture in Maps.
    const velocity = elapsed > 0 ? distance / elapsed : 0;

    setIsDragging(false);

    if (distance > 100 || velocity > 0.6) {
      // Dismiss. Don't reset dragOffset — the sheet is about to unmount
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
        {/* Drag handle + header — touch listeners scoped here so touches
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
            className="text-[19px] font-bold text-charcoal m-0"
          >
            More
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-[30px] h-[30px] rounded-full bg-white border border-light-grey flex items-center justify-center text-warm-grey hover:text-charcoal active:scale-95 transition-transform"
          >
            <IconX className="h-4 w-4" />
          </button>
          </div>
        </div>

        {/* Scrollable body — only flexes when content overflows the
            88vh cap (rare on a phone, common on a small landscape view). */}
        <div className="flex-1 overflow-y-auto">
          {/* 2×2 feature tiles */}
          <div className="grid grid-cols-2 gap-3 px-5 pt-1 pb-5">
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

          {/* Account section */}
          <div className="px-5 pb-2">
            <div className="text-[11px] font-bold tracking-[0.1em] uppercase text-warm-grey px-1 pb-2">
              Account
            </div>
            <div className="bg-white rounded-2xl border border-light-grey overflow-hidden">
              {moreAccountRows.map((row, i, arr) => {
                const isLast = i === arr.length - 1;
                const rowClasses = `flex items-center px-4 py-3.5 ${isLast ? '' : 'border-b border-light-grey'}`;
                const labelClasses = `flex-1 text-[14px] text-charcoal ${row.bold ? 'font-semibold' : 'font-normal'}`;
                const Chevron = (
                  <IconChevronRight className="h-3.5 w-3.5 text-warm-grey/60 ml-2" />
                );

                if (row.href) {
                  return (
                    <a key={row.label} href={row.href} className={rowClasses}>
                      <span className={labelClasses}>{row.label}</span>
                      {Chevron}
                    </a>
                  );
                }
                return (
                  <NavLink key={row.label} to={row.to} className={rowClasses}>
                    <span className={labelClasses}>{row.label}</span>
                    {Chevron}
                  </NavLink>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
