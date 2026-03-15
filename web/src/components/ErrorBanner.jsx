export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="bg-error/10 border border-error/30 text-error rounded-2xl px-4 py-3 flex items-start gap-3 mb-4">
      <span className="text-error mt-0.5">⚠️</span>
      <p className="flex-1 text-sm">{message}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="text-error hover:text-error/80 text-lg leading-none">×</button>
      )}
    </div>
  );
}
