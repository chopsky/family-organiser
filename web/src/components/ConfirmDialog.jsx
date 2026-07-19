/**
 * Styled confirmation modal - replaces browser confirm()/alert() in admin
 * mutations so every destructive/consequential action gets the same
 * treatment as the user-delete modal it was extracted from.
 *
 * Usage:
 *   const [confirming, setConfirming] = useState(false);
 *   <ConfirmDialog
 *     open={confirming}
 *     title="Extend trial"
 *     message="Extend the trial by 30 days (until 12 Jul 2026)?"
 *     confirmLabel="Extend"
 *     busy={saving}
 *     error={saveError}
 *     onConfirm={doIt}
 *     onCancel={() => setConfirming(false)}
 *   />
 *
 * danger=true renders the confirm button in coral (destructive actions);
 * default is plum.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  busyLabel = 'Working…',
  error = null,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-lg">
        <h3 className="font-display text-lg font-bold text-charcoal">{title}</h3>
        <p className="text-sm text-warm-grey mt-2">{message}</p>
        {error && (
          <div className="mt-3 p-3 rounded-xl bg-coral-light border border-coral/30">
            <p className="text-xs font-semibold text-coral uppercase tracking-wider">Error</p>
            <p className="text-sm text-coral mt-1 break-words">{error}</p>
          </div>
        )}
        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-xl border border-light-grey text-sm font-semibold text-charcoal hover:bg-cream transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 px-4 py-2.5 rounded-xl text-white text-sm font-semibold transition-colors disabled:opacity-50 ${
              danger ? 'bg-coral hover:bg-coral/90' : 'bg-plum hover:bg-plum-dark'
            }`}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
