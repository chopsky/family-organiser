/**
 * Premium paywall - the redesigned Subscribe screen (design handoff
 * design_handoff_premium_paywall, 2026-08-27). One viewport at rest:
 * gradient hero, tinted benefit rows, family-coverage line, radio plan
 * cards, promo flow, docked gradient CTA whose price follows plan +
 * coupon.
 *
 * Purely presentational + local promo/plan state. Platform pages
 * (IosSubscribe / AndroidSubscribe) own ALL billing: they pass real
 * StoreKit/Play prices, validate promo codes server-side, and receive
 * onPurchase(planKey, appliedPromo). Handoff purples are mapped into
 * the brand plum ramp per the founder's rule (#6d38ad family), not the
 * spec's #6C3DD9.
 *
 * Apple 3.1.2(c): the fine-print row keeps the full auto-renew
 * disclosure + Terms/Privacy near the purchase button, and each plan
 * card's sub names the billed amount and period.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Avatar from './ui/Avatar';
import {
  IconSparkles, IconFileText, IconBell, IconCalendar, IconReceipt, IconX, IconCheck,
} from './Icons';

const BRAND_GRADIENT = 'linear-gradient(135deg, var(--color-plum) 0%, var(--color-plum-bright) 100%)';
const PLUM_SHADOW = (a) => `rgba(109,56,173,${a})`;

const BENEFITS = [
  { Icon: IconSparkles, tint: 'var(--color-plum)', soft: 'var(--color-plum-light)', title: 'Unlimited AI', sub: 'Ask by text, photo or voice note' },
  { Icon: IconFileText, tint: 'var(--color-sky)', soft: 'var(--color-sky-light)', title: 'School letters, handled', sub: 'Snap or forward - dates land themselves' },
  { Icon: IconBell, tint: 'var(--color-amber)', soft: 'var(--color-amber-light)', title: 'Morning & evening briefs', sub: 'Plus the Sunday weekly digest' },
  { Icon: IconCalendar, tint: 'var(--color-sage)', soft: 'var(--color-sage-light)', title: 'Every calendar in one place', sub: 'Google, Apple & Outlook, live-synced' },
  { Icon: IconReceipt, tint: 'var(--color-rose)', soft: 'var(--color-rose-light)', title: 'Document vault', sub: 'Paperwork & memories, attached to their events' },
];

/** Format an amount in the product's own currency; null when we can't -
 *  callers then skip discount maths rather than invent numbers. */
function fmtCurrency(amount, currencyCode) {
  if (typeof amount !== 'number' || !currencyCode) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: currencyCode,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch { return null; }
}

function PlanCard({ selected, onSelect, label, badge, price, per, sub }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${label} plan, ${price || 'price unavailable'} ${per}. ${sub}`}
      onClick={onSelect}
      className="relative flex-1 text-left bg-white transition-all duration-150"
      style={{
        borderRadius: 18, padding: '14px 14px 12px', cursor: 'pointer',
        border: selected ? '2px solid var(--color-plum)' : '2px solid rgba(26,22,32,0.08)',
        boxShadow: selected ? `0 6px 18px ${PLUM_SHADOW(0.16)}` : '0 1px 0 rgba(26,22,32,0.03)',
      }}
    >
      {badge && (
        <span
          className="absolute uppercase text-white font-extrabold"
          style={{
            top: -10, left: 12, background: 'var(--color-amber)', fontSize: 9.5,
            letterSpacing: '0.06em', padding: '3px 8px', borderRadius: 100,
            boxShadow: '0 3px 8px rgba(224,160,64,0.4)', whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </span>
      )}
      <div className="flex items-center justify-between" style={{ marginBottom: 7 }}>
        <span
          className="uppercase font-bold"
          style={{ fontSize: 11, letterSpacing: '0.08em', color: selected ? 'var(--color-plum-dark)' : '#8A8493' }}
        >
          {label}
        </span>
        <span
          aria-hidden="true"
          className="transition-all duration-150"
          style={{
            width: 18, height: 18, borderRadius: '50%', boxSizing: 'border-box', background: '#fff',
            border: selected ? '5.5px solid var(--color-plum)' : '1.5px solid rgba(26,22,32,0.12)',
          }}
        />
      </div>
      <div className="flex items-baseline" style={{ gap: 3 }}>
        <span style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 24, letterSpacing: -0.3, color: 'var(--color-charcoal, #1A1620)' }}>
          {price || '—'}
        </span>
        <span className="font-semibold" style={{ fontSize: 12, color: '#8A8493' }}>{per}</span>
      </div>
      <div className="font-medium" style={{ fontSize: 11.5, color: '#8A8493', marginTop: 2 }}>{sub}</div>
    </button>
  );
}

/**
 * Props (all display strings pre-localised by the platform page):
 *   members            [{ name, color_theme, avatar_url }] - whole household
 *   monthly / annual   { available, perMonth, sub, ctaPrice, amount, currencyCode }
 *                      amount+currencyCode numeric for discount maths (optional)
 *   onPurchase(plan, promo)   promo = { code, percentOff } | null
 *   onRestore(), onClose()
 *   validatePromo(code) -> Promise<{ valid, code, percentOff } | { valid:false }>
 *   initialPromoCode   optional code to auto-validate on mount (signup campaign)
 *   busy               truthy while purchase/restore in flight (disables actions)
 *   confirming         "Confirming your subscription…" line
 *   error / onDismissError
 *   finePrint          ReactNode - platform-specific auto-renew disclosure
 */
export default function PremiumPaywall({
  members = [], monthly, annual,
  onPurchase, onRestore, onClose, validatePromo, initialPromoCode = null,
  busy = false, confirming = false, error = '', onDismissError,
  finePrint = null,
}) {
  const [plan, setPlan] = useState('annual'); // annual pre-selected per spec
  const [promo, setPromo] = useState('closed'); // closed | open | checking | applied
  const [code, setCode] = useState('');
  const [applied, setApplied] = useState(null); // { code, percentOff }
  const [promoError, setPromoError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (promo === 'open') inputRef.current?.focus(); }, [promo]);

  // A campaign code captured at signup pre-fills the applied chip - the
  // family sees their discount without typing anything.
  useEffect(() => {
    if (!initialPromoCode || !validatePromo) return;
    let cancelled = false;
    validatePromo(initialPromoCode).then((res) => {
      if (!cancelled && res?.valid) { setApplied({ code: res.code || initialPromoCode, percentOff: res.percentOff }); setPromo('applied'); }
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPromoCode]);

  async function applyCode() {
    const trimmed = code.trim();
    if (!trimmed || promo === 'checking') return;
    setPromo('checking');
    setPromoError('');
    try {
      const res = await validatePromo(trimmed);
      if (res?.valid) {
        setApplied({ code: res.code || trimmed, percentOff: res.percentOff });
        setPromo('applied');
      } else {
        setPromo('open');
        setPromoError("That code isn't valid.");
      }
    } catch {
      setPromo('open');
      setPromoError("Couldn't check that code. Try again.");
    }
  }

  const active = plan === 'annual' ? annual : monthly;
  const percentOff = applied?.percentOff ?? null;
  const discounted = percentOff != null && typeof active?.amount === 'number' && active?.currencyCode
    ? fmtCurrency(active.amount * (1 - percentOff / 100), active.currencyCode)
    : null;
  const perSuffix = plan === 'annual' ? '/yr' : '/mo';
  const ctaAvailable = !!active?.available && !!active?.ctaPrice;

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--color-cream, #FBF8F3)', zIndex: 40 }}>
      {/* Soft brand glow behind the header */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          top: -140, left: '50%', transform: 'translateX(-50%)', width: 460, height: 340,
          borderRadius: '50%', background: `radial-gradient(closest-side, ${PLUM_SHADOW(0.16)}, ${PLUM_SHADOW(0)})`,
        }}
      />

      {/* Top bar */}
      <div
        className="relative z-10 flex items-center justify-between"
        style={{ padding: 'calc(env(safe-area-inset-top, 0px) + 12px) 20px 0' }}
      >
        <button
          type="button" onClick={onClose} disabled={busy} aria-label="Close"
          className="flex items-center justify-center"
          style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(26,22,32,0.06)', border: 0, cursor: 'pointer' }}
        >
          <IconX className="h-4 w-4" style={{ color: '#4A4453' }} />
        </button>
        <button
          type="button" onClick={onRestore} disabled={busy}
          className="font-semibold"
          style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 13.5, color: '#8A8493', padding: '6px 2px' }}
        >
          {busy === 'restore' ? 'Restoring…' : 'Restore'}
        </button>
      </div>

      {/* Scrollable content (no scroll at rest on standard devices) */}
      <div className="relative z-[1] flex-1 overflow-y-auto" style={{ padding: '10px 22px 0', scrollbarWidth: 'none' }}>
        {/* Header */}
        <div className="text-center" style={{ paddingBottom: 8 }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: 50, height: 50, borderRadius: 16, margin: '0 auto 11px',
              background: BRAND_GRADIENT, transform: 'rotate(-4deg)',
              boxShadow: `0 10px 24px ${PLUM_SHADOW(0.35)}, inset 0 2px 0 rgba(255,255,255,0.3)`,
            }}
          >
            <IconSparkles className="h-6 w-6 text-white" />
          </div>
          <div className="uppercase font-bold" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--color-plum-dark)', marginBottom: 6 }}>
            Housemait Premium
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif-display)', fontWeight: 400, fontSize: 31, lineHeight: 1.08, letterSpacing: -0.4, color: '#1A1620' }}>
            Everything, <em style={{ color: 'var(--color-plum)' }}>unlimited.</em>
          </h1>
          <p className="font-medium mx-auto" style={{ fontSize: 13.5, color: '#4A4453', lineHeight: 1.4, maxWidth: 300, marginTop: 8 }}>
            Housemait stays free for your family. Premium takes the lid off the assistant.
          </p>
        </div>

        {error && (
          <div role="alert" className="rounded-xl bg-coral-light text-coral text-sm px-4 py-3 mb-2 flex items-start justify-between gap-3">
            <span>{error}</span>
            {onDismissError && (
              <button type="button" onClick={onDismissError} aria-label="Dismiss error" className="shrink-0"><IconX className="h-4 w-4" /></button>
            )}
          </div>
        )}
        {confirming && (
          <p className="text-center text-sm mb-2" style={{ color: '#8A8493' }}>Confirming your subscription…</p>
        )}

        {/* Benefits card */}
        <div
          className="bg-white"
          style={{ borderRadius: 22, padding: '6px 16px', boxShadow: '0 1px 0 rgba(26,22,32,0.04), 0 4px 14px rgba(26,22,32,0.04)' }}
        >
          {BENEFITS.map((b, i) => (
            <div key={b.title}>
              {i > 0 && <div style={{ height: 1, background: 'rgba(26,22,32,0.07)' }} />}
              <div className="flex items-center" style={{ gap: 13, padding: '6px 0' }}>
                <div className="flex items-center justify-center shrink-0" style={{ width: 36, height: 36, borderRadius: 12, background: b.soft }}>
                  <b.Icon className="h-[18px] w-[18px]" style={{ color: b.tint }} />
                </div>
                <div className="min-w-0">
                  <div className="font-bold" style={{ fontSize: 14.5, letterSpacing: -0.2, color: '#1A1620' }}>{b.title}</div>
                  <div className="font-medium" style={{ fontSize: 12.5, color: '#8A8493', marginTop: 1 }}>{b.sub}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Family coverage */}
        {members.length > 1 && (
          <div className="flex items-center justify-center" style={{ gap: 10, padding: '8px 0' }}>
            <div className="flex" aria-hidden="true">
              {members.slice(0, 6).map((m, i) => (
                <div key={m.id || m.name || i} style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: '50%', border: '2px solid var(--color-cream, #FBF8F3)' }}>
                  <Avatar member={m} size={24} />
                </div>
              ))}
            </div>
            <span className="font-semibold whitespace-nowrap" style={{ fontSize: 12.5, color: '#4A4453' }}>
              One plan covers all {members.length} of you
            </span>
          </div>
        )}

        {/* Plan picker */}
        <div role="radiogroup" aria-label="Choose a plan" className="flex" style={{ gap: 10, paddingTop: members.length > 1 ? 4 : 12 }}>
          <PlanCard
            selected={plan === 'annual'} onSelect={() => setPlan('annual')}
            label="Annual" badge="2 months free"
            price={annual?.perMonth} per="/mo" sub={annual?.sub || 'Billed once a year'}
          />
          <PlanCard
            selected={plan === 'monthly'} onSelect={() => setPlan('monthly')}
            label="Monthly"
            price={monthly?.perMonth} per="/mo" sub={monthly?.sub || 'Pay as you go'}
          />
        </div>

        {/* Promo code - only where the platform can actually honour a
            discount (iOS via Apple offer codes; Play has no equivalent). */}
        {validatePromo && promo === 'closed' && (
          <div className="text-center" style={{ paddingTop: 10 }}>
            <button
              type="button" onClick={() => { setPromo('open'); setPromoError(''); }}
              className="font-semibold underline"
              style={{ background: 'transparent', border: 0, cursor: 'pointer', fontSize: 12.5, color: '#8A8493', textUnderlineOffset: 3 }}
            >
              Have a promo code?
            </button>
          </div>
        )}
        {validatePromo && (promo === 'open' || promo === 'checking') && (
          <>
            <div className="flex" style={{ gap: 8, paddingTop: 10 }}>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setPromoError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') applyCode(); }}
                placeholder="Enter promo code"
                aria-label="Promo code"
                autoCapitalize="characters" autoCorrect="off" spellCheck="false"
                className="flex-1 min-w-0 bg-white font-semibold outline-none"
                style={{ border: '1.5px solid rgba(26,22,32,0.12)', borderRadius: 14, padding: '11px 14px', fontSize: 14, letterSpacing: '0.04em', color: '#1A1620' }}
              />
              <button
                type="button" onClick={applyCode} disabled={!code.trim() || promo === 'checking'}
                className="text-white font-bold transition-colors"
                style={{ border: 0, cursor: 'pointer', background: code.trim() ? '#1A1620' : 'rgba(26,22,32,0.12)', fontSize: 13.5, padding: '0 18px', borderRadius: 14 }}
              >
                {promo === 'checking' ? '…' : 'Apply'}
              </button>
            </div>
            {promoError && <p role="alert" className="text-coral" style={{ fontSize: 12, marginTop: 6 }}>{promoError}</p>}
          </>
        )}
        {validatePromo && promo === 'applied' && applied && (
          <div
            className="flex items-center"
            style={{ gap: 9, background: 'var(--color-sage-light)', border: '1px solid rgba(125,174,130,0.45)', borderRadius: 14, padding: '9px 12px', marginTop: 10 }}
          >
            <span className="flex items-center justify-center shrink-0" style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--color-sage)' }}>
              <IconCheck className="h-3 w-3 text-white" />
            </span>
            <span className="flex-1 min-w-0 font-semibold" style={{ fontSize: 12.5, color: '#3F6E3D' }}>
              <b>{applied.code}</b> applied{applied.percentOff != null ? ` - ${applied.percentOff}% off your first ${plan === 'annual' ? 'year' : 'month'}` : ''}
            </span>
            <button
              type="button" aria-label="Remove promo code"
              onClick={() => { setPromo('closed'); setCode(''); setApplied(null); }}
              className="flex" style={{ background: 'transparent', border: 0, cursor: 'pointer', padding: 2 }}
            >
              <IconX className="h-[13px] w-[13px]" style={{ color: '#3F6E3D' }} />
            </button>
          </div>
        )}
        <div style={{ height: 8 }} />
      </div>

      {/* CTA dock */}
      <div
        className="relative z-10"
        style={{ padding: '12px 22px 6px', background: 'linear-gradient(to top, var(--color-cream, #FBF8F3) 70%, rgba(251,248,243,0))' }}
      >
        <button
          type="button"
          onClick={() => onPurchase(plan, applied)}
          disabled={busy || !ctaAvailable}
          className="w-full text-white font-bold disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.99] transition-transform"
          style={{
            border: 0, cursor: 'pointer', background: BRAND_GRADIENT,
            fontSize: 16.5, letterSpacing: -0.2, padding: '16px 20px', borderRadius: 18,
            boxShadow: `0 12px 28px ${PLUM_SHADOW(0.4)}, inset 0 2px 0 rgba(255,255,255,0.28)`,
          }}
        >
          {busy && busy !== 'restore' ? 'Processing…' : (
            <>
              Start Premium —{' '}
              {discounted && (
                <span style={{ textDecoration: 'line-through', opacity: 0.55, fontWeight: 600 }}>{active?.ctaPrice}</span>
              )}{discounted ? ' ' : ''}
              {ctaAvailable ? `${discounted || active.ctaPrice}${perSuffix}` : 'Unavailable'}
            </>
          )}
        </button>
        <div
          className="flex items-center justify-center flex-wrap text-center font-medium"
          style={{ columnGap: 14, rowGap: 2, fontSize: 11.5, color: '#8A8493', padding: '8px 0 max(env(safe-area-inset-bottom, 0px), 14px)' }}
        >
          {finePrint || (
            <>
              <span>Auto-renews · Cancel anytime</span>
              <Link to="/terms" className="underline" style={{ textUnderlineOffset: 2 }}>Terms</Link>
              <Link to="/privacy" className="underline" style={{ textUnderlineOffset: 2 }}>Privacy</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
