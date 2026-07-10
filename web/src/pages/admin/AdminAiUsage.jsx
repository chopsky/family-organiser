import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconCpu } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import DailyChart from '../../components/DailyChart';
import DateRangeToggle, { DAYS_ALL } from '../../components/DateRangeToggle';
import { formatRelativeTime, staleness } from '../../lib/formatRelativeTime';

function rangeLabel(days) {
  if (days === DAYS_ALL) return 'all time';
  return `${days}d`;
}

export default function AdminAiUsage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  // AI provider self-test: ai-runtime (does the live process see the key?)
  // + ai-selftest (a real call — which provider actually answered?).
  const [ai, setAi] = useState(null);
  const [aiChecking, setAiChecking] = useState(false);

  async function handleAiCheck() {
    setAiChecking(true);
    setAi(null);
    try {
      const [rt, st] = await Promise.all([
        api.get('/admin/tools/ai-runtime').then(r => r.data).catch(e => ({ error: e.response?.data?.error || e.message })),
        api.get('/admin/tools/ai-selftest').then(r => r.data).catch(e => e.response?.data || { error: e.message }),
      ]);
      setAi({ runtime: rt, selftest: st });
    } finally {
      setAiChecking(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    api.get('/admin/ai-usage', { params: { days } })
      .then(({ data }) => setData(data))
      .catch((err) => console.error('Failed to load AI usage:', err))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner /></div>;

  const stats = data?.stats || {};
  const timeline = data?.timeline || [];
  const topHouseholds = data?.topHouseholds || [];
  const topUsers = data?.topUsers || [];
  const botFailures = data?.botFailures || null;

  const statCards = [
    { label: `Total Calls (${rangeLabel(days)})`, value: stats.totalCalls ?? 0, color: 'text-plum bg-plum-light' },
    { label: 'Avg Latency', value: `${stats.avgLatencyMs ?? 0}ms`, color: 'text-sage bg-sage-light' },
    { label: 'Failover Rate', value: `${stats.failoverRate ?? 0}%`, color: 'text-coral bg-coral-light' },
    { label: 'Failover Calls', value: stats.failoverCalls ?? 0, color: 'text-warm-grey bg-cream' },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <IconCpu className="h-6 w-6 text-plum" />
            <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">AI Usage</h1>
          </div>
          <p className="text-warm-grey text-sm">API calls across Gemini, Claude, and GPT-4o</p>
        </div>
        <DateRangeToggle value={days} onChange={setDays} />
      </div>

      {/* ── Bot health — the strip the founder checks after any bot change.
            User-visible failures (whatsapp_message_log.error) is the headline:
            every one is a family that got an apology. Provider error/failover
            rates are the leading indicators (a rescued call never reaches
            users). ── */}
      {botFailures && (
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 mt-6">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="font-display text-lg font-medium text-charcoal">Bot health</h2>
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${botFailures.failures > 0 ? 'bg-coral' : 'bg-sage'}`} />
            <span className="text-xs text-warm-grey">({rangeLabel(days)})</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className={`text-2xl font-bold ${botFailures.failures > 0 ? 'text-coral' : 'text-sage'}`}>
                {botFailures.failures}
                <span className="text-sm font-medium text-warm-grey ml-1.5">({botFailures.failureRate}%)</span>
              </p>
              <p className="text-xs text-warm-grey font-medium mt-0.5">User-visible failures / {botFailures.totalInbound} messages</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-charcoal">{stats.errorRate ?? 0}%</p>
              <p className="text-xs text-warm-grey font-medium mt-0.5">Provider error rate ({stats.errorCalls ?? 0} calls)</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-charcoal">{stats.failoverRate ?? 0}%</p>
              <p className="text-xs text-warm-grey font-medium mt-0.5">Failover rate</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-charcoal">{stats.p95LatencyMs ?? 0}ms</p>
              <p className="text-xs text-warm-grey font-medium mt-0.5">p95 latency (recent sample)</p>
            </div>
          </div>
          {botFailures.recent?.length > 0 && (
            <div className="mt-4 pt-4 border-t border-light-grey">
              <p className="text-xs font-semibold text-charcoal mb-2">Recent failures</p>
              <div className="space-y-1.5">
                {botFailures.recent.map((f, i) => (
                  <div key={i} className="text-xs bg-cream rounded-lg px-3 py-2 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-warm-grey shrink-0">{formatRelativeTime(f.at)}</span>
                    {f.intent && <span className="font-mono text-plum shrink-0">{f.intent}</span>}
                    <span className="text-charcoal truncate">&ldquo;{f.bodyPreview}&rdquo;</span>
                    <span className="text-coral basis-full truncate">{f.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        {statCards.map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
            <p className="text-2xl font-bold text-charcoal">{value}</p>
            <p className="text-xs text-warm-grey font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* AI provider self-test - triage "Gemini is being skipped" alerts.
          ai-runtime reports whether the LIVE process sees GEMINI_API_KEY;
          ai-selftest makes a real call and reports which provider answered. */}
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5 mt-8">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="font-display text-lg font-medium text-charcoal">Provider self-test</h2>
          <button
            type="button"
            onClick={handleAiCheck}
            disabled={aiChecking}
            className="text-xs font-semibold text-plum hover:underline disabled:opacity-50 shrink-0"
          >
            {aiChecking ? 'Checking…' : 'Run AI self-test'}
          </button>
        </div>
        <p className="text-xs text-warm-grey">
          If you&apos;re getting &quot;Gemini is being skipped&quot; alerts, run this. It asks the live server whether it can see <span className="font-mono">GEMINI_API_KEY</span> and makes a real one-word call to see which provider actually answers.
        </p>

        {ai && (
          <div className="mt-4 pt-4 border-t border-light-grey space-y-4">
            {/* Runtime key probe */}
            <div>
              {ai.runtime?.error ? (
                <p className="text-xs text-coral">Couldn&apos;t read runtime: {ai.runtime.error}</p>
              ) : (() => {
                const k = ai.runtime?.GEMINI_API_KEY || {};
                const ok = k.present;
                return (
                  <div className="text-xs bg-cream rounded-lg p-3 space-y-0.5">
                    <p className="font-semibold text-charcoal mb-1">Does the live process see the key? (pid {ai.runtime?.pid})</p>
                    <p>
                      <span className="font-mono">GEMINI_API_KEY</span>:{' '}
                      {ok
                        ? <span className="text-sage font-medium">present — {k.length} chars, starts &quot;{k.starts}&quot;</span>
                        : <span className="text-coral font-medium">MISSING from the running process</span>}
                    </p>
                    {ok && (k.hasLeadingWhitespace || k.hasTrailingWhitespace) && (
                      <p className="text-coral">⚠ Key has {k.hasLeadingWhitespace ? 'leading' : ''}{k.hasLeadingWhitespace && k.hasTrailingWhitespace ? ' & ' : ''}{k.hasTrailingWhitespace ? 'trailing' : ''} whitespace — trim it in Railway.</p>
                    )}
                    {!ok && (
                      <p className="text-warm-grey">The Railway Variables UI may show it, but this process doesn&apos;t have it. Check it&apos;s on the right service + environment, then redeploy the API service.</p>
                    )}
                    {Array.isArray(ai.runtime?.aiRelatedKeys) && (
                      <p className="text-warm-grey">AI-related env keys seen: <span className="font-mono">{ai.runtime.aiRelatedKeys.join(', ') || '(none)'}</span></p>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Real call - which provider answered */}
            <div>
              {ai.selftest?.error || ai.selftest?.ok === false ? (
                <p className="text-xs text-coral">
                  Live AI call failed: {ai.selftest.error || ai.selftest.errorCode || 'unknown error'}
                </p>
              ) : ai.selftest?.provider ? (
                <p className="text-xs">
                  Live call answered by{' '}
                  <span className={ai.selftest.provider === 'gemini' ? 'text-sage font-semibold' : 'text-coral font-semibold'}>
                    {ai.selftest.provider}
                  </span>
                  {' '}in {ai.selftest.totalLatencyMs}ms{ai.selftest.text ? ` (said "${ai.selftest.text.trim()}")` : ''}.
                  {ai.selftest.provider !== 'gemini' && ' Gemini is not being used as primary — see the key probe above.'}
                </p>
              ) : (
                <p className="text-xs text-warm-grey">No provider returned.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Platform-wide daily chart */}
      {timeline.length > 0 && (
        <div className="mt-8">
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
            <p className="text-[11px] text-warm-grey font-semibold uppercase tracking-wider mb-2">Last 10 Days</p>
            <DailyChart data={timeline.slice(-10).map((d) => ({ date: d.date, calls: d.total }))} />
          </div>
        </div>
      )}

      {/* Provider Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        <div>
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">By Provider</h2>
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
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">By Feature</h2>
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
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">Top Households</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Household</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden sm:table-cell">Last Used</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Calls</th>
                </tr>
              </thead>
              <tbody>
                {topHouseholds.map((h) => (
                  <tr key={h.household_id} className="border-b border-light-grey last:border-0">
                    <td className="px-4 py-3">
                      <Link to={`/admin/households/${h.household_id}`} className="font-medium text-plum hover:underline">{h.name}</Link>
                    </td>
                    <td className={`px-4 py-3 text-xs hidden sm:table-cell ${staleness(h.last_used_at)}`} title={h.last_used_at ? new Date(h.last_used_at).toLocaleString() : ''}>
                      {formatRelativeTime(h.last_used_at)}
                    </td>
                    <td className="px-4 py-3 text-right text-charcoal">{h.calls}</td>
                  </tr>
                ))}
                {topHouseholds.length === 0 && (
                  <tr><td colSpan="3" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">Top Users</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">User</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider hidden sm:table-cell">Last Used</th>
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
                    <td className={`px-4 py-3 text-xs hidden sm:table-cell ${staleness(u.last_used_at)}`} title={u.last_used_at ? new Date(u.last_used_at).toLocaleString() : ''}>
                      {formatRelativeTime(u.last_used_at)}
                    </td>
                    <td className="px-4 py-3 text-right text-charcoal">{u.calls}</td>
                  </tr>
                ))}
                {topUsers.length === 0 && (
                  <tr><td colSpan="3" className="px-4 py-6 text-center text-warm-grey">No data yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Daily Timeline */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Daily Usage</h2>
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
                <tr><td colSpan="5" className="px-4 py-6 text-center text-warm-grey">No data yet - AI calls will appear here automatically</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
