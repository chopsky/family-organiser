import { useEffect } from 'react';
import { Link } from 'react-router-dom';

const SERIF = '"Instrument Serif", serif';

// Real 404 for unrecognised URLs. The edge middleware now lets unknown paths
// fall through (instead of bouncing them to a locale landing), and the SPA's
// catch-all renders this instead of redirecting home. "Housemait home" links to
// /, which sends a logged-in user to the dashboard and everyone else to their
// locale landing (the geo-redirect now lives only on /).
export default function NotFound() {
  // Ask crawlers not to index typo / dead URLs. A client-rendered 404 still
  // returns HTTP 200 (Vercel serves index.html for every path), so noindex is
  // the standard mitigation for the soft-404.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = 'Page not found · Housemait';
    return () => { document.head.removeChild(meta); document.title = prevTitle; };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-cream flex items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <div style={{ fontFamily: SERIF }} className="text-plum text-[64px] leading-none mb-1">404</div>
        <h1 style={{ fontFamily: SERIF }} className="text-3xl text-charcoal mb-3">This page wandered off.</h1>
        <p className="text-warm-grey leading-relaxed mb-8">
          The page you're after doesn't exist - it may have moved, or the link was mistyped.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center h-12 px-6 rounded-xl bg-plum text-white font-semibold hover:opacity-90 transition-opacity"
        >
          Housemait home
        </Link>
      </div>
    </div>
  );
}
