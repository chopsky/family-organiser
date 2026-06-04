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
  const [devices, setDevices] = useState(null);
  const [selftest, setSelftest] = useState(null);
  const [selftesting, setSelftesting] = useState(false);

  async function loadDevices() {
    try {
      const { data: d } = await api.get('/admin/tools/my-devices');
      setDevices(d);
    } catch {
      setDevices({ error: true });
    }
  }
  useEffect(() => { loadDevices(); }, []);

  async function handleSelfTest() {
    setSelftesting(true);
    setSelftest(null);
    try {
      const { data: d } = await api.post('/admin/tools/push-selftest');
      setSelftest(d);
    } catch (err) {
      setSelftest({ error: err.response?.data?.error || err.message });
    } finally {
      setSelftesting(false);
    }
  }

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
      setTriggerStatus({ kind: 'ok', message: `Sent via ${data.where}.` });
      loadDevices(); // dead tokens may have just been pruned
    } catch (err) {
      setTriggerStatus({ kind: 'err', message: err.response?.data?.error || err.message });
    } finally {
      setTriggering(false);
    }
  }

  function fmtWhen(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
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
              Fires today's brief to you on your best channel - a push notification if you have the app installed, otherwise WhatsApp - bypassing the daily lock, weather cache, and your own on/off toggle. Use it to preview the real copy without waiting until 07:00 tomorrow.
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

      {/* Push diagnostic - your registered devices. Lets you confirm the
          current device actually registered for push (a recent "updated")
          vs old ghost tokens from past installs. */}
      <div className="bg-white border border-light-grey rounded-2xl p-5 mt-4">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-medium text-charcoal">Your push devices</h2>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleSelfTest}
              disabled={selftesting}
              className="text-xs font-semibold text-plum hover:underline disabled:opacity-50"
            >
              {selftesting ? 'Testing…' : 'Run push self-test'}
            </button>
            <button
              type="button"
              onClick={loadDevices}
              className="text-xs text-plum hover:underline"
            >
              Refresh
            </button>
          </div>
        </div>
        {!devices ? (
          <p className="text-xs text-warm-grey">Loading…</p>
        ) : devices.error ? (
          <p className="text-xs text-coral">Couldn&apos;t load devices.</p>
        ) : devices.devices.length === 0 ? (
          <p className="text-xs text-warm-grey">
            No devices registered. Your phone hasn&apos;t registered a push token - open the app and allow notifications when prompted (or enable them in iOS Settings → Housemait → Notifications, then reopen the app).
          </p>
        ) : (
          <>
            <p className="text-xs text-warm-grey mb-3">
              {devices.activeCount} active of {devices.totalCount} total. The device you&apos;re using now should show a recent &quot;updated&quot; time and <span className="text-sage font-medium">active</span>. Old <span className="text-warm-grey font-medium">inactive</span> rows are pruned ghosts from past installs.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-light-grey text-left text-warm-grey">
                    <th className="py-2 pr-3 font-semibold uppercase tracking-wider">Token</th>
                    <th className="py-2 pr-3 font-semibold uppercase tracking-wider">Platform</th>
                    <th className="py-2 pr-3 font-semibold uppercase tracking-wider">Status</th>
                    <th className="py-2 pr-3 font-semibold uppercase tracking-wider">Registered</th>
                    <th className="py-2 font-semibold uppercase tracking-wider">Last updated</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.devices.map((d) => (
                    <tr key={d.id} className="border-b border-light-grey/60">
                      <td className="py-2 pr-3 font-mono text-charcoal whitespace-nowrap">
                        {d.tokenMasked}
                        {d.token && (
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(d.token)}
                            className="ml-2 text-plum hover:underline font-sans"
                            title="Copy full device token (for Apple's Push Notifications Console)"
                          >
                            Copy
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-warm-grey">{d.platform}</td>
                      <td className="py-2 pr-3">
                        <span className={d.active ? 'text-sage font-medium' : 'text-warm-grey'}>
                          {d.active ? 'active' : 'inactive'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-warm-grey">{fmtWhen(d.created_at)}</td>
                      <td className="py-2 text-warm-grey">{fmtWhen(d.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Per-token self-test results - the ground truth for "APNs says
            sent but no banner". Shows whether each token actually succeeded
            and on which APNs environment (sandbox vs production). */}
        {selftest && (
          <div className="mt-4 pt-4 border-t border-light-grey">
            {selftest.error ? (
              <p className="text-xs text-coral">{selftest.error}</p>
            ) : selftest.configured === false ? (
              <p className="text-xs text-coral">APNs isn&apos;t configured on the server (missing APN_KEY / APN_KEY_ID / APN_TEAM_ID).</p>
            ) : selftest.results.length === 0 ? (
              <p className="text-xs text-warm-grey">No active tokens to test.</p>
            ) : (
              <>
                <p className="text-xs text-warm-grey mb-2">
                  Self-test result per token (active + inactive). The <strong>attempts</strong> column shows each APNs environment my server tried and what it returned.
                  {selftest.primaryEnv && <> Server tries <span className="font-medium text-charcoal">{selftest.primaryEnv}</span> first.</>}
                </p>
                <div className="space-y-1">
                  {selftest.results.map((r) => (
                    <div key={r.tokenMasked} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs py-1.5 border-b border-light-grey/40">
                      <span className="font-mono text-charcoal">{r.tokenMasked}</span>
                      <span className={r.active ? 'text-sage' : 'text-warm-grey'}>{r.active ? 'active' : 'inactive'}</span>
                      <span className="text-warm-grey">{fmtWhen(r.updated_at)}</span>
                      {/* attempt trail: production ✗ BadDeviceToken → sandbox ✓ */}
                      <span className="text-warm-grey">
                        {(r.attempts || []).map((a, i) => (
                          <span key={a.env}>
                            {i > 0 && ' → '}
                            <span className={a.ok ? 'text-sage font-medium' : 'text-coral'}>
                              {a.env} {a.ok ? '✓' : `✗${a.reason ? ` ${a.reason.replace(/[{}"]/g, '').replace('reason:', '')}` : ''}`}
                            </span>
                          </span>
                        ))}
                      </span>
                      {r.success
                        ? <span className="text-sage font-medium shrink-0 ml-auto">delivered via {r.env}</span>
                        : <span className="text-coral font-medium shrink-0 ml-auto">failed</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
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
