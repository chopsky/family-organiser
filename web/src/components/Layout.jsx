import { useState, useEffect, useRef } from 'react';
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { IconHome, IconCart, IconCheck, IconCalendar, IconCamera, IconSettings, IconUsers, IconMore } from './Icons';
import ChatWidget from './ChatWidget';

const mainNav = [
  { to: '/dashboard',  label: 'Home',     Icon: IconHome     },
  { to: '/shopping',   label: 'Shopping',  Icon: IconCart      },
  { to: '/tasks',      label: 'Tasks',     Icon: IconCheck     },
  { to: '/calendar',   label: 'Calendar',  Icon: IconCalendar  },
  { to: '/receipt',    label: 'Receipt',   Icon: IconCamera    },
  { to: '/family',     label: 'Family',    Icon: IconUsers     },
];

const mobileNav = [
  { to: '/dashboard',  label: 'Home',     Icon: IconHome     },
  { to: '/shopping',   label: 'Shopping',  Icon: IconCart      },
  { to: '/tasks',      label: 'Tasks',     Icon: IconCheck     },
  { to: '/calendar',   label: 'Calendar',  Icon: IconCalendar  },
];

const moreNav = [
  { to: '/family',    label: 'Family Setup',     Icon: IconUsers    },
  { to: '/receipt',   label: 'Receipt Scanner',   Icon: IconCamera   },
  { to: '/settings',  label: 'Settings',          Icon: IconSettings  },
];

const avatarColors = {
  sage: 'bg-sage text-white',
  plum: 'bg-plum text-white',
  coral: 'bg-coral text-white',
  amber: 'bg-amber text-white',
  sky: 'bg-sky text-white',
  rose: 'bg-rose text-white',
  teal: 'bg-teal text-white',
  lavender: 'bg-lavender text-white',
  terracotta: 'bg-terracotta text-white',
  slate: 'bg-slate text-white',
};

export default function Layout({ children }) {
  const { household, user, token, login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [members, setMembers] = useState([]);
  const moreRef = useRef(null);

  // Close "More" popover on navigation
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  // Close "More" popover on outside click
  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e) {
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  // Sync user profile and members on mount and route changes
  useEffect(() => {
    if (!user?.id) return;
    api.get('/household')
      .then(({ data }) => {
        if (data.members) setMembers(data.members);
        const me = data.members?.find(m => m.id === user.id);
        if (me && (
          (me.color_theme && me.color_theme !== user.color_theme) ||
          (me.avatar_url !== undefined && me.avatar_url !== user.avatar_url)
        )) {
          login({ token, user: { ...user, color_theme: me.color_theme || user.color_theme, avatar_url: me.avatar_url || null }, household });
        }
      })
      .catch(() => {});
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLogout() {
    logout();
    navigate('/');
  }

  const avatarClass = avatarColors[user?.color_theme] || avatarColors.sage;

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

  const isMoreActive = moreNav.some(n => location.pathname === n.to);

  function renderNavLink({ to, label, Icon }) {
    return (
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
    );
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-60 bg-white border-r border-light-grey flex-col fixed inset-y-0 left-0 z-30">
        {/* Logo */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-2.5">
          <img src="/anora-logomark-colour.png" alt="Anora" className="h-9" />
          <span className="font-display text-[22px] font-bold text-plum tracking-tight">Nestd</span>
        </div>

        {/* Household pill */}
        <div className="mx-4 mb-4 px-3 py-2 bg-plum-light rounded-lg flex items-center gap-2 text-[13px] font-medium text-plum">
          {members.length > 0 && (
            <div className="flex -space-x-1.5">
              {members.map((m) => {
                const ac = avatarColors[m.color_theme] || avatarColors.sage;
                return m.avatar_url ? (
                  <img key={m.id} src={m.avatar_url} alt={m.name} className="w-6 h-6 rounded-full object-cover ring-2 ring-plum-light" />
                ) : (
                  <div key={m.id} className={`w-6 h-6 rounded-full ${ac} flex items-center justify-center text-[10px] font-bold ring-2 ring-plum-light`}>
                    {m.name[0].toUpperCase()}
                  </div>
                );
              })}
            </div>
          )}
          <span className="truncate">{household?.name ?? 'My Family'}</span>
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-3 flex flex-col gap-0.5">
          {mainNav.map(renderNavLink)}
        </nav>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-light-grey flex items-center gap-2.5">
          {renderAvatar('w-8 h-8', 'text-xs')}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-charcoal truncate">{user?.name}</p>
            <p className="text-[11px] text-warm-grey capitalize">{user?.role || 'Member'}</p>
          </div>
          <Link to="/settings" className="text-warm-grey hover:text-charcoal transition-colors" title="Settings">
            <IconSettings className="h-5 w-5" />
          </Link>
        </div>
      </aside>

      {/* ── Mobile Top Bar ── */}
      <header className="md:hidden bg-cream border-b border-light-grey z-30">
        <div className="px-4 py-3 flex items-center gap-3">
          <Link to="/dashboard" className="shrink-0">
            <img src="/anora-logomark-colour.png" alt="Nestd" className="h-7" />
          </Link>
          <div className="flex-1 min-w-0 text-center">
            <Link to="/dashboard" className="font-semibold text-base text-charcoal truncate block">
              {household?.name ?? 'Nestd'}
            </Link>
          </div>
          <Link to="/settings" className="shrink-0">
            {renderAvatar('w-8 h-8', 'text-xs')}
          </Link>
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
        {mobileNav.map(({ to, label, Icon }) => (
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

        {/* More button + popover */}
        <div ref={moreRef} className="relative flex flex-col items-center gap-1">
          <button
            onClick={() => setMoreOpen(v => !v)}
            className={`flex flex-col items-center gap-1 ${isMoreActive || moreOpen ? 'text-plum' : 'text-warm-grey'}`}
          >
            <IconMore className="h-[22px] w-[22px]" />
            <span className="text-[10px] font-semibold">More</span>
          </button>

          {moreOpen && (
            <div className="absolute bottom-full mb-2 right-0 bg-white rounded-2xl shadow-lg border border-light-grey py-2 min-w-[180px] z-50">
              {moreNav.map(({ to, label, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                      isActive ? 'text-plum bg-plum-light' : 'text-charcoal hover:bg-cream'
                    }`
                  }
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>
      </nav>

      <ChatWidget />
    </div>
  );
}
