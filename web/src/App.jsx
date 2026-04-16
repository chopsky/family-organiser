import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { lazy, Suspense } from 'react';
import { Capacitor } from '@capacitor/core';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';

// Eagerly load pages that are always needed on first paint
import LandingPage from './pages/LandingPage';
import Login from './pages/Login';

// Lazy load everything else — only downloaded when the route is visited
const Signup          = lazy(() => import('./pages/Signup'));
const ForgotPassword  = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword   = lazy(() => import('./pages/ResetPassword'));
const CheckEmail      = lazy(() => import('./pages/CheckEmail'));
const SetupHousehold  = lazy(() => import('./pages/SetupHousehold'));
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

// Admin pages — only downloaded if user is a platform admin
const AdminDashboard       = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminUsers           = lazy(() => import('./pages/admin/AdminUsers'));
const AdminUserDetail      = lazy(() => import('./pages/admin/AdminUserDetail'));
const AdminHouseholds      = lazy(() => import('./pages/admin/AdminHouseholds'));
const AdminHouseholdDetail = lazy(() => import('./pages/admin/AdminHouseholdDetail'));
const AdminAiUsage         = lazy(() => import('./pages/admin/AdminAiUsage'));
const AdminWhatsApp        = lazy(() => import('./pages/admin/AdminWhatsApp'));
const AdminCalendarSync    = lazy(() => import('./pages/admin/AdminCalendarSync'));
const AdminAnalytics       = lazy(() => import('./pages/admin/AdminAnalytics'));

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

function RequireAuth({ children }) {
  const { token, needsHousehold } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (needsHousehold) return <Navigate to="/setup" replace />;
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

function AppRoutes() {
  const { token, needsHousehold } = useAuth();
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={token ? <Navigate to="/dashboard" replace /> : (Capacitor.isNativePlatform() ? <Navigate to="/login" replace /> : <LandingPage />)} />
        <Route path="/login" element={token && !needsHousehold ? <Navigate to="/dashboard" replace /> : <Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/setup" element={<RequireAuthOnly><SetupHousehold /></RequireAuthOnly>} />
        <Route path="/dashboard" element={<RequireAuth><Layout><Dashboard /></Layout></RequireAuth>} />
        <Route path="/shopping" element={<RequireAuth><Layout><Shopping /></Layout></RequireAuth>} />
        <Route path="/tasks" element={<RequireAuth><Layout><Tasks /></Layout></RequireAuth>} />
        <Route path="/calendar" element={<RequireAuth><Layout><Calendar /></Layout></RequireAuth>} />
        <Route path="/meals" element={<RequireAuth><Layout><Meals /></Layout></RequireAuth>} />
        <Route path="/receipt" element={<RequireAuth><Layout><Receipt /></Layout></RequireAuth>} />
        <Route path="/documents" element={<RequireAuth><Layout><Documents /></Layout></RequireAuth>} />
        <Route path="/family" element={<RequireAuth><Layout><FamilySetup /></Layout></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Layout><Settings /></Layout></RequireAuth>} />
        {/* Admin routes */}
        <Route path="/admin" element={<RequirePlatformAdmin><AdminLayout><AdminDashboard /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/users" element={<RequirePlatformAdmin><AdminLayout><AdminUsers /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/users/:id" element={<RequirePlatformAdmin><AdminLayout><AdminUserDetail /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/households" element={<RequirePlatformAdmin><AdminLayout><AdminHouseholds /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/households/:id" element={<RequirePlatformAdmin><AdminLayout><AdminHouseholdDetail /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/ai-usage" element={<RequirePlatformAdmin><AdminLayout><AdminAiUsage /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/whatsapp" element={<RequirePlatformAdmin><AdminLayout><AdminWhatsApp /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/calendar-sync" element={<RequirePlatformAdmin><AdminLayout><AdminCalendarSync /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="/admin/analytics" element={<RequirePlatformAdmin><AdminLayout><AdminAnalytics /></AdminLayout></RequirePlatformAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
