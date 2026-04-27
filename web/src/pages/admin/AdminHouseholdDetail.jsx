import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { IconArrowLeft } from '../../components/Icons';
import Spinner from '../../components/Spinner';
import SubscriptionBadge from '../../components/SubscriptionBadge';

function formatDate(value) {
  if (!value) return '—';
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
    // Extend from whichever is later — current trial end or now
    const base = household.trial_ends_at && new Date(household.trial_ends_at) > new Date()
      ? new Date(household.trial_ends_at)
      : new Date();
    const newEnd = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    if (!confirm(`Extend trial by 30 days (until ${new Date(newEnd).toLocaleDateString()})?`)) return;
    await patchSubscription({ trial_ends_at: newEnd });
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
        <h2 className="font-display text-xl font-bold text-charcoal">{household.name}</h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-light-grey">
          <Detail label="Join Code" value={household.join_code} mono />
          <Detail label="Members" value={household.members?.length ?? 0} />
          <Detail label="Timezone" value={household.timezone} />
          <Detail label="Created" value={household.created_at ? new Date(household.created_at).toLocaleDateString() : '—'} />
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
              value={household.stripe_customer_id ? `${household.stripe_customer_id.slice(0, 18)}…` : '—'}
              mono
            />
            <Detail
              label="Stripe Subscription"
              value={household.stripe_subscription_id ? `${household.stripe_subscription_id.slice(0, 18)}…` : '—'}
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
      <p className={`text-sm text-charcoal mt-0.5 ${mono ? 'font-mono' : ''}`}>{value || '—'}</p>
    </div>
  );
}
