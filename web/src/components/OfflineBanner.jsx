/**
 * Slim "You're offline" banner — only renders on native iOS when
 * the WebView reports no network. On web it never shows (the web
 * bundle's data layer doesn't cache offline, so the banner would
 * just be noise during a transient blip).
 *
 * Positioned via `sticky top-0` inside the main scroll area so it
 * sits below the mobile top bar (which is also sticky top-0) and
 * above page content. The plum-light background + bark text keeps
 * it on-brand without screaming.
 */

import { isNative } from '../lib/platform';
import { useOnlineStatus } from '../lib/useOnlineStatus';

export default function OfflineBanner() {
  const online = useOnlineStatus();
  if (!isNative() || online) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-20 bg-plum-light text-plum text-center text-xs font-semibold py-1.5 px-4"
    >
      You're offline · showing last saved data
    </div>
  );
}
