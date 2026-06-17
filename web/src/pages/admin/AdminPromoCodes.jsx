/**
 * AdminPromoCodes - create + manage Stripe discount codes for web checkout.
 *
 * These create a Stripe coupon + promotion code. The customer types the code
 * on the Stripe-hosted checkout page (which already shows the field). For iOS,
 * mirror the same string as an Apple Offer Code in App Store Connect - the two
 * systems don't share codes, only the human string.
 *
 * Backed by /api/admin/promo-codes (GET list, POST create, PATCH enable/disable).
 */
import { Fragment, useEffect, useState } from 'react';
import api from '../../lib/api';
import { appleOfferCodeRedeemUrl } from '../../lib/app-store';

// The flyer QR / printed link. Opens the WEB signup on every device (iPhone
// included), with the Stripe code pre-applied at annual checkout. The web
// onboarding ends with its own "get the app" step. See FairRedirect.jsx.
function fairLink(code) {
  return `https://housemait.com/fair?promo=${encodeURIComponent(code)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** A label + truncated URL with a one-click "Copy" button that flips to
 *  "Copied!" once used. Keeps the printable campaign links one tap away. */
function CopyLink({ label, url, copyKey, copiedKey, onCopy }) {
  const copied = copiedKey === copyKey;
  return (
    <div className="flex items-center gap-2 max-w-[260px]">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-warm-grey font-semibold">{label}</div>
        <div className="text-xs text-cocoa truncate" title={url}>{url}</div>
      </div>
      <button
        type="button"
        onClick={() => onCopy(url, copyKey)}
        className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md border transition-colors ${copied ? 'border-sage text-sage' : 'border-plum/30 text-plum hover:border-plum'}`}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

function discountLabel(c) {
  const pct = c.percent_off === 100 ? 'Free' : `${c.percent_off}% off`;
  let dur = '';
  if (c.percent_off === 100) {
    dur = c.duration === 'once' ? ' (first period)' : c.duration === 'forever' ? ' (forever)' : ` (${c.duration_in_months} mo)`;
  } else if (c.duration === 'once') dur = ' (first payment)';
  else if (c.duration === 'forever') dur = ' (every payment)';
  else if (c.duration === 'repeating') dur = ` (${c.duration_in_months} mo)`;
  return pct + dur;
}

export default function AdminPromoCodes() {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  // Create form
  const [code, setCode] = useState('');
  const [percentOff, setPercentOff] = useState('100');
  const [appliesTo, setAppliesTo] = useState('any');
  const [duration, setDuration] = useState('once');
  const [durationMonths, setDurationMonths] = useState('12');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdMsg, setCreatedMsg] = useState('');

  const [togglingId, setTogglingId] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  async function copyToClipboard(text, key) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts / older browsers.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* noop */ }
      document.body.removeChild(ta);
    }
    setCopiedKey(key);
  }

  async function loadCodes() {
    setLoading(true);
    setListError('');
    try {
      const { data } = await api.get('/admin/promo-codes');
      setCodes(data.codes || []);
    } catch (err) {
      setListError(err.response?.data?.error || 'Could not load discount codes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadCodes(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError('');
    setCreatedMsg('');
    try {
      const body = {
        code: code.trim(),
        percent_off: Number(percentOff),
        duration,
        duration_in_months: duration === 'repeating' ? Number(durationMonths) : undefined,
        applies_to: appliesTo,
        max_redemptions: maxRedemptions === '' ? null : Number(maxRedemptions),
        expires_at: expiresAt ? `${expiresAt}T23:59:59Z` : null,
      };
      const { data } = await api.post('/admin/promo-codes', body);
      let msg = `Created ${data.code}.`;
      if (data.restrictedToPlan) msg += ` Restricted to the ${data.restrictedToPlan} plan.`;
      if (data.sharedProductWarning) msg += ` Note: your annual & monthly share one Stripe product, so this code couldn't be limited to ${appliesTo} only — it applies to whichever plan the customer picks.`;
      setCreatedMsg(msg);
      setCode('');
      await loadCodes();
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Could not create the code.');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggle(c) {
    setTogglingId(c.id);
    try {
      await api.patch(`/admin/promo-codes/${c.id}`, { active: !c.active });
      setCodes((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)));
    } catch (err) {
      setListError(err.response?.data?.error || 'Could not update the code.');
    } finally {
      setTogglingId(null);
    }
  }

  const inputCls = 'w-full border border-cream-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent';
  const labelCls = 'block text-xs font-semibold text-cocoa mb-1';

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-charcoal tracking-tight">Discount codes</h1>

      <div className="bg-plum-light/60 border border-plum/20 rounded-xl p-4 text-sm text-charcoal">
        <strong>How it works:</strong> this creates a Stripe coupon + promotion code for <strong>web checkout</strong> (customers
        type it on the Stripe page). For the <strong>iOS app</strong>, create a matching <strong>Apple Offer Code</strong> with the
        same string in App Store Connect — Stripe and Apple don’t share codes. Percentage discounts only. Use <strong>100%</strong>
        for a free period (e.g. 100% off + Annual = a free first year). Each code below has a ready-to-print
        <strong> Flyer / QR link</strong> that opens the web signup with the code pre-applied on every device
        (iPhone included — the web onboarding ends with a "get the app" step), and an
        <strong> Apple redeem link</strong> that opens the in-app redemption sheet with the Offer Code pre-filled.
      </div>

      {/* Create */}
      <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">Create a discount code</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Code</label>
            <input className={`${inputCls} uppercase`} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="FREEYEAR" autoCapitalize="characters" autoCorrect="off" spellCheck={false} required />
          </div>
          <div>
            <label className={labelCls}>% off (100 = free)</label>
            <input className={inputCls} type="number" min="1" max="100" value={percentOff} onChange={(e) => setPercentOff(e.target.value)} required />
          </div>
          <div>
            <label className={labelCls}>Applies to</label>
            <select className={inputCls} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
              <option value="any">Any plan</option>
              <option value="annual">Annual only</option>
              <option value="monthly">Monthly only</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Duration</label>
            <select className={inputCls} value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value="once">First payment only</option>
              <option value="repeating">First N months</option>
              <option value="forever">Every payment (forever)</option>
            </select>
          </div>
          {duration === 'repeating' && (
            <div>
              <label className={labelCls}>Number of months</label>
              <input className={inputCls} type="number" min="1" value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} />
            </div>
          )}
          <div>
            <label className={labelCls}>Max redemptions (blank = unlimited)</label>
            <input className={inputCls} type="number" min="1" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="500" />
          </div>
          <div>
            <label className={labelCls}>Expires (blank = no end date)</label>
            <input className={inputCls} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={creating || !code.trim()} className="bg-plum hover:bg-plum-pressed disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm transition-colors">
              {creating ? 'Creating…' : 'Create code'}
            </button>
          </div>
        </form>
        {createError && <p className="text-sm text-coral mt-3">{createError}</p>}
        {createdMsg && <p className="text-sm text-sage mt-3">{createdMsg}</p>}
      </div>

      {/* List */}
      <div className="bg-white rounded-2xl p-5 shadow-[var(--shadow-sm)]">
        <h2 className="font-display text-lg font-semibold text-charcoal mb-3">All codes</h2>
        {listError && <p className="text-sm text-coral mb-3">{listError}</p>}
        {loading ? (
          <p className="text-sm text-warm-grey">Loading…</p>
        ) : codes.length === 0 ? (
          <p className="text-sm text-warm-grey">No codes yet. Create one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-warm-grey border-b border-cream-border">
                  <th className="py-2 pr-3 font-semibold">Code</th>
                  <th className="py-2 pr-3 font-semibold">Discount</th>
                  <th className="py-2 pr-3 font-semibold">Plan</th>
                  <th className="py-2 pr-3 font-semibold">Redeemed</th>
                  <th className="py-2 pr-3 font-semibold">Expires</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const expired = c.expires_at && new Date(c.expires_at) < new Date();
                  const exhausted = c.max_redemptions != null && c.times_redeemed >= c.max_redemptions;
                  const live = c.active && !expired && !exhausted;
                  return (
                    <Fragment key={c.id}>
                      <tr className="border-b border-cream-border/40">
                        <td className="py-2.5 pr-3 font-semibold text-charcoal uppercase tracking-wide">{c.code}</td>
                        <td className="py-2.5 pr-3 text-cocoa whitespace-nowrap">{discountLabel(c)}</td>
                        <td className="py-2.5 pr-3 text-cocoa whitespace-nowrap">{c.restricted_products ? 'restricted' : 'any'}</td>
                        <td className="py-2.5 pr-3 text-cocoa whitespace-nowrap">{c.times_redeemed}{c.max_redemptions != null ? ` / ${c.max_redemptions}` : ''}</td>
                        <td className="py-2.5 pr-3 text-cocoa whitespace-nowrap">{fmtDate(c.expires_at)}</td>
                        <td className="py-2.5 pr-3">
                          <span style={{ background: live ? '#EDF5EE' : '#FDF0EB', color: live ? '#3C7842' : '#B14828', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 8, whiteSpace: 'nowrap' }}>
                            {!c.active ? 'Disabled' : exhausted ? 'Fully claimed' : expired ? 'Expired' : 'Live'}
                          </span>
                        </td>
                        <td className="py-2.5 text-right whitespace-nowrap">
                          <button type="button" onClick={() => handleToggle(c)} disabled={togglingId === c.id} className="text-xs font-medium text-plum hover:underline disabled:opacity-50">
                            {togglingId === c.id ? '…' : c.active ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                      <tr className="border-b border-cream-border/60">
                        <td colSpan={7} className="pb-3 pt-0 pl-0">
                          <div className="flex flex-col sm:flex-row gap-3 sm:gap-6 bg-cream/60 rounded-lg px-3 py-2">
                            <CopyLink label="Flyer / QR link" url={fairLink(c.code)} copyKey={`${c.id}:fair`} copiedKey={copiedKey} onCopy={copyToClipboard} />
                            <CopyLink label="Apple redeem link" url={appleOfferCodeRedeemUrl(c.code)} copyKey={`${c.id}:apple`} copiedKey={copiedKey} onCopy={copyToClipboard} />
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
