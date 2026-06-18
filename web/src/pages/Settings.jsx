import { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import Spinner from '../components/Spinner';
import WhatsAppPairing from '../components/WhatsAppPairing';
import DeviceCalendarSync from '../components/DeviceCalendarSync';
import { isDeviceCalendarSupported } from '../lib/deviceCalendar';
import { useAppForegroundRefresh } from '../hooks/useAppForegroundRefresh';
import { isIos } from '../lib/platform';
import { formatRelativeTime } from '../lib/formatRelativeTime';
import {
  IconMessageCircle, IconCalendar, IconMail, IconBell,
  IconDownload, IconShield, IconUser, IconTrash, IconChevronRight, IconX, IconMapPin,
} from '../components/Icons';
import { TrialIndicatorSubtle } from '../components/TrialIndicator';
import { useSubscription } from '../context/SubscriptionContext';
import { pickPhoto } from '../lib/photo-picker';
import resizeImage from '../lib/resizeImage';
import {
  getLocationPermission, requestLocationPermission, openLocationSettings, clearLocationCache,
} from '../lib/location';

const avatarColors = {
  red: 'bg-red text-white', 'burnt-orange': 'bg-burnt-orange text-white',
  amber: 'bg-amber text-white', gold: 'bg-gold text-white',
  leaf: 'bg-leaf text-white', emerald: 'bg-emerald text-white',
  teal: 'bg-teal text-white', sky: 'bg-sky text-white',
  cobalt: 'bg-cobalt text-white', indigo: 'bg-indigo text-white',
  purple: 'bg-purple text-white', magenta: 'bg-magenta text-white',
  rose: 'bg-rose text-white', terracotta: 'bg-terracotta text-white',
  moss: 'bg-moss text-white', slate: 'bg-slate text-white',
  sage: 'bg-sage text-white', plum: 'bg-plum text-white', coral: 'bg-coral text-white', lavender: 'bg-indigo text-white',
};

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
    return (
      <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#4285F4" />
        <rect x="4.5" y="6" width="15" height="14" rx="2.5" fill="#fff" />
        <text x="12" y="16.6" textAnchor="middle" fontSize="9" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text>
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
    return (
      <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#0F6CBD" />
        <rect x="9.5" y="6" width="10" height="12" rx="1.5" fill="#fff" opacity="0.9" />
        <circle cx="9" cy="12" r="5.2" fill="#0F6CBD" stroke="#fff" strokeWidth="1.6" />
        <circle cx="9" cy="12" r="2.1" fill="none" stroke="#fff" strokeWidth="1.6" />
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

// Per-provider wizard steps for the add-calendar form. `link` deep-links as
// close to the page holding the address as each provider allows - Outlook
// lands EXACTLY on the publish page; Google can only deep-link to settings
// (the per-calendar page needs an id we can't know).
const FEED_PROVIDERS = [
  {
    id: 'google',
    label: 'Google calendar',
    link: 'https://calendar.google.com/calendar/u/0/r/settings',
    linkLabel: 'Open Google Calendar settings',
    steps: [
      'Pick your calendar on the left, under "Settings for my calendars".',
      'Scroll to "Integrate calendar".',
      'Copy "Secret address in iCal format" and paste it below.',
    ],
    placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
    iosTip: 'On a phone, tap AA in Safari\'s address bar → Request Desktop Website first.',
  },
  {
    id: 'outlook',
    label: 'Outlook calendar',
    link: 'https://outlook.live.com/calendar/0/options/calendar/SharedCalendars',
    linkLabel: 'Open Outlook\'s publish page',
    steps: [
      'Under "Publish a calendar", choose the calendar and "Can view all details", then click Publish.',
      'Copy the ICS link it shows and paste it below.',
    ],
    placeholder: 'https://outlook.live.com/owa/calendar/…/calendar.ics',
    iosTip: 'On a phone, tap AA in Safari\'s address bar → Request Desktop Website first.',
  },
  {
    id: 'apple',
    label: 'Apple calendar',
    link: 'https://www.icloud.com/calendar',
    linkLabel: 'Open iCloud Calendar',
    steps: [
      'Click the share icon next to the calendar in the left sidebar.',
      'Tick "Public Calendar" and copy the webcal:// link.',
      'Paste it below.',
    ],
    placeholder: 'webcal://p12-caldav.icloud.com/published/…',
    // On the iPhone the Calendar app beats iCloud.com - swapped in at render.
    iosSteps: [
      'Open the iPhone Calendar app → tap "Calendars" at the bottom.',
      'Tap (i) next to the calendar → turn on "Public Calendar".',
      'Tap "Share Link…" → Copy, then paste it below.',
    ],
  },
  // NOTE: a generic "school or club link" row used to live here. Removed for
  // now - it muddied the picker next to the Family → Schools term-dates
  // import, and pasting a feed link to the WhatsApp bot subscribes it
  // directly anyway. Existing link subscriptions are unaffected.
];

/**
 * Settings → Plan card. Renders subscription state + the right CTA for
 * the current status. Extracted into its own component so the Settings
 * page layout stays readable; it only reads from SubscriptionContext
 * and doesn't need any props.
 *
 *   • internal  → "Internal account - unlimited access"
 *   • trialing  → "Free trial · X days left" + Subscribe CTA
 *   • active    → Plan name + "Manage subscription" (opens Stripe Portal)
 *   • expired   → "Your subscription has ended" + Subscribe CTA
 *   • cancelled → same as expired
 *   • loading   → subtle loading state (no spinner - this card is ambient)
 */
function PlanSection() {
  const { isActive, isTrialing, isExpired, isInternal, plan, provider, daysRemaining, trialEndsAt, loading } = useSubscription();
  // Billing is owner-only: non-owners see the plan status but not the
  // subscribe/manage controls (the server also enforces this).
  const { isOwner } = useAuth();
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

  // Don't render anything while we don't know the state yet - the subtle
  // indicator in My profile covers the "I know nothing" case silently.
  if (loading && !isActive && !isTrialing && !isExpired && !isInternal) return null;

  return (
    <div className="bg-linen rounded-2xl p-4.5 md:p-6" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
      <h2 className="text-base md:text-medium font-semibold text-bark mb-2">Plan</h2>

      {isInternal && (
        <p className="text-sm text-cocoa">
          <span className="inline-block bg-plum-light text-plum font-semibold text-xs px-2 py-0.5 rounded mr-2">
            Internal
          </span>
          Unlimited access. No billing applies to this household.
        </p>
      )}

      {!isInternal && isTrialing && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-cocoa">
              <strong className="text-plum font-semibold">Free trial</strong>
              {daysRemaining != null && (
                <span> · {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} left</span>
              )}
              {trialEndsAt && (
                <span className="text-warm-grey">
                  {' '}(ends {new Intl.DateTimeFormat('en-GB', {
                    day: 'numeric', month: 'long', timeZone: 'Europe/London',
                  }).format(new Date(trialEndsAt))})
                </span>
              )}
            </p>
            <p className="text-xs text-warm-grey mt-1">
              Subscribe any time to avoid interruption.
            </p>
          </div>
          {isOwner ? (
            <Link
              to="/subscribe"
              className="inline-flex items-center px-4 py-2 rounded-xl bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
            >
              Subscribe
            </Link>
          ) : (
            <span className="text-xs text-warm-grey">Managed by the account owner</span>
          )}
        </div>
      )}

      {!isInternal && isActive && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-cocoa">
              <strong className="text-emerald font-semibold">Active</strong>
              {plan && (
                <span className="text-charcoal">
                  {' '}· {plan === 'annual' ? 'Annual plan' : 'Monthly plan'}
                </span>
              )}
            </p>
            <p className="text-xs text-warm-grey mt-1">
              {provider === 'apple'
                ? 'Update card, switch plans, or cancel anytime in your Apple ID subscriptions.'
                : 'Update card, switch plans, or cancel anytime from the Stripe portal.'}
            </p>
          </div>
          {isOwner ? (
            <button
              type="button"
              onClick={openCustomerPortal}
              disabled={portalLoading}
              className="inline-flex items-center px-4 py-2 rounded-xl border-[1.5px] border-plum text-plum hover:bg-plum-light text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {portalLoading ? 'Opening…' : 'Manage subscription'}
            </button>
          ) : (
            <span className="text-xs text-warm-grey">Managed by the account owner</span>
          )}
        </div>
      )}

      {!isInternal && isExpired && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm text-cocoa">
              <strong className="text-coral font-semibold">Subscription ended</strong>
            </p>
            <p className="text-xs text-warm-grey mt-1">
              Your data's still here. Subscribe to unlock everything again.
            </p>
          </div>
          {isOwner ? (
            <Link
              to="/subscribe"
              className="inline-flex items-center px-4 py-2 rounded-xl bg-plum hover:bg-plum-pressed text-white text-sm font-semibold transition-colors"
            >
              Subscribe
            </Link>
          ) : (
            <span className="text-xs text-warm-grey">Managed by the account owner</span>
          )}
        </div>
      )}

      {portalError && (
        <p className="text-sm text-coral mt-3">{portalError}</p>
      )}
    </div>
  );
}

/**
 * EditProfileForm - the form body of the Edit-profile modal. Extracted
 * so the iOS popup wrapper and the web centered-modal wrapper can both
 * render the same form without duplicating ~80 lines of JSX. All state
 * + handlers come in via props (the Settings component owns them).
 */
function EditProfileForm({
  profileAvatar, profileName, profileColor, profileRole, profileBirthday,
  uploadingAvatar, savingProfile, avatarColors,
  setProfileName, setProfileRole, setProfileBirthday, setProfileColor,
  handlePickAvatar, handleAvatarRemove, handleSaveProfile, onCancel,
}) {
  return (
    <>
      <div className="space-y-4">
        {/* Avatar upload */}
        <div className="flex flex-col items-center gap-2">
          {profileAvatar ? (
            <img src={profileAvatar} alt={profileName} className="w-20 h-20 rounded-full object-cover" />
          ) : (
            <div className={`w-20 h-20 rounded-full ${avatarColors[profileColor] || avatarColors.teal} flex items-center justify-center font-bold text-2xl`}>
              {profileName?.[0]?.toUpperCase() || '?'}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePickAvatar}
              disabled={uploadingAvatar}
              className={`text-sm font-medium ${uploadingAvatar ? 'text-cocoa' : 'text-primary hover:text-primary-pressed'} transition-colors`}
            >
              {uploadingAvatar ? 'Uploading…' : 'Upload photo'}
            </button>
            {profileAvatar && (
              <button type="button" onClick={handleAvatarRemove} disabled={uploadingAvatar} className="text-sm text-error hover:text-error/80 transition-colors">
                Remove
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-bark mb-1">Name <span className="text-error">*</span></label>
          <input type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="Your name" />
        </div>

        <div>
          <label className="block text-sm font-medium text-bark mb-1">Family role</label>
          <input type="text" value={profileRole} onChange={(e) => setProfileRole(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" placeholder="e.g. Father, Mother, Daughter" />
        </div>

        <div>
          <label className="block text-sm font-medium text-bark mb-1">Birthday</label>
          <input type="date" value={profileBirthday} onChange={(e) => setProfileBirthday(e.target.value)} className="w-full border border-cream-border rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent bg-white" />
        </div>

        <div>
          <label className="block text-sm font-medium text-bark mb-1.5">Colour theme</label>
          <div className="grid grid-cols-8 gap-2.5">
            {[
              { key: 'red',           bg: 'bg-red',           ring: 'ring-red' },
              { key: 'burnt-orange',  bg: 'bg-burnt-orange',  ring: 'ring-burnt-orange' },
              { key: 'amber',         bg: 'bg-amber',         ring: 'ring-amber' },
              { key: 'gold',          bg: 'bg-gold',          ring: 'ring-gold' },
              { key: 'leaf',          bg: 'bg-leaf',          ring: 'ring-leaf' },
              { key: 'emerald',       bg: 'bg-emerald',       ring: 'ring-emerald' },
              { key: 'teal',          bg: 'bg-teal',          ring: 'ring-teal' },
              { key: 'sky',           bg: 'bg-sky',           ring: 'ring-sky' },
              { key: 'cobalt',        bg: 'bg-cobalt',        ring: 'ring-cobalt' },
              { key: 'indigo',        bg: 'bg-indigo',        ring: 'ring-indigo' },
              { key: 'purple',        bg: 'bg-purple',        ring: 'ring-purple' },
              { key: 'magenta',       bg: 'bg-magenta',       ring: 'ring-magenta' },
              { key: 'rose',          bg: 'bg-rose',          ring: 'ring-rose' },
              { key: 'terracotta',    bg: 'bg-terracotta',    ring: 'ring-terracotta' },
              { key: 'moss',          bg: 'bg-moss',          ring: 'ring-moss' },
              { key: 'slate',         bg: 'bg-slate',         ring: 'ring-slate' },
            ].map(({ key, bg, ring }) => (
              <button key={key} type="button" onClick={() => setProfileColor(key)}
                className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center transition-all ${profileColor === key ? `ring-2 ${ring} ring-offset-2` : 'hover:scale-110'}`}
                title={key.charAt(0).toUpperCase() + key.slice(1)}
              >
                {profileColor === key && (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white drop-shadow" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

      </div>

      <div className="flex gap-3 mt-6">
        <button onClick={onCancel} className="flex-1 border border-cream-border text-cocoa font-medium py-2.5 rounded-2xl hover:bg-sand transition-colors">
          Cancel
        </button>
        <button onClick={handleSaveProfile} disabled={savingProfile} className="flex-1 bg-primary hover:bg-primary-pressed disabled:bg-primary/50 text-white font-semibold py-2.5 rounded-2xl transition-colors">
          {savingProfile ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
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
// ── Settings restyle tokens ─────────────────────────────────────────────────
// Mirror the reference palette (already the values the Tasks/Rewards/Lists
// pages use). The web Settings shell adopts the centred single-column "section
// label + card" design; the iOS popup/sub-page markup is intentionally left
// alone.
const SET_INK = '#1A1620', SET_INK2 = '#4A4453', SET_INK3 = '#8A8493';
const SET_LINE = 'rgba(26,22,32,0.07)', SET_LINE_STRONG = 'rgba(26,22,32,0.12)';
const SET_BRAND = '#6C3DD9', SET_DANGER = '#A04257';
const SET_SERIF = '"Instrument Serif", serif';
const settingsCardStyle = (danger) => ({
  background: '#fff',
  border: `1px solid ${danger ? 'rgba(160,66,87,0.25)' : SET_LINE}`,
  borderRadius: 18,
  boxShadow: '0 1px 0 rgba(26,22,32,0.02), 0 4px 14px rgba(26,22,32,0.03)',
});
const settingsLabelStyle = (danger) => ({
  fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: danger ? SET_DANGER : SET_INK3, margin: '0 0 12px 4px',
});

// A small uppercase section label sitting above a white card (the new web
// Settings pattern). `icon` is accepted but ignored - the label has no icon -
// so existing `icon={...}` call sites keep working.
function SettingsCard({ title, danger = false, children }) {
  return (
    <section>
      <div style={settingsLabelStyle(danger)}>{title}</div>
      <div style={{ ...settingsCardStyle(danger), padding: '18px 20px' }}>
        {children}
      </div>
    </section>
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
const IOS_SECTIONS = [
  { slug: 'whatsapp',     title: 'Connect WhatsApp',  icon: 'IconMessageCircle' },
  { slug: 'calendars',    title: 'Connect Calendars', icon: 'IconCalendar' },
  { slug: 'emails-to-ai', title: 'Send Emails to AI', icon: 'IconMail' },
  { slug: 'notifications',title: 'Notifications',     icon: 'IconBell' },
  { slug: 'location',     title: 'Location',          icon: 'IconMapPin' },
  { slug: 'sessions',     title: 'Active sessions',   icon: 'IconShield' },
  { slug: 'data',         title: 'Your data',         icon: 'IconDownload' },
  { slug: 'account',      title: 'Account',           icon: 'IconUser' },
  { slug: 'delete',       title: 'Delete account',    icon: 'IconTrash', danger: true },
];
const IOS_SECTION_ICONS = {
  IconMessageCircle, IconCalendar, IconMail, IconBell, IconMapPin,
  IconShield, IconDownload, IconUser, IconTrash,
};

export default function Settings() {
  // Management controls (e.g. the Send-Emails-to-AI allowlist) gate on
  // canManage - any adult member - per the collaborative model. Billing is
  // owner-only (isOwner), enforced on the server too.
  const { household, user, canManage: isAdmin, isOwner, login, logout, token } = useAuth();
  const navigate = useNavigate();

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
    if (!section || !IOS_SECTIONS.some((s) => s.slug === section)) return undefined;
    if (isIosPlatform) {
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
  const [colorPickerOpenId, setColorPickerOpenId] = useState(null); // id of feed whose inline colour picker is expanded
  const [addingFeed, setAddingFeed] = useState(false);
  // Inline error for the add-feed form, shown next to the Subscribe button.
  // The page-level `error`/`success` surface outside this modal, where a user
  // mid-subscribe can't see them - so a failed pull read as "nothing happened".
  const [feedError, setFeedError] = useState('');
  // Own-avatar in the account header: fall back to the initial if the photo
  // 404s (keyed on the URL so a re-upload retries).
  const [headerAvatarErrUrl, setHeaderAvatarErrUrl] = useState(null);
  const [feedActionId, setFeedActionId] = useState(null); // id of feed currently being refreshed/removed

  // Receipt email forwarding state
  const [receiptEmail, setReceiptEmail] = useState('');
  const [receiptCopied, setReceiptCopied] = useState(false);
  const [regeneratingReceipt, setRegeneratingReceipt] = useState(false);
  // Account card: how the user signs in. Populated from /api/auth/me
  // on mount so it reflects the latest stamp from the user's most
  // recent sign-in (including users whose AuthContext cache pre-dates
  // the auth_provider column existing).
  const [accountInfo, setAccountInfo] = useState({ email: user?.email || null, auth_provider: user?.auth_provider || null });
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

  // Edit profile state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileRole, setProfileRole] = useState('');
  const [profileBirthday, setProfileBirthday] = useState('');
  const [profileColor, setProfileColor] = useState('teal');
  const [profileAvatar, setProfileAvatar] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

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

  async function openEditProfile() {
    let me = members.find((m) => m.id === user?.id);
    // If members haven't loaded yet, fetch directly
    if (!me) {
      try {
        const { data } = await api.get('/household');
        if (data.members) setMembers(data.members);
        me = data.members?.find((m) => m.id === user?.id);
      } catch {
        // Fall back to auth context
      }
    }
    setProfileName(me?.name || user?.name || '');
    setProfileRole(me?.family_role || '');
    setProfileBirthday(me?.birthday || '');
    setProfileColor(me?.color_theme || user?.color_theme || 'sage');
    setProfileAvatar(me?.avatar_url || user?.avatar_url || null);
    setEditingProfile(true);
  }

  async function uploadAvatarBlob(blob) {
    if (!blob) return;
    setUploadingAvatar(true);
    try {
      const resized = await resizeImage(blob);
      const formData = new FormData();
      // Camera-plugin Blobs don't carry a filename - the backend needs
      // one for multipart, so synthesize a stable jpg name.
      formData.append('avatar', resized, resized.name || blob.name || 'avatar.jpg');
      const { data } = await api.post('/household/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setProfileAvatar(data.avatar_url);
      await loadMembers();
      login({ token, user: { ...user, avatar_url: data.avatar_url }, household });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to upload image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  // iOS: opens the native photo picker (with "Take Photo" / "Photo Library").
  // Web: falls back inside pickPhoto() to a hidden <input type="file">.
  async function handlePickAvatar() {
    if (uploadingAvatar) return;
    const blob = await pickPhoto();
    if (blob) await uploadAvatarBlob(blob);
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true);
    try {
      await api.delete('/household/profile/avatar');
      setProfileAvatar(null);
      await loadMembers();
      login({ token, user: { ...user, avatar_url: null }, household });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to remove image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSaveProfile() {
    if (!profileName.trim()) { setError('Name is required.'); return; }
    setSavingProfile(true);
    try {
      await api.patch('/household/profile', {
        name: profileName.trim(),
        family_role: profileRole.trim(),
        birthday: profileBirthday || null,
        color_theme: profileColor,
      });
      await loadMembers();
      const updatedUser = { ...user, name: profileName.trim(), color_theme: profileColor };
      login({ token, user: updatedUser, household });
      setEditingProfile(false);
      setSuccess('Profile updated!');
      setTimeout(() => setSuccess(''), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update profile.');
    } finally {
      setSavingProfile(false);
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
    if (!deletePassword) {
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
      // Backend requires BOTH the password and the literal string
      // "DELETE" - matches the two-factor feel of a destructive action.
      await api.delete('/auth/account', { data: { password: deletePassword, confirmation: 'DELETE' } });
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
    if (!newFeedUrl.trim() || !newFeedName.trim()) {
      setFeedError('URL and name are required.');
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

  async function handleUpdateFeedColor(id, color) {
    setColorPickerOpenId(null);
    // Optimistic update so the swatch flips immediately - revert if the
    // PATCH fails.
    const prev = externalFeeds;
    setExternalFeeds(p => p.map(f => f.id === id ? { ...f, color } : f));
    try {
      await api.patch(`/calendar/external-feeds/${id}`, { color });
    } catch (err) {
      setExternalFeeds(prev);
      setError(err.response?.data?.error || 'Could not update calendar colour.');
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
      .then(({ data }) => setAccountInfo({ email: data.email || null, auth_provider: data.auth_provider || null }))
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


  return (
    <div className="space-y-[30px]" style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 100, color: SET_INK }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: SET_INK3, marginBottom: 6 }}>
          Account &amp; preferences
        </div>
        <h1 style={{ margin: 0, fontFamily: SET_SERIF, fontSize: 44, fontWeight: 400, lineHeight: 1, color: SET_INK }}>
          Settings
        </h1>
      </div>

      <ErrorBanner message={error} onDismiss={() => setError('')} />

      {/* My profile */}
      <>
      {/* My profile */}
      {(() => {
        const me = members.find((m) => m.id === user?.id);
        const ac = avatarColors[me?.color_theme || user?.color_theme] || avatarColors.teal;
        const photo = me?.avatar_url || user?.avatar_url;
        const sub = me?.family_role || user?.email;
        return (
          <section>
            <div style={settingsLabelStyle(false)}>Your profile</div>
            <div style={{ ...settingsCardStyle(false), padding: 22 }}>
              <div className="flex items-center gap-4">
                {photo && headerAvatarErrUrl !== photo ? (
                  <img src={photo} alt={user?.name} onError={() => setHeaderAvatarErrUrl(photo)} style={{ width: 60, height: 60, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div className={`${ac} flex items-center justify-center`} style={{ width: 60, height: 60, borderRadius: '50%', fontWeight: 700, fontSize: 22, flexShrink: 0 }}>
                    {user?.name?.[0]?.toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: SET_INK }}>{user?.name}</div>
                  {sub && <div style={{ fontSize: 13, color: SET_INK3, marginTop: 2 }}>{sub}</div>}
                </div>
                {/* Subtle trial indicator - renders nothing unless the household is trialing. */}
                <TrialIndicatorSubtle />
                <button
                  onClick={openEditProfile}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 9, border: `1px solid ${SET_LINE_STRONG}`, background: '#fff', color: SET_INK2, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                >
                  Edit profile
                </button>
              </div>
            </div>
          </section>
        );
      })()}

      {/* Plan / subscription */}
      <PlanSection />
      </>

      {/* iOS list mode: list of nav rows, each opens a popup overlay
          for that section. Visual mirrors the accordion summaries
          (icon + title + chevron) so the landing surface stays
          familiar - the chevron implies "tap to see more", which is
          true whether the more is inline (accordion), a sub-page, or
          a popup. */}
      {iosListMode && (
        <div className="bg-linen rounded-2xl px-5 md:px-6" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
          {IOS_SECTIONS.map((sec) => {
            const Icon = IOS_SECTION_ICONS[sec.icon];
            const iconColor = sec.danger ? 'text-error' : 'text-plum';
            const titleColor = sec.danger ? 'text-error' : 'text-bark';
            return (
              <button
                key={sec.slug}
                type="button"
                onClick={() => setPopupSlug(sec.slug)}
                className="w-full flex items-center gap-3 py-4 md:py-5 cursor-pointer select-none border-b border-cream-border last:border-b-0 text-left"
              >
                {Icon && <Icon className={`w-4 h-4 md:w-5 md:h-5 shrink-0 ${iconColor}`} />}
                <h2 className={`flex-1 text-base md:text-medium font-semibold ${titleColor}`}>{sec.title}</h2>
                <IconChevronRight className="w-4 h-4 md:w-5 md:h-5 text-cocoa shrink-0" />
              </button>
            );
          })}
        </div>
      )}

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
      <div
        className={isIosPlatform ? '' : 'bg-linen rounded-2xl px-5 md:px-6'}
        style={isIosPlatform ? undefined : { boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}
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
                placeholder="Calendar name (e.g. Work, School, Sasha's iCloud)"
                value={newFeedName}
                onChange={(e) => setNewFeedName(e.target.value)}
                className="w-full border border-cream-border rounded-2xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              {/* Colour picker - 16-swatch palette matching the member-theme
                  picker in FamilySetup. Sets the colour that subscribed-feed
                  events will use on the calendar grid; defaults to 'sky'. */}
              <div>
                <p className="text-xs text-cocoa mb-1.5">Colour <span className="text-cocoa">(how this calendar's events appear on the grid)</span></p>
                <div className="flex flex-wrap gap-2">
                  {FEED_COLOR_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewFeedColor(c)}
                      title={c}
                      aria-label={`Set colour ${c}`}
                      className={`w-6 h-6 rounded-full transition-transform ${newFeedColor === c ? 'ring-2 ring-bark ring-offset-2 ring-offset-white scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: FEED_COLOR_HEX[c] }}
                    />
                  ))}
                </div>
              </div>
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
                    {/* Clickable colour swatch - tap to expand the inline
                        16-colour picker below the row. Optimistically
                        updates on pick. */}
                    <button
                      type="button"
                      onClick={() => setColorPickerOpenId(colorPickerOpenId === feed.id ? null : feed.id)}
                      aria-label={`Change colour for ${feed.display_name}`}
                      className="w-5 h-5 rounded-full shrink-0 ring-1 ring-cream-border hover:ring-bark transition-shadow"
                      style={{ backgroundColor: FEED_COLOR_HEX[feed.color] || FEED_COLOR_HEX.sky }}
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
                  {/* Inline colour picker - expands beneath the row when the
                      swatch is tapped. Same 16-colour palette as the add
                      form. Picking a colour fires the PATCH + collapses. */}
                  {colorPickerOpenId === feed.id && (
                    <div className="mt-2 pt-2 border-t border-cream-border flex flex-wrap gap-2">
                      {FEED_COLOR_PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => handleUpdateFeedColor(feed.id, c)}
                          title={c}
                          aria-label={`Set ${feed.display_name} colour to ${c}`}
                          className={`w-6 h-6 rounded-full transition-transform ${feed.color === c ? 'ring-2 ring-bark ring-offset-2 ring-offset-white scale-110' : 'hover:scale-105'}`}
                          style={{ backgroundColor: FEED_COLOR_HEX[c] }}
                        />
                      ))}
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
      <div
        className={isIosPlatform ? '' : 'bg-linen rounded-2xl px-5 md:px-6'}
        style={isIosPlatform ? undefined : { boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}
      >

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

      {/* Account card - shows name, role, and HOW the user is signed
          in. Sits just above the danger zone so the user has a clear
          reminder of which account they're about to delete. */}
      <SectionWrapper slug="account" title="Account" icon={IconUser}>
        <p className="text-sm text-cocoa">
          Signed in as <span className="font-medium text-bark">{user?.name}</span>
          {user?.role && <span> ({user.role})</span>}
        </p>
        {(accountInfo.email || accountInfo.auth_provider) && (
          <div className="mt-3 flex items-center gap-2 text-sm text-cocoa">
            {accountInfo.auth_provider === 'google' && (
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.11V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
            )}
            {accountInfo.auth_provider === 'apple' && (
              <svg className="h-4 w-4 shrink-0 text-bark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16.365 1.43c0 1.14-.49 2.27-1.28 3.07-.84.85-2.22 1.5-3.34 1.42-.14-1.1.43-2.27 1.21-3.06.86-.87 2.32-1.52 3.41-1.43zM21 17.36c-.55 1.22-.81 1.77-1.52 2.84-1 1.5-2.41 3.36-4.16 3.38-1.55.01-1.95-.96-4.05-.95-2.1.01-2.54.96-4.1.95-1.75-.03-3.08-1.7-4.08-3.2C.28 16.18-.05 11.27 1.7 8.58c1.24-1.91 3.2-3.04 5.04-3.04 1.88 0 3.06 1.03 4.6 1.03 1.5 0 2.42-1.03 4.6-1.03 1.65 0 3.4.9 4.65 2.45-4.08 2.24-3.42 8.08.4 9.37z"/>
              </svg>
            )}
            {accountInfo.auth_provider === 'email' && (
              <svg className="h-4 w-4 shrink-0 text-cocoa" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="m22 7-10 6L2 7"/>
              </svg>
            )}
            {accountInfo.email && <span className="text-bark">{accountInfo.email}</span>}
          </div>
        )}
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
                    !deletePassword ||
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

      {/* Edit Profile Modal - on iOS uses the same full-screen popup
          pattern as the section rows (sticky header with title + X,
          scrollable card content below) so the Edit-profile surface
          feels consistent with the other tap-to-popup interactions.
          On web, keeps the centered overlay - a full-screen takeover
          on desktop would feel disproportionate.

          The form body is rendered inline below in BOTH branches; the
          duplication is acceptable here because the alternative
          (extracting ~80 lines of form JSX into a const) would
          create a less-readable shape for a single modal. */}
      {editingProfile && isIosPlatform && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-cream"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Edit profile"
        >
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-cream-border bg-cream">
            <h2 className="flex-1 text-base md:text-medium font-semibold truncate text-bark">Edit profile</h2>
            <button
              type="button"
              onClick={() => setEditingProfile(false)}
              aria-label="Close"
              className="-mr-2 p-2 rounded-lg text-cocoa hover:text-bark hover:bg-oat transition-colors"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)' }}>
            <div className="bg-linen rounded-2xl p-4.5 md:p-6" style={{ boxShadow: 'rgba(26, 22, 32, 0.04) 0px 1px 0px, rgba(26, 22, 32, 0.04) 0px 4px 14px' }}>
              <EditProfileForm
                profileAvatar={profileAvatar}
                profileName={profileName}
                profileColor={profileColor}
                profileRole={profileRole}
                profileBirthday={profileBirthday}
                uploadingAvatar={uploadingAvatar}
                savingProfile={savingProfile}
                avatarColors={avatarColors}
                setProfileName={setProfileName}
                setProfileRole={setProfileRole}
                setProfileBirthday={setProfileBirthday}
                setProfileColor={setProfileColor}
                handlePickAvatar={handlePickAvatar}
                handleAvatarRemove={handleAvatarRemove}
                handleSaveProfile={handleSaveProfile}
                onCancel={() => setEditingProfile(false)}
              />
            </div>
          </div>
        </div>
      )}

      {editingProfile && !isIosPlatform && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEditingProfile(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative bg-linen rounded-2xl shadow-lg border border-cream-border p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base md:text-medium font-semibold text-bark">Edit profile</h2>
              <button onClick={() => setEditingProfile(false)} className="text-cocoa hover:text-bark p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <EditProfileForm
              profileAvatar={profileAvatar}
              profileName={profileName}
              profileColor={profileColor}
              profileRole={profileRole}
              profileBirthday={profileBirthday}
              uploadingAvatar={uploadingAvatar}
              savingProfile={savingProfile}
              avatarColors={avatarColors}
              setProfileName={setProfileName}
              setProfileRole={setProfileRole}
              setProfileBirthday={setProfileBirthday}
              setProfileColor={setProfileColor}
              handlePickAvatar={handlePickAvatar}
              handleAvatarRemove={handleAvatarRemove}
              handleSaveProfile={handleSaveProfile}
              onCancel={() => setEditingProfile(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

