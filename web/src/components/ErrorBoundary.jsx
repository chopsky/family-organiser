import { Component } from 'react';

// A lazy-loaded route chunk failed to download. This is almost always a stale
// session after a new deploy: the running app references content-hashed chunk
// filenames that no longer exist on the server. The cure is simply to reload
// and pick up the fresh index.html + new chunk names.
function isChunkLoadError(error) {
  const msg = `${error?.message || ''} ${error?.name || ''}`;
  return /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Failed to fetch dynamically/i.test(msg);
}

const RELOAD_TS_KEY = 'housemait_chunk_reload_ts';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, isChunk: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, isChunk: isChunkLoadError(error) };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
    // Auto-recover from a stale-deploy chunk error by reloading once. Guard
    // with a timestamp so a genuinely-missing chunk can't loop the page.
    if (isChunkLoadError(error)) {
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_TS_KEY)) || 0; } catch { /* private mode */ }
      if (Date.now() - last > 15000) {
        try { sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now())); } catch { /* private mode */ }
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      const isChunk = this.state.isChunk;
      return (
        <div className="min-h-screen bg-oat flex items-center justify-center px-4">
          <div className="bg-linen rounded-2xl shadow-sm p-8 max-w-md w-full text-center border border-cream-border">
            <p className="text-5xl mb-4">{isChunk ? '✨' : '😕'}</p>
            <h1 className="text-xl font-semibold text-bark mb-2">
              {isChunk ? 'A new version is available' : 'Something went wrong'}
            </h1>
            <p className="text-cocoa text-sm mb-6">
              {isChunk
                ? 'Housemait was updated while you had it open. Reload to get the latest version.'
                : (this.state.error?.message || 'An unexpected error occurred.')}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-primary hover:bg-primary-pressed text-white font-medium px-6 py-2.5 rounded-2xl transition-colors"
            >
              {isChunk ? 'Reload now' : 'Reload app'}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
