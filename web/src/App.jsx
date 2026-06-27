import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SubscriptionProvider } from './context/SubscriptionContext';
import { ChildModeProvider, useChildMode } from './context/ChildModeContext';
import ChildModePinScreen from './components/ChildModePinScreen';
import { CHILD_OPEN_ROUTES, CHILD_HOME_ROUTE } from './lib/childMode';
import { lazy, Suspense, useLayoutEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { localeHomePath } from './hooks/useLocale';
import { useUniversalLinks } from './hooks/useUniversalLinks';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
// File renamed from CookieConsent.jsx - many ad-blocker rules match on
// the substring "CookieConsent" in URLs and `net::ERR_BLOCKED_BY_CLIENT`
// the dev request. ConsentBanner is functionally identical.
import ConsentBanner from './components/ConsentBanner';
import { UpdateBannerSafe } from './components/UpdateBanner';

// Eagerly load pages that are always needed on first paint
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';

// Lazy load everything else - only downloaded when the route is visited
// Signup.jsx is retired - /signup now renders the unified OnboardingFlow. The
// file is kept on disk only as the design reference the account step was lifted
// from.
const OnboardingFlow  = lazy(() => import('./pages/onboarding/OnboardingFlow'));
const FairRedirect    = lazy(() => import('./pages/FairRedirect'));
const ForgotPassword  = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword   = lazy(() => import('./pages/ResetPassword'));
const CheckEmail      = lazy(() => import('./pages/CheckEmail'));
const Verified        = lazy(() => import('./pages/Verified'));
const Verify          = lazy(() => import('./pages/Verify'));
const SetupHousehold  = lazy(() => import('./pages/SetupHousehold'));
const Onboarding      = lazy(() => import('./pages/Onboarding'));
const ConnectWhatsAppStandalone = lazy(() => import('./pages/ConnectWhatsAppStandalone'));
const Dashboard       = lazy(() => import('./pages/Dashboard'));
// Tasks → the chores/routines/stars rebuild (Chores); Shopping folded into
// Lists. The old pages are retired from routing (their data lives on: old
// to-dos in Lists → To-dos, old shopping in Lists → Groceries).
const Chores          = lazy(() => import('./pages/Chores'));
const Rewards         = lazy(() => import('./pages/Rewards'));
const Lists           = lazy(() => import('./pages/Lists'));
const Calendar        = lazy(() => import('./pages/Calendar'));
const Meals           = lazy(() => import('./pages/Meals'));
const Receipt         = lazy(() => import('./pages/Receipt'));
const FamilySetup     = lazy(() => import('./pages/FamilySetup'));
const Settings        = lazy(() => import('./pages/Settings'));
const Documents       = lazy(() => import('./pages/Documents'));
const Privacy         = lazy(() => import('./pages/Privacy'));
const Terms           = lazy(() => import('./pages/Terms'));
const Support         = lazy(() => import('./pages/Support'));
const Help            = lazy(() => import('./pages/Help'));
const NotFound        = lazy(() => import('./pages/NotFound'));
const Subscribe       = lazy(() => import('./pages/Subscribe'));
const SubscribeSuccess = lazy(() => import('./pages/SubscribeSuccess'));
const SubscribeCancel  = lazy(() => import('./pages/SubscribeCancel'));

// Admin pages - only downloaded if user is a platform admin
const AdminDashboard       = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers           = lazy(() => import('./pages/admin/AdminUsers'));
const AdminUserDetail      = lazy(() => import('./pages/admin/AdminUserDetail'));
const AdminHouseholds      = lazy(() => import('./pages/admin/AdminHouseholds'));
const AdminHouseholdDetail = lazy(() => import('./pages/admin/AdminHouseholdDetail'));
const AdminAiUsage         = lazy(() => import('./pages/admin/AdminAiUsage'));
const AdminWhatsApp        = lazy(() => import('./pages/admin/AdminWhatsApp'));
const AdminInboundEmails   = lazy(() => import('./pages/admin/AdminInboundEmails'));
const AdminCalendarSync    = lazy(() => import('./pages/admin/AdminCalendarSync'));
const AdminAnalytics       = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminAnnouncements   = lazy(() => import('./pages/admin/AdminAnnouncements'));
const AdminPromoCodes      = lazy(() => import('./pages/admin/AdminPromoCodes'));
const AdminAuditLog        = lazy(() => import('./pages/admin/AdminAuditLog'));

/** Skeleton loading screen shown while a lazy chunk downloads */
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="space-y-4 w-full max-w-md px-6">
        <div className="h-8 bg-light-grey/60 rounded-lg animate-pulse w-3/4" />
        <div className="h-4 bg-light-grey/40 rounded animate-pulse w-full" />
        <div className="h-4 bg-light-grey/40 rounded animate-pulse w-5/6" />
        <div className="h-32 bg-light-grey/30 rounded-2xl animate-pulse w-full mt-6" />
      </div>
    </div>
  );
}

/**
 * Locale-aware redirect for the root path.
 *
 * Single chokepoint that every "send the user home" code path flows
 * through (the four marketing-page logo links, the logout flows in
 * Layout/Settings, the 401 handler in api.js, the catch-all path="*"
 * fallback, and any future `to="/"` we forget to convert). If the
 * visitor previously interacted with a locale-specific marketing page,
 * a `housemait-locale` cookie was set - we send them back to that
 * country's landing page instead of dropping them on the international
 * default.
 *
 * Mirrors the Vercel edge middleware (which redirects on IP-geo for
 * fresh, direct visits) but runs in the client where React Router's
 * <Link> + navigate() bypass the edge.
 *
 * Falls through to {children} when no usable cookie is set, so first-
 * touch visitors still see the international page.
 */
function LocaleRedirect({ children }) {
  const homePath = localeHomePath();
  if (homePath !== '/') return <Navigate to={homePath} replace />;
  return children;
}

function RequireAuth({ children }) {
  const { token, needsHousehold, needsOnboarding } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  // A half-finished signup (no household, or not-yet-onboarded) funnels into the
  // unified flow at /signup, which resumes from auth state via entryIndex. The
  // legacy /setup + /onboarding routes stay mounted as a fallback (reachable by
  // direct URL) but the gates no longer point at them.
  if (needsHousehold || needsOnboarding) return <Navigate to="/signup" replace />;
  return children;
}

function RequireAuthOnly({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

function RequirePlatformAdmin({ children }) {
  const { token, isPlatformAdmin } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}

// Child Mode route gate (per-device). Allowed kid routes render through;
// /settings is replaced by the PIN screen until unlocked; every other in-app
// route redirects Home. A no-op when Child Mode is off.
function ChildGate({ children }) {
  const { enabled, settingsUnlocked } = useChildMode();
  const path = useLocation().pathname;
  if (!enabled) return children;
  if (CHILD_OPEN_ROUTES.includes(path)) return children;
  if (path === '/settings') return settingsUnlocked ? children : <ChildModePinScreen />;
  return <Navigate to={CHILD_HOME_ROUTE} replace />;
}

/**
 * Wraps Routes in a div keyed by pathname so a CSS animation fires on
 * every route change. Pairs with the `.page-transition` keyframe in
 * index.css. On iOS this gives a subtle slide-fade between pages -
 * closer to UIKit's push transition than the previous instant swap.
 * On reduced-motion settings the animation auto-disables (see CSS).
 */
function RouteTransition({ children }) {
  const location = useLocation();
  // Reset scroll to top on every route change. Most pages window-scroll (only
  // /tasks, /lists, /rewards use a full-height inner scroller), and React
  // Router doesn't reset window.scrollY between routes - so without this a
  // scrolled Dashboard would carry its offset onto the next page (e.g.
  // Calendar opening part-scrolled). Keyed on pathname only, so query-only
  // changes (?list=, ?member=) don't yank the scroll.
  //
  // useLayoutEffect (not useEffect) so the reset runs BEFORE the browser
  // paints: pages like Calendar render tall cached content synchronously on
  // mount, so a post-paint reset showed one frame at the inherited offset (a
  // visible "drop"/flicker). Resetting pre-paint means the page is never
  // painted scrolled. scrollRestoration:'manual' stops the browser re-applying
  // a remembered position, and we zero documentElement/body too in case the
  // active scroller isn't window.
  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }, [location.pathname]);
  return (
    <div key={location.pathname} className="page-transition">
      {children}
    </div>
  );
}

function AppRoutes() {
  const { token, needsHousehold } = useAuth();
  // On iOS, intercept Universal Link opens (e.g. https://housemait.com/verify?token=…
  // tapped from Mail) and route to the corresponding in-app path so the
  // user doesn't bounce out to a browser.
  useUniversalLinks();
  return (
    <Suspense fallback={<PageLoader />}>
      {/* iOS-only "new version available" banner. No-ops on web and on
          unsupported platforms. Mounted at the route-level so the
          notice appears on every screen the user lands on. */}
      <UpdateBannerSafe />
      <RouteTransition>
      <Routes>
        {/* On iOS / native: a fresh install almost always means a brand-new
            user, so /signup is the more useful default. Returning users can
            tap the "Already have an account? Log in" link on Signup. On
            web the LandingPage handles its own login/signup CTAs. */}
        <Route path="/" element={token ? <Navigate to="/dashboard" replace /> : (Capacitor.isNativePlatform() ? <Navigate to="/signup" replace /> : <LocaleRedirect><LandingPage /></LocaleRedirect>)} />
        {/* Country-specific marketing variants. Same LandingPage component;
            it reads pricing, audience tagline, and feature flags via
            useLocale() based on the route path. Each variant emits its
            own hreflang + self-canonical so Google serves the right page
            per region in search results. Auth'd users always bounce to
            /dashboard regardless of which locale path they hit. */}
        <Route path="/gb" element={token ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
        {/* Legacy /uk URL - kept until search engines and bookmarks have
            migrated to /gb. Bounces to /gb so old inbound links keep
            working; vercel.json also issues a 301 at the edge for the
            same path so non-React traffic (crawlers, social previewers)
            gets the permanent-move signal without invoking the SPA. */}
        <Route path="/uk" element={<Navigate to="/gb" replace />} />
        <Route path="/us" element={token ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
        <Route path="/eu" element={token ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
        <Route path="/au" element={token ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
        <Route path="/ca" element={token ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
        <Route path="/za" element={token ? <Navigate to="/dashboard" replace /> : <LandingPage />} />
        <Route path="/login" element={token && !needsHousehold ? <Navigate to="/dashboard" replace /> : <Login />} />
        {/* /signup must be unreachable while a session is live - otherwise a
            logged-in user creating a "new" account carries their token into
            the flow, every API call inside onboarding acts as the original
            user, and the new account row ends up half-created (no verification
            email sent, wrong household, etc). Bounce authed users to /dashboard. */}
        {/* /signup IS the unified onboarding flow. No guard: it renders pre-auth
            (steps 1-4) AND post-auth-not-onboarded (steps 5-9), self-redirecting
            to /dashboard once fully onboarded. Carries ?invite= and ?promo=
            through (the flow captures them). The old single-screen Signup.jsx is
            retired (kept on disk as the styling reference). */}
        <Route path="/signup" element={<OnboardingFlow />} />
        {/* Legacy campaign link - admin now generates /signup?promo= directly.
            Kept so older printed flyers still work; redirects to web signup with
            the promo on every device. */}
        <Route path="/fair" element={<FairRedirect />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/verified" element={<Verified />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/support" element={<Support />} />
        <Route path="/setup" element={<RequireAuthOnly><SetupHousehold /></RequireAuthOnly>} />
        {/* Onboarding wizard - requires auth + a household, but deliberately
            NOT a completed onboarding (that's what it sets). Renders without
            the regular Layout so the wizard owns the full viewport. */}
        <Route path="/onboarding" element={<RequireAuthOnly><Onboarding /></RequireAuthOnly>} />
        {/* Standalone WhatsApp pairing surface for the T+24h re-engagement
            email's CTA. RequireAuthOnly (not RequireAuth) so users who
            never completed the wizard AND users who did but skipped
            WhatsApp can both reach it - the page itself bounces already-
            linked users to /dashboard. */}
        <Route path="/connect-whatsapp" element={<RequireAuthOnly><ConnectWhatsAppStandalone /></RequireAuthOnly>} />
        <Route path="/dashboard" element={<RequireAuth><ChildGate><Layout><Dashboard /></Layout></ChildGate></RequireAuth>} />
        {/* Tasks is now the chores/routines/stars page; Shopping folded into
            Lists. Old paths redirect so existing links/bookmarks/shortcuts keep
            working. */}
        <Route path="/tasks" element={<RequireAuth><ChildGate><Layout><Chores /></Layout></ChildGate></RequireAuth>} />
        <Route path="/lists" element={<RequireAuth><ChildGate><Layout><Lists /></Layout></ChildGate></RequireAuth>} />
        <Route path="/rewards" element={<RequireAuth><ChildGate><Layout><Rewards /></Layout></ChildGate></RequireAuth>} />
        <Route path="/chores" element={<Navigate to="/tasks" replace />} />
        <Route path="/shopping" element={<Navigate to="/lists" replace />} />
        <Route path="/calendar" element={<RequireAuth><ChildGate><Layout><Calendar /></Layout></ChildGate></RequireAuth>} />
        <Route path="/meals" element={<RequireAuth><ChildGate><Layout><Meals /></Layout></ChildGate></RequireAuth>} />
        <Route path="/receipt" element={<RequireAuth><ChildGate><Layout><Receipt /></Layout></ChildGate></RequireAuth>} />
        <Route path="/documents" element={<RequireAuth><ChildGate><Layout><Documents /></Layout></ChildGate></RequireAuth>} />
        <Route path="/family" element={<RequireAuth><ChildGate><Layout><FamilySetup /></Layout></ChildGate></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><ChildGate><Layout><Settings /></Layout></ChildGate></RequireAuth>} />
        <Route path="/help" element={<RequireAuth><ChildGate><Layout><Help /></Layout></ChildGate></RequireAuth>} />
        {/* Subscribe flow - Subscribe page is reachable by anyone logged in
            (including expired users, so they can reactivate). Success and
            Cancel pages are hit by Stripe redirects so they need to work
            without any route guards beyond auth. */}
        <Route path="/subscribe" element={<RequireAuthOnly><Subscribe /></RequireAuthOnly>} />
        <Route path="/subscription/success" element={<RequireAuthOnly><SubscribeSuccess /></RequireAuthOnly>} />
        <Route path="/subscription/cancel" element={<RequireAuthOnly><SubscribeCancel /></RequireAuthOnly>} />
        {/* Admin routes */}
        <Route path="/admin" element={<RequirePlatformAdmin><AdminLayout><AdminDashboard /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/users" element={<RequirePlatformAdmin><AdminLayout><AdminUsers /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/users/:id" element={<RequirePlatformAdmin><AdminLayout><AdminUserDetail /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/households" element={<RequirePlatformAdmin><AdminLayout><AdminHouseholds /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/households/:id" element={<RequirePlatformAdmin><AdminLayout><AdminHouseholdDetail /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/ai-usage" element={<RequirePlatformAdmin><AdminLayout><AdminAiUsage /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/whatsapp" element={<RequirePlatformAdmin><AdminLayout><AdminWhatsApp /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/inbound-emails" element={<RequirePlatformAdmin><AdminLayout><AdminInboundEmails /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/announcements" element={<RequirePlatformAdmin><AdminLayout><AdminAnnouncements /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/calendar-sync" element={<RequirePlatformAdmin><AdminLayout><AdminCalendarSync /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/analytics" element={<RequirePlatformAdmin><AdminLayout><AdminAnalytics /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/promo-codes" element={<RequirePlatformAdmin><AdminLayout><AdminPromoCodes /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/audit-log" element={<RequirePlatformAdmin><AdminLayout><AdminAuditLog /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </RouteTransition>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* SubscriptionProvider lives inside AuthProvider so it can call
            useAuth() to gate its fetch on token + household. Keeping it
            separate from AuthContext matches the server-side split
            (routes/auth vs routes/subscription) and keeps AuthContext
            lean for the parts of the app that don't care about billing. */}
        {/* ChildModeProvider needs useAuth() (household) and useLocation()
            (re-lock-on-leave), so it sits inside AuthProvider and BrowserRouter. */}
        <ChildModeProvider>
          <SubscriptionProvider>
            <AppRoutes />
            <ConsentBanner />
          </SubscriptionProvider>
        </ChildModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
