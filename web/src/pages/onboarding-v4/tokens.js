/**
 * Onboarding v4 design tokens.
 *
 * Per the handoff decision (palette option "b"): these map onto the app's
 * EXISTING CSS custom properties wherever one exists, rather than standing up a
 * parallel palette. Only genuinely-missing values are declared literally, and
 * each of those carries a note saying why.
 *
 * Happily the two palettes have already converged on the important one: the
 * spec's --purple #6D38AD is exactly our --color-plum. The only real gap is the
 * neutral ramp - the spec runs a 3-step ink scale where we have 2 (charcoal /
 * warm-grey), so ink2 below is the one genuine addition.
 *
 * Small, deliberate drift we accept (option b):
 *   purpleSoft  spec #F2ECFA -> ours #F3EDFC  (imperceptible)
 *   purpleDeep  spec #4A1D96 -> ours #5A3488  (ours is lighter; used for
 *               pressed states and dark-text-on-tint, so it stays legible)
 *   cream       spec #FDFAF4 -> ours #FBF8F3
 *   green       spec #1FAF54 -> ours #25D366 is materially brighter, so the
 *               WhatsApp button keeps the spec value (brand-critical, and it
 *               sits on a green shadow that only works at the darker tone)
 */

export const T = {
  // ── Brand ────────────────────────────────────────────────────────────────
  purple: 'var(--color-plum)',            // #6d38ad - exact match with spec
  purpleDeep: 'var(--color-plum-dark)',
  purpleSoft: 'var(--color-plum-light)',

  // Gradients live here as TOKENS, not inline, because that's how they drifted:
  // the handoff shipped `#8B5CF6 -> #5F2EDB` on the chat bubble and
  // `#A97FFF -> #6D38AD` on the progress bar. Both are violets — bluer and
  // brighter than #6d38ad — so the two most prominent purple surfaces in the
  // flow were a different purple from the brand. Both now interpolate within
  // the plum ramp, so they track --color-plum automatically.
  gradPlum: 'linear-gradient(150deg, var(--color-plum), var(--color-plum-dark))',
  gradProgress: 'linear-gradient(90deg, var(--color-plum-mid), var(--color-plum))',

  // ── Ink ramp ─────────────────────────────────────────────────────────────
  ink: 'var(--color-charcoal)',
  ink2: '#4A4453',                        // NEW: no existing mid-tone between
                                          // charcoal and warm-grey
  ink3: 'var(--color-warm-grey)',

  // ── Surfaces ─────────────────────────────────────────────────────────────
  surface: '#FFFDFA',                     // NEW: warm white for cards. Ours is
                                          // pure #FFFFFF (--color-linen); the
                                          // spec's warmth is visible against
                                          // the lilac gradient.
  cream: 'var(--color-cream)',
  line: 'rgba(26,22,32,0.09)',
  line2: 'rgba(26,22,32,0.15)',

  // ── Status ───────────────────────────────────────────────────────────────
  green: '#1FAF54',                       // WhatsApp brand (see note above)
  okInk: 'var(--color-sage)',
  okBg: 'var(--color-sage-light)',
  gold: '#D89B3A',                        // star rating on the testimonial
  danger: '#B04A36',                      // ICS validation errors

  // ── Type ─────────────────────────────────────────────────────────────────
  title: 'var(--font-serif-display)',     // Recoleta, already self-hosted

  // ── Screen background (matches housemait.com/signup) ─────────────────────
  bg: 'linear-gradient(175deg,#f1ecf6 0%,#f5eff7 26%,#F7F1EC 52%,#f5eee7 76%,#f0e7dd 100%)',
};

// Shadows, verbatim from the spec - these are compositional, not brand values,
// so there is nothing existing to map them onto.
export const SHADOW = {
  card: '0 12px 30px -18px rgba(26,22,32,.3), 0 0 0 1px rgba(26,22,32,.05)',
  cardLg: '0 26px 60px -26px rgba(26,22,32,.4), 0 0 0 1px rgba(26,22,32,.05)',
  cta: '0 10px 24px -8px rgba(109,56,173,.55)',
  whatsapp: '0 10px 22px -8px rgba(31,175,84,.5)',
  note: '0 8px 18px -10px rgba(26,22,32,.35)',
  row: '0 8px 20px -16px rgba(26,22,32,.4)',
};

// Radii (spec section "Radii").
export const R = {
  card: 20, cta: 17, row: 17, bubble: 19, bubbleTail: 6,
  field: 16, auth: 16, chip: 15, tile: 11, pill: 99,
};

// Motion. Every duration collapses to ~0 under Reduce Motion; the flow reads
// `reduced` from the existing usePrefersReducedMotion hook and passes it here.
export const EASE = {
  rise: 'cubic-bezier(.22,.8,.2,1)',
  pop: 'cubic-bezier(.22,1.3,.36,1)',
  bubble: 'cubic-bezier(.22,.9,.3,1)',
  progress: 'cubic-bezier(.32,.72,0,1)',
};

export const dur = (ms, reduced) => (reduced ? 0.01 : ms);
