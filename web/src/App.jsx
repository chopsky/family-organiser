import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login         from './pages/Login';
import Signup        from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import CheckEmail    from './pages/CheckEmail';
import SetupHousehold from './pages/SetupHousehold';
import Dashboard     from './pages/Dashboard';
import Shopping      from './pages/Shopping';
import Tasks         from './pages/Tasks';
import Receipt       from './pages/Receipt';
import Settings      from './pages/Settings';

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
      <Route path="/receipt" element={<RequireAuth><Layout><Receipt /></Layout></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><Layout><Settings /></Layout></RequireAuth>} />
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
