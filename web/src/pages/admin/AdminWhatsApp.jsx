import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { IconMessageCircle } from '../../components/Icons';
import Spinner from '../../components/Spinner';

export default function AdminWhatsApp() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/whatsapp-stats')
      .then(({ data }) => setData(data))
      .catch((err) => console.error('Failed to load WhatsApp stats:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const stats = data?.stats || {};
  const timeline = data?.timeline || [];

  const statCards = [
    { label: 'Total Messages (30d)', value: stats.totalMessages ?? 0 },
    { label: 'Avg Response Time', value: `${stats.avgProcessingMs ?? 0}ms` },
    { label: 'Error Rate', value: `${stats.errorRate ?? 0}%` },
    { label: 'Unique Users', value: stats.uniqueUsers ?? 0 },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <IconMessageCircle className="h-6 w-6 text-plum" />
        <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">WhatsApp Bot</h1>
      </div>
      <p className="text-warm-grey text-sm">Message processing and intent breakdown</p>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {statCards.map(({ label, value }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
            <p className="text-2xl font-bold text-charcoal">{value}</p>
            <p className="text-xs text-warm-grey font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        {/* By Type */}
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">By Message Type</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.byType || {}).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                  <tr key={type} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3 font-medium text-charcoal capitalize">{type}</td>
                    <td className="px-4 py-3 text-right text-charcoal">{count}</td>
                  </tr>
                ))}
                {Object.keys(stats.byType || {}).length === 0 && (
                  <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* By Intent */}
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal mb-3">By Intent</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Intent</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(stats.byIntent || {}).sort((a, b) => b[1] - a[1]).map(([intent, count]) => (
                  <tr key={intent} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3 font-medium text-charcoal capitalize">{intent.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-right text-charcoal">{count}</td>
                  </tr>
                ))}
                {Object.keys(stats.byIntent || {}).length === 0 && (
                  <tr><td colSpan="2" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Daily Timeline */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Daily Volume</h2>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Inbound</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Outbound</th>
              </tr>
            </thead>
            <tbody>
              {timeline.slice(-14).reverse().map((day) => (
                <tr key={day.date} className="border-b border-light-grey last:border-0">
                  <td className="px-4 py-3 text-charcoal">{day.date}</td>
                  <td className="px-4 py-3 text-right text-charcoal">{day.inbound || 0}</td>
                  <td className="px-4 py-3 text-right text-warm-grey">{day.outbound || 0}</td>
                </tr>
              ))}
              {timeline.length === 0 && (
                <tr><td colSpan="3" className="px-4 py-6 text-center text-warm-grey">No data yet — WhatsApp messages will appear here automatically</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
