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

// A plain window.location.reload() can re-serve the SAME stale index.html from
// the HTTP cache - which just lands back on the missing-chunk error, trapping
// the user on this banner forever. So we reload with a cache-busting query
// param (the browser keys its cache on the full URL, so a fresh param forces a
// network fetch of index.html), after best-effort clearing any Cache Storage.
// The param is harmless - React Router ignores unknown query keys - and
// location.replace() avoids piling up history entries.
function hardReload() {
  const bust = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('_r', String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };
  // There's no service worker today, but clear Cache Storage anyway so this
  // stays correct if one is ever added. Never let it block the reload.
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {})
        .finally(bust);
      return;
    }
  } catch { /* caches unavailable - fall through */ }
  bust();
}

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
        hardReload();
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
              onClick={hardReload}
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
