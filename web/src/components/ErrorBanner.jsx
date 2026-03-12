export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 flex items-start gap-3 mb-4">
      <span className="text-red-500 mt-0.5">⚠️</span>
      <p className="flex-1 text-sm">{message}</p>
      {onDismiss && (
        <button onClick={onDismiss} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
      )}
    </div>
  );
}
