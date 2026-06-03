import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconArrowLeft } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import SubscriptionBadge from '../../components/SubscriptionBadge';
import DailyChart from '../../components/DailyChart';
import DateRangeToggle, { DAYS_ALL } from '../../components/DateRangeToggle';
import { formatBytes } from '../../lib/formatBytes';
import { formatRelativeTime, staleness } from '../../lib/formatRelativeTime';

function rangeLabel(days) {
  if (days === DAYS_ALL) return 'all time';
  return `${days}d`;
}

const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB - mirrors src/routes/documents.js
const FILE_QUOTA_COUNT = 500;

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

const avatarColors = {
  red: 'bg-red', 'burnt-orange': 'bg-burnt-orange', amber: 'bg-amber', gold: 'bg-gold',
  leaf: 'bg-leaf', emerald: 'bg-emerald', teal: 'bg-teal', sky: 'bg-sky',
  cobalt: 'bg-cobalt', indigo: 'bg-indigo', purple: 'bg-purple', magenta: 'bg-magenta',
  rose: 'bg-rose', terracotta: 'bg-terracotta', moss: 'bg-moss', slate: 'bg-slate',
  sage: 'bg-sage', plum: 'bg-plum', coral: 'bg-coral',
};

export default function AdminHouseholdDetail() {
  const { id } = useParams();
  const [household, setHousehold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiUsage, setAiUsage] = useState(null);
  const [aiUsageLoading, setAiUsageLoading] = useState(true);
  const [aiUsageDays, setAiUsageDays] = useState(30);
  const [activity, setActivity] = useState(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityDays, setActivityDays] = useState(30);

  const loadHousehold = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/households/${id}`);
      setHousehold(data);
    } catch (err) {
      console.error('Failed to load household:', err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadHousehold(); }, [loadHousehold]);

  useEffect(() => {
    setAiUsageLoading(true);
    api.get(`/admin/households/${id}/ai-usage`, { params: { days: aiUsageDays } })
      .then(({ data }) => setAiUsage(data))
      .catch((err) => console.error('Failed to load household AI usage:', err))
      .finally(() => setAiUsageLoading(false));
  }, [id, aiUsageDays]);

  useEffect(() => {
    setActivityLoading(true);
    api.get(`/admin/households/${id}/activity`, { params: { days: activityDays } })
      .then(({ data }) => setActivity(data))
      .catch((err) => console.error('Failed to load household activity:', err))
      .finally(() => setActivityLoading(false));
  }, [id, activityDays]);

  async function patchSubscription(updates) {
    setSaving(true);
    try {
      const { data } = await api.patch(`/admin/households/${id}/subscription`, updates);
      setHousehold((prev) => ({ ...prev, ...data }));
    } catch (err) {
      console.error('Failed to update subscription:', err);
      alert('Failed to update subscription. See console for details.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleInternal() {
    if (!household) return;
    const next = !household.is_internal;
    const verb = next ? 'mark as internal (free unlimited access)' : 'remove internal flag';
    if (!confirm(`Are you sure you want to ${verb}?`)) return;
    await patchSubscription({ is_internal: next });
  }

  async function handleExtendTrial() {
    if (!household) return;
    // Extend from whichever is later - current trial end or now
    const base = household.trial_ends_at && new Date(household.trial_ends_at) > new Date()
      ? new Date(household.trial_ends_at)
      : new Date();
    const newEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (!confirm(`Extend trial by 30 days (until ${new Date(newEnd).toLocaleDateString()})?`)) return;
    await patchSubscription({ trial_ends_at: newEnd });
  }

  async function handleTrialPause() {
    if (!household) return;
    const next = !household.trial_paused_at;
    const msg = next
      ? "Pause this trial? The clock freezes (they keep access) until you resume - no trial days are used."
      : 'Resume this trial? The paused time gets added back onto their trial end date.';
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/admin/households/${id}/trial-pause`, { paused: next });
      setHousehold((prev) => ({ ...prev, ...data }));
    } catch (err) {
      console.error('Failed to pause/resume trial:', err);
      alert('Failed to update the trial. See console for details.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (!household) return <p className="text-warm-grey py-10 text-center">Household not found</p>;

  return (
    <div>
      <Link to="/admin/households" className="flex items-center gap-1.5 text-sm font-medium text-warm-grey hover:text-plum transition-colors mb-4">
        <IconArrowLeft className="h-4 w-4" /> Back to Households
      </Link>

      {/* Header Card */}
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-charcoal">{household.name}</h2>
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-warm-grey font-semibold uppercase tracking-wider">Last Active</p>
            <p
              className={`text-sm font-medium ${staleness(household.last_active_at)}`}
              title={household.last_active_at ? new Date(household.last_active_at).toLocaleString() : ''}
            >
              {formatRelativeTime(household.last_active_at)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-light-grey">
          <Detail label="Join Code" value={household.join_code} mono />
          <Detail label="Members" value={household.members?.length ?? 0} />
          <Detail label="Timezone" value={household.timezone} />
          <Detail label="Created" value={household.created_at ? new Date(household.created_at).toLocaleDateString() : '-'} />
        </div>
      </div>

      {/* Subscription */}
      <div className="mt-6">
        <h3 className="font-display text-lg font-semibold text-charcoal mb-3">Subscription</h3>
        <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
          <div className="flex items-center gap-3 flex-wrap">
            <SubscriptionBadge household={household} />
            {household.subscription_plan && !household.is_internal && (
              <span className="text-sm text-warm-grey capitalize">{household.subscription_plan}</span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-4 pt-4 border-t border-light-grey">
            <Detail label="Trial Started" value={formatDate(household.trial_started_at)} />
            <Detail label="Trial Ends" value={formatDate(household.trial_ends_at)} />
            <Detail label="Period Ends" value={formatDate(household.subscription_current_period_end)} />
            <Detail
              label="Stripe Customer"
              value={household.stripe_customer_id ? `${household.stripe_customer_id.slice(0, 18)}…` : '-'}
              mono
            />
            <Detail
              label="Stripe Subscription"
              value={household.stripe_subscription_id ? `${household.stripe_subscription_id.slice(0, 18)}…` : '-'}
              mono
            />
            <Detail label="Internal" value={household.is_internal ? 'Yes' : 'No'} />
          </div>

          <div className="mt-5 pt-5 border-t border-light-grey flex flex-wrap gap-3">
            <button
              onClick={handleToggleInternal}
              disabled={saving}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
                household.is_internal
                  ? 'bg-cream text-charcoal border border-light-grey hover:bg-light-grey'
                  : 'bg-plum text-white hover:bg-plum-dark'
              }`}
            >
              {household.is_internal ? 'Remove Internal Flag' : 'Mark as Internal (Free)'}
            </button>
            <button
              onClick={handleExtendTrial}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-plum text-plum hover:bg-plum-light transition-colors disabled:opacity-50"
            >
              Extend Trial 30 Days
            </button>
            <button
              onClick={handleTrialPause}
              disabled={saving}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 border ${
                household.trial_paused_at
                  ? 'bg-amber/15 text-amber border-amber/40 hover:bg-amber/25'
                  : 'border-light-grey text-charcoal hover:bg-light-grey'
              }`}
              title={household.trial_paused_at ? `Paused since ${new Date(household.trial_paused_at).toLocaleString()}` : 'Freeze the trial clock'}
            >
              {household.trial_paused_at ? 'Resume Trial' : 'Pause Trial'}
            </button>
            {household.stripe_customer_id && (
              <a
                href={`https://dashboard.stripe.com/customers/${household.stripe_customer_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-light-grey text-charcoal hover:bg-cream transition-colors"
              >
                Open in Stripe ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Storage */}
      <div className="mt-6">
        <h3 className="font-display text-lg font-semibold text-charcoal mb-3">Storage</h3>
        <StorageCard
          bytes={household.documents_bytes ?? 0}
          fileCount={household.documents_count ?? 0}
        />
      </div>

      {/* AI Usage */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-display text-lg font-semibold text-charcoal">AI Usage ({rangeLabel(aiUsageDays)})</h3>
          <DateRangeToggle value={aiUsageDays} onChange={setAiUsageDays} />
        </div>
        <AiUsageCard usage={aiUsage} loading={aiUsageLoading} />
      </div>

      {/* Product Activity */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="font-display text-lg font-semibold text-charcoal">Activity ({rangeLabel(activityDays)})</h3>
          {/* Activity timeline endpoint caps at 90d server-side, so no "All" option here */}
          <DateRangeToggle value={activityDays} onChange={setActivityDays} includeAll={false} />
        </div>
        <ActivityCard activity={activity} loading={activityLoading} />
      </div>

      {/* Members */}
      <div className="mt-6">
        <h3 className="font-display text-lg font-semibold text-charcoal mb-3">Members</h3>
        <div className="grid gap-3">
          {(household.members || []).map((m) => {
            const ac = avatarColors[m.color_theme] || avatarColors.sage;
            return (
              <Link
                key={m.id}
                to={`/admin/users/${m.id}`}
                className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-4 flex items-center gap-3 hover:shadow-[var(--shadow-md)] transition-shadow"
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt={m.name} className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className={`w-10 h-10 rounded-full ${ac} text-white flex items-center justify-center font-bold text-sm`}>
                    {m.name?.[0]?.toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-charcoal text-sm">{m.name}</p>
                  <p className="text-xs text-warm-grey">{m.email || 'No email'}</p>
                </div>
                <div className="hidden sm:block text-right shrink-0 mr-2">
                  <p className="text-[10px] text-warm-grey font-semibold uppercase tracking-wider">Last Active</p>
                  <p
                    className={`text-xs font-medium ${staleness(m.last_active_at)}`}
                    title={m.last_active_at ? new Date(m.last_active_at).toLocaleString() : ''}
                  >
                    {formatRelativeTime(m.last_active_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-charcoal text-xs font-semibold capitalize">
                    {m.role}
                  </span>
                  {m.is_platform_admin && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-plum-light text-plum text-xs font-semibold">
                      Admin
                    </span>
                  )}
                  {m.disabled_at && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">
                      Disabled
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
          {(!household.members || household.members.length === 0) && (
            <p className="text-warm-grey text-sm text-center py-6">No members in this household</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }) {
  return (
    <div>
      <p className="text-xs font-semibold text-warm-grey uppercase tracking-wider">{label}</p>
      <p className={`text-sm text-charcoal mt-0.5 ${mono ? 'font-mono' : ''}`}>{value || '-'}</p>
    </div>
  );
}

function StorageCard({ bytes, fileCount }) {
  const bytesPct = Math.min(100, (bytes / STORAGE_QUOTA_BYTES) * 100);
  const filesPct = Math.min(100, (fileCount / FILE_QUOTA_COUNT) * 100);
  const overQuota = bytes > STORAGE_QUOTA_BYTES || fileCount > FILE_QUOTA_COUNT;

  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="font-display text-2xl font-bold text-charcoal">{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
        <span className="text-warm-grey">·</span>
        <span className="font-display text-2xl font-bold text-charcoal">{formatBytes(bytes)}</span>
        {overQuota && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">
            Over quota
          </span>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <QuotaBar
          label="Storage"
          used={formatBytes(bytes)}
          limit={formatBytes(STORAGE_QUOTA_BYTES)}
          pct={bytesPct}
        />
        <QuotaBar
          label="Files"
          used={`${fileCount}`}
          limit={`${FILE_QUOTA_COUNT}`}
          pct={filesPct}
        />
      </div>
    </div>
  );
}

function QuotaBar({ label, used, limit, pct }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="font-semibold text-warm-grey uppercase tracking-wider">{label}</span>
        <span className="text-charcoal">{used} <span className="text-warm-grey">of {limit}</span></span>
      </div>
      <div className="h-2 bg-cream rounded-full overflow-hidden">
        <div
          className="h-full bg-plum rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function AiUsageCard({ usage, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">Loading AI usage…</p>
      </div>
    );
  }
  if (!usage || usage.totalCalls === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">No AI calls in the last 30 days</p>
      </div>
    );
  }

  const byProvider = Object.entries(usage.byProvider || {}).sort((a, b) => b[1] - a[1]);
  const byFeature = Object.entries(usage.byFeature || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
      {/* Headline metrics */}
      <div className="flex items-baseline gap-3 flex-wrap mb-4">
        <span className="font-display text-2xl font-bold text-charcoal">{usage.totalCalls}</span>
        <span className="text-warm-grey text-sm">total calls</span>
        {usage.lastUsedAt && (
          <span
            className={`text-xs font-medium ml-auto ${staleness(usage.lastUsedAt)}`}
            title={new Date(usage.lastUsedAt).toLocaleString()}
          >
            Last used {formatRelativeTime(usage.lastUsedAt)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5 pb-5 border-b border-light-grey">
        <div>
          <p className="text-lg font-bold text-charcoal">{usage.avgLatencyMs}ms</p>
          <p className="text-[11px] text-warm-grey">Avg Latency</p>
        </div>
        <div>
          <p className="text-lg font-bold text-charcoal">{usage.failoverCalls}</p>
          <p className="text-[11px] text-warm-grey">Failovers</p>
        </div>
        <div>
          <p className="text-lg font-bold text-charcoal">{byProvider.length}</p>
          <p className="text-[11px] text-warm-grey">Providers Used</p>
        </div>
      </div>

      {/* Daily chart */}
      {usage.daily?.length > 0 && (
        <div className="mb-5 pb-5 border-b border-light-grey">
          <p className="text-[11px] text-warm-grey font-semibold uppercase tracking-wider mb-2">Last 10 Days</p>
          <DailyChart data={usage.daily} />
        </div>
      )}

      {/* Provider + feature breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <p className="text-[11px] text-warm-grey font-semibold uppercase tracking-wider mb-2">By Provider</p>
          <div className="space-y-1.5">
            {byProvider.map(([provider, count]) => (
              <div key={provider} className="flex items-center justify-between text-sm">
                <span className="text-warm-grey capitalize">{provider}</span>
                <span className="font-medium text-charcoal">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] text-warm-grey font-semibold uppercase tracking-wider mb-2">Top Features</p>
          <div className="space-y-1.5">
            {byFeature.map(([feature, count]) => (
              <div key={feature} className="flex items-center justify-between text-sm">
                <span className="text-warm-grey capitalize">{feature.replace(/_/g, ' ')}</span>
                <span className="font-medium text-charcoal">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const ACTIVITY_FEATURES = [
  { key: 'tasks', label: 'Tasks', verb: 'added' },
  { key: 'shopping', label: 'Shopping', verb: 'added' },
  { key: 'calendar', label: 'Calendar', verb: 'created' },
  { key: 'documents', label: 'Documents', verb: 'uploaded' },
  { key: 'meals', label: 'Meals', verb: 'planned' },
];

function ActivityCard({ activity, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">Loading activity…</p>
      </div>
    );
  }
  if (!activity) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">No activity data</p>
      </div>
    );
  }

  const total = Object.values(activity.totals || {}).reduce((a, b) => a + b, 0);

  if (total === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
        <p className="text-sm text-warm-grey">No product activity in the last {activity.days} days.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-[var(--shadow-sm)] p-6">
      <div className="flex items-baseline gap-3 flex-wrap mb-5">
        <span className="font-display text-2xl font-bold text-charcoal">{total}</span>
        <span className="text-warm-grey text-sm">total actions</span>
      </div>

      <div className="space-y-4">
        {ACTIVITY_FEATURES.map(({ key, label, verb }) => {
          const count = activity.totals?.[key] || 0;
          const daily = activity.daily?.[key] || [];
          // DailyChart expects { date, calls } — adapt the count field.
          const chartData = daily.map((d) => ({ date: d.date, calls: d.count }));
          return (
            <div key={key} className="flex items-stretch gap-4">
              <div className="w-28 shrink-0">
                <p className="font-medium text-sm text-charcoal">{label}</p>
                <p className="text-xs text-warm-grey">{count} {verb}</p>
              </div>
              <div className="flex-1 min-w-0">
                <DailyChart data={chartData} height="h-12" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
