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
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/dashboard" className="flex items-center gap-2">
              <img src="/Curata-favicon.png" alt="Curata" className="h-7" />
              <span className="font-bold text-lg text-bark">{household?.name ?? 'Curata'}</span>
            </Link>
            {user && <span className="ml-2 text-cocoa text-sm">· {user.name}</span>}
          </div>
          <button
            onClick={handleLogout}
            className="text-cocoa hover:text-bark text-sm transition-colors"
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
