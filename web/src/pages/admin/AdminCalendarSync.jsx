import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { IconRefresh } from '../../components/Icons';
import Spinner from '../../components/Spinner';

function syncStatus(conn) {
  if (!conn.sync_enabled) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-warm-grey text-xs font-semibold">Disabled</span>;
  }
  if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">Token Expired</span>;
  }
  if (!conn.last_synced_at) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-warm-grey text-xs font-semibold">Never Synced</span>;
  }
  const hoursSinceSync = (Date.now() - new Date(conn.last_synced_at).getTime()) / (1000 * 60 * 60);
  if (hoursSinceSync > 24) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">Stale ({Math.round(hoursSinceSync)}h ago)</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-sage-light text-sage text-xs font-semibold">Healthy</span>;
}

export default function AdminCalendarSync() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/calendar-sync')
      .then(({ data }) => setConnections(data.connections || []))
      .catch((err) => console.error('Failed to load calendar sync:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  const byProvider = {};
  for (const c of connections) {
    byProvider[c.provider] = (byProvider[c.provider] || 0) + 1;
  }
  const activeCount = connections.filter((c) => c.sync_enabled).length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <IconRefresh className="h-6 w-6 text-plum" />
        <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Calendar Sync</h1>
      </div>
      <p className="text-warm-grey text-sm">Connected calendars and sync health</p>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{connections.length}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Total Connections</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{activeCount}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Active Syncs</p>
        </div>
        {Object.entries(byProvider).map(([provider, count]) => (
          <div key={provider} className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
            <p className="text-2xl font-bold text-charcoal">{count}</p>
            <p className="text-xs text-warm-grey font-medium mt-0.5 capitalize">{provider}</p>
          </div>
        ))}
      </div>

      {/* Connections Table */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Connections</h2>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">User</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Provider</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden md:table-cell">Last Synced</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden lg:table-cell">Events</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden lg:table-cell">Token Expires</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((conn) => (
                <tr key={conn.id} className="border-b border-light-grey last:border-0 hover:bg-cream/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-charcoal">{conn.user_name}</p>
                    <p className="text-xs text-warm-grey">{conn.user_email}</p>
                  </td>
                  <td className="px-4 py-3 capitalize text-charcoal">{conn.provider}</td>
                  <td className="px-4 py-3">{syncStatus(conn)}</td>
                  <td className="px-4 py-3 text-warm-grey hidden md:table-cell">
                    {conn.last_synced_at ? new Date(conn.last_synced_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-charcoal hidden lg:table-cell">{conn.synced_events}</td>
                  <td className="px-4 py-3 text-warm-grey text-xs hidden lg:table-cell">
                    {conn.token_expires_at ? new Date(conn.token_expires_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
              {connections.length === 0 && (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-warm-grey">No calendar connections yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
