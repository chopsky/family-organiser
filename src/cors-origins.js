/**
 * CORS origin allowlist.
 *
 * Extracted into its own module so it can be unit-tested without booting the
 * whole Express app (which requires Supabase env vars to load its route
 * modules).
 *
 * Allowed:
 * - The configured production WEB_URL (e.g. https://www.housmait.com)
 * - capacitor://localhost — Capacitor iOS wrapper
 * - http://localhost — dev server
 * - Vercel preview URLs for this project (hash-based or git-branch form)
 *
 * Rejected:
 * - Any other *.vercel.app origin (so a random Vercel user can't spin up a
 *   project and hit our API)
 * - Origins that merely contain our project name somewhere in the host
 *
 * In local development, WEB_URL is typically unset → allow all origins.
 */

const PREVIEW_PATTERNS = [
  // Deployment hash form: family-organiser-<hash>-<scope>.vercel.app
  /^https:\/\/family-organiser-[a-z0-9-]+\.vercel\.app$/,
  // Git-branch form: family-organiser-git-<branch>-<scope>.vercel.app
  /^https:\/\/family-organiser-git-[a-z0-9-]+-[a-z0-9-]+\.vercel\.app$/,
];

function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin / mobile / server-to-server
  if (!process.env.WEB_URL) return true; // dev: allow all
  if (origin === process.env.WEB_URL) return true;
  if (origin === 'capacitor://localhost') return true;
  if (origin === 'http://localhost') return true;
  return PREVIEW_PATTERNS.some((re) => re.test(origin));
}

module.exports = { isAllowedOrigin };
