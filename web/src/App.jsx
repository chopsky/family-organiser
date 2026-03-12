import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login    from './pages/Login';
import Dashboard from './pages/Dashboard';
import Shopping  from './pages/Shopping';
import Tasks     from './pages/Tasks';
import Receipt   from './pages/Receipt';
import Settings  from './pages/Settings';

function RequireAuth({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/" replace />;
}

function AppRoutes() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route
        path="/"
        element={token ? <Navigate to="/dashboard" replace /> : <Login />}
      />
      <Route
        path="/dashboard"
        element={<RequireAuth><Layout><Dashboard /></Layout></RequireAuth>}
      />
      <Route
        path="/shopping"
        element={<RequireAuth><Layout><Shopping /></Layout></RequireAuth>}
      />
      <Route
        path="/tasks"
        element={<RequireAuth><Layout><Tasks /></Layout></RequireAuth>}
      />
      <Route
        path="/receipt"
        element={<RequireAuth><Layout><Receipt /></Layout></RequireAuth>}
      />
      <Route
        path="/settings"
        element={<RequireAuth><Layout><Settings /></Layout></RequireAuth>}
      />
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
