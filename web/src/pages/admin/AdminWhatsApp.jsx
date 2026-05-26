import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { IconMessageCircle } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import DateRangeToggle, { DAYS_ALL } from '../../components/DateRangeToggle';

function rangeLabel(days) {
  if (days === DAYS_ALL) return 'all time';
  return `${days}d`;
}

export default function AdminWhatsApp() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerStatus, setTriggerStatus] = useState(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    api.get('/admin/whatsapp-stats', { params: { days } })
      .then(({ data }) => setData(data))
      .catch((err) => console.error('Failed to load WhatsApp stats:', err))
      .finally(() => setLoading(false));
  }, [days]);

  async function handleTriggerMorningBrief() {
    setTriggering(true);
    setTriggerStatus(null);
    try {
      const { data } = await api.post('/admin/tools/trigger-morning-brief');
      setTriggerStatus({ kind: 'ok', message: `Sent to ${data.sentTo}. Check WhatsApp.` });
    } catch (err) {
      setTriggerStatus({ kind: 'err', message: err.response?.data?.error || err.message });
    } finally {
      setTriggering(false);
    }
  }

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner /></div>;

  const stats = data?.stats || {};
  const timeline = data?.timeline || [];

  const statCards = [
    { label: `Total Messages (${rangeLabel(days)})`, value: stats.totalMessages ?? 0 },
    { label: 'Avg Response Time', value: `${stats.avgProcessingMs ?? 0}ms` },
    { label: 'Error Rate', value: `${stats.errorRate ?? 0}%` },
    { label: 'Unique Users', value: stats.uniqueUsers ?? 0 },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <IconMessageCircle className="h-6 w-6 text-plum" />
            <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">WhatsApp Bot</h1>
          </div>
          <p className="text-warm-grey text-sm">Message processing and intent breakdown</p>
        </div>
        <DateRangeToggle value={days} onChange={setDays} />
      </div>

      {/* Test tools - admin-only manual digest trigger */}
      <div className="bg-white border border-light-grey rounded-2xl p-5 mt-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-charcoal">Send my morning brief now</h2>
            <p className="text-xs text-warm-grey mt-1 max-w-md">
              Manually fires today's WhatsApp digest to your own number, bypassing the daily lock and the weather cache. Use this to verify digest fixes without waiting until 07:00 tomorrow.
            </p>
          </div>
          <button
            type="button"
            onClick={handleTriggerMorningBrief}
            disabled={triggering}
            className="h-10 px-4 rounded-lg bg-plum hover:bg-plum/90 text-white text-sm font-semibold disabled:opacity-50 shrink-0"
          >
            {triggering ? 'Sending…' : 'Send to me'}
          </button>
        </div>
        {triggerStatus && (
          <p className={`text-xs mt-3 ${triggerStatus.kind === 'ok' ? 'text-sage' : 'text-coral'}`}>
            {triggerStatus.message}
          </p>
        )}
      </div>

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
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">By Message Type</h2>
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
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">By Intent</h2>
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
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Daily Volume</h2>
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
                <tr><td colSpan="3" className="px-4 py-6 text-center text-warm-grey">No data yet - WhatsApp messages will appear here automatically</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
