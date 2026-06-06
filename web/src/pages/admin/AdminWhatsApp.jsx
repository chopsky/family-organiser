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

  // AI provider diagnostics: ai-runtime (does the live process see the key?)
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

  // Setup-completion nudge
  const [nudge, setNudge] = useState(null);
  const [nudgeLoading, setNudgeLoading] = useState(false);
  const [nudgeStatus, setNudgeStatus] = useState(null);

  async function loadNudgePreview() {
    setNudgeLoading(true);
    setNudgeStatus(null);
    try {
      const { data: d } = await api.get('/admin/tools/setup-nudge/preview');
      setNudge(d);
    } catch (err) {
      setNudge({ error: err.response?.data?.error || err.message });
    } finally {
      setNudgeLoading(false);
    }
  }

  async function handleNudgeSendToMe() {
    setNudgeStatus(null);
    try {
      const { data: d } = await api.post('/admin/tools/setup-nudge/send-to-me');
      setNudgeStatus({ kind: 'ok', message: `Sent to you via ${d.channel}${d.usedSampleGaps ? " (sample gaps - you're fully set up)" : ''}.` });
    } catch (err) {
      setNudgeStatus({ kind: 'err', message: err.response?.data?.error || err.message });
    }
  }

  async function handleNudgeSendAll() {
    if (!nudge || !nudge.total) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Send the setup nudge to all ${nudge.total} members (${nudge.viaPush} push, ${nudge.viaWhatsApp} WhatsApp)?`)) return;
    setNudgeStatus({ kind: 'ok', message: 'Sending…' });
    try {
      const { data: d } = await api.post('/admin/tools/setup-nudge/send');
      setNudgeStatus({ kind: 'ok', message: `Done. ${d.pushSent} push, ${d.whatsappSent} WhatsApp, ${d.skipped} skipped, ${d.failed} failed.` });
      loadNudgePreview();
    } catch (err) {
      setNudgeStatus({ kind: 'err', message: err.response?.data?.error || err.message });
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
                {selftest.apns && (
                  <div className="text-xs text-warm-grey mb-3 bg-cream rounded-lg p-3 space-y-0.5">
                    <p className="font-semibold text-charcoal mb-1">Server APNs config — compare against Apple Developer</p>
                    <p>Key ID: <span className="font-mono text-charcoal">{selftest.apns.keyId || '(unset)'}</span> — must exist under <em>Keys</em>, enabled for APNs.</p>
                    <p>Team ID: <span className="font-mono text-charcoal">{selftest.apns.teamId || '(unset)'}</span> — must be the team that owns <span className="font-mono">com.housemait.app</span>.</p>
                    <p>Bundle/topic: <span className="font-mono text-charcoal">{selftest.apns.bundleId}</span> · Tries <span className="font-medium text-charcoal">{selftest.apns.primaryEnv}</span> first (APN_PRODUCTION={String(selftest.apns.apnProduction)}).</p>
                  </div>
                )}
                <p className="text-xs text-warm-grey mb-2">
                  Self-test result per token (active + inactive). The <strong>attempts</strong> column shows each APNs environment my server tried and what it returned.
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

      {/* AI provider self-test - triage "Gemini is being skipped" alerts.
          ai-runtime reports whether the LIVE process sees GEMINI_API_KEY;
          ai-selftest makes a real call and reports which provider answered. */}
      <div className="bg-white border border-light-grey rounded-2xl p-5 mt-4">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-medium text-charcoal">AI provider self-test</h2>
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

      {/* Setup-completion nudge - reach WhatsApp-reliant members who haven't
          set up the app (calendars / school dates / address). */}
      <div className="bg-white border border-light-grey rounded-2xl p-5 mt-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-charcoal">Setup-completion nudge</h2>
            <p className="text-xs text-warm-grey mt-1 max-w-lg">
              Reaches WhatsApp-connected members whose household hasn&apos;t done the app-only setup (connecting calendars, importing school term dates, adding a home address). Each is routed to push if they have the app, otherwise WhatsApp. Re-running skips anyone who&apos;s since set up.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={loadNudgePreview} disabled={nudgeLoading}
              className="h-10 px-4 rounded-lg border border-light-grey text-charcoal text-sm font-semibold hover:bg-cream disabled:opacity-50">
              {nudgeLoading ? 'Loading…' : 'Preview audience'}
            </button>
            <button type="button" onClick={handleNudgeSendToMe}
              className="h-10 px-4 rounded-lg border border-light-grey text-charcoal text-sm font-semibold hover:bg-cream">
              Send to me
            </button>
          </div>
        </div>

        {nudge && !nudge.error && (
          <div className="mt-4 text-xs">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-charcoal">
              <span><strong>{nudge.total}</strong> to nudge</span>
              <span className="text-warm-grey">{nudge.viaPush} via push · {nudge.viaWhatsApp} via WhatsApp{nudge.noChannel ? ` · ${nudge.noChannel} no channel` : ''}</span>
              <span className="text-warm-grey">
                gaps: {Object.entries(nudge.gapCounts || {}).map(([g, n]) => `${g} ${n}`).join(' · ') || 'none'}
              </span>
            </div>
            {nudge.sampleWhatsApp && (
              <div className="mt-3 grid md:grid-cols-2 gap-3">
                <div className="bg-cream rounded-lg p-3">
                  <p className="font-semibold text-charcoal mb-1">Sample WhatsApp</p>
                  <p className="text-warm-grey whitespace-pre-wrap">{nudge.sampleWhatsApp}</p>
                </div>
                {nudge.samplePush && (
                  <div className="bg-cream rounded-lg p-3">
                    <p className="font-semibold text-charcoal mb-1">Sample push</p>
                    <p className="text-charcoal">{nudge.samplePush.title}</p>
                    <p className="text-warm-grey">{nudge.samplePush.body}</p>
                  </div>
                )}
              </div>
            )}
            {nudge.total > 0 && (
              <button type="button" onClick={handleNudgeSendAll}
                className="mt-3 h-10 px-4 rounded-lg bg-plum hover:bg-plum/90 text-white text-sm font-semibold">
                Send to all {nudge.total}
              </button>
            )}
          </div>
        )}
        {nudge?.error && <p className="text-xs text-coral mt-3">{nudge.error}</p>}
        {nudgeStatus && (
          <p className={`text-xs mt-3 ${nudgeStatus.kind === 'ok' ? 'text-sage' : 'text-coral'}`}>{nudgeStatus.message}</p>
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
