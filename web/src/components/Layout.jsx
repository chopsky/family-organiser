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

const avatarColors = {
  orange: 'bg-coral-light text-coral',
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-sage-light text-sage',
  purple: 'bg-plum-light text-plum',
  red: 'bg-error/20 text-error',
  gray: 'bg-light-grey text-warm-grey',
};

export default function Layout({ children }) {
  const { household, user, token, login, logout } = useAuth();
  const navigate = useNavigate();

  // Sync user profile (e.g. color_theme, avatar_url) from backend on mount
  useEffect(() => {
    if (!user?.id) return;
    api.get('/household')
      .then(({ data }) => {
        const me = data.members?.find(m => m.id === user.id);
        if (me && (
          (me.color_theme && me.color_theme !== user.color_theme) ||
          (me.avatar_url !== undefined && me.avatar_url !== user.avatar_url)
        )) {
          login({ token, user: { ...user, color_theme: me.color_theme || user.color_theme, avatar_url: me.avatar_url || null }, household });
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLogout() {
    logout();
    navigate('/');
  }

  const avatarClass = avatarColors[user?.color_theme] || avatarColors.orange;

  function renderAvatar(size = 'w-8 h-8', textSize = 'text-sm') {
    if (user?.avatar_url) {
      return <img src={user.avatar_url} alt={user.name} className={`${size} rounded-full object-cover`} />;
    }
    return (
      <div className={`${size} rounded-full ${avatarClass} flex items-center justify-center font-bold ${textSize}`}>
        {user?.name?.[0]?.toUpperCase()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream flex">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 bg-white border-r border-light-grey flex-col fixed inset-y-0 left-0 z-30">
        {/* Logo */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-2.5">
          <div className="w-9 h-9 bg-plum rounded-[10px] flex items-center justify-center">
            <IconHome className="h-5 w-5 text-white" />
          </div>
          <span className="font-display text-[22px] font-bold text-plum tracking-tight">Nestd</span>
        </div>

        {/* Household pill */}
        <div className="mx-4 mb-4 px-3 py-2 bg-plum-light rounded-lg flex items-center gap-2 text-[13px] font-medium text-plum">
          {household?.name ?? 'My Family'}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 flex flex-col gap-0.5">
          {nav.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-plum-light text-plum'
                    : 'text-warm-grey hover:bg-cream hover:text-charcoal'
                }`
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-light-grey flex items-center gap-2.5">
          {renderAvatar('w-8 h-8', 'text-xs')}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-charcoal truncate">{user?.name}</p>
            <button onClick={handleLogout} className="text-[11px] text-warm-grey hover:text-plum transition-colors">
              Sign out
            </button>
          </div>
          <NavLink to="/settings" className="w-7 h-7 rounded-lg hover:bg-cream flex items-center justify-center text-warm-grey hover:text-charcoal transition-colors">
            <IconSettings className="h-4 w-4" />
          </NavLink>
        </div>
      </aside>

      {/* ── Mobile Top Bar ── */}
      <header className="md:hidden bg-cream border-b border-light-grey sticky top-0 z-30">
        <div className="px-4 py-3 flex items-center gap-3">
          {/* Logo — left */}
          <Link to="/dashboard" className="shrink-0">
            <img src="/anora-logomark-colour.png" alt="Anora" className="h-7" />
          </Link>

          {/* Household name — centered */}
          <div className="flex-1 min-w-0 text-center">
            <Link to="/dashboard" className="font-semibold text-base text-charcoal truncate block">
              {household?.name ?? 'Nestd'}
            </Link>
          </div>

          {/* Profile circle + sign out — right */}
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/settings" className="shrink-0">
              {renderAvatar('w-8 h-8', 'text-xs')}
            </Link>
            <button
              onClick={handleLogout}
              className="text-warm-grey hover:text-charcoal text-sm whitespace-nowrap transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ── */}
      <main className="flex-1 md:ml-60">
        <div className="max-w-3xl mx-auto px-5 md:px-8 py-6 md:py-7 pb-24 md:pb-7">
          {children}
        </div>
      </main>

      {/* ── Mobile Bottom Tab Bar ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-[82px] border-t border-light-grey flex items-start justify-around pt-2.5" style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}>
        {nav.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 ${
                isActive ? 'text-plum' : 'text-warm-grey'
              }`
            }
          >
            <Icon className="h-[22px] w-[22px]" />
            <span className="text-[10px] font-semibold">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
