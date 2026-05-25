import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconRefresh } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import { formatRelativeTime, staleness } from '../../lib/formatRelativeTime';

// Status badge for an inbound feed. Precedence: disabled > failing > never-synced > stale > healthy.
function feedStatus(f) {
  if (!f.sync_enabled) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-warm-grey text-xs font-semibold">Disabled</span>;
  }
  if ((f.consecutive_failures ?? 0) >= 3 || f.last_error) {
    return (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold"
        title={f.last_error || ''}
      >
        Failing ({f.consecutive_failures || 1}x)
      </span>
    );
  }
  if (!f.last_synced_at) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-warm-grey text-xs font-semibold">Never Synced</span>;
  }
  const hoursSinceSync = (Date.now() - new Date(f.last_synced_at).getTime()) / (1000 * 60 * 60);
  if (hoursSinceSync > 24) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">Stale</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-sage-light text-sage text-xs font-semibold">Healthy</span>;
}

function truncate(str, max = 50) {
  if (!str) return '';
  return str.length > max ? `${str.slice(0, max)}...` : str;
}

export default function AdminCalendarSync() {
  const [feeds, setFeeds] = useState([]);
  const [outboundTokens, setOutboundTokens] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/calendar-sync')
      .then(({ data }) => {
        setFeeds(data.feeds || []);
        setOutboundTokens(data.outboundTokens || []);
      })
      .catch((err) => console.error('Failed to load calendar sync:', err))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;

  // Compute stats
  const total = feeds.length;
  const healthy = feeds.filter((f) => {
    if (!f.sync_enabled) return false;
    if ((f.consecutive_failures ?? 0) >= 3 || f.last_error) return false;
    if (!f.last_synced_at) return false;
    return (Date.now() - new Date(f.last_synced_at).getTime()) / (1000 * 60 * 60) <= 24;
  }).length;
  const failing = feeds.filter((f) => (f.consecutive_failures ?? 0) >= 3 || !!f.last_error).length;
  const outbound = outboundTokens.length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <IconRefresh className="h-6 w-6 text-plum" />
        <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Calendar Sync</h1>
      </div>
      <p className="text-warm-grey text-sm">External iCal subscriptions (inbound) and shared feed tokens (outbound)</p>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{total}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Inbound Feeds</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-sage">{healthy}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Healthy</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-coral">{failing}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Failing</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-plum">{outbound}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Outbound Tokens</p>
        </div>
      </div>

      {/* Inbound Feeds */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Inbound Feeds</h2>
        <p className="text-xs text-warm-grey mb-3">External calendars (Google, Apple, school, etc.) that users have subscribed to via iCal URL. We pull events on a regular cron.</p>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Household</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Feed</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden md:table-cell">Owner</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden md:table-cell">Last Synced</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden lg:table-cell text-right">Events</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden lg:table-cell text-right">Fails</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.id} className="border-b border-light-grey last:border-0 hover:bg-cream/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/admin/households/${f.household_id}`} className="font-medium text-charcoal hover:text-plum">
                      {f.household_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-charcoal">{f.display_name || 'Untitled feed'}</p>
                    <p className="text-[11px] text-warm-grey font-mono truncate max-w-[280px]" title={f.feed_url}>{truncate(f.feed_url, 60)}</p>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <Link to={`/admin/users/${f.user_id}`} className="text-charcoal hover:text-plum">{f.user_name}</Link>
                    <p className="text-xs text-warm-grey">{f.user_email}</p>
                  </td>
                  <td className="px-4 py-3">{feedStatus(f)}</td>
                  <td className={`px-4 py-3 text-xs hidden md:table-cell ${staleness(f.last_synced_at)}`} title={f.last_synced_at ? new Date(f.last_synced_at).toLocaleString() : ''}>
                    {formatRelativeTime(f.last_synced_at)}
                  </td>
                  <td className="px-4 py-3 text-charcoal hidden lg:table-cell text-right">{f.event_count}</td>
                  <td className={`px-4 py-3 hidden lg:table-cell text-right ${(f.consecutive_failures ?? 0) > 0 ? 'text-coral font-medium' : 'text-warm-grey'}`}>
                    {f.consecutive_failures ?? 0}
                  </td>
                </tr>
              ))}
              {feeds.length === 0 && (
                <tr><td colSpan="7" className="px-4 py-8 text-center text-warm-grey">No external feeds subscribed yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Outbound Tokens */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Outbound Feed Tokens</h2>
        <p className="text-xs text-warm-grey mb-3">Users who have generated a secret iCal URL so a third-party app (Google, Apple, etc.) can subscribe to their Housemait calendar. We can see the token has been generated, but not whether anything is actually subscribed on the other end.</p>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-light-grey text-left">
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">User</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden sm:table-cell">Household</th>
                <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Created</th>
              </tr>
            </thead>
            <tbody>
              {outboundTokens.map((t) => (
                <tr key={`${t.user_id}-${t.household_id}`} className="border-b border-light-grey last:border-0 hover:bg-cream/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${t.user_id}`} className="font-medium text-charcoal hover:text-plum">{t.user_name}</Link>
                    <p className="text-xs text-warm-grey">{t.user_email}</p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <Link to={`/admin/households/${t.household_id}`} className="text-charcoal hover:text-plum">{t.household_name}</Link>
                  </td>
                  <td className="px-4 py-3 text-xs text-warm-grey" title={t.created_at ? new Date(t.created_at).toLocaleString() : ''}>
                    {formatRelativeTime(t.created_at)}
                  </td>
                </tr>
              ))}
              {outboundTokens.length === 0 && (
                <tr><td colSpan="3" className="px-4 py-8 text-center text-warm-grey">No users sharing their calendar externally yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
