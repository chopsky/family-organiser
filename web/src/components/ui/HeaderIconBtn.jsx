/**
 * HeaderIconBtn - THE page-top icon button (design_handoff_calendar's
 * chrome language; circle bumped 34 → 38px, founder call 2026-09-02). A
 * 38px visual circle centred inside a 44px hit target, so every page's
 * header actions read identically:
 *
 *   default  - white circle, 1px hairline ring, soft lift, ink-2 icon
 *   primary  - plum fill, white icon (the "+" button; flat - no glow,
 *              founder call 2026-09-02)
 *   active   - ink fill, white icon (a toggled state, e.g. filters open)
 *
 * `badge` renders a small plum count bubble top-right (active filters).
 * Pass the icon as children (16px glyphs sit best).
 */
export default function HeaderIconBtn({ primary, active, badge, className = '', style, children, ...rest }) {
  const face = primary
    ? { background: 'var(--color-plum)', color: '#fff' }
    : active
      ? { background: '#1A1620', color: '#fff' }
      : { background: '#fff', border: '1px solid rgba(26,22,32,0.07)', boxShadow: '0 1px 0 rgba(26,22,32,0.03)', color: 'var(--ink-2)' };
  return (
    <button
      type="button"
      className={`shrink-0 w-11 h-11 -m-[3px] flex items-center justify-center bg-transparent relative cursor-pointer active:scale-[0.97] transition-transform disabled:opacity-50 ${className}`}
      style={style}
      {...rest}
    >
      <span className="w-[38px] h-[38px] rounded-full flex items-center justify-center" style={face}>
        {children}
      </span>
      {badge > 0 && (
        <span
          className="absolute flex items-center justify-center rounded-full text-white font-extrabold"
          style={{ top: 2, right: 2, minWidth: 16, height: 16, background: 'var(--color-plum)', fontSize: 9.5, padding: '0 4px' }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
