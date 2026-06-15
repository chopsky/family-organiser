/**
 * PillBtn - the compact pill button used across the redesigned desktop
 * pages. `primary` is a filled plum button; otherwise it's white with a
 * subtle border. Presses to scale(0.98). Ported from the design handoff
 * and mapped to our theme tokens.
 *
 * Props:
 *   primary  - filled plum style when true, outline otherwise
 *   icon     - leading node (e.g. <IconPlus className="h-3.5 w-3.5" />)
 *   children - label
 *   ...rest  - onClick, type, disabled, aria-label, etc.
 */
export default function PillBtn({ children, primary, icon, className = '', ...rest }) {
  const base =
    'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-[10px] text-[13px] font-semibold ' +
    'whitespace-nowrap cursor-pointer transition-transform active:scale-[0.98] ' +
    'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-plum/40';
  const variant = primary
    ? 'bg-plum text-white shadow-sm hover:bg-plum/90'
    : 'bg-white text-charcoal border-[1.5px] border-light-grey hover:border-plum/40';

  return (
    <button className={`${base} ${variant} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}
