import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import AdminLayout from './components/AdminLayout';
import Login         from './pages/Login';
import Signup        from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import CheckEmail    from './pages/CheckEmail';
import SetupHousehold from './pages/SetupHousehold';
import Dashboard     from './pages/Dashboard';
import Shopping      from './pages/Shopping';
import Tasks         from './pages/Tasks';
import Calendar      from './pages/Calendar';
import Receipt       from './pages/Receipt';
import Settings      from './pages/Settings';
import FamilySetup   from './pages/FamilySetup';
import Meals         from './pages/Meals';
import AdminDashboard       from './pages/admin/AdminDashboard';
import AdminUsers           from './pages/admin/AdminUsers';
import AdminUserDetail      from './pages/admin/AdminUserDetail';
import AdminHouseholds      from './pages/admin/AdminHouseholds';
import AdminHouseholdDetail from './pages/admin/AdminHouseholdDetail';
import AdminAiUsage        from './pages/admin/AdminAiUsage';
import AdminWhatsApp       from './pages/admin/AdminWhatsApp';
import AdminCalendarSync   from './pages/admin/AdminCalendarSync';
import AdminAnalytics      from './pages/admin/AdminAnalytics';

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
    <Routes>
      <Route path="/" element={token ? <Navigate to="/dashboard" replace /> : <Navigate to="/login" replace />} />
      <Route path="/login" element={token && !needsHousehold ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/check-email" element={<CheckEmail />} />
      <Route path="/setup" element={<RequireAuthOnly><SetupHousehold /></RequireAuthOnly>} />
      <Route path="/dashboard" element={<RequireAuth><Layout><Dashboard /></Layout></RequireAuth>} />
      <Route path="/shopping" element={<RequireAuth><Layout><Shopping /></Layout></RequireAuth>} />
      <Route path="/tasks" element={<RequireAuth><Layout><Tasks /></Layout></RequireAuth>} />
      <Route path="/calendar" element={<RequireAuth><Layout><Calendar /></Layout></RequireAuth>} />
      <Route path="/meals" element={<RequireAuth><Layout><Meals /></Layout></RequireAuth>} />
      <Route path="/receipt" element={<RequireAuth><Layout><Receipt /></Layout></RequireAuth>} />
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
