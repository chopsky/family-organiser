import { NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  IconBarChart, IconUsers, IconHome, IconShield,
  IconCpu, IconMessageCircle, IconRefresh, IconTrendingUp,
  IconArrowLeft,
} from './Icons';

const adminNav = [
  { to: '/admin',               label: 'Overview',       Icon: IconBarChart },
  { to: '/admin/users',         label: 'Users',          Icon: IconUsers },
  { to: '/admin/households',    label: 'Households',     Icon: IconHome },
  { to: '/admin/ai-usage',      label: 'AI Usage',       Icon: IconCpu },
  { to: '/admin/whatsapp',      label: 'WhatsApp',       Icon: IconMessageCircle },
  { to: '/admin/calendar-sync', label: 'Calendar Sync',  Icon: IconRefresh },
  { to: '/admin/analytics',     label: 'Analytics',      Icon: IconTrendingUp },
];

export default function AdminLayout({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  function renderNavLink({ to, label, Icon }) {
    const isExact = location.pathname === to;
    return (
      <NavLink
        key={to}
        to={to}
        end={to === '/admin'}
        className={() =>
          `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
            isExact
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
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-60 bg-white border-r border-light-grey flex-col fixed inset-y-0 left-0 z-30">
        {/* Header */}
        <div className="px-5 pt-6 pb-3 flex items-center gap-2.5">
          <IconShield className="h-6 w-6 text-plum" />
          <h1 className="font-display text-lg font-semibold text-charcoal tracking-tight">Admin</h1>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 flex flex-col gap-0.5 mt-2">
          {adminNav.map(renderNavLink)}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-light-grey">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-sm font-medium text-warm-grey hover:text-plum transition-colors"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to App
          </Link>
          <p className="text-[11px] text-warm-grey mt-2">{user?.name}</p>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden bg-white border-b border-light-grey z-30">
        <div className="px-4 py-3 flex items-center gap-3">
          <Link to="/dashboard" className="text-warm-grey hover:text-plum transition-colors">
            <IconArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <IconShield className="h-5 w-5 text-plum" />
            <h1 className="font-display text-base font-semibold text-charcoal">Admin</h1>
          </div>
        </div>
        <nav className="px-4 pb-2 flex gap-1 overflow-x-auto">
          {adminNav.map(({ to, label }) => {
            const isExact = location.pathname === to;
            return (
              <NavLink
                key={to}
                to={to}
                end={to === '/admin'}
                className={() =>
                  `px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    isExact ? 'bg-plum-light text-plum' : 'text-warm-grey hover:bg-cream'
                  }`
                }
              >
                {label}
              </NavLink>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 md:ml-60 min-w-0 overflow-x-hidden">
        <div className="px-5 md:px-8 py-6 md:py-7 max-w-5xl">
          {children}
        </div>
      </main>
    </div>
  );
}
