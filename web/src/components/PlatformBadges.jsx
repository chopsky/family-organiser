import { formatRelativeTime } from '../lib/formatRelativeTime';

/**
 * Show which platforms a user has actually used.
 *
 * Three possible badges (any combination):
 *   - "iOS App"    sage  → has an ACTIVE iOS push token (native app, push working)
 *   - "iOS App"    grey  → has a stale iOS push token (installed at some point,
 *                          push has since broken / declined / uninstalled)
 *   - "iOS Safari" plum  → iPhone UA in refresh_tokens but no device_token
 *                          (mobile Safari OR app declined push at onboarding)
 *   - "Web"        plum  → non-mobile UA in refresh_tokens (desktop / laptop)
 *
 * Nothing rendered when the user has never logged in anywhere.
 *
 * `platforms` shape: see getPlatformsByUserIds in src/db/queries.js.
 */
export default function PlatformBadges({ platforms, size = 'md' }) {
  if (!platforms) return null;
  const { iosApp, iosAppActive, iosWeb, web, lastIosAt, lastWebAt, appVersion } = platforms;

  const badges = [];

  if (iosApp) {
    // Append the reported app version when we have it, so it's obvious which
    // build a user is on (e.g. "iOS App · 1.7.0 (22)").
    const verSuffix = appVersion ? ` · ${appVersion}` : '';
    badges.push({
      key: 'ios-app',
      label: `iOS App${verSuffix}`,
      className: iosAppActive
        ? 'bg-sage-light text-sage'
        : 'bg-cream text-warm-grey',
      tooltip: iosAppActive
        ? `Native iOS app, push active${appVersion ? ` — version ${appVersion}` : ''}${lastIosAt ? ` — last seen ${formatRelativeTime(lastIosAt)}` : ''}`
        : `iOS app installed at some point (push token inactive)${appVersion ? ` — version ${appVersion}` : ''}${lastIosAt ? ` — last seen ${formatRelativeTime(lastIosAt)}` : ''}`,
    });
  } else if (iosWeb) {
    badges.push({
      key: 'ios-safari',
      label: 'iOS Safari',
      className: 'bg-plum-light text-plum',
      tooltip: `Used on iPhone/iPad via Safari${lastIosAt ? ` — last seen ${formatRelativeTime(lastIosAt)}` : ''}`,
    });
  }

  if (web) {
    badges.push({
      key: 'web',
      label: 'Web',
      className: 'bg-plum-light text-plum',
      tooltip: `Used on desktop / web${lastWebAt ? ` — last seen ${formatRelativeTime(lastWebAt)}` : ''}`,
    });
  }

  if (badges.length === 0) return null;

  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.map((b) => (
        <span
          key={b.key}
          title={b.tooltip}
          className={`inline-flex items-center rounded-md font-semibold ${padding} ${b.className}`}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}
