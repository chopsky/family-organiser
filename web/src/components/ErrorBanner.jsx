export default function ErrorBanner({ message, onDismiss, onRetry }) {
  if (!message) return null;
  return (
    <div className="bg-error/10 border border-error/30 text-error rounded-2xl px-4 py-3 flex items-start gap-3 mb-4">
      <span className="text-error mt-0.5">⚠️</span>
      <p className="flex-1 text-sm">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1 rounded-lg bg-error text-white text-xs font-semibold hover:bg-error/90 transition-colors shrink-0"
        >
          Retry
        </button>
      )}
      {onDismiss && (
        <button onClick={onDismiss} className="text-error hover:text-error/80 text-lg leading-none">×</button>
      )}
    </div>
  );
}
