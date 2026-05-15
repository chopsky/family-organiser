/**
 * Shared Tailwind class strings for the onboarding wizard steps.
 *
 * Factored out so every step renders the same headline / kicker / CTA
 * treatment without duplicating the long arbitrary-value strings.
 */

// Serif hero headline — same treatment as the Dashboard greeting.
// Applied via className so Tailwind v4 builds the arbitrary values; the
// serif fontFamily still needs an inline style override (see step files).
export const serifHeading =
  'font-normal leading-none tracking-[-0.8px] text-[40px] md:text-[48px]';

// Apply alongside the serifHeading class:
//   <h1 className={serifHeading} style={serifHeadingStyle}>...</h1>
export const serifHeadingStyle = {
  fontFamily: '"Instrument Serif", Georgia, "Times New Roman", serif',
  color: 'var(--color-bark)',
};

// Uppercase caption line above the heading.
export const kicker = 'text-[11px] font-bold uppercase tracking-[0.1em]';

// Primary CTA — filled plum button. Inline-block so the text "→" glyph sits
// on the baseline without collapsing the button height on mobile.
export const primaryBtn =
  'inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-primary hover:bg-primary-pressed ' +
  'text-white font-semibold text-sm transition-colors disabled:bg-primary/50 disabled:cursor-not-allowed';

// Secondary CTA — outlined, lower emphasis. Used for "Skip for now" links.
export const secondaryBtn =
  'inline-flex items-center justify-center px-6 py-3 rounded-2xl border border-cream-border ' +
  'text-bark hover:bg-cream font-medium text-sm transition-colors';

// Plain-text skip link, for "Maybe later" affordances.
export const skipLink = 'text-sm text-cocoa hover:text-bark underline-offset-4 hover:underline transition-colors';

// Input used in the wizard (invite email, phone number, verification code).
export const inputBase =
  'w-full border border-cream-border rounded-xl px-4 py-3 focus:outline-none ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all text-bark';
