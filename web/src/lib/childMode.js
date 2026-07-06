// Single source of truth for which routes are reachable in Child Mode, shared
// by the route gate (App.jsx) and the nav filter (Layout.jsx) so they can't
// drift. '/settings' is "allowed but PIN-gated" — see ChildGate in App.jsx.
// Home/Dashboard is hidden in Child Mode; kids land on /tasks.
export const CHILD_VISIBLE_ROUTES = ['/tasks', '/rewards', '/calendar', '/note', '/settings'];

// Routes that render straight through in Child Mode (no PIN). '/settings' is
// deliberately excluded — it needs the PIN gate. '/note' is Kids-only: the
// adult app has no page there (App.jsx bounces it to the Dashboard, where
// the notes land).
export const CHILD_OPEN_ROUTES = ['/tasks', '/rewards', '/calendar', '/note'];

// Where Child Mode lands / redirects (Home is hidden).
export const CHILD_HOME_ROUTE = '/tasks';
