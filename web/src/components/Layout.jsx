import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const nav = [
  { to: '/dashboard',  label: '🏠 Home'     },
  { to: '/shopping',   label: '🛒 Shopping'  },
  { to: '/tasks',      label: '✅ Tasks'     },
  { to: '/receipt',    label: '📷 Receipt'   },
  { to: '/settings',   label: '⚙️ Settings'  },
];

export default function Layout({ children }) {
  const { household, user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-amber-50/40 flex flex-col">
      {/* Top bar */}
      <header className="bg-orange-500 text-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/dashboard" className="flex items-center gap-2">
              <img src="/Curata-favicon.png" alt="Curata" className="h-7" />
              <span className="font-bold text-lg">{household?.name ?? 'Curata'}</span>
            </Link>
            {user && <span className="ml-2 text-orange-200 text-sm">· {user.name}</span>}
          </div>
          <button
            onClick={handleLogout}
            className="text-orange-200 hover:text-white text-sm transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {/* Bottom nav */}
      <nav className="bg-white border-t border-gray-200 sticky bottom-0">
        <div className="max-w-4xl mx-auto flex">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 text-center py-3 text-xs font-medium transition-colors ${
                  isActive ? 'text-orange-500 border-t-2 border-orange-500' : 'text-gray-500 hover:text-gray-700'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
