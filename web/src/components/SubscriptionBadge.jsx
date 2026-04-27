/**
 * Renders a small status badge for a household's subscription state.
 * Used in admin lists and detail pages.
 */
export default function SubscriptionBadge({ household }) {
  if (!household) return null;
  const { is_internal, subscription_status, subscription_plan, trial_ends_at } = household;

  if (is_internal) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-warm-grey text-xs font-semibold">
        Internal
      </span>
    );
  }

  if (subscription_status === 'trialing') {
    let label = 'Trial';
    if (trial_ends_at) {
      const days = Math.max(0, Math.ceil((new Date(trial_ends_at) - Date.now()) / (1000 * 60 * 60 * 24)));
      label = `Trial · ${days}d`;
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-plum-light text-plum text-xs font-semibold">
        {label}
      </span>
    );
  }

  if (subscription_status === 'active') {
    const planLabel = subscription_plan === 'annual' ? 'Annual' : subscription_plan === 'monthly' ? 'Monthly' : 'Active';
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-sage-light text-sage text-xs font-semibold">
        Active · {planLabel}
      </span>
    );
  }

  if (subscription_status === 'expired') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">
        Expired
      </span>
    );
  }

  if (subscription_status === 'cancelled') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-coral-light text-coral text-xs font-semibold">
        Cancelled
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-cream text-warm-grey text-xs font-semibold">
      —
    </span>
  );
}
