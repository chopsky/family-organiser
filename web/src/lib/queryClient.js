// App-wide data layer: cache-first, stale-while-revalidate.
//
// Every useQuery-backed screen paints instantly from the persisted cache on a
// cold launch, then revalidates in the background - the "Apple Calendar" feel.
// The cache is persisted to localStorage so it survives app restarts, and is
// busted per app version so a data-shape change can never break a launch.
import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data is treated as fresh for 30s; after that, opening a screen
      // (or reconnecting) triggers a background refetch. Either way the cached
      // data is shown immediately, so there's no blank/skeleton on a warm cache.
      staleTime: 30 * 1000,
      // Keep (and persist) data for a week so cold launches have something to
      // paint even after days away.
      gcTime: WEEK_MS,
      refetchOnMount: true,
      refetchOnReconnect: true,
      // We drive foreground refresh via useAppForegroundRefresh, so we don't
      // also refetch on every window focus (which fires noisily on the web).
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const persister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'housemait-rq-cache',
});

export const persistOptions = {
  persister,
  maxAge: WEEK_MS,
  // Tie cache validity to the app version: a new release drops the old cache,
  // so a changed query shape can never resurrect a broken payload.
  buster: typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : 'dev',
};
