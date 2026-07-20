import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { IconTrendingUp } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import DateRangeToggle, { DAYS_ALL } from '../../components/DateRangeToggle';
import ErrorBanner from '../../components/ErrorBanner';

function rangeLabel(days) {
  if (days === DAYS_ALL) return 'all time';
  return `${days}d`;
}

export default function AdminAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get('/admin/analytics', { params: { days } })
      .then(({ data }) => setData(data))
      .catch((err) => {
        console.error('Failed to load analytics:', err);
        setError('Could not load analytics. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [days, reloadKey]);

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner /></div>;

  const {
    dau = [], featureUsage = {}, funnel = {}, wau = 0,
    retention = null, channelCohorts = null, calendarConnection = null,
    acquisition = null,
  } = data || {};

  // Calculate DAU average
  const recentDau = dau.slice(-7);
  const avgDau = recentDau.length > 0
    ? Math.round(recentDau.reduce((sum, d) => sum + d.activeUsers, 0) / recentDau.length)
    : 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <IconTrendingUp className="h-6 w-6 text-plum" />
            <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Analytics</h1>
          </div>
          <p className="text-warm-grey text-sm">User activity, feature usage, and onboarding</p>
        </div>
        <DateRangeToggle value={days} onChange={setDays} />
      </div>

      <div className="mt-4">
        <ErrorBanner message={error} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>

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
          <p className="text-2xl font-bold text-charcoal">
            {Object.values(featureUsage).reduce((a, b) => a + (b?.created || 0) + (b?.completed || 0), 0)}
          </p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Actions ({rangeLabel(days)})</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{funnel.registered ?? 0}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">Registered Users</p>
        </div>
      </div>

      {/* Calendar connection - the activation keystone. Once a household has a
          live calendar, the dashboard/brief/reminders all have content. */}
      <CalendarConnection stats={calendarConnection} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        {/* Feature Usage */}
        <div>
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">Feature Usage ({rangeLabel(days)})</h2>
          <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-light-grey text-left">
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Feature</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Created</th>
                  <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Completed</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(featureUsage)
                  .sort((a, b) => ((b[1]?.created || 0) + (b[1]?.completed || 0)) - ((a[1]?.created || 0) + (a[1]?.completed || 0)))
                  .map(([feature, stats]) => (
                    <tr key={feature} className="border-b border-light-grey last:border-0">
                      <td className="px-4 py-3 font-medium text-charcoal capitalize">{feature}</td>
                      <td className="px-4 py-3 text-right text-charcoal">{stats?.created ?? 0}</td>
                      <td className="px-4 py-3 text-right text-charcoal">
                        {stats?.completed === undefined ? <span className="text-warm-grey">—</span> : stats.completed}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Onboarding Funnel */}
        <div>
          <h2 className="font-display text-lg font-medium text-charcoal mb-3">Onboarding Funnel</h2>
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

      {/* Acquisition by platform — the ad-relevant cut. iOS column maps to
          Apple Search Ads installs; web_only is the browser cohort. */}
      {acquisition && acquisition.total > 0 && (
        <div className="mt-8">
          <h2 className="font-display text-lg font-medium text-charcoal mb-1">Acquisition by platform (last {acquisition.days} days)</h2>
          <p className="text-sm text-warm-grey mb-3">
            Apple Search Ads drives <strong>iOS</strong> installs only — compare that column against Apple&rsquo;s install count.
            &ldquo;Web only&rdquo; = signed up in a browser, never opened the native app. Sub-counts are of that segment&rsquo;s sign-ups.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { key: 'ios', label: '📱 iOS app' },
              { key: 'web_only', label: '🌐 Web only' },
              { key: 'android', label: '🤖 Android app' },
            ].map(({ key, label }) => {
              const s = acquisition.segments?.[key] || { signups: 0, verified: 0, onboarded: 0, whatsapp: 0, subscribed: 0 };
              const pct = (n) => (s.signups ? Math.round((n / s.signups) * 100) : 0);
              const rows = [
                ['Verified', s.verified], ['Onboarded', s.onboarded],
                ['WhatsApp linked', s.whatsapp], ['Subscribed', s.subscribed],
              ];
              return (
                <div key={key} className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-5">
                  <div className="flex items-baseline justify-between mb-3">
                    <span className="text-sm font-medium text-charcoal">{label}</span>
                    <span className="text-2xl font-bold text-plum">{s.signups}<span className="text-xs font-medium text-warm-grey ml-1">sign-ups</span></span>
                  </div>
                  {rows.map(([lbl, val]) => (
                    <div key={lbl} className="flex items-center justify-between text-sm mt-1.5">
                      <span className="text-warm-grey">{lbl}</span>
                      <span className="font-medium text-charcoal">{val} <span className="text-warm-grey">({pct(val)}%)</span></span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Retention cohorts */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Retention by Cohort</h2>
        <p className="text-xs text-warm-grey mb-3">
          Each row is a weekly signup cohort. Cells show the % of that cohort active N weeks later
          ("active" = created any content during that week). Empty cells = cohort too new to measure.
        </p>
        <RetentionGrid retention={retention} />
      </div>

      {/* Channel cohorts: WhatsApp-only vs app */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Channel cohorts: WhatsApp-only vs app</h2>
        <p className="text-xs text-warm-grey mb-3">
          Households grouped by how their members actually use Housemait. <strong>App installed</strong> = at
          least one member registered the native iOS app; <strong>WhatsApp only</strong> = no app, but WhatsApp
          linked; <strong>Web only</strong> = neither. <strong>Conversion</strong> = of households past trial,
          the % subscribed. <strong>Retention</strong> = of households that ever subscribed, the % still active.
          Shows whether WhatsApp-primary households are worth more or less than app households.
        </p>
        <ChannelCohorts channelCohorts={channelCohorts} />
      </div>

      {/* DAU Timeline */}
      <div className="mt-8">
        <h2 className="font-display text-lg font-medium text-charcoal mb-3">Daily Active Users</h2>
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

function CalendarConnection({ stats }) {
  const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  return (
    <div className="mt-8">
      <h2 className="font-display text-lg font-medium text-charcoal mb-1">Calendar connection</h2>
      <p className="text-sm text-warm-grey mb-3">
        The activation keystone — a household with a live calendar gets a populated dashboard, daily brief and reminders.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{fmtPct(stats?.connectedPct)}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">
            Households connected{stats ? ` (${stats.connected}/${stats.total})` : ''}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{fmtPct(stats?.activation7dPct)}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">
            Connected within 7 days{stats ? ` (${stats.activated7d}/${stats.eligible7d})` : ''}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{stats?.deviceConnected ?? '—'}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">via iPhone sync</p>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
          <p className="text-2xl font-bold text-charcoal">{stats?.urlConnected ?? '—'}</p>
          <p className="text-xs text-warm-grey font-medium mt-0.5">via calendar link</p>
        </div>
      </div>
    </div>
  );
}

const COHORT_LABELS = { app: 'App installed', whatsapp_only: 'WhatsApp only', web_only: 'Web only' };
const COHORT_ORDER = ['app', 'whatsapp_only', 'web_only'];

function ChannelCohorts({ channelCohorts }) {
  if (!channelCohorts) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">No cohort data yet.</p>
      </div>
    );
  }
  const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
  const th = 'px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider';
  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-light-grey text-left">
            <th className={th}>Cohort</th>
            <th className={`${th} text-right`}>Households</th>
            <th className={`${th} text-right`}>Trialing</th>
            <th className={`${th} text-right`}>Active</th>
            <th className={`${th} text-right`}>Expired</th>
            <th className={`${th} text-right`}>Cancelled</th>
            <th className={`${th} text-right`}>Conversion</th>
            <th className={`${th} text-right`}>Retention</th>
          </tr>
        </thead>
        <tbody>
          {COHORT_ORDER.map((key) => {
            const c = channelCohorts[key];
            if (!c) return null;
            return (
              <tr key={key} className="border-b border-light-grey last:border-0">
                <td className="px-4 py-3 font-medium text-charcoal">{COHORT_LABELS[key]}</td>
                <td className="px-4 py-3 text-right text-charcoal">{c.total}</td>
                <td className="px-4 py-3 text-right text-warm-grey">{c.trialing}</td>
                <td className="px-4 py-3 text-right text-charcoal">{c.active}</td>
                <td className="px-4 py-3 text-right text-warm-grey">{c.expired}</td>
                <td className="px-4 py-3 text-right text-warm-grey">{c.cancelled}</td>
                <td className="px-4 py-3 text-right font-semibold text-charcoal">{fmtPct(c.conversionPct)}</td>
                <td className="px-4 py-3 text-right font-semibold text-charcoal">{fmtPct(c.retentionPct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Map a retention % to a tailwind background colour. Linear gradient from
// coral (low retention) through butter (mid) to sage (high). Cohort row
// header (the "100%" Week 0 cell) is always sage.
function retentionCellClass(pct) {
  if (pct === null || pct === undefined) return 'bg-cream text-warm-grey';
  if (pct >= 70) return 'bg-sage-light text-sage';
  if (pct >= 40) return 'bg-butter-light text-charcoal';
  if (pct > 0)   return 'bg-coral-light text-coral';
  return 'bg-cream text-warm-grey';
}

function formatCohortLabel(iso) {
  // iso is the Monday of the cohort week. Render as "13 Apr" — compact.
  if (!iso) return '';
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function RetentionGrid({ retention }) {
  if (!retention || !retention.cohorts || retention.cohorts.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">Not enough cohort data yet — retention grid will populate as users sign up across more weeks.</p>
      </div>
    );
  }
  const { offsets, cohorts } = retention;

  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-light-grey text-left">
            <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider">Cohort (Mon)</th>
            <th className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-right">Size</th>
            {offsets.map((n) => (
              <th key={n} className="px-4 py-3 font-semibold text-warm-grey text-xs uppercase tracking-wider text-center">
                W{n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.signupWeek} className="border-b border-light-grey last:border-0">
              <td className="px-4 py-3 font-medium text-charcoal">{formatCohortLabel(c.signupWeek)}</td>
              <td className="px-4 py-3 text-right text-warm-grey">{c.size}</td>
              {offsets.map((n) => {
                const pct = c.retention?.[n];
                const cell = retentionCellClass(pct);
                return (
                  <td key={n} className="px-2 py-2 text-center">
                    <span className={`inline-block w-full px-2 py-1 rounded-md text-xs font-semibold ${cell}`}>
                      {pct === null || pct === undefined ? '—' : `${pct}%`}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
