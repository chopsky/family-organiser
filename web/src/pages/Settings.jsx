import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import WhatsAppPairing from '../components/WhatsAppPairing';
import DeviceCalendarSync from '../components/DeviceCalendarSync';
import GoogleCalendarConnect from '../components/GoogleCalendarConnect';
import { isDeviceCalendarSupported } from '../lib/deviceCalendar';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
import { isIos, isAndroid } from '../lib/platform';
import { iapKeyPresent } from '../lib/revenuecat';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import { FEED_PROVIDERS } from '../lib/feedProviders';
import {
  IconMessageCircle, IconCalendar, IconMail, IconBell,
  IconDownload, IconShield, IconUser, IconTrash, IconChevronRight, IconX, IconMapPin, IconStar,
} from '../components/Icons';
import { LOCALES, getLocaleByCountry } from '../lib/locales';
import { readLocaleCookie } from '../hooks/useLocale';
import { openWriteReview } from '../lib/appReview';
import { useSubscription } from '../context/SubscriptionContext';
import PageHeader from '../components/ui/PageHeader';
import Avatar from '../components/ui/Avatar';
import { MEMBER_HEX } from '../lib/memberColors';
import { useChildMode } from '../context/ChildModeContext';
import useHasChildren from '../hooks/useHasChildren';
import {
  getLocationPermission, requestLocationPermission, openLocationSettings, clearLocationCache,
} from '../lib/location';

// Canonical 16-colour palette - same order as the member-theme picker
// in FamilySetup so the two pickers feel consistent and a user who's
// already coloured the household members has the same swatches to
// pick from when colouring a subscribed calendar.
const FEED_COLOR_PALETTE = [
  'red', 'burnt-orange', 'amber', 'gold',
  'leaf', 'emerald', 'teal', 'sky',
  'cobalt', 'indigo', 'purple', 'magenta',
  'rose', 'terracotta', 'moss', 'slate',
];
// Hex map for the swatch backgrounds - mirrors index.css --color-* vars.
const FEED_COLOR_HEX = {
  red: '#E25555', 'burnt-orange': '#E07A3A', amber: '#E8A040', gold: '#C5A833',
  leaf: '#7BAE4E', emerald: '#3A9E6E', teal: '#3AADA0', sky: '#4A9FCC',
  cobalt: '#3A6FD4', indigo: '#6558C7', purple: '#9050B5', magenta: '#C74E95',
  rose: '#E06888', terracotta: '#C47A5E', moss: '#7C8A6E', slate: '#7A8694',
};

/**
 * Live paste feedback for the add-calendar wizard: spot the URLs people
 * paste when they meant the iCal address. Client-side mirror of the
 * server's classifyFeedUrlMistake (src/services/externalFeed.js) - keep the
 * two in step - so the hint appears as they paste instead of after submit.
 * Returns { level: 'block' | 'warn', message } or null.
 */
function feedUrlHint(rawUrl) {
  const url = (rawUrl || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  if (host === 'calendar.google.com') {
    if (path.startsWith('/calendar/embed')) {
      return { level: 'block', message: 'That\'s Google\'s embed link (for websites). Copy "Secret address in iCal format" instead - it\'s under Integrate calendar on the same page.' };
    }
    if (/^\/calendar(\/u\/\d+)?\/r(\/|$)/.test(path)) {
      return { level: 'block', message: 'That\'s the settings page\'s own URL. On that page, scroll to Integrate calendar and copy "Secret address in iCal format".' };
    }
    if (/\/public\/basic\.ics$/i.test(path)) {
      return { level: 'warn', message: 'Heads-up: this is the Public address, which only works if the calendar is made public. The "Secret address in iCal format" (just below it) works without that.' };
    }
    return null;
  }
  if ((host === 'outlook.live.com' || host === 'outlook.office.com' || host === 'outlook.office365.com')
      && path.startsWith('/calendar') && !/\.ics$/i.test(path)) {
    return { level: 'block', message: 'That\'s the Outlook page\'s own URL. Use "Publish a calendar" in Outlook\'s Shared calendars settings and copy the ICS link it shows.' };
  }
  if (host === 'icloud.com' || host === 'www.icloud.com') {
    return { level: 'block', message: 'That\'s the iCloud website URL. In iCloud Calendar, click the share icon next to the calendar, tick "Public Calendar", and copy the webcal:// link.' };
  }
  return null;
}

/**
 * Small provider tiles for the add-calendar picker - simplified,
 * brand-evocative glyphs drawn inline (no external logo assets). Used at
 * 28px in the menu rows and the empty-state card.
 */
function ProviderLogo({ id, size = 28 }) {
  const s = { width: size, height: size, flexShrink: 0 };
  if (id === 'google') {
    // Google Calendar (2020): a white page with the four Google brand colours
    // on its edges (blue TL, red TR, green BL, yellow BR) and a blue "31".
    return (
      <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
        <defs>
          <clipPath id="gcal-card"><rect x="1.5" y="1.5" width="21" height="21" rx="3.5" /></clipPath>
        </defs>
        <g clipPath="url(#gcal-card)">
          <rect x="1.5" y="1.5" width="10.5" height="10.5" fill="#4285F4" />
          <rect x="12" y="1.5" width="10.5" height="10.5" fill="#EA4335" />
          <rect x="1.5" y="12" width="10.5" height="10.5" fill="#34A853" />
          <rect x="12" y="12" width="10.5" height="10.5" fill="#FBBC04" />
        </g>
        <rect x="3.3" y="3.3" width="17.4" height="17.4" rx="1.6" fill="#fff" />
        <text x="12" y="16.2" textAnchor="middle" fontSize="8.4" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text>
      </svg>
    );
  }
  if (id === 'apple') {
    return (
      <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#fff" stroke="#E8E5EC" strokeWidth="1" />
        <text x="12" y="7.8" textAnchor="middle" fontSize="4.4" fontWeight="700" fill="#E25555" fontFamily="Arial, sans-serif">MON</text>
        <text x="12" y="18.4" textAnchor="middle" fontSize="10.5" fontWeight="500" fill="#2D2A33" fontFamily="Arial, sans-serif">25</text>
      </svg>
    );
  }
  if (id === 'outlook') {
    // Microsoft Outlook: the blue "O" panel + calendar grid (the real icon).
    return (
      <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
        <path fill="#1976d2" d="M28,13h14.533C43.343,13,44,13.657,44,14.467v19.066C44,34.343,43.343,35,42.533,35H28V13z" />
        <rect width="14" height="15.542" x="28" y="17.958" fill="#fff" />
        <polygon fill="#1976d2" points="27,44 4,39.5 4,8.5 27,4" />
        <path fill="#fff" d="M15.25,16.5c-3.176,0-5.75,3.358-5.75,7.5s2.574,7.5,5.75,7.5S21,28.142,21,24S18.426,16.5,15.25,16.5z M15,28.5c-1.657,0-3-2.015-3-4.5s1.343-4.5,3-4.5s3,2.015,3,4.5S16.657,28.5,15,28.5z" />
        <rect width="2.7" height="2.9" x="28.047" y="29.737" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="29.737" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="29.737" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="28.047" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="38.25" y="26.159" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="28.047" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="38.25" y="22.706" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="31.448" y="19.112" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="34.849" y="19.112" fill="#1976d2" />
        <rect width="2.7" height="2.9" x="38.25" y="19.112" fill="#1976d2" />
      </svg>
    );
  }
  // School / club link
  return (
    <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="#7DAE82" />
      <path d="M10.2 13.8 13.8 10.2 M9 11.5l-2 2a2.6 2.6 0 0 0 3.7 3.7l2-2 M15 12.5l2-2a2.6 2.6 0 0 0-3.7-3.7l-2 2" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One quiet disclosure row for the Connect Calendars section. Everything
 * that isn't the primary "get your events in" action sits behind one of
 * these - visible and one tap away, but never competing with the hero.
 * Expanding is local state, so each row remembers nothing across visits
 * (deliberate: the screen should always reopen calm).
 */
function CollapsibleRow({ icon, label, sub, defaultOpen = false, className = '', children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white border border-cream-border rounded-2xl overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-oat transition-colors text-left"
      >
        {icon && <span className="text-base" aria-hidden="true">{icon}</span>}
        <span className="flex-1 text-sm text-bark">
          {label}
          {sub != null && <span className="text-cocoa"> · {sub}</span>}
        </span>
        <span className={`text-cocoa transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

// FEED_PROVIDERS now lives in ../lib/feedProviders so the onboarding calendar
// step and this add-calendar form share one source.

// ── Settings design system (design_handoff_settings) ────────────────
// Reusable card + Row styling: white 18px-radius card with a hairline
// border and soft double shadow; an uppercase section label above it;
// rows of title/sub + a right-side control, split by hairline dividers.
const SET_CARD_SHADOW = '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)';
const SET_CARD_CLASS = 'bg-white rounded-[18px] border border-[rgba(26,22,32,0.07)]';

function SectionLabel({ children }) {
  return (
    <div className="text-[11px] font-bold uppercase text-warm-grey mb-3 ml-1" style={{ letterSpacing: '0.1em' }}>
      {children}
    </div>
  );
}

function SetRow({ title, sub, control, last = false }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-[15px] ${last ? '' : 'border-b border-[rgba(26,22,32,0.07)]'}`}>
      <div className="min-w-0">
        <div className="text-sm font-medium text-bark">{title}</div>
        {sub && <div className="text-xs text-warm-grey mt-0.5">{sub}</div>}
      </div>
      {control}
    </div>
  );
}

// Outlined select-style button (value + chevron-down) used as a row control.
function SelectBtn({ value, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-3 py-[7px] rounded-[9px] border border-[rgba(26,22,32,0.12)] bg-white text-[13px] font-semibold text-cocoa whitespace-nowrap disabled:opacity-50 hover:bg-oat transition-colors"
    >
      {value}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-warm-grey"><path d="M6 9l6 6 6-6" /></svg>
    </button>
  );
}

/**
 * Settings → Profile card (settings handoff). One card: an identity
 * header (avatar + name + email · role + Edit profile pill), then a
 * divider and the Family plan + Billing rows wired to the real
 * subscription:
 *
 *   • internal  → "Internal" badge, no billing controls
 *   • trialing  → "Free trial" badge + days left + Subscribe CTA
 *   • active    → "✦ Premium" badge + real locale price + Manage
 *   • expired   → "Ended" badge + Subscribe CTA
 *
 * Billing controls stay owner-only (server enforces this too).
 */
function ProfileCard({ me, members }) {
  const { isActive, isTrialing, isExpired, isInternal, plan, provider, daysRemaining, trialEndsAt, loading } = useSubscription();
  // Billing is owner-only: non-owners see the plan status but not the
  // subscribe/manage controls (the server also enforces this).
  const { isOwner, user, household } = useAuth();
  const navigate = useNavigate();
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState('');

  // Phase 3 (IAP rebuild): the iOS-hide hack is gone. iOS users now see
  // their real subscription state and a working Manage button. The
  // Manage button routes by `provider` (see openCustomerPortal) - Apple
  // subscribers deep-link to their Apple ID subscriptions; Stripe
  // subscribers (e.g. someone who subscribed on web and later opened
  // the iOS app) hit the Stripe portal as before.

  // NB: there's no "trial reminder emails" toggle here. PECR covers us
  // as long as the email-footer unsubscribe link works, and the footer
  // link already flips trial_emails_enabled=false via /api/unsubscribe.
  // Surfacing a duplicate toggle in Settings didn't add value and gave
  // users two ways to disable (one of which only they'd discover).
  // If you ever want to re-add it, the PATCH /api/settings/settings
  // endpoint still accepts trial_emails_enabled - just wire a UI back.

  // Manage-subscription button routing depends on which platform the
  // household is billed through:
  //   • Apple   → deep-link to iOS's subscription management screen.
  //               itms-apps://apps.apple.com/account/subscriptions opens
  //               the Settings → Apple ID → Subscriptions panel directly
  //               in the App Store app on iOS. Same URL works inside the
  //               Capacitor WebView (window.location triggers the
  //               external scheme handler).
  //   • Stripe  → open the Stripe customer portal (current default).
  //
  // We don't need to handle "isIos() && provider==='stripe'" specially -
  // a household billed through Stripe but accessed via iOS still has a
  // valid Stripe portal URL; we just open it. (App Review concerns about
  // anti-steering apply to the Subscribe flow, not to managing an
  // existing subscription.)
  async function openCustomerPortal() {
    if (portalLoading) return;

    if (provider === 'apple') {
      // Universal deep link - works inside Capacitor WebView and Safari.
      // No API round-trip needed; iOS handles the URL natively.
      window.location.href = 'itms-apps://apps.apple.com/account/subscriptions';
      return;
    }

    if (provider === 'google') {
      // Play's subscription-management page for OUR subscription. On an
      // Android device this opens the Play Store app; on web/iOS it opens
      // Play's web account page - both let the user manage/cancel.
      window.location.href =
        'https://play.google.com/store/account/subscriptions?package=com.housemait.app';
      return;
    }

    setPortalLoading(true);
    setPortalError('');
    try {
      const { data } = await api.post('/subscription/portal');
      if (!data?.url) throw new Error('Portal URL missing');
      window.location.href = data.url;
    } catch (err) {
      console.error('[Settings] portal open failed:', err);
      setPortalError(err.response?.data?.error || 'Could not open the portal. Try again?');
      setPortalLoading(false);
    }
  }

  // Real locale price so the plan badge shows what the household actually
  // pays (same cascade as /subscribe: household country → locale cookie →
  // international default).
  const locale = (household?.country && getLocaleByCountry(household.country))
    || LOCALES[readLocaleCookie()] || LOCALES.default;
  const priceLabel = plan === 'annual'
    ? `${locale.pricing.annual}/yr`
    : `${locale.pricing.monthly}/mo`;

  const subStateKnown = isActive || isTrialing || isExpired || isInternal;
  const fmtDate = (d) => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
  }).format(new Date(d));

  const badge = (label, cls) => (
    <span className={`inline-flex items-center gap-1.5 px-[11px] py-1 rounded-full text-[12.5px] font-bold ${cls}`}>{label}</span>
  );
  const planBadge = isInternal ? badge('Internal', 'bg-plum-light text-plum')
    : isActive ? badge(<><span className="text-[13px]">✦</span> Premium</>, 'bg-plum-light text-plum')
    : isTrialing ? badge('Free trial', 'bg-plum-light text-plum')
    : isExpired ? badge('Ended', 'bg-coral-light text-coral')
    : null;
  const planMeta = isInternal ? null
    : isActive ? priceLabel
    : isTrialing && daysRemaining != null ? `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`
    : null;

  const isAndroidPlatform = isAndroid();
  // Android can only offer purchase once Play Billing is configured
  // (RevenueCat Google key baked into the build). Without it, no
  // Subscribe CTA and neutral expired copy (Play payments policy).
  const androidCanPurchase = !isAndroidPlatform || iapKeyPresent();
  const billingSub = isInternal ? 'No billing applies to this household'
    : isTrialing ? (trialEndsAt ? `Trial ends ${fmtDate(trialEndsAt)}` : 'Subscribe any time to avoid interruption')
    : isActive ? (provider === 'apple' ? 'Billed through your Apple ID' : provider === 'google' ? 'Billed through Google Play' : 'Billed by card via Stripe')
    : isExpired ? (androidCanPurchase ? "Your data's still here - subscribe to unlock everything" : "Your data's still here and safe")
    : '';
  const billingControl = isInternal ? null
    : !isOwner
      ? <span className="text-xs text-warm-grey whitespace-nowrap">Managed by the owner</span>
      : isActive
        ? <SelectBtn value={portalLoading ? 'Opening…' : 'Manage'} onClick={openCustomerPortal} disabled={portalLoading} />
        : (isTrialing || isExpired)
          // Android: Subscribe CTA only once Play Billing is live in this
          // build (Play payments policy; /subscribe then shows the paywall).
          ? (!androidCanPurchase ? null : (
            <Link to="/subscribe" className="inline-flex items-center px-4 py-2 rounded-[11px] bg-plum hover:bg-plum-pressed text-white text-[13px] font-semibold transition-colors whitespace-nowrap">
              Subscribe
            </Link>
          ))
          : null;

  return (
    <div className={SET_CARD_CLASS} style={{ boxShadow: SET_CARD_SHADOW, overflow: 'hidden' }}>
      {/* Identity header */}
      <div className="flex items-center gap-[18px] p-[22px]">
        <Avatar member={me || user} size={60} />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-semibold text-bark truncate">{user?.name}</div>
          <div className="text-[13px] text-warm-grey mt-0.5 truncate">
            {[user?.email, me?.family_role || (isOwner ? 'Owner' : 'Member')].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/family?editProfile=1')}
          className="shrink-0 px-4 py-[9px] rounded-[10px] border border-[rgba(26,22,32,0.12)] bg-white text-[13px] font-semibold text-bark hover:bg-oat transition-colors whitespace-nowrap"
        >
          Edit profile
        </button>
      </div>

      {/* Plan + billing, from the real subscription. Hidden only while the
          state is still unknown - the identity header always renders. */}
      {(subStateKnown || !loading) && (
        <div className="border-t border-[rgba(26,22,32,0.07)]">
          <SetRow
            title="Family plan"
            sub={`${household?.name || 'Your household'} · ${members.length} ${members.length === 1 ? 'member' : 'members'}`}
            control={
              <div className="flex items-center gap-3">
                {planBadge}
                {planMeta && <span className="text-[13px] font-semibold text-warm-grey whitespace-nowrap">{planMeta}</span>}
              </div>
            }
          />
          <SetRow title="Billing" sub={billingSub} control={billingControl} last />
        </div>
      )}

      {portalError && <p className="text-sm text-coral px-5 pb-4">{portalError}</p>}
    </div>
  );
}


/**
 * AccordionItem - collapsible row. Uses native <details>/<summary> so
 * the browser owns open/close state (no React, no useState), and screen
 * readers already understand the disclosure pattern.
 *
 * Two visual modes:
 *   • Default: a row with a bottom divider, meant to live inside a
 *     shared <SettingsCard> container (mirrors the Help-page pattern
 *     where multiple <details> share one card with internal hairlines).
 *   • `danger`: free-standing coral-tinted card with its own border.
 *     Used by the Delete-account section so the destructive action
 *     stays visually separated from the rest of the panel.
 *
 * The chevron rotates via a CSS rule in index.css
 * (`details[open] > summary .acc-chevron`). Default: closed.
 *
 * name="settings-accordion" makes the browser treat every <details>
 * sharing this name as an exclusive group - opening one closes the
 * others. Native HTML feature (Safari 17.4+, Chrome 120+, Firefox
 * 119+). Older browsers ignore the attribute and just allow
 * multiple-open, which is the previous behaviour (graceful fallback).
 */
/**
 * SettingsCard - always-expanded standalone card, no collapse chrome.
 * Web layout uses this for every section EXCEPT Notifications + Active
 * sessions (which stay as accordions so the long lists they contain
 * can be hidden when not in use). Visually matches the My Profile /
 * Plan cards already on this page, and the section cards on the
 * Family page.
 */
function SettingsCard({ title, icon: IconCmp, danger = false, children }) {
  const baseStyle = danger
    ? { background: 'rgba(215, 99, 83, 0.04)', borderColor: 'rgba(215, 99, 83, 0.25)' }
    : { boxShadow: SET_CARD_SHADOW };
  const wrapClass = danger ? 'rounded-[18px] border p-5 md:p-6' : `${SET_CARD_CLASS} p-4.5 md:p-6`;
  const iconColor = danger ? 'text-error' : 'text-plum';
  const titleColor = danger ? 'text-error' : 'text-bark';
  return (
    <div className={wrapClass} style={baseStyle}>
      <div className="flex items-center gap-3 mb-3">
        {IconCmp && <IconCmp className={`w-4 h-4 md:w-5 md:h-5 shrink-0 ${iconColor}`} />}
        <h2 className={`flex-1 text-base md:text-medium font-semibold ${titleColor}`}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function AccordionItem({ title, icon: IconCmp, defaultOpen = false, danger = false, bare = false, children }) {
  // bare = render just the content with no title, no chevron, no collapse
  // chrome. Used by the iOS sub-page mode where the page header above
  // already shows the back arrow + section title, so the accordion's
  // own header would be redundant.
  if (bare) {
    return <div className="py-1">{children}</div>;
  }
  if (danger) {
    return (
      <details
        name="settings-accordion"
        className="rounded-2xl border"
        style={{ background: 'rgba(215, 99, 83, 0.04)', borderColor: 'rgba(215, 99, 83, 0.25)' }}
        open={defaultOpen}
      >
        <summary className="flex items-center gap-3 px-5 py-4 md:px-6 md:py-5 cursor-pointer select-none">
          {IconCmp && <IconCmp className="w-4 h-4 md:w-5 md:h-5 shrink-0 text-error" />}
          <h2 className="flex-1 text-base md:text-medium font-semibold text-bark">{title}</h2>
          <svg className="acc-chevron w-4 h-4 md:w-5 md:h-5 text-cocoa shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </summary>
        <div className="px-5 pb-5 md:px-6 md:pb-6">
          {children}
        </div>
      </details>
    );
  }
  return (
    <details name="settings-accordion" className="border-b border-cream-border last:border-b-0" open={defaultOpen}>
      <summary className="flex items-center gap-3 py-4 md:py-5 cursor-pointer select-none">
        {IconCmp && <IconCmp className="w-4 h-4 md:w-5 md:h-5 shrink-0 text-plum" />}
        <h2 className="flex-1 text-base md:text-medium font-semibold text-bark">{title}</h2>
        <svg className="acc-chevron w-4 h-4 md:w-5 md:h-5 text-cocoa shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </summary>
      <div className="pb-5 md:pb-6">
        {children}
      </div>
    </details>
  );
}

// Settings sub-pages on iOS - each row on the iOS settings landing
// navigates to /settings/<slug> which renders just that one section.
// `slug` is the URL fragment, `match` lists which AccordionItem title
// (or 'delete' for the danger one) belongs to this sub-page. Order
// here drives the order of the row list on the iOS landing.
// Child Mode is NOT in this list - it renders as a standalone gradient
// card on every platform (settings handoff), not behind a row + popup.
// `group` drives the labelled card grouping on the iOS landing so the
// list mirrors the web page's section labels.
const IOS_SECTIONS = [
  { slug: 'whatsapp',     title: 'Connect WhatsApp',  icon: 'IconMessageCircle', group: 'Connected services' },
  { slug: 'calendars',    title: 'Connect Calendars', icon: 'IconCalendar',      group: 'Connected services' },
  { slug: 'emails-to-ai', title: 'Send Emails to AI', icon: 'IconMail',          group: 'Connected services' },
  { slug: 'notifications',title: 'Notifications',     icon: 'IconBell',          group: 'Notifications & privacy' },
  { slug: 'location',     title: 'Location',          icon: 'IconMapPin',        group: 'Notifications & privacy' },
  { slug: 'sessions',     title: 'Active sessions',   icon: 'IconShield',        group: 'Notifications & privacy' },
  { slug: 'data',         title: 'Your data',         icon: 'IconDownload',      group: 'Account' },
  // `action` rows fire immediately instead of opening a popup - Rate
  // Housemait jumps straight to the App Store review composer.
  { slug: 'rate',         title: 'Rate Housemait',    icon: 'IconStar',          group: 'Account', action: openWriteReview },
  { slug: 'delete',       title: 'Delete account',    icon: 'IconTrash', danger: true, group: 'Account' },
];
const IOS_GROUPS = [...new Set(IOS_SECTIONS.map((s) => s.group))];
const IOS_SECTION_ICONS = {
  IconMessageCircle, IconCalendar, IconMail, IconBell, IconMapPin,
  IconShield, IconDownload, IconUser, IconTrash, IconStar,
};

export default function Settings() {
  // Management controls (e.g. the Send-Emails-to-AI allowlist) gate on
  // canManage - any adult member - per the collaborative model. Billing is
  // owner-only (isOwner), enforced on the server too.
  const { household, user, canManage: isAdmin, isOwner, login, logout, token, updateHousehold } = useAuth();
  const { enabled: childMode, enable: enableChildMode, disable: disableChildMode, pinIsSet } = useChildMode();
  const hasChildren = useHasChildren();
  const navigate = useNavigate();

  // ── Child Mode PIN management ──────────────────────────────────
  const [pinFormOpen, setPinFormOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState('');
  async function saveChildPin() {
    if (!/^\d{4,6}$/.test(pinDraft)) { setPinMsg('PIN must be 4 to 6 digits.'); return; }
    if (pinDraft !== pinConfirm) { setPinMsg("The two PINs don't match."); return; }
    setPinBusy(true); setPinMsg('');
    try {
      await api.post('/household/child-mode/pin', { pin: pinDraft });
      updateHousehold({ child_mode_pin_set: true });
      setPinFormOpen(false); setPinDraft(''); setPinConfirm('');
    } catch (err) {
      setPinMsg(err.response?.data?.error || 'Could not save PIN.');
    } finally { setPinBusy(false); }
  }
  async function removeChildPin() {
    if (childMode) return; // never strand a locked device with no PIN
    setPinBusy(true); setPinMsg('');
    try {
      await api.delete('/household/child-mode/pin');
      updateHousehold({ child_mode_pin_set: false });
    } catch (err) {
      setPinMsg(err.response?.data?.error || 'Could not remove PIN.');
    } finally { setPinBusy(false); }
  }

  // ── Child Mode launcher ("Whose turn is it?") ───────────────────
  // Start opens a per-child picker; choosing a kid shows a short
  // "Hi [name]! 👋" hand-off, seeds KidsShell's active kid, then locks
  // the device into Child Mode. Exit stays PIN-gated (ChildGate).
  const [pickKidOpen, setPickKidOpen] = useState(false);
  const [enteringKid, setEnteringKid] = useState(null);
  function launchChildModeFor(kid) {
    const go = () => {
      if (kid?.id) { try { localStorage.setItem('kidsActiveKid', kid.id); } catch { /* private browsing */ } }
      setPickKidOpen(false);
      setEnteringKid(null);
      if (enableChildMode()) navigate('/tasks');
    };
    if (!kid) return go(); // no dependents yet - skip the hand-off beat
    setEnteringKid(kid);
    setTimeout(go, 900);
  }
  function startChildMode() {
    if (!pinIsSet) {
      setPinFormOpen(true);
      setPinMsg('Set a PIN first - you need it to switch back out.');
      return;
    }
    setEnteringKid(null);
    setPickKidOpen(true);
  }

  // iOS native shell: the Settings landing is a list of section rows
  // (same surface as a sectioned iOS Settings.app screen). Tapping a
  // row opens a popup overlay for that section's content. Closing the
  // popup returns to the list. URL doesn't change - no deep linking,
  // back button does NOT close the popup (close affordance is the X
  // button in the popup header).
  //
  // On web (browser or PWA) the layout is unchanged: cards + accordion
  // sections all on one page.
  const isIosPlatform = isIos();
  const [popupSlug, setPopupSlug] = useState(null); // slug of section currently shown in popup, null = closed
  const iosPopupOpen   = isIosPlatform && !!popupSlug;
  const iosListMode    = isIosPlatform && !popupSlug;
  const popupSection   = iosPopupOpen ? IOS_SECTIONS.find((s) => s.slug === popupSlug) || null : null;

  // Close the popup whenever the platform changes away from iOS (e.g.
  // running in dev with platform mocking) so we never have a stuck
  // overlay. No-op in production.
  useEffect(() => {
    if (!isIosPlatform && popupSlug) setPopupSlug(null);
  }, [isIosPlatform, popupSlug]);

  // Deep link: /settings?section=<slug> opens that section directly - the
  // dashboard calendar nudge and stale-sync pushes land people on Connect
  // Calendars without hunting for it. iOS opens the section popup; web
  // scrolls to the card once the page has rendered.
  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get('section');
    // child-mode is a standalone card (not a popup section) on every
    // platform, so it always takes the scroll path.
    // Action rows (e.g. rate) have no popup/anchor - never deep-link them.
    if (!section || (section !== 'child-mode' && !IOS_SECTIONS.some((s) => s.slug === section && !s.action))) return undefined;
    if (isIosPlatform && section !== 'child-mode') {
      setPopupSlug(section);
      return undefined;
    }
    const t = setTimeout(() => {
      document.getElementById(`settings-section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(t);
    // Mount-only by design: the param is consumed once on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-section wrapper picker. Three rendering paths:
  //   1. iOS list mode (popup closed) - section is represented by a
  //      row in the list above, so this returns null.
  //   2. iOS popup mode for THIS slug - render as a fixed-position
  //      modal overlay with header (title + X close) and the section
  //      content scrollable below.
  //   3. iOS popup mode for ANOTHER slug - return null (only one
  //      popup at a time).
  //   4. Web - either AccordionItem (if accordion={true}) or
  //      SettingsCard (always-expanded standalone card).
  // Memoised so its component identity is STABLE across renders. Defined
  // inside Settings (it needs the iOS popup state), but without this every
  // keystroke would create a new SectionWrapper function -> React remounts
  // every section -> focused inputs lose focus -> the iOS keyboard dismisses.
  // Deps are only the iOS-mode values it closes over (none change while typing).
  const SectionWrapper = useCallback(function SectionWrapper({ slug, title, icon, danger, accordion, children }) {
    if (iosListMode) return null;
    if (iosPopupOpen) {
      if (popupSlug !== slug) return null;
      const titleColor = danger ? 'text-error' : 'text-bark';
      return (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-cream"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Popup header - title on the left, X on the right. Sticky
              so the title stays visible while the content scrolls. */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-cream-border bg-cream">
            <h2 className={`flex-1 text-base md:text-medium font-semibold truncate ${titleColor}`}>{title}</h2>
            <button
              type="button"
              onClick={() => setPopupSlug(null)}
              aria-label="Close"
              className="-mr-2 p-2 rounded-lg text-cocoa hover:text-bark hover:bg-oat transition-colors"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>
          {/* Content - scrollable. Wrapped in the same card visual as
              a SettingsCard on web so the section content has the
              breathing room it has everywhere else. */}
          <div className="flex-1 overflow-y-auto px-5 py-5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)' }}>
            <div
              className={danger ? 'rounded-2xl border p-5 md:p-6' : 'bg-linen rounded-2xl p-4.5 md:p-6'}
              style={danger
                ? { background: 'rgba(215, 99, 83, 0.04)', borderColor: 'rgba(215, 99, 83, 0.25)' }
                : { boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}
            >
              {children}
            </div>
          </div>
        </div>
      );
    }
    // The id anchors the ?section=<slug> deep link's scroll target on web.
    // The accordion wrapper carries the between-rows divider the inner
    // AccordionItem used to draw: each <details> is now the only child of
    // its wrapper, so ITS `last:border-b-0` always fires - without the
    // border here the grouped card's hairlines would vanish.
    if (accordion) {
      return <div id={`settings-section-${slug}`} className="border-b border-cream-border last:border-b-0"><AccordionItem title={title} icon={icon} danger={danger}>{children}</AccordionItem></div>;
    }
    return <div id={`settings-section-${slug}`}><SettingsCard title={title} icon={icon} danger={danger}>{children}</SettingsCard></div>;
  }, [iosListMode, iosPopupOpen, popupSlug, setPopupSlug]);

  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');

  // ── Delete-account modal state ───────────────────────────────────
  // Password-gated destructive action. Stays closed until the user opens
  // the modal from the danger-zone section near the bottom of the page.
  const [deleteOpen, setDeleteOpen]         = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleteTypedConfirm, setDeleteTypedConfirm] = useState(''); // must equal "DELETE"
  const [deleting, setDeleting]             = useState(false);
  const [deleteError, setDeleteError]       = useState('');

  // Data export (GDPR Article 20 - right to portability)
  const [exporting, setExporting] = useState(false);

  // Active sessions (Settings → Active sessions)
  const [sessions, setSessions]             = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingSessionId, setRevokingSessionId] = useState(null);
  const [revokingAllOthers, setRevokingAllOthers] = useState(false);

  const [members, setMembers]         = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // Push notification preferences
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [loadingNotifPrefs, setLoadingNotifPrefs] = useState(true);
  const [savingNotifPref, setSavingNotifPref] = useState(null); // which key is saving

  // Location permission state - drives the Location section. One of
  // 'granted' | 'denied' | 'prompt' | 'unavailable' | null (still loading).
  const [locationPerm, setLocationPerm] = useState(null);
  const [requestingLocation, setRequestingLocation] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getLocationPermission().then((p) => { if (!cancelled) setLocationPerm(p); });
    return () => { cancelled = true; };
  }, []);
  // Re-check on foreground - the user may have toggled the OS permission in
  // iOS Settings while we were backgrounded.
  useAppForegroundRefresh(() => {
    getLocationPermission().then(setLocationPerm);
  });
  const handleRequestLocation = async () => {
    setRequestingLocation(true);
    try {
      const result = await requestLocationPermission();
      clearLocationCache(); // force a fresh fix next time the widget asks
      setLocationPerm(result);
    } finally {
      setRequestingLocation(false);
    }
  };

  // WhatsApp link state. Phone is now learnt from the inbound webhook
  // (pull-push pairing) rather than entered up front, so no phone/code
  // local state needed - that all lives in WhatsAppPairing.
  const [disconnectingWhatsapp, setDisconnectingWhatsapp] = useState(false);
  const [whatsappBotNumber, setWhatsappBotNumber] = useState(null); // for "Open in WhatsApp" link when already connected

  // Calendar feed state
  const [feedUrl, setFeedUrl] = useState('');
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);

  // External (inbound) calendar feeds - Cozi/FamilyWall-style read-only
  // subscriptions to the user's Apple/Google/Outlook calendar via iCal URL.
  // Replaces the old two-way sync entirely.
  const [externalFeeds, setExternalFeeds] = useState([]);
  const [loadingExternalFeeds, setLoadingExternalFeeds] = useState(false);
  const [showAddFeed, setShowAddFeed] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedName, setNewFeedName] = useState('');
  const [newFeedColor, setNewFeedColor] = useState('sky'); // default matches backend
  // Which provider the user picked in the add-calendar wizard. Drives the
  // step-by-step panel + deep link; null until they choose.
  const [newFeedProvider, setNewFeedProvider] = useState(null);
  const [feedOwnerOpenId, setFeedOwnerOpenId] = useState(null); // id of feed whose "Whose calendar?" picker is expanded
  const [addingFeed, setAddingFeed] = useState(false);
  // Inline error for the add-feed form, shown next to the Subscribe button.
  // The page-level `error`/`success` surface outside this modal, where a user
  // mid-subscribe can't see them - so a failed pull read as "nothing happened".
  const [feedError, setFeedError] = useState('');
  // Own-avatar in the account header: fall back to the initial if the photo
  // 404s (keyed on the URL so a re-upload retries).
  const [feedActionId, setFeedActionId] = useState(null); // id of feed currently being refreshed/removed

  // Receipt email forwarding state
  const [receiptEmail, setReceiptEmail] = useState('');
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [regeneratingReceipt, setRegeneratingReceipt] = useState(false);
  // Account card: how the user signs in. Populated from /api/auth/me
  // on mount so it reflects the latest stamp from the user's most
  // recent sign-in (including users whose AuthContext cache pre-dates
  // the auth_provider column existing).
  const [accountInfo, setAccountInfo] = useState({ email: user?.email || null, auth_provider: user?.auth_provider || null, has_password: user?.has_password });
  // Alias editor state
  const [aliasEditing, setAliasEditing] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasAvailability, setAliasAvailability] = useState(null); // { available, reason? } | null
  const [aliasSaving, setAliasSaving] = useState(false);
  const [aliasError, setAliasError] = useState('');
  // Sender allowlist state
  const [senders, setSenders] = useState([]);
  const [senderInput, setSenderInput] = useState('');
  const [senderAdding, setSenderAdding] = useState(false);
  const [senderError, setSenderError] = useState('');
  // Rejected-sender nudge: addresses we blocked for not being on the
  // allowlist, surfaced so an admin can one-tap allow them.
  const [rejections, setRejections] = useState([]);
  const [allowingRejected, setAllowingRejected] = useState(null); // email being allowed


  function loadMembers() {
    return api.get('/household')
      .then(({ data }) => setMembers(data.members ?? []))
      .catch(() => setError('Could not load members.'))
      .finally(() => setLoadingMembers(false));
  }

  useEffect(() => { loadMembers(); }, []);

  // Refetch members when the app/tab returns from the background - the
  // user may have just completed a WhatsApp pairing handshake in another
  // app and we need to pick up the now-linked state. Throttle short so a
  // quick app-switch back from WhatsApp definitely fires.
  useAppForegroundRefresh(() => { loadMembers(); }, { throttleMs: 2000 });

  // Fetch the bot's WhatsApp number once so we can render the
  // "Open in WhatsApp" deep-link button for linked users.
  useEffect(() => {
    api.get('/auth/whatsapp-bot-info')
      .then(({ data }) => setWhatsappBotNumber(data?.bot_number || null))
      .catch(() => setWhatsappBotNumber(null));
  }, []);

  // Load notification preferences on every platform. Push toggles
  // only render on native iOS (where APNs actually delivers); WhatsApp
  // toggles render on every platform because the bot messages don't
  // care which device opened Settings. The endpoint hands back full
  // defaults when no row exists, so falling back to a hand-rolled
  // shape is just belt-and-braces in case of a transient API blip.
  const isNative = Capacitor.isNativePlatform();
  useEffect(() => {
    api.get('/notifications/preferences')
      .then(({ data }) => setNotifPrefs(data))
      .catch(() => setNotifPrefs({
        calendar_reminders: true, task_assigned: true, shopping_updated: true,
        meal_plan_updated: true, family_activity: true,
        whatsapp_daily_reminder: true, whatsapp_event_reminders: true,
        whatsapp_weekly_digest: true, whatsapp_overdue_nudge: true,
        whatsapp_subscription_reminder: true,
      }))
      .finally(() => setLoadingNotifPrefs(false));
  }, []);

  async function toggleNotifPref(key) {
    if (!notifPrefs) return;
    const newVal = !notifPrefs[key];
    setSavingNotifPref(key);
    try {
      await api.put('/notifications/preferences', { ...notifPrefs, [key]: newVal });
      setNotifPrefs(prev => ({ ...prev, [key]: newVal }));
    } catch {
      setError('Could not update notification preference.');
    } finally {
      setSavingNotifPref(null);
    }
  }


  // Load calendar connections
  // Fetch existing feed token on mount without creating one. We need this
  // for the mutual-exclusivity warning: if both feed and connections are
  // active, surface a banner so the user can pick one. Calling the regular
  // /feed-token endpoint would auto-create the token, so we use the
  // dedicated /status endpoint that returns null when none exists.
  useEffect(() => {
    api.get('/calendar/feed-token/status')
      .then(({ data }) => {
        if (data?.exists) {
          setFeedUrl(data.feedUrl);
        }
      })
      .catch(() => {});
  }, []);

  // (Two-way sync removed - the loadConnections + OAuth callback handler
  // for ?connected=<provider> are no longer needed. Inbound subscriptions
  // are managed via the read-only feed flow further down in this file.)

  // The previous handleSendWhatsappCode / handleVerifyWhatsapp pair
  // is gone - see /components/WhatsAppPairing.jsx + the pull-push
  // pairing endpoints in /src/routes/auth.js for the replacement.

  // ── Active sessions ──────────────────────────────────────────────
  // Pulls the caller's live refresh tokens from /api/auth/sessions with
  // device + IP + last-used metadata, lets them revoke any of them, and
  // offers a 'sign out everywhere else' shortcut.

  function loadSessions() {
    setLoadingSessions(true);
    const refreshToken = (() => {
      try { return localStorage.getItem('refreshToken') || ''; } catch { return ''; }
    })();
    return api
      .get('/auth/sessions', {
        // Passed as a header so the server can mark the current row -
        // the raw token never appears in the response.
        headers: refreshToken ? { 'X-Refresh-Token': refreshToken } : {},
      })
      .then(({ data }) => setSessions(data.sessions || []))
      .catch(() => setSessions([]))
      .finally(() => setLoadingSessions(false));
  }

  useEffect(() => { loadSessions(); }, []);

  async function handleRevokeSession(sessionId, isCurrent) {
    if (isCurrent) {
      if (!window.confirm('This is your current session - revoking will sign you out of this browser. Continue?')) return;
    }
    setRevokingSessionId(sessionId);
    setError('');
    try {
      await api.delete(`/auth/sessions/${sessionId}`);
      if (isCurrent) {
        // Revoked the session we're using - force a fresh login. Clears
        // tokens locally too in case the refresh interceptor misses it.
        try { localStorage.removeItem('token'); localStorage.removeItem('refreshToken'); } catch { /* noop */ }
        window.location.href = '/login';
        return;
      }
      await loadSessions();
      setSuccess('Session revoked.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not revoke that session.');
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeAllOthers() {
    if (!window.confirm('Revoke every other device signed into your account? You\'ll stay signed in here.')) return;
    setRevokingAllOthers(true);
    setError('');
    try {
      await api.delete('/auth/sessions?except=current', {
        headers: (() => {
          try {
            const rt = localStorage.getItem('refreshToken');
            return rt ? { 'X-Refresh-Token': rt } : {};
          } catch { return {}; }
        })(),
      });
      await loadSessions();
      setSuccess('All other sessions revoked.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not revoke other sessions.');
    } finally {
      setRevokingAllOthers(false);
    }
  }

  // Turn a user-agent string into a short, readable label. UA parsing is
  // famously unreliable - we only try to catch the common cases and fall
  // back to "Unknown device" rather than risking nonsense.
  function describeDevice(ua) {
    if (!ua) return 'Unknown device';
    const s = String(ua);
    const platform =
      /iPad/i.test(s) ? 'iPad' :
      /iPhone/i.test(s) ? 'iPhone' :
      /Android/i.test(s) ? 'Android' :
      /Macintosh|Mac OS X/i.test(s) ? 'Mac' :
      /Windows/i.test(s) ? 'Windows' :
      /Linux/i.test(s) ? 'Linux' :
      '';
    const browser =
      /Capacitor/i.test(s) ? 'Housemait app' :
      /Edg\//i.test(s) ? 'Edge' :
      /Chrome\//i.test(s) && !/Edg\//i.test(s) ? 'Chrome' :
      /Firefox\//i.test(s) ? 'Firefox' :
      /Safari\//i.test(s) ? 'Safari' :
      'Browser';
    if (platform && browser) return `${browser} on ${platform}`;
    return platform || browser || 'Unknown device';
  }

  function formatWhen(iso) {
    if (!iso) return '';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // ── Export my data (GDPR Article 20) ─────────────────────────────
  // Downloads a JSON file with every row Housemait holds about the user
  // and their household. The endpoint sets Content-Disposition; we also
  // do a belt-and-braces Blob + anchor download so Capacitor/iOS and any
  // odd browser picks it up reliably.
  async function handleExportData() {
    setError('');
    setSuccess('');
    setExporting(true);
    try {
      const { data } = await api.get('/auth/export');
      const filename = `housemait-export-${new Date().toISOString().split('T')[0]}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Give the browser a tick before revoking so the download kicks in.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSuccess('Export downloaded.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not generate your data export.');
    } finally {
      setExporting(false);
    }
  }

  // ── Delete account ───────────────────────────────────────────────
  // Re-posts the user's password to the server for re-auth, then the
  // server decides whether to delete just this user or the whole
  // household (sole-member case). On success we clear the local auth
  // state and send the user back to the landing page - from their
  // perspective they're logged out, because their session no longer
  // corresponds to a valid user row.
  async function handleDeleteAccount() {
    setDeleteError('');
    // SSO-only accounts (Google/Apple) have no password to re-enter; the typed
    // "DELETE" + live session is their confirmation. has_password === false is
    // the only case we skip the password; unknown/true still asks for one.
    const needsPassword = accountInfo.has_password !== false;
    if (needsPassword && !deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    if (deleteTypedConfirm !== 'DELETE') {
      setDeleteError('Type DELETE (in capitals) to confirm.');
      return;
    }
    if (!deleteConfirmed) {
      setDeleteError('Please confirm you understand this cannot be undone.');
      return;
    }
    setDeleting(true);
    try {
      // Backend requires the literal string "DELETE" plus, for password
      // accounts, the password (re-auth). SSO users send no password.
      await api.delete('/auth/account', { data: { ...(deletePassword ? { password: deletePassword } : {}), confirmation: 'DELETE' } });
      // Clear the auth context without calling the server's /auth/logout
      // endpoint - the refresh token we'd post there was just deleted with
      // the rest of our data, so attempting it would 404.
      logout();
      navigate('/', { replace: true });
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Could not delete your account. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleDisconnectWhatsapp() {
    setError('');
    setDisconnectingWhatsapp(true);
    try {
      await api.post('/auth/whatsapp-disconnect');
      setSuccess('WhatsApp disconnected.');
      loadMembers();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not disconnect WhatsApp.');
    } finally {
      setDisconnectingWhatsapp(false);
    }
  }

  async function handleGetFeedUrl() {
    setError('');
    setLoadingFeed(true);
    try {
      const { data } = await api.get('/calendar/feed-token');
      setFeedUrl(data.feedUrl);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not get calendar feed URL.');
    } finally {
      setLoadingFeed(false);
    }
  }

  async function handleRegenerateFeed() {
    if (!window.confirm('Regenerate your calendar feed URL? The old URL will stop working.')) return;
    setError('');
    setLoadingFeed(true);
    setFeedCopied(false);
    try {
      const { data } = await api.post('/calendar/feed-token');
      setFeedUrl(data.feedUrl);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not regenerate feed URL.');
    } finally {
      setLoadingFeed(false);
    }
  }

  /**
   * Revoke the feed token. Used both by the "Disable feed" button under
   * the feed URL (added when a two-way sync is also active) and by the
   * mutual-exclusivity banner's "remove feed" action.
   */
  async function handleRemoveFeed() {
    if (!window.confirm('Disable the read-only calendar feed? Anyone subscribed to the feed URL will stop receiving updates.')) return;
    setError('');
    setLoadingFeed(true);
    try {
      await api.delete('/calendar/feed-token');
      setFeedUrl('');
      setSuccess('Calendar feed disabled.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not disable calendar feed.');
    } finally {
      setLoadingFeed(false);
    }
  }

  function handleCopyFeed() {
    navigator.clipboard.writeText(feedUrl).then(() => {
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 2000);
    });
  }

  // ── External feed subscriptions (read-only inbound) ────────────────────────
  async function loadExternalFeeds() {
    setLoadingExternalFeeds(true);
    try {
      const { data } = await api.get('/calendar/external-feeds');
      // Keep ALL feeds: URL subscriptions render in the Subscribed-calendars
      // list; device-synced rows render in their own read-only "Synced from
      // phones" block (so the web shows evidence of device sync and offers
      // unlink - the recovery path when a phone is lost).
      setExternalFeeds(data?.feeds || []);
    } catch {
      // Non-fatal: leave the list empty
    } finally {
      setLoadingExternalFeeds(false);
    }
  }
  useEffect(() => { loadExternalFeeds(); }, []);

  async function handleAddExternalFeed(e) {
    e.preventDefault();
    if (!newFeedUrl.trim()) {
      setFeedError('Please paste the calendar URL.');
      return;
    }
    setAddingFeed(true);
    setFeedError('');
    try {
      const { data } = await api.post('/calendar/external-feeds', {
        feed_url: newFeedUrl.trim(),
        display_name: newFeedName.trim(),
        color: newFeedColor,
      });
      setExternalFeeds(prev => [...prev, data.feed]);
      setSuccess('Subscribed - your calendar is syncing; events will appear on the calendar shortly.');
      setNewFeedUrl('');
      setNewFeedName('');
      setNewFeedColor('sky');
      setNewFeedProvider(null);
      setShowAddFeed(false);
    } catch (err) {
      setFeedError(err.response?.data?.error || "Couldn't reach that calendar. Check the link is the iCal/webcal address and try again.");
    } finally {
      setAddingFeed(false);
    }
  }

  async function handleRefreshExternalFeed(id) {
    setFeedActionId(id);
    setError('');
    try {
      const { data } = await api.post(`/calendar/external-feeds/${id}/refresh`);
      const stats = data?.refresh || {};
      setSuccess(
        `Refreshed: ${stats.created || 0} new, ${stats.updated || 0} updated, ${stats.deleted || 0} removed.`
      );
      // Update last_synced_at locally so the UI reflects the new state without a re-fetch.
      setExternalFeeds(prev => prev.map(f => f.id === id
        ? { ...f, last_synced_at: new Date().toISOString(), last_error: null, consecutive_failures: 0 }
        : f
      ));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not refresh feed.');
      // Re-load to pick up the failure counter the server bumped.
      loadExternalFeeds();
    } finally {
      setFeedActionId(null);
    }
  }

  // "Whose calendar is this?" - attribute a synced calendar to a member (events
  // take that member's colour + show in their filter) or to nobody ("Shared":
  // a neutral colour, e.g. for school / holidays). The backend re-stamps the
  // already-imported events; we optimistically reflect the colour change here.
  async function handleSetFeedOwner(id, ownerMemberId) {
    setFeedOwnerOpenId(null);
    const prev = externalFeeds;
    const member = members.find((m) => m.id === ownerMemberId);
    const color = ownerMemberId ? (member?.color_theme || 'slate') : 'slate';
    setExternalFeeds(p => p.map(f => f.id === id ? { ...f, owner_member_id: ownerMemberId, color } : f));
    try {
      await api.patch(`/calendar/external-feeds/${id}/owner`, { owner_member_id: ownerMemberId });
    } catch (err) {
      setExternalFeeds(prev);
      setError(err.response?.data?.error || 'Could not update calendar owner.');
    }
  }

  async function handleRemoveExternalFeed(id) {
    const feed = externalFeeds.find((f) => f.id === id);
    const msg = feed?.source === 'device'
      ? 'Stop syncing this calendar from the phone? Its events will disappear from Housemait. Re-tick it in the app’s calendar picker to bring it back.'
      : 'Remove this calendar subscription? Its events will disappear from Housemait. You can re-add the URL anytime.';
    if (!window.confirm(msg)) return;
    setFeedActionId(id);
    setError('');
    try {
      await api.delete(`/calendar/external-feeds/${id}`);
      setExternalFeeds(prev => prev.filter(f => f.id !== id));
      setSuccess('Calendar subscription removed.');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove feed.');
    } finally {
      setFeedActionId(null);
    }
  }

  // Build the user-facing inbound address. Prefer the household's
  // chosen alias if it's set; fall back to the long hex token. The
  // token always works as a backup even when an alias is configured.
  useEffect(() => {
    const local = household?.email_alias || household?.inbound_email_token;
    if (local) {
      setReceiptEmail(`${local}@inbound.housemait.com`);
    } else {
      // Cache might not have the household with these fields yet - fetch fresh.
      api.get('/household').then(({ data }) => {
        const fallback = data.household?.email_alias || data.household?.inbound_email_token;
        if (fallback) setReceiptEmail(`${fallback}@inbound.housemait.com`);
      }).catch(() => {});
    }
  }, [household?.email_alias, household?.inbound_email_token]);

  // Load the sender allowlist for this household. Cheap query, but
  // we only fetch it once per Settings mount - the list is rarely
  // updated and the Settings page is short-lived.
  useEffect(() => {
    api.get('/household/inbound-senders')
      .then(({ data }) => setSenders(data.senders || []))
      .catch(() => setSenders([]));
    api.get('/household/inbound-rejections')
      .then(({ data }) => setRejections(data.rejections || []))
      .catch(() => setRejections([]));
  }, []);

  // Pull fresh account info (email + auth provider) for the Account
  // card. The AuthContext may still hold a stale user object that
  // pre-dates the auth_provider column existing; /api/auth/me always
  // returns the latest DB state.
  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => setAccountInfo({ email: data.email || null, auth_provider: data.auth_provider || null, has_password: data.has_password }))
      .catch(() => {});
  }, []);

  function handleCopyReceiptEmail() {
    navigator.clipboard.writeText(receiptEmail).then(() => {
      setReceiptCopied(true);
      setTimeout(() => setReceiptCopied(false), 2000);
    });
  }

  async function handleRegenerateReceiptEmail() {
    if (!window.confirm('Regenerate your receipt email address? The old address will stop working.')) return;
    setRegeneratingReceipt(true);
    setReceiptCopied(false);
    try {
      const { data } = await api.post('/household/regenerate-email-address');
      setReceiptEmail(data.receipt_email);
      setSuccess('Receipt email address regenerated.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not regenerate receipt email.');
    } finally {
      setRegeneratingReceipt(false);
    }
  }

  // ─── Alias editor ────────────────────────────────────────────────
  // Pull a fresh availability check on every keystroke (debounced).
  // The backend's GET /email-alias/availability returns both the
  // format-validity error AND the uniqueness check, so we don't need
  // to duplicate the regex on the client.
  useEffect(() => {
    if (!aliasEditing) return;
    const trimmed = aliasInput.trim();
    if (!trimmed) { setAliasAvailability(null); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/household/email-alias/availability', { params: { alias: trimmed } });
        setAliasAvailability(data);
      } catch {
        setAliasAvailability({ available: false, reason: 'Could not check availability.' });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [aliasInput, aliasEditing]);

  function openAliasEditor() {
    setAliasInput(household?.email_alias || '');
    setAliasAvailability(null);
    setAliasError('');
    setAliasEditing(true);
  }

  async function handleSaveAlias() {
    const trimmed = aliasInput.trim().toLowerCase();
    if (!trimmed) {
      setAliasError('Please enter an alias.');
      return;
    }
    if (aliasAvailability && !aliasAvailability.available) {
      setAliasError(aliasAvailability.reason || 'That alias is unavailable.');
      return;
    }
    setAliasSaving(true);
    setAliasError('');
    try {
      const { data } = await api.patch('/household/email-alias', { alias: trimmed });
      // Update auth context so the new alias is reflected everywhere
      // that reads household from useAuth.
      login({ token, user, household: data.household });
      setAliasEditing(false);
      setSuccess('Alias updated.');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setAliasError(err.response?.data?.error || 'Could not save alias.');
    } finally {
      setAliasSaving(false);
    }
  }

  async function handleAddSender(e) {
    e?.preventDefault();
    const trimmed = senderInput.trim();
    if (!trimmed) return;
    setSenderAdding(true);
    setSenderError('');
    try {
      const { data } = await api.post('/household/inbound-senders', { email: trimmed });
      setSenders((prev) => [...prev, data.sender]);
      setSenderInput('');
    } catch (err) {
      setSenderError(err.response?.data?.error || 'Could not add email.');
    } finally {
      setSenderAdding(false);
    }
  }

  async function handleDeleteSender(senderId, senderEmail) {
    if (!window.confirm(`Remove ${senderEmail} from the allowlist? Mail forwarded from this address will be rejected.`)) return;
    try {
      await api.delete(`/household/inbound-senders/${senderId}`);
      setSenders((prev) => prev.filter((s) => s.id !== senderId));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove sender.');
    }
  }

  // One-tap "allow" from the rejected-sender nudge: add to the allowlist
  // and drop it from the nudge list.
  async function handleAllowRejected(email) {
    setAllowingRejected(email);
    setSenderError('');
    try {
      const { data } = await api.post('/household/inbound-senders', { email });
      setSenders((prev) => [...prev, data.sender]);
      setRejections((prev) => prev.filter((r) => r.email !== email));
    } catch (err) {
      setSenderError(err.response?.data?.error || 'Could not allow that address.');
    } finally {
      setAllowingRejected(null);
    }
  }

  function handleDismissRejected(email) {
    setRejections((prev) => prev.filter((r) => r.email !== email));
  }

  // ── Child mode gradient card (settings handoff) ─────────────────
  // Explainer + Start button up top; a translucent footer row holds the
  // Exit PIN control (the existing set/change/remove PIN form drops down
  // inside the footer). Rendered standalone on web, inside the section
  // popup on iOS - one JSX tree so the two stay identical.
  const kidMembers = members.filter((m) => m.member_type === 'dependent');
  const childModeCard = (
    <div className={SET_CARD_CLASS} style={{ boxShadow: SET_CARD_SHADOW, overflow: 'hidden', background: 'linear-gradient(140deg,#F3EDFC,#E3F4FE)' }}>
      <div className="flex items-center gap-[18px] p-[22px] flex-wrap sm:flex-nowrap">
        <div className="w-[54px] h-[54px] rounded-2xl bg-white flex items-center justify-center text-[28px] shrink-0">🧸</div>
        <div className="flex-1 min-w-0 basis-48">
          <div className="text-base font-semibold text-bark">Hand the device to your kids</div>
          <div className="text-[13px] text-cocoa mt-[3px] leading-[1.45] max-w-[440px]">
            A simpler, playful space with only their quests, star shop and calendar. You&apos;ll need your PIN to switch back.
          </div>
        </div>
        {!childMode ? (
          <button
            type="button"
            onClick={startChildMode}
            className="shrink-0 px-5 py-[11px] rounded-[11px] bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
            style={{ boxShadow: '0 4px 12px rgba(107,63,160,0.3)' }}
          >
            Start Child mode
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { disableChildMode(); navigate('/dashboard'); }}
            className="shrink-0 px-5 py-[11px] rounded-[11px] border-[1.5px] border-plum text-plum text-sm font-semibold bg-white/70"
          >
            Turn off Child mode
          </button>
        )}
      </div>
      <div className="border-t border-[rgba(26,22,32,0.06)]" style={{ background: 'rgba(255,255,255,0.5)' }}>
        <SetRow
          title="Exit PIN"
          sub={pinIsSet ? 'Required to leave Child mode' : 'No PIN yet - set one to use Child mode'}
          control={isAdmin ? (
            <div className="flex items-center gap-2.5">
              <SelectBtn value={pinIsSet ? '••••' : 'Set PIN'} onClick={() => { setPinFormOpen((v) => !v); setPinMsg(''); }} />
              {pinIsSet && !childMode && (
                <button type="button" onClick={removeChildPin} disabled={pinBusy} className="text-[13px] font-semibold text-coral disabled:opacity-50">Remove</button>
              )}
            </div>
          ) : (
            <span className="text-xs text-warm-grey">Set by an adult admin</span>
          )}
          last
        />
        {pinFormOpen && (
          <div className="px-5 pb-4 space-y-2">
            <input type="password" inputMode="numeric" maxLength={6} value={pinDraft} onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, ''))} placeholder="New PIN (4-6 digits)" className="w-full h-11 rounded-lg border border-cream-border px-3 text-sm bg-white focus:border-plum outline-none" />
            <input type="password" inputMode="numeric" maxLength={6} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))} placeholder="Confirm PIN" className="w-full h-11 rounded-lg border border-cream-border px-3 text-sm bg-white focus:border-plum outline-none" />
            <div className="flex gap-2 pt-1">
              <button onClick={saveChildPin} disabled={pinBusy} className="flex-1 h-11 rounded-lg bg-plum text-white text-sm font-semibold disabled:opacity-50">{pinBusy ? 'Saving…' : 'Save PIN'}</button>
              <button onClick={() => { setPinFormOpen(false); setPinDraft(''); setPinConfirm(''); setPinMsg(''); }} className="px-4 h-11 rounded-lg border border-cream-border text-sm font-medium text-cocoa bg-white">Cancel</button>
            </div>
          </div>
        )}
        {pinMsg && <p className="text-xs text-coral px-5 pb-3">{pinMsg}</p>}
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader kicker="Account & preferences" title="Settings" />

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* Profile card (settings handoff): identity header + Family plan
          + Billing rows, wired to the real subscription. */}
      <div>
        <SectionLabel>Your profile</SectionLabel>
        <ProfileCard me={members.find((m) => m.id === user?.id)} members={members} />
      </div>

      {/* Child mode - standalone gradient card on web (a hero feature, not
          an accordion row); on iOS it sits between the profile card and the
          grouped section list. The id anchors the ?section=child-mode deep
          link on both platforms. Hidden until the household has a child -
          UNLESS Child Mode is already in use (PIN set or this device locked):
          the controls for an active lock must never vanish, even if the last
          child profile is removed. */}
      {(hasChildren || pinIsSet || childMode) && (
        <div id="settings-section-child-mode">
          <SectionLabel>Child mode</SectionLabel>
          {childModeCard}
        </div>
      )}

      {/* iOS list mode: nav rows grouped into labelled cards (same groups
          + labels as the web page's sections), each row opening a popup
          overlay for that section. The chevron implies "tap to see more",
          which is true whether the more is inline (accordion), a sub-page,
          or a popup. */}
      {iosListMode && IOS_GROUPS.map((group) => (
        <div key={group}>
          <SectionLabel>{group}</SectionLabel>
          <div className={`${SET_CARD_CLASS} px-5 md:px-6`} style={{ boxShadow: SET_CARD_SHADOW }}>
            {IOS_SECTIONS.filter((sec) => sec.group === group).map((sec) => {
              const Icon = IOS_SECTION_ICONS[sec.icon];
              const iconColor = sec.danger ? 'text-error' : 'text-plum';
              const titleColor = sec.danger ? 'text-error' : 'text-bark';
              return (
                <button
                  key={sec.slug}
                  type="button"
                  onClick={() => (sec.action ? sec.action() : setPopupSlug(sec.slug))}
                  className="w-full flex items-center gap-3 py-4 md:py-5 cursor-pointer select-none border-b border-cream-border last:border-b-0 text-left"
                >
                  {Icon && <Icon className={`w-4 h-4 md:w-5 md:h-5 shrink-0 ${iconColor}`} />}
                  <h2 className={`flex-1 text-base md:text-medium font-semibold ${titleColor}`}>{sec.title}</h2>
                  <IconChevronRight className="w-4 h-4 md:w-5 md:h-5 text-cocoa shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Sections - each renders via SectionWrapper which picks the
          right wrapper for the platform/sub-page state:
            • Web: cards for most sections, accordion for Notifications
              + Active sessions (long lists worth hiding when not in use).
            • iOS list mode: each row sits in the section list above.
            • iOS sub-page mode: only the active section renders, bare. */}

      {/* Connect WhatsApp + Connect Calendars + Send Emails to AI - the
          three "how Housemait talks to the outside world" sections, grouped
          into one shared card of accordions (mirrors the Notifications /
          Location / Active sessions group below). */}
      {!isIosPlatform && <SectionLabel>Connected services</SectionLabel>}
      <div
        className={isIosPlatform ? '' : `${SET_CARD_CLASS} px-5 md:px-6 !mt-0`}
        style={isIosPlatform ? undefined : { boxShadow: SET_CARD_SHADOW }}
      >

      {/* Connect WhatsApp */}
      <SectionWrapper slug="whatsapp" title="Connect WhatsApp" icon={IconMessageCircle} accordion>
        {members.find((m) => m.id === user?.id)?.whatsapp_linked ? (
          <div className="space-y-3">
            <p className="text-sm text-success bg-success/10 rounded-2xl px-3 py-2">
              WhatsApp connected! You'll receive reminders and can message the bot.
            </p>
            {whatsappBotNumber && (
              <a
                href={`https://wa.me/${whatsappBotNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-2 rounded-2xl transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Open in WhatsApp
              </a>
            )}
            <button
              onClick={handleDisconnectWhatsapp}
              disabled={disconnectingWhatsapp}
              className="block text-sm text-cocoa hover:text-error transition-colors"
            >
              {disconnectingWhatsapp ? 'Disconnecting…' : 'Disconnect WhatsApp'}
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm text-cocoa mb-3">
              Link your WhatsApp to receive daily reminders and manage your household via chat.
            </p>
            <WhatsAppPairing
              autoStart={false}
              onSuccess={async () => {
                // Refresh members so the connected state flips without a page reload.
                try {
                  const { data } = await api.get('/household');
                  if (data.members) setMembers(data.members);
                } catch { /* ignore */ }
              }}
              onError={setError}
              compact
            />
          </>
        )}
      </SectionWrapper>

      {/* Connect Calendars - two DIRECTIONS, framed explicitly because the
          actions otherwise read as the same thing. Most families set up both:
          1) bring their existing events IN (device sync / URL feeds), and
          2) see Housemait events OUT in their usual calendar app. */}
      <SectionWrapper slug="calendars" title="Connect Calendars" icon={IconCalendar} accordion>
        {/* ONE hero: getting your events in. On iOS that's the device-sync
            card below (renders null on web, where the add-by-link row is
            expanded by default and plays hero instead). Everything else -
            phone roster, link subscriptions, the outbound feed - sits in
            quiet disclosure rows so a first visit reads as one card and
            three lines, not four competing sections. Direction lives in the
            row LABELS ("Show Housemait in...") so the two Apple-related
            actions can't be mistaken for each other. */}
        <div className="mb-4">
          <DeviceCalendarSync onSynced={loadExternalFeeds} />
        </div>

        {/* The rows keep their code order but display roster → link →
            outbound via CSS order, so the big JSX blocks don't move. */}
        <div className="flex flex-col gap-2">
        <CollapsibleRow label={<span className="font-semibold">Export from Housemait</span>} className="order-3">
        <p className="text-xs text-cocoa mb-3">
          Housemait events appear alongside everything else in Apple Calendar (or Google/Outlook). One-way — nothing in your calendar is ever changed.
        </p>


        {feedUrl ? (
          <div className="space-y-3">
            {/* Apple Calendar - tappable webcal:// link. iOS / macOS
                hand the scheme to Calendar.app which shows a native
                one-tap subscribe sheet. Works inside Capacitor's
                WKWebView because non-http(s) schemes are routed via
                UIApplication.shared.open(). On other browsers (Chrome
                on Android, Edge) clicking is a no-op - those users
                will use the copy-URL flow below. */}
            <a
              href={feedUrl.replace(/^https?:\/\//, 'webcal://')}
              className="block w-full bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-3 rounded-2xl text-sm text-center transition-colors"
            >
              Subscribe in Apple Calendar
            </a>
            <p className="text-xs text-cocoa text-center -mt-1">
              Opens the iOS or macOS Calendar app with a one-tap confirm.
            </p>

            {/* Google + Outlook get the same one-tap treatment via their
                add-by-URL deep links - each opens the provider's own
                "Add calendar?" confirm, replacing the old copy-the-URL-and-
                find-the-setting instructions (still available below for
                anyone it doesn't work for, e.g. Office 365 work accounts). */}
            <div className="flex gap-2">
              <a
                href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl.replace(/^https?:\/\//, 'webcal://'))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 border-[1.5px] border-primary text-primary hover:bg-plum-light font-medium px-3 py-2.5 rounded-2xl text-xs text-center transition-colors"
              >
                Add to Google Calendar
              </a>
              <a
                href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feedUrl)}&name=${encodeURIComponent('Housemait')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 border-[1.5px] border-primary text-primary hover:bg-plum-light font-medium px-3 py-2.5 rounded-2xl text-xs text-center transition-colors"
              >
                Add to Outlook
              </a>
            </div>

            {/* The copy-URL flow + feed admin are the rare path (Google /
                Outlook / power users) - folded behind a disclosure so the
                section stays one button tall for the typical Apple user. */}
            <details className="pt-2 border-t border-cream-border">
              <summary className="text-xs font-medium text-primary cursor-pointer select-none py-1">
                Buttons didn&apos;t work, or using another app? Copy the link
              </summary>
              <div className="pt-2 space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={feedUrl}
                    className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-xs bg-oat text-cocoa select-all"
                    onClick={(e) => e.target.select()}
                  />
                  <button
                    onClick={handleCopyFeed}
                    className="border border-cream-border text-bark hover:bg-cream font-medium px-3 py-2 rounded-2xl text-xs transition-colors whitespace-nowrap"
                  >
                    {feedCopied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <div className="text-xs text-cocoa space-y-1">
                  <p>Paste it into your calendar app&apos;s &ldquo;subscribe from URL&rdquo; option:</p>
                  <p><span className="font-medium">Google:</span> Settings &rarr; Add calendar &rarr; From URL.</p>
                  <p><span className="font-medium">Outlook:</span> Add calendar &rarr; Subscribe from web.</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleRegenerateFeed}
                    disabled={loadingFeed}
                    className="text-xs text-cocoa hover:text-error transition-colors"
                  >
                    {loadingFeed ? 'Regenerating…' : 'Regenerate URL'}
                  </button>
                  <button
                    onClick={handleRemoveFeed}
                    disabled={loadingFeed}
                    className="text-xs text-cocoa hover:text-error transition-colors"
                  >
                    Disable feed
                  </button>
                </div>
              </div>
            </details>
          </div>
        ) : (
          <button
            onClick={handleGetFeedUrl}
            disabled={loadingFeed}
            className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-5 py-2.5 rounded-2xl text-sm transition-colors"
          >
            {loadingFeed ? 'Generating…' : 'Generate Calendar Feed'}
          </button>
        )}
        </CollapsibleRow>

        {/* Device-synced calendars (read-only roster). Connection happens in
            the iPhone app's picker, but the WEB must still show evidence of
            the sync and allow unlink - that's the recovery path when the
            phone that fed a calendar is lost or the app was deleted. */}
        {externalFeeds.some((f) => f.source === 'device' && f.sync_enabled !== false) && (
          <CollapsibleRow
            label="Synced from phones"
            sub={(() => {
              const n = externalFeeds.filter((f) => f.source === 'device' && f.sync_enabled !== false).length;
              return `${n} calendar${n === 1 ? '' : 's'}`;
            })()}
            className="order-1"
          >
            <p className="text-sm text-cocoa mb-3">
              Calendars syncing automatically from family iPhones. Choose which in the Housemait app on that phone.
            </p>
            <ul className="space-y-2">
              {externalFeeds.filter((f) => f.source === 'device' && f.sync_enabled !== false).map((feed) => {
                const owner = members.find((m) => m.id === feed.device_owner_user_id)?.name;
                // Device calendars only refresh when the owning phone opens
                // the app - surface a quiet phone so the family knows this
                // calendar may be showing old events (and whose phone fixes it).
                const hoursSinceSync = feed.last_synced_at
                  ? (Date.now() - new Date(feed.last_synced_at).getTime()) / (1000 * 60 * 60)
                  : Infinity;
                const isStale = hoursSinceSync > 48;
                return (
                  <li key={feed.id} className="bg-white border border-cream-border rounded-2xl px-3 py-2 flex items-center gap-2.5">
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: FEED_COLOR_HEX[feed.color] || FEED_COLOR_HEX.sky }} />
                    <span className="flex-1 min-w-0">
                      {/* Badge OUTSIDE the truncating span: long calendar
                          names must shorten, never the staleness signal. */}
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-bark truncate">{feed.display_name}</span>
                        {isStale && (
                          <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md bg-amber/15 text-amber text-[10px] font-semibold">
                            Not syncing
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-cocoa">
                        {owner ? `${owner}'s iPhone` : 'Family iPhone'}
                        {` · last synced ${formatRelativeTime(feed.last_synced_at)}`}
                        {isStale && ` — opening Housemait on ${owner ? `${owner}'s` : 'that'} iPhone brings it up to date`}
                      </span>
                    </span>
                    <button
                      onClick={() => handleRemoveExternalFeed(feed.id)}
                      disabled={feedActionId === feed.id}
                      className="text-error/70 hover:text-error p-1.5 rounded-lg transition-colors hover:bg-error/10 disabled:opacity-50"
                      title="Stop syncing this calendar"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CollapsibleRow>
        )}

        {/* External feed subscriptions (read-only inbound). With device sync
            retired this is the inbound hero everywhere, so it opens expanded.
            (Driven by the same flag: if EventKit is ever switched back on,
            iOS re-collapses this to a quiet line under the device card.) */}
        <CollapsibleRow
          label={<span className="font-semibold">Import to Housemait</span>}
          sub={externalFeeds.some((f) => f.source !== 'device') ? String(externalFeeds.filter((f) => f.source !== 'device').length) : null}
          defaultOpen={!isDeviceCalendarSupported()}
          className="order-2"
        >
          {/* Google Calendar OAuth (read-only inbound). Self-hides unless the
              backend reports the feature enabled, so it's invisible until the
              GOOGLE_CALENDAR_ENABLED flag is on. The one-tap, sign-in path -
              sits above the paste-a-URL fallback below. */}
          <GoogleCalendarConnect onChange={loadExternalFeeds} />

          <div className="flex items-start justify-between gap-3 mb-3">
            <p className="text-sm text-cocoa">
              Show your third-party calendar events in your Housemait calendar. Read-only - edits happen in the source calendar.
            </p>
            {/* The button only earns its place once subscriptions exist -
                the empty state's own card IS the add affordance. */}
            {!showAddFeed && externalFeeds.some((f) => f.source !== 'device') && (
              <button
                onClick={() => setShowAddFeed(true)}
                className="text-xs text-primary hover:text-primary-pressed font-medium whitespace-nowrap shrink-0"
              >
                + Add calendar
              </button>
            )}
          </div>

          {showAddFeed && (() => {
            const isNative = Capacitor.isNativePlatform();
            const provider = FEED_PROVIDERS.find((p) => p.id === newFeedProvider) || null;
            const steps = provider ? ((isNative && provider.iosSteps) || provider.steps) : null;
            const hint = feedUrlHint(newFeedUrl);
            // Step 1 is a quiet provider MENU, not a form: pick where the
            // calendar lives, see nothing else until you have. The fields
            // and steps only appear for the chosen provider.
            if (!provider) {
              return (
                <div className="border border-cream-border rounded-2xl overflow-hidden mb-3">
                  {isNative && (
                    <p className="text-[11px] text-cocoa italic px-4 pt-3">
                      Your own iPhone calendars sync automatically via &ldquo;Bring your events into Housemait&rdquo; above - use this to pull in a calendar from another account.
                    </p>
                  )}
                  {FEED_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setNewFeedProvider(p.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-oat transition-colors border-b border-cream-border last:border-b-0 text-left"
                    >
                      <ProviderLogo id={p.id} />
                      <span className="flex-1 text-sm text-bark">{p.label}</span>
                      <span className="text-cocoa" aria-hidden="true">›</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowAddFeed(false)}
                    className="w-full text-xs text-cocoa hover:text-bark py-2.5 bg-white border-t border-cream-border"
                  >
                    Cancel
                  </button>
                </div>
              );
            }
            return (
            <form onSubmit={handleAddExternalFeed} className="border border-cream-border rounded-2xl p-3 space-y-3 mb-3">
              <div className="flex items-center gap-2.5">
                <ProviderLogo id={provider.id} size={24} />
                <span className="flex-1 text-sm font-medium text-bark">{provider.label}</span>
                <button
                  type="button"
                  onClick={() => setNewFeedProvider(null)}
                  className="text-xs font-medium text-primary hover:text-primary-pressed"
                >
                  Change
                </button>
              </div>

              {provider && (
                <div className="bg-oat rounded-xl px-3 py-2.5 space-y-2">
                  {provider.link && !(isNative && provider.iosSteps) && (
                    <a
                      href={provider.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs font-semibold text-primary hover:text-primary-pressed underline"
                    >
                      {provider.linkLabel} →
                    </a>
                  )}
                  <ol className="text-xs text-cocoa space-y-1 list-decimal list-inside">
                    {steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                  {isNative && provider.iosTip && !provider.iosSteps && (
                    <p className="text-[11px] text-cocoa italic">{provider.iosTip}</p>
                  )}
                </div>
              )}

              <input
                type="url"
                placeholder={provider?.placeholder || 'https://… or webcal://… (iCal feed URL)'}
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {/* Live wrong-paste feedback - same patterns the server enforces,
                  surfaced as they paste instead of after a failed submit. */}
              {hint && (
                <p className={`text-[11px] rounded-xl px-3 py-2 ${hint.level === 'block' ? 'bg-coral/10 text-bark' : 'bg-amber/10 text-bark'}`}>
                  {hint.level === 'block' ? '✋ ' : '💡 '}{hint.message}
                </p>
              )}
              <input
                type="text"
                placeholder="Calendar name (optional — we'll use the calendar's own name)"
                value={newFeedName}
                onChange={(e) => setNewFeedName(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {/* No colour picker here: a new calendar is added under you (it
                  takes your colour and shows in your filter). Change "whose
                  calendar" it is — or mark it Shared — from the list below. */}
              <p className="text-[11px] text-cocoa">This calendar will be added under you. You can change whose it is afterwards.</p>
              {feedError && (
                <p className="text-[11px] rounded-xl px-3 py-2 bg-coral/10 text-bark">⚠️ {feedError}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={addingFeed || hint?.level === 'block'}
                  className="bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors"
                >
                  {addingFeed ? 'Adding…' : 'Subscribe'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowAddFeed(false); setNewFeedUrl(''); setNewFeedName(''); setNewFeedProvider(null); setFeedError(''); }}
                  className="text-sm text-cocoa hover:text-bark px-3"
                >
                  Cancel
                </button>
              </div>
            </form>
            );
          })()}

          {/* Calm empty state: the provider tiles ARE the invitation - one
              tap opens the provider menu. */}
          {!showAddFeed && externalFeeds.every((f) => f.source === 'device') && !loadingExternalFeeds && (
            <button
              type="button"
              onClick={() => setShowAddFeed(true)}
              className="w-full bg-white border border-cream-border rounded-2xl py-8 flex flex-col items-center gap-3 hover:border-primary transition-colors"
            >
              <span className="flex items-center">
                <span className="-mr-1.5 rotate-[-6deg]"><ProviderLogo id="google" size={30} /></span>
                <span className="z-10"><ProviderLogo id="apple" size={32} /></span>
                <span className="-ml-1.5 rotate-[6deg]"><ProviderLogo id="outlook" size={30} /></span>
              </span>
              <span className="text-sm font-medium text-bark">+ Add calendar</span>
            </button>
          )}

          {externalFeeds.some((f) => f.source !== 'device') && (
            <ul className="space-y-2">
              {externalFeeds.filter((f) => f.source !== 'device').map((feed) => (
                <li key={feed.id} className="bg-white border border-cream-border rounded-2xl px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    {/* Owner swatch - shows the colour of the member this
                        calendar belongs to (or neutral grey when Shared). Tap
                        to expand the "Whose calendar?" picker below the row. */}
                    <button
                      type="button"
                      onClick={() => setFeedOwnerOpenId(feedOwnerOpenId === feed.id ? null : feed.id)}
                      aria-label={`Set whose calendar ${feed.display_name} is`}
                      title="Whose calendar?"
                      className="w-5 h-5 rounded-full shrink-0 ring-1 ring-cream-border hover:ring-bark transition-shadow"
                      style={{ backgroundColor: MEMBER_HEX[feed.color] || MEMBER_HEX.slate }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-bark truncate">{feed.display_name}</p>
                      <p className="text-xs text-cocoa truncate">
                        {feed.last_synced_at
                          ? `Last refreshed ${new Date(feed.last_synced_at).toLocaleString()}`
                          : 'Never refreshed'}
                        {/* "partial-pull:" markers are delete-confirmation
                            bookkeeping (sync is healthy), not errors. */}
                        {feed.last_error && !feed.last_error.startsWith('partial-pull:') && ' · last error: ' + feed.last_error}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleRefreshExternalFeed(feed.id)}
                        disabled={feedActionId === feed.id}
                        aria-label={`Refresh ${feed.display_name}`}
                        title="Refresh"
                        className="p-1.5 text-primary hover:text-primary-pressed disabled:opacity-50"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={feedActionId === feed.id ? 'animate-spin' : ''} aria-hidden="true">
                          <path d="M21 12a9 9 0 1 1-3.5-7.1" />
                          <polyline points="21 4 21 10 15 10" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleRemoveExternalFeed(feed.id)}
                        disabled={feedActionId === feed.id}
                        aria-label={`Remove ${feed.display_name}`}
                        title="Remove"
                        className="p-1.5 text-error hover:text-error/80 disabled:opacity-50"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* "Whose calendar?" picker - expands beneath the row when the
                      owner swatch is tapped. Picking a member attributes the
                      calendar's events to them (their colour + their filter);
                      "Shared" makes it neutral with no assignee. */}
                  {feedOwnerOpenId === feed.id && (
                    <div className="mt-2 pt-2 border-t border-cream-border">
                      <p className="text-xs text-cocoa mb-2">Whose calendar is this?</p>
                      <div className="flex flex-wrap gap-1.5">
                        {members.map((m) => {
                          const isOwner = feed.owner_member_id === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => handleSetFeedOwner(feed.id, m.id)}
                              aria-label={`Assign ${feed.display_name} to ${m.name}`}
                              className={`flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full border text-xs transition-colors ${isOwner ? 'border-bark bg-oat' : 'border-cream-border hover:border-bark'}`}
                            >
                              <Avatar member={m} size={20} />
                              <span className="text-bark truncate max-w-[88px]">{m.name}</span>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => handleSetFeedOwner(feed.id, null)}
                          aria-label={`Mark ${feed.display_name} as shared`}
                          className={`flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full border text-xs transition-colors ${!feed.owner_member_id ? 'border-bark bg-oat' : 'border-cream-border hover:border-bark'}`}
                        >
                          <span className="w-5 h-5 rounded-full shrink-0" style={{ background: MEMBER_HEX.slate }} />
                          <span className="text-bark">Shared</span>
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleRow>
        </div>

      </SectionWrapper>


      {/* Send Emails to AI */}
      <SectionWrapper slug="emails-to-ai" title="Send Emails to AI" icon={IconMail} accordion>
        <p className="text-sm text-cocoa mb-3">
          Forward any email to your household's unique address and our AI will automatically extract the details - receipts, flight bookings, school newsletters, appointment reminders, and more.
        </p>
        {receiptEmail ? (
          <div className="space-y-4">
            {/* Inbound address (alias preferred, token fallback) */}
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={receiptEmail}
                className="flex-1 border border-cream-border rounded-2xl px-3 py-2 text-sm bg-oat text-cocoa select-all"
                onClick={(e) => e.target.select()}
              />
              <button
                onClick={handleCopyReceiptEmail}
                className="bg-primary hover:bg-primary-pressed text-white font-medium px-4 py-2 rounded-2xl text-sm transition-colors whitespace-nowrap"
              >
                {receiptCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            {/* Alias editor - only admins can change. Inline editor
                appears under the address input when "Edit" is tapped. */}
            {isAdmin && !aliasEditing && (
              <button
                type="button"
                onClick={openAliasEditor}
                className="text-xs font-medium text-plum hover:underline"
              >
                {household?.email_alias ? 'Change alias' : 'Pick a memorable alias'}
              </button>
            )}
            {isAdmin && aliasEditing && (
              <div className="border border-cream-border rounded-xl p-3 bg-white space-y-2">
                <label className="text-xs font-semibold text-cocoa">Choose an alias</label>
                <div className="flex items-stretch gap-2">
                  <input
                    type="text"
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value.toLowerCase())}
                    placeholder="e.g. smithfamily"
                    autoFocus
                    className="flex-1 min-w-0 border border-cream-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <span className="shrink-0 flex items-center text-sm text-cocoa whitespace-nowrap">
                    @inbound.housemait.com
                  </span>
                </div>
                {aliasAvailability && aliasInput.trim() && (
                  <p className={`text-xs ${aliasAvailability.available ? 'text-emerald-700' : 'text-coral'}`}>
                    {aliasAvailability.available
                      ? `✓ ${aliasAvailability.normalised || aliasInput.trim()} is available`
                      : `✗ ${aliasAvailability.reason}`}
                  </p>
                )}
                {aliasError && <p className="text-xs text-coral">{aliasError}</p>}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleSaveAlias}
                    disabled={aliasSaving || (aliasAvailability && !aliasAvailability.available)}
                    className="bg-primary hover:bg-primary-pressed disabled:opacity-50 text-white font-medium px-4 py-1.5 rounded-lg text-xs transition-colors"
                  >
                    {aliasSaving ? 'Saving…' : 'Save alias'}
                  </button>
                  <button
                    onClick={() => { setAliasEditing(false); setAliasError(''); }}
                    className="text-xs text-cocoa hover:text-bark"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Sender allowlist - anyone in the household can view; only
                admins can add/remove. */}
            <div className="pt-3 border-t border-cream-border">
              <p className="text-sm font-semibold text-bark mb-2">You can send from these email addresses:</p>
              {senders.length > 0 ? (
                <ul className="border border-cream-border rounded-xl divide-y divide-cream-border bg-white">
                  {senders.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <svg className="h-4 w-4 text-cocoa shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-10 6L2 7" />
                      </svg>
                      <span className="flex-1 text-sm text-bark truncate">{s.email}</span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSender(s.id, s.email)}
                          aria-label={`Remove ${s.email}`}
                          className="text-cocoa hover:text-coral transition-colors p-1"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-cocoa italic">No senders on the allowlist yet - anyone trying to forward to your inbound address will be blocked. Add an email below to get started.</p>
              )}
              {isAdmin && (
                <form onSubmit={handleAddSender} className="mt-3 flex gap-2">
                  <input
                    type="email"
                    value={senderInput}
                    onChange={(e) => setSenderInput(e.target.value)}
                    placeholder="another@email.com"
                    className="flex-1 border border-cream-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <button
                    type="submit"
                    disabled={senderAdding || !senderInput.trim()}
                    className="bg-primary hover:bg-primary-pressed disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors whitespace-nowrap"
                  >
                    {senderAdding ? 'Adding…' : '+ Add email'}
                  </button>
                </form>
              )}
              {senderError && <p className="text-xs text-coral mt-1">{senderError}</p>}
            </div>

            {/* Rejected-sender nudge: mail we blocked because the sender
                wasn't on the allowlist. Admin-only, since only admins can
                allow. Surfacing this turns a silent failure ("I forwarded
                it and nothing happened") into a one-tap fix. */}
            {isAdmin && rejections.length > 0 && (
              <div className="rounded-xl border border-coral/30 bg-coral-light p-3.5">
                <p className="text-sm font-semibold text-bark mb-1">We blocked some forwarded mail</p>
                <p className="text-xs text-cocoa mb-3">
                  These addresses tried to forward to your inbound email but aren't on your allowlist, so we ignored them. Recognise one? Allow it and re-forward.
                </p>
                <ul className="space-y-2">
                  {rejections.map((r) => (
                    <li key={r.email} className="flex items-center gap-2 bg-white border border-cream-border rounded-lg px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-bark truncate">{r.email}</p>
                        {r.subject && <p className="text-xs text-cocoa truncate">{r.subject}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAllowRejected(r.email)}
                        disabled={allowingRejected === r.email}
                        className="bg-primary hover:bg-primary-pressed disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded-lg text-xs transition-colors whitespace-nowrap"
                      >
                        {allowingRejected === r.email ? 'Allowing…' : 'Allow'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissRejected(r.email)}
                        aria-label={`Dismiss ${r.email}`}
                        className="text-cocoa hover:text-bark transition-colors p-1"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isAdmin && (
              <button
                onClick={handleRegenerateReceiptEmail}
                disabled={regeneratingReceipt}
                className="text-xs text-cocoa hover:text-error transition-colors"
              >
                {regeneratingReceipt ? 'Regenerating...' : 'Regenerate backup address'}
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-cocoa">
            Your household does not have a forwarding email address yet. It will be generated automatically.
          </p>
        )}
      </SectionWrapper>

      </div>

      {/* Grouped wrapper for Notifications + Active sessions - the
          two sections that stay collapsible on web. On web the wrapper
          is a shared bg-linen card with internal hairlines between
          the two accordions. On iOS the wrapper is an unstyled div so
          each section renders standalone (sub-page mode wraps each
          in its own card via SectionWrapper; list mode skips them).
          Wrapper must always render so children stay mounted - the
          previous bug was gating the wrapper conditionally, which
          dropped the children too. */}
      {!isIosPlatform && <SectionLabel>Notifications &amp; privacy</SectionLabel>}
      <div
        className={isIosPlatform ? '' : `${SET_CARD_CLASS} px-5 md:px-6 !mt-0`}
        style={isIosPlatform ? undefined : { boxShadow: SET_CARD_SHADOW }}
      >

      {/* Child Mode renders as a standalone gradient card near the top of
          the page on every platform - no accordion row or iOS popup. */}

      {/* Notifications - unified on every platform. Two subsections:
          Push (iOS only, where APNs delivers) and WhatsApp (any platform
          once linked). Each subsection lists per-type toggles wired to
          notification_preferences. Rendered always so users on web also
          know the section exists; subsection content adapts to capability. */}
      <SectionWrapper slug="notifications" title="Notifications" icon={IconBell} accordion>
        {loadingNotifPrefs ? (
          <div className="py-4 text-center text-sm text-cocoa">Loading…</div>
        ) : notifPrefs ? (
          <div className="space-y-6">
            {/* Morning briefing - the master switch for the daily brief.
                It's delivered as a push if the app is installed, otherwise
                on WhatsApp, so it lives ABOVE the channel subsections and is
                always reachable (push-only users couldn't see it when it was
                nested under WhatsApp). Bound to whatsapp_daily_reminder. */}
            <div className="flex items-center justify-between pb-5 border-b border-cream-border">
              <div className="min-w-0 flex-1 pr-3">
                <p className="text-sm font-medium text-bark">Morning briefing</p>
                <p className="text-xs text-cocoa">Your daily summary of what&apos;s on - sent as a phone notification if you have the app, otherwise on WhatsApp.</p>
              </div>
              <button
                onClick={() => toggleNotifPref('whatsapp_daily_reminder')}
                disabled={savingNotifPref === 'whatsapp_daily_reminder'}
                aria-label="Toggle morning briefing"
                className={`relative shrink-0 ml-3 w-11 h-6 rounded-full transition-colors duration-200 ${
                  notifPrefs.whatsapp_daily_reminder !== false ? 'bg-primary' : 'bg-sand'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                    notifPrefs.whatsapp_daily_reminder !== false ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Push subsection - iOS app only */}
            <div>
              <h3 className="text-sm font-semibold text-bark mb-1">Push notifications</h3>
              {isNative ? (
                <>
                  <p className="text-xs text-cocoa mb-3">Delivered to your iPhone&apos;s lock screen.</p>
                  <div className="space-y-1">
                    {[
                      { key: 'calendar_reminders', label: 'Calendar reminders', desc: 'New events and upcoming reminders' },
                      { key: 'task_assigned', label: 'Task assignments', desc: 'When a task is assigned to you' },
                      { key: 'shopping_updated', label: 'Shopping list updates', desc: 'When someone adds to the shopping list' },
                      { key: 'meal_plan_updated', label: 'Meal plan changes', desc: 'When the meal plan is updated' },
                      { key: 'family_activity', label: 'Family activity', desc: 'New members and household updates' },
                    ].map(({ key, label, desc }) => (
                      <div key={key} className="flex items-center justify-between py-3 px-1">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-bark">{label}</p>
                          <p className="text-xs text-cocoa">{desc}</p>
                        </div>
                        <button
                          onClick={() => toggleNotifPref(key)}
                          disabled={savingNotifPref === key}
                          className={`relative shrink-0 ml-3 w-11 h-6 rounded-full transition-colors duration-200 ${
                            notifPrefs[key] ? 'bg-primary' : 'bg-sand'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                              notifPrefs[key] ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-cocoa">Available in the Housemait iOS app.</p>
              )}
            </div>

            {/* WhatsApp subsection - works on every platform once linked */}
            <div className="pt-6 border-t border-cream-border">
              <h3 className="text-sm font-semibold text-bark mb-1">WhatsApp notifications</h3>
              {(() => {
                const meRow = members.find((m) => m.id === user?.id);
                const linked = !!meRow?.whatsapp_linked;
                if (!linked) {
                  return <p className="text-xs text-cocoa">Connect WhatsApp (above) to receive bot messages.</p>;
                }
                return (
                  <>
                    <p className="text-xs text-cocoa mb-3">Choose which messages the Housemait bot sends you on WhatsApp.</p>
                    <div className="space-y-1">
                      {[
                        { key: 'whatsapp_event_reminders', label: 'Event reminders', desc: 'Heads-up before an event starts (uses per-event timing)' },
                        { key: 'whatsapp_weekly_digest', label: 'Weekly digest', desc: 'Sunday recap of the week ahead and tasks done' },
                        { key: 'whatsapp_overdue_nudge', label: 'Overdue task nudges', desc: 'Gentle reminder when tasks are past due' },
                        { key: 'whatsapp_subscription_reminder', label: 'Subscription renewals', desc: 'Three days before a tracked subscription renews' },
                      ].map(({ key, label, desc }) => (
                        <div key={key} className="flex items-center justify-between py-3 px-1">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-bark">{label}</p>
                            <p className="text-xs text-cocoa">{desc}</p>
                          </div>
                          <button
                            onClick={() => toggleNotifPref(key)}
                            disabled={savingNotifPref === key}
                            className={`relative shrink-0 ml-3 w-11 h-6 rounded-full transition-colors duration-200 ${
                              notifPrefs[key] !== false ? 'bg-primary' : 'bg-sand'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                                notifPrefs[key] !== false ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        ) : null}
      </SectionWrapper>

      {/* Location - device GPS is the primary source for the weather widget
          and location-aware AI answers; the Family Setup address is the
          fallback. Lets the user grant, see, or re-enable the permission. */}
      <SectionWrapper slug="location" title="Location" icon={IconMapPin} accordion>
        <p className="text-sm text-cocoa">
          Housemait uses your current location to show local weather on your
          home screen and to answer questions that depend on where you are.
          When location is off, it uses your household address from Family
          Setup instead.
        </p>

        <div className="mt-4">
          {locationPerm === null ? (
            <p className="text-sm text-cocoa">Checking…</p>
          ) : locationPerm === 'granted' ? (
            <div className="flex items-center gap-2 rounded-xl border border-cream-border bg-leaf/10 p-3">
              <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-leaf" aria-hidden="true" />
              <p className="text-sm text-bark">
                <span className="font-semibold">Location is on.</span>{' '}
                Weather and the assistant use your current location.
                {isNative && ' You can turn this off in your device Settings.'}
              </p>
            </div>
          ) : locationPerm === 'denied' ? (
            <div className="rounded-xl border border-cream-border p-3">
              <p className="text-sm text-bark mb-3">
                <span className="font-semibold">Location is off.</span>{' '}
                {isNative
                  ? 'Turn it back on in your device Settings to use local weather and location-aware answers.'
                  : 'Allow location for this site in your browser settings to use local weather and location-aware answers.'}
              </p>
              {isNative && (
                <button
                  type="button"
                  onClick={openLocationSettings}
                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  Open Settings
                </button>
              )}
            </div>
          ) : locationPerm === 'unavailable' ? (
            <p className="text-sm text-cocoa">
              Location isn't available on this device. Housemait will use your
              household address from Family Setup instead.
            </p>
          ) : (
            // 'prompt'
            <button
              type="button"
              onClick={handleRequestLocation}
              disabled={requestingLocation}
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-primary text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {requestingLocation ? 'Requesting…' : 'Use my location'}
            </button>
          )}
        </div>
      </SectionWrapper>

      {/* Active sessions - lets users see + revoke live refresh tokens.
          Security-adjacent but non-destructive to the account itself;
          sits above the GDPR export so the "who's logged in right now"
          question is answered before the heavier "export everything" tool. */}
      <SectionWrapper slug="sessions" title="Active sessions" icon={IconShield} accordion>
        <p className="text-sm text-cocoa">
          Everywhere you're signed into Housemait right now. Revoke any you
          don't recognise - the device gets signed out immediately.
        </p>

        <div className="mt-4 space-y-2">
          {loadingSessions ? (
            <p className="text-sm text-cocoa">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-cocoa">No active sessions found.</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border border-cream-border p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-bark truncate">
                    {describeDevice(s.userAgent)}
                    {s.isCurrent && (
                      <span className="ml-2 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-plum-light text-plum">
                        This session
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-cocoa mt-0.5">
                    {s.ipAddress || 'Unknown IP'} · Last used {formatWhen(s.lastUsedAt)}
                    {s.createdAt && <> · Signed in {formatWhen(s.createdAt)}</>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevokeSession(s.id, s.isCurrent)}
                  disabled={revokingSessionId === s.id}
                  className="shrink-0 px-3 py-1.5 rounded-lg border border-cream-border text-sm font-medium text-bark hover:bg-cream disabled:opacity-50 transition-colors"
                >
                  {revokingSessionId === s.id ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bulk action - show only when more than one session exists. */}
        {sessions.length > 1 && (
          <button
            type="button"
            onClick={handleRevokeAllOthers}
            disabled={revokingAllOthers}
            className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl border border-cream-border text-bark hover:bg-cream font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {revokingAllOthers ? 'Revoking…' : 'Revoke all other sessions'}
          </button>
        )}
      </SectionWrapper>

      </div>

      {/* Your data - GDPR right to portability (Article 20). Sits below
          Active sessions; non-destructive action, no surprises. */}
      {!isIosPlatform && <SectionLabel>Account</SectionLabel>}
      <SectionWrapper slug="data" title="Your data" icon={IconDownload}>
        <p className="text-sm text-cocoa">
          Download a JSON file with every row Housemait holds about you and
          your household - tasks, events, shopping lists, notes, documents
          metadata, message history. Safe to generate any time; nothing is
          deleted.
        </p>
        <button
          type="button"
          onClick={handleExportData}
          disabled={exporting}
          className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl border border-cream-border text-bark hover:bg-cream font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? 'Preparing…' : 'Export my data'}
        </button>
      </SectionWrapper>

      {/* Danger zone - delete account. Sits above the Log out affordance
          because Log out is the very last thing on the page; users
          looking to leave the app see it without having to scroll past
          a destructive action. SectionWrapper renders this as a danger-
          tinted SettingsCard on web; on iOS list mode the danger row
          lives in the section list above instead, and on the
          /settings/delete sub-page it renders bare. */}
      <SectionWrapper slug="delete" title="Delete account" icon={IconTrash} danger>
        <p className="text-sm text-cocoa">
          Permanently delete your Housemait account. If you're the only
          member of your household, <strong className="text-bark">everything in it</strong>{' '}
          - tasks, events, shopping lists, notes, documents - will also be
          deleted. This cannot be undone.
        </p>
        <button
          onClick={() => {
            setDeleteOpen(true);
            setDeletePassword('');
            setDeleteConfirmed(false);
            setDeleteTypedConfirm('');
            setDeleteError('');
          }}
          className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-xl bg-error hover:bg-error/90 text-white font-semibold text-sm transition-colors"
        >
          Delete my account
        </button>
      </SectionWrapper>

      {/* Log out - bottom of the page. Standard convention in most
          settings UIs; users scrolling to the end of Settings expect to
          find it here. */}
      <button
        onClick={() => { logout(); navigate('/'); }}
        className="w-full mt-6 py-3 rounded-2xl border border-error/30 text-error font-semibold text-sm hover:bg-error/5 transition-colors"
      >
        Log out
      </button>

      {/* Delete Account Modal */}
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !deleting && setDeleteOpen(false)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base md:text-medium font-semibold text-bark">Delete your account?</h2>
              <button
                type="button"
                onClick={() => !deleting && setDeleteOpen(false)}
                className="text-cocoa hover:text-bark p-1"
                disabled={deleting}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-cocoa mb-4">
              This permanently deletes your Housemait account. If you're the only
              member of <strong className="text-bark">{household?.name || 'your household'}</strong>,
              the household and all its data will be deleted too.
            </p>

            {deleteError && (
              <div className="mb-3 p-3 rounded-lg bg-error/10 border border-error/30 text-sm text-error">
                {deleteError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleDeleteAccount();
              }}
              className="space-y-3"
            >
              {/* Password re-auth only for accounts that have a password.
                  Google/Apple SSO users have none, so we drop the field for
                  them (otherwise their account is impossible to delete). */}
              {accountInfo.has_password === false ? (
                <p className="text-sm text-cocoa">
                  You signed in with {accountInfo.auth_provider === 'apple' ? 'Apple' : 'Google'}, so there's no password to enter.
                </p>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-bark mb-1.5">
                    Your password
                  </label>
                  <input
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    disabled={deleting}
                    className="w-full border border-cream-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition-all text-bark"
                  />
                </div>
              )}

              {/* Typed-DELETE confirmation - matches the spec's two-step
                  destructive-action pattern (Phase 8 / GDPR). Input is
                  case-sensitive; the backend also enforces this. */}
              <div>
                <label className="block text-xs font-semibold text-bark mb-1.5">
                  Type <span className="font-mono bg-cream px-1.5 py-0.5 rounded">DELETE</span> to confirm
                </label>
                <input
                  type="text"
                  value={deleteTypedConfirm}
                  onChange={(e) => setDeleteTypedConfirm(e.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                  disabled={deleting}
                  placeholder="DELETE"
                  className="w-full border border-cream-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-error/30 focus:border-error transition-all text-bark font-mono tracking-widest"
                />
              </div>

              <label className="flex items-start gap-3 text-sm text-bark cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deleteConfirmed}
                  onChange={(e) => setDeleteConfirmed(e.target.checked)}
                  disabled={deleting}
                  className="mt-1 h-4 w-4 accent-error"
                />
                <span>
                  I understand this cannot be undone.
                </span>
              </label>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-xl border border-cream-border text-bark font-medium text-sm hover:bg-cream transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    deleting ||
                    (accountInfo.has_password !== false && !deletePassword) ||
                    deleteTypedConfirm !== 'DELETE' ||
                    !deleteConfirmed
                  }
                  className="flex-1 py-3 rounded-xl bg-error hover:bg-error/90 disabled:bg-error/40 text-white font-semibold text-sm transition-colors"
                >
                  {deleting ? 'Deleting…' : 'Delete account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Child-mode launcher: "Whose turn is it?" per-child picker with a
          short hand-off beat, then the device locks into Child Mode. */}
      {pickKidOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: 'rgba(26,22,32,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => { if (!enteringKid) setPickKidOpen(false); }}
        >
          <div
            className="w-[420px] max-w-[92vw] bg-white rounded-[22px] p-7"
            style={{ boxShadow: '0 30px 80px rgba(26,22,32,0.35)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {enteringKid ? (
              <div className="text-center py-3">
                <div className="mx-auto mb-4 flex items-center justify-center"><Avatar member={enteringKid} size={96} /></div>
                <div className="text-[30px] text-bark" style={{ fontFamily: 'var(--font-serif-display)' }}>Hi {enteringKid.name}! 👋</div>
                <div className="text-sm text-warm-grey mt-1.5">Opening your space…</div>
              </div>
            ) : (
              <>
                <div className="text-[26px] text-bark text-center" style={{ fontFamily: 'var(--font-serif-display)' }}>Whose turn is it?</div>
                <div className="text-[13.5px] text-warm-grey text-center mt-1.5 mb-5">Open Child mode for…</div>
                <div className="flex flex-col gap-2.5">
                  {kidMembers.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => launchChildModeFor(k)}
                      className="flex items-center gap-3.5 p-3 rounded-[14px] border border-[rgba(26,22,32,0.07)] bg-white text-left hover:bg-oat transition-colors"
                    >
                      <Avatar member={k} size={46} />
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-bold text-bark">{k.name}</div>
                        <div className="text-[12.5px] text-warm-grey">Quests · Star Shop · My Days</div>
                      </div>
                      <IconChevronRight className="w-4 h-4 text-warm-grey/60 shrink-0" />
                    </button>
                  ))}
                  {kidMembers.length === 0 && (
                    <button
                      type="button"
                      onClick={() => launchChildModeFor(null)}
                      className="p-3 rounded-[14px] border border-[rgba(26,22,32,0.07)] bg-white text-sm font-semibold text-bark hover:bg-oat transition-colors"
                    >
                      Start Child mode on this device
                    </button>
                  )}
                </div>
                <div className="text-xs text-warm-grey text-center mt-4">🔒 You&apos;ll need your PIN to switch back out.</div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Profile editing lives on the Family page (the canonical editor with
          avatars/colour/role). The "Edit" button in My profile deep-links to
          /family?editProfile=1, so there is no second edit form here. */}
    </div>
  );
}

