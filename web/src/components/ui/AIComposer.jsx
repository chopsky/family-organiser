/**
 * AIComposer (design_handoff_ai_chat spec): the pinned input bar — text field,
 * then paperclip (attach), mic, and a plum circular send. `attach={false}`
 * hides the paperclip (the Home composer uses it that way). Enter submits.
 *
 * Attach/mic are wired by the parent: `onAttach` opens the file picker,
 * `onMic` toggles speech-to-text (`micOn` reflects the recording state).
 */
const Icon = {
  paperclip: (p = {}) => (
    <svg width={p.s || 18} height={p.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11l-9 9a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" /></svg>
  ),
  mic: (p = {}) => (
    <svg width={p.s || 18} height={p.s || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" /></svg>
  ),
  send: (p = {}) => (
    <svg width={p.s || 16} height={p.s || 16} viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l18-8-8 18-2-7-8-3z" /></svg>
  ),
};

export default function AIComposer({
  value, onChange, onSubmit, onMic, onAttach,
  attach = false, micOn = false, disabled = false, autoFocus = false,
  placeholder = 'Ask me anything…',
}) {
  const iconBtn = 'w-[34px] h-[34px] rounded-full flex items-center justify-center transition-colors';
  return (
    <div
      className="flex items-center gap-2 bg-white"
      style={{
        borderRadius: 18,
        padding: '10px 10px 10px 16px',
        boxShadow: '0 1px 0 rgba(45,42,51,0.04), 0 6px 18px rgba(45,42,51,0.05)',
        border: '1px solid rgba(45,42,51,0.05)',
      }}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        autoFocus={autoFocus}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 border-0 outline-none bg-transparent text-[15px] text-charcoal min-w-0 disabled:opacity-50 placeholder:text-warm-grey/70"
      />
      {attach && (
        <button type="button" onClick={onAttach} disabled={disabled} aria-label="Attach image or PDF"
          className={`${iconBtn} text-warm-grey hover:text-plum disabled:opacity-50`}>
          <Icon.paperclip />
        </button>
      )}
      <button type="button" onClick={onMic} disabled={disabled} aria-label="Voice input"
        className={`${iconBtn} ${micOn ? 'text-coral bg-coral/10' : 'text-warm-grey hover:text-plum'} disabled:opacity-50`}>
        <Icon.mic />
      </button>
      <button type="button" onClick={onSubmit} disabled={disabled || !value.trim()} aria-label="Send"
        className="w-9 h-9 rounded-full bg-plum text-white flex items-center justify-center shrink-0 disabled:opacity-40 transition-opacity"
        style={{ boxShadow: '0 2px 8px rgba(107,63,160,0.3)' }}>
        <Icon.send />
      </button>
    </div>
  );
}
