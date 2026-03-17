import { useEffect } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
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
  const { household, user, token, login, logout } = useAuth();
  const navigate = useNavigate();

  // Sync user profile (e.g. color_theme) from backend on mount
  useEffect(() => {
    if (!user?.id) return;
    api.get('/household')
      .then(({ data }) => {
        const me = data.members?.find(m => m.id === user.id);
        if (me && me.color_theme && me.color_theme !== user.color_theme) {
          login({ token, user: { ...user, color_theme: me.color_theme }, household });
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
            <Link to="/dashboard" className="font-semibold text-lg text-bark">
              {household?.name ?? 'Anora'}
            </Link>
          </div>

          {/* Profile circle + sign out — right */}
          <div className="flex items-center gap-2 shrink-0">
            {user && (() => {
              const avatarColors = {
                orange: 'bg-secondary/30 text-primary',
                blue: 'bg-blue-100 text-blue-600',
                green: 'bg-success/20 text-success',
                purple: 'bg-purple-100 text-purple-600',
                red: 'bg-error/20 text-error',
                gray: 'bg-sand text-cocoa',
              };
              const avatarClass = avatarColors[user.color_theme] || avatarColors.orange;
              return (
                <Link to="/settings" className={`w-8 h-8 rounded-full ${avatarClass} flex items-center justify-center font-bold text-sm`} title={user.name}>
                  {user.name?.[0]?.toUpperCase()}
                </Link>
              );
            })()}
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
