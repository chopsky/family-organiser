import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { IconTrendingUp } from '../../components/Icons';
import Spinner from '../../components/Spinner';

export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/analytics')
      .then(({ data }) => setData(data))
      .catch((err) => console.error('Failed to load analytics:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const { dau = [], featureUsage = {}, funnel = {}, wau = 0 } = data || {};

  // Calculate DAU average
  const recentDau = dau.slice(-7);
  const avgDau = recentDau.length > 0
    ? Math.round(recentDau.reduce((sum, d) => sum + d.activeUsers, 0) / recentDau.length)
    : 0;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <IconTrendingUp className="h-6 w-6 text-plum" />
        <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Analytics</h1>
      </div>
      <p className="text-warm-grey text-sm">User activity, feature usage, and onboarding</p>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{avgDau}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Avg DAU (7d)</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{wau}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">WAU</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{Object.values(featureUsage).reduce((a, b) => a + b, 0)}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Actions (30d)</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{funnel.registered ?? 0}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Registered Users</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        {/* Feature Usage */}
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Feature Usage (30d)</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Feature</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(featureUsage).sort((a, b) => b[1] - a[1]).map(([feature, count]) => (
                  <tr key={feature} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3 font-medium text-charcoal capitalize">{feature}</td>
                    <td className="px-4 py-3 text-right text-charcoal">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Onboarding Funnel */}
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Onboarding Funnel</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <FunnelStep label="Registered" value={funnel.registered ?? 0} total={funnel.registered} />
            <FunnelStep label="Email Verified" value={funnel.verified ?? 0} total={funnel.registered} />
            <FunnelStep label="Joined Household" value={funnel.joinedHousehold ?? 0} total={funnel.registered} />
            <div className="mt-4 pt-4 border-t border-light-grey">
              <div className="flex items-center justify-between text-sm">
                <span className="text-warm-grey">Invites Sent</span>
                <span className="font-medium text-charcoal">{funnel.invitesSent ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-warm-grey">Invites Accepted</span>
                <span className="font-medium text-charcoal">{funnel.invitesAccepted ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* DAU Timeline */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Daily Active Users</h2>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Active Users</th>
              </tr>
            </thead>
            <tbody>
              {dau.slice(-14).reverse().map((day) => (
                <tr key={day.date} className="border-b border-light-grey last:border-0">
                  <td className="px-4 py-3 text-charcoal">{day.date}</td>
                  <td className="px-4 py-3 text-right font-medium text-charcoal">{day.activeUsers}</td>
                </tr>
              ))}
              {dau.length === 0 && (
                <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No activity data yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FunnelStep({ label, value, total }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-charcoal font-medium">{label}</span>
        <span className="text-warm-grey">{value} ({pct}%)</span>
      </div>
      <div className="h-2 bg-cream rounded-full overflow-hidden">
        <div className="h-full bg-plum rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
