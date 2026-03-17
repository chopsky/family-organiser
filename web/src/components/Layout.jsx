import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IconHome, IconCart, IconCheck, IconCalendar, IconCamera, IconSettings } from './Icons';

const nav = [
  { to: '/dashboard',  label: 'Home',     Icon: IconHome     },
  { to: '/shopping',   label: 'Shopping',  Icon: IconCart      },
  { to: '/tasks',      label: 'Tasks',     Icon: IconCheck     },
  { to: '/calendar',   label: 'Calendar',  Icon: IconCalendar  },
  { to: '/receipt',    label: 'Receipt',   Icon: IconCamera    },
  { to: '/settings',   label: 'Settings',  Icon: IconSettings  },
];

export default function Layout({ children }) {
  const { household, user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-oat flex flex-col">
      {/* Top bar */}
      <header className="bg-oat border-b border-cream-border shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center">
          {/* Logo — left */}
          <Link to="/dashboard" className="shrink-0">
            <img src="/anora-logomark-colour.png" alt="Anora" className="h-7" />
          </Link>

          {/* Family name — centered */}
          <div className="flex-1 text-center">
            <Link to="/dashboard" className="font-bold text-lg text-bark">
              {household?.name ?? 'Anora'}
            </Link>
          </div>

          {/* Profile circle + sign out — right */}
          <div className="flex items-center gap-2 shrink-0">
            {user && (
              <Link to="/settings" className="w-8 h-8 rounded-full bg-secondary/30 flex items-center justify-center text-primary font-bold text-sm" title={user.name}>
                {user.name?.[0]?.toUpperCase()}
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="text-cocoa hover:text-bark text-sm transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">
        {children}
      </main>

      {/* Bottom nav */}
      <nav className="bg-oat border-t border-cream-border sticky bottom-0">
        <div className="max-w-4xl mx-auto flex">
          {nav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors ${
                  isActive ? 'text-primary border-t-2 border-primary' : 'text-cocoa hover:text-bark'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
