/**
 * Small flag-and-name pill rendered above auth-page logos so a visitor
 * coming off the marketing site keeps a visual cue of which region they
 * were just on. Reads the housemait-locale cookie set by useLocale() —
 * if nothing is saved (visitor arrived directly on /login or /signup
 * without ever touching a localised marketing page), the component
 * renders nothing rather than guessing a region.
 *
 * No interactivity: this is a display-only badge. The strict geo
 * middleware enforces region, so a UI control to switch regions would
 * be misleading.
 */

import { LOCALES } from '../lib/locales';
import { readLocaleCookie } from '../hooks/useLocale';

export default function LocaleBadge() {
  const code = readLocaleCookie();
  if (!code) return null;
  const locale = LOCALES[code];
  if (!locale || locale.code === 'default') return null;

  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-cream-border text-xs font-medium text-cocoa shadow-sm mb-4"
      aria-label={`Region: ${locale.name}`}
    >
      <span aria-hidden="true">{locale.flag}</span>
      <span>{locale.name}</span>
    </div>
  );
}
