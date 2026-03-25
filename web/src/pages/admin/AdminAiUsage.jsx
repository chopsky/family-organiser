import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconCpu } from '../../components/Icons';
import Spinner from '../../components/Spinner';

export default function AdminAiUsage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/ai-usage')
      .then(({ data }) => setData(data))
      .catch((err) => console.error('Failed to load AI usage:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const stats = data?.stats || {};
  const timeline = data?.timeline || [];
  const topHouseholds = data?.topHouseholds || [];
  const topUsers = data?.topUsers || [];

  const statCards = [
    { label: 'Total Calls (30d)', value: stats.totalCalls ?? 0, color: 'text-plum bg-plum-light' },
    { label: 'Avg Latency', value: `${stats.avgLatencyMs ?? 0}ms`, color: 'text-sage bg-sage-light' },
    { label: 'Failover Rate', value: `${stats.failoverRate ?? 0}%`, color: 'text-coral bg-coral-light' },
    { label: 'Failover Calls', value: stats.failoverCalls ?? 0, color: 'text-warm-grey bg-cream' },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <IconCpu className="h-6 w-6 text-plum" />
        <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">AI Usage</h1>
      </div>
      <p className="text-warm-grey text-sm">API calls across Gemini, Claude, and GPT-4o</p>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {statCards.map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
            <p className="text-2xl font-bold text-charcoal">{value}</p>
            <p className="text-xs text-warm-grey font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Provider Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">By Provider</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Provider</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.byProvider || {}).sort((a, b) => b[1] - a[1]).map(([provider, count]) => (
                  <tr key={provider} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3 font-medium text-charcoal capitalize">{provider}</td>
                    <td className="px-4 py-3 text-right text-charcoal">{count}</td>
                  </tr>
                ))}
                {Object.keys(stats.byProvider || {}).length === 0 && (
                  <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">By Feature</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Feature</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.byFeature || {}).sort((a, b) => b[1] - a[1]).map(([feature, count]) => (
                  <tr key={feature} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3 font-medium text-charcoal capitalize">{feature}</td>
                    <td className="px-4 py-3 text-right text-charcoal">{count}</td>
                  </tr>
                ))}
                {Object.keys(stats.byFeature || {}).length === 0 && (
                  <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Top Households & Users */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Top Households</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Household</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {topHouseholds.map((h) => (
                  <tr key={h.household_id} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3">
                      <Link to={`/admin/households/${h.household_id}`} className="font-medium text-plum hover:underline">{h.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right text-charcoal">{h.calls}</td>
                  </tr>
                ))}
                {topHouseholds.length === 0 && (
                  <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Top Users</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">User</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {topUsers.map((u) => (
                  <tr key={u.user_id} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3">
                      <Link to={`/admin/users/${u.user_id}`} className="font-medium text-plum hover:underline">{u.name}</Link>
                      <p className="text-xs text-warm-grey">{u.email}</p>
                    </td>
                    <td className="px-4 py-3 text-right text-charcoal">{u.calls}</td>
                  </tr>
                ))}
                {topUsers.length === 0 && (
                  <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Daily Timeline */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Daily Usage</h2>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Total</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Gemini</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Claude</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">GPT-4o</th>
              </tr>
            </thead>
            <tbody>
              {timeline.slice(-14).reverse().map((day) => (
                <tr key={day.date} className="border-b border-light-grey last:border-0">
                  <td className="px-4 py-3 text-charcoal">{day.date}</td>
                  <td className="px-4 py-3 text-right font-medium text-charcoal">{day.total}</td>
                  <td className="px-4 py-3 text-right text-warm-grey">{day.gemini || 0}</td>
                  <td className="px-4 py-3 text-right text-warm-grey">{day.claude || 0}</td>
                  <td className="px-4 py-3 text-right text-warm-grey">{day['gpt-4o'] || 0}</td>
                </tr>
              ))}
              {timeline.length === 0 && (
                <tr><td colSpan="5" className="px-4 py-6 text-center text-warm-grey">No data yet — AI calls will appear here automatically</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
