import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconUsers, IconHome, IconTrendingUp } from '../../components/Icons';
import Spinner from '../../components/Spinner';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [recentUsers, setRecentUsers] = useState([]);
  const [recentHouseholds, setRecentHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, usersRes, householdsRes] = await Promise.all([
          api.get('/admin/stats'),
          api.get('/admin/users', { params: { limit: 5 } }),
          api.get('/admin/households', { params: { limit: 5 } }),
        ]);
        setStats(statsRes.data);
        setRecentUsers(usersRes.data.users || []);
        setRecentHouseholds(householdsRes.data.households || []);
      } catch (err) {
        console.error('Failed to load admin stats:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers ?? 0, icon: IconUsers, color: 'text-plum bg-plum-light' },
    { label: 'Total Households', value: stats?.totalHouseholds ?? 0, icon: IconHome, color: 'text-sage bg-sage-light' },
    { label: 'New Users (7d)', value: stats?.newUsersThisWeek ?? 0, icon: IconTrendingUp, color: 'text-coral bg-coral-light' },
    { label: 'New Households (7d)', value: stats?.newHouseholdsThisWeek ?? 0, icon: IconTrendingUp, color: 'text-plum bg-plum-light' },
  ];

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Platform Overview</h1>
      <p className="text-warm-grey text-sm mt-1">Key metrics at a glance</p>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
            <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center mb-3`}>
              <Icon className="h-5 w-5" />
            </div>
            <p className="text-2xl font-bold text-charcoal">{value}</p>
            <p className="text-xs text-warm-grey font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Recent Users */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-charcoal">Recent Users</h2>
          <Link to="/admin/users" className="text-sm font-semibold text-plum hover:underline">View all</Link>
        </div>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden sm:table-cell">Email</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden md:table-cell">Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentUsers.map((u) => (
                <tr key={u.id} className="border-b border-light-grey last:border-0 hover:bg-cream/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${u.id}`} className="font-medium text-charcoal hover:text-plum">
                      {u.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-warm-grey hidden sm:table-cell">{u.email || '—'}</td>
                  <td className="px-4 py-3 text-warm-grey hidden md:table-cell">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
              {recentUsers.length === 0 && (
                <tr><td colSpan="3" className="px-4 py-6 text-center text-warm-grey">No users yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Households */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-charcoal">Recent Households</h2>
          <Link to="/admin/households" className="text-sm font-semibold text-plum hover:underline">View all</Link>
        </div>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Members</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden md:table-cell">Created</th>
              </tr>
            </thead>
            <tbody>
              {recentHouseholds.map((h) => (
                <tr key={h.id} className="border-b border-light-grey last:border-0 hover:bg-cream/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/admin/households/${h.id}`} className="font-medium text-charcoal hover:text-plum">
                      {h.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-plum-light text-plum text-xs font-semibold">
                      {h.member_count ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-warm-grey hidden md:table-cell">
                    {h.created_at ? new Date(h.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
              {recentHouseholds.length === 0 && (
                <tr><td colSpan="3" className="px-4 py-6 text-center text-warm-grey">No households yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
