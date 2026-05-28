import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SubscriptionProvider } from './context/SubscriptionContext';
import { lazy, Suspense } from 'react';
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
const Signup          = lazy(() => import('./pages/Signup'));
const ForgotPassword  = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword   = lazy(() => import('./pages/ResetPassword'));
const CheckEmail      = lazy(() => import('./pages/CheckEmail'));
const Verified        = lazy(() => import('./pages/Verified'));
const Verify          = lazy(() => import('./pages/Verify'));
const SetupHousehold  = lazy(() => import('./pages/SetupHousehold'));
const Onboarding      = lazy(() => import('./pages/Onboarding'));
const ConnectWhatsAppStandalone = lazy(() => import('./pages/ConnectWhatsAppStandalone'));
const Dashboard       = lazy(() => import('./pages/Dashboard'));
const Shopping        = lazy(() => import('./pages/Shopping'));
const Tasks           = lazy(() => import('./pages/Tasks'));
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
  if (needsHousehold) return <Navigate to="/setup" replace />;
  // Any authenticated in-app route bounces to /onboarding until the wizard
  // is done. Skipping the wizard by typing the URL directly is blocked too.
  if (needsOnboarding) return <Navigate to="/onboarding" replace />;
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

/**
 * Wraps Routes in a div keyed by pathname so a CSS animation fires on
 * every route change. Pairs with the `.page-transition` keyframe in
 * index.css. On iOS this gives a subtle slide-fade between pages -
 * closer to UIKit's push transition than the previous instant swap.
 * On reduced-motion settings the animation auto-disables (see CSS).
 */
function RouteTransition({ children }) {
  const location = useLocation();
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
        <Route path="/signup" element={token ? <Navigate to="/dashboard" replace /> : <Signup />} />
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
        <Route path="/dashboard" element={<RequireAuth><Layout><Dashboard /></Layout></RequireAuth>} />
        <Route path="/shopping" element={<RequireAuth><Layout><Shopping /></Layout></RequireAuth>} />
        <Route path="/tasks" element={<RequireAuth><Layout><Tasks /></Layout></RequireAuth>} />
        <Route path="/calendar" element={<RequireAuth><Layout><Calendar /></Layout></RequireAuth>} />
        <Route path="/meals" element={<RequireAuth><Layout><Meals /></Layout></RequireAuth>} />
        <Route path="/receipt" element={<RequireAuth><Layout><Receipt /></Layout></RequireAuth>} />
        <Route path="/documents" element={<RequireAuth><Layout><Documents /></Layout></RequireAuth>} />
        <Route path="/family" element={<RequireAuth><Layout><FamilySetup /></Layout></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Layout><Settings /></Layout></RequireAuth>} />
        <Route path="/help" element={<RequireAuth><Layout><Help /></Layout></RequireAuth>} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
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
        <SubscriptionProvider>
          <AppRoutes />
          <ConsentBanner />
        </SubscriptionProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
