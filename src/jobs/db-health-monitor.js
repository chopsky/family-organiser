/**
 * Database health monitor - emails the operator when Postgres becomes
 * unreachable, and again when it recovers.
 *
 * Why this exists alongside an external uptime monitor (UptimeRobot watching
 * /health/db): the external one is the primary safety net because it also
 * catches Railway itself being down, which nothing running ON Railway can
 * report. This job is the richer secondary - it knows the actual PostgREST
 * error code, how long the outage has run, and how many probes have failed,
 * so the email tells you what broke rather than just "site down".
 *
 * Written after the 2026-07-29 outage (Supabase Postgres unreachable for ~35
 * minutes, PGRST002) which nothing detected - /health was DB-free and stayed
 * green, and there was no monitoring at all. A user reported it.
 *
 * ### Alerting policy
 *   - Probe every 2 minutes.
 *   - Alert after 2 CONSECUTIVE failures, so a single transient blip doesn't
 *     wake anyone. Detection latency is therefore ~2-4 minutes.
 *   - Then stay quiet for 30 minutes before re-alerting. A 40-minute outage
 *     sends 2 emails, not 20. An inbox full of identical alerts is an inbox
 *     you stop reading.
 *   - Send exactly one recovery email when it comes back, with the duration.
 *
 * ### State is in-memory, deliberately
 * A deploy mid-outage resets the counters, so you may get one duplicate alert.
 * That's strictly better than the alternatives: a DB table can't be written to
 * during a DB outage (the exact moment it's needed), and a file doesn't
 * survive Railway's ephemeral filesystem either.
 */

const { checkDatabase } = require('../utils/db-health');
const email = require('../services/email');

const FAILURES_BEFORE_ALERT = 2;
const REMINDER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ── Mutable state for the CURRENT outage ────────────────────────────────────
let consecutiveFailures = 0;
let outageStartedAt = null; // Date of the first failing probe
let alertedAt = null;       // Date we last successfully emailed about it

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins === 1) return '1 minute';
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m`;
}

async function sendOutageAlert(result, isReminder) {
  const downFor = outageStartedAt ? Date.now() - outageStartedAt.getTime() : 0;
  const subject = isReminder
    ? `Database STILL unreachable (${formatDuration(downFor)})`
    : 'Database unreachable';

  const body =
    `The API cannot reach Postgres. Users will be seeing errors and cannot log in.<br/><br/>` +
    `<strong>Down for:</strong> ${esc(formatDuration(downFor))}<br/>` +
    `<strong>Failed probes:</strong> ${consecutiveFailures}<br/>` +
    `<strong>Error code:</strong> ${esc(result.code || 'none')}<br/>` +
    `<strong>Detail:</strong> ${esc(result.message || 'no message')}<br/>` +
    `<strong>Probe took:</strong> ${result.latencyMs}ms<br/><br/>` +
    `<strong>What to check:</strong><br/>` +
    `1. Supabase Dashboard - is project status "Unhealthy"?<br/>` +
    `2. If resource metrics (CPU / RAM / disk / connections) look normal, ` +
    `restart the project: Settings &rarr; General &rarr; Restart project. ` +
    `That cleared the 2026-07-29 outage, which had this same signature.<br/>` +
    `3. status.supabase.com for a platform incident.<br/>` +
    `4. Dashboard &rarr; Logs &rarr; Postgres, filtered to now - log retention ` +
    `is short, so capture the cause before it ages out.`;

  await email.sendAdminAlert(subject, body);
}

async function sendRecoveryAlert(result) {
  const downFor = outageStartedAt ? Date.now() - outageStartedAt.getTime() : 0;
  const body =
    `Postgres is answering again. The API recovered on its own - no deploy needed.<br/><br/>` +
    `<strong>Total downtime:</strong> ${esc(formatDuration(downFor))}<br/>` +
    `<strong>Failed probes:</strong> ${consecutiveFailures}<br/>` +
    `<strong>Current probe:</strong> ${result.latencyMs}ms<br/><br/>` +
    `Worth checking Dashboard &rarr; Logs &rarr; Postgres for the window above ` +
    `while the logs are still in retention - that's where the cause will be.`;

  await email.sendAdminAlert(`Database recovered after ${formatDuration(downFor)}`, body);
}

/**
 * One monitor tick. Exported for tests and manual triggering.
 *
 * Never rejects. cron invokes this without a .catch(), so a rejection here
 * would surface as an unhandled promise rejection - which on newer Node
 * versions terminates the process. A monitor that can kill the server it is
 * monitoring is worse than no monitor.
 */
async function runDbHealthCheck() {
  try {
    return await tick();
  } catch (err) {
    console.error('[db-health] Monitor tick threw unexpectedly:', err.message);
    return { ok: false, latencyMs: 0, code: 'MONITOR_ERROR', message: err.message };
  }
}

async function tick() {
  const result = await checkDatabase();

  // ── Healthy ───────────────────────────────────────────────────────────────
  if (result.ok) {
    if (alertedAt) {
      // We told them it was down, so we owe them the all-clear.
      try {
        await sendRecoveryAlert(result);
        console.log('[db-health] Recovered - recovery alert sent');
      } catch (err) {
        console.error('[db-health] Recovery alert failed to send:', err.message);
      }
    } else if (consecutiveFailures > 0) {
      // Blipped but recovered before we alerted. Log only - not worth an email.
      console.log(`[db-health] Recovered after ${consecutiveFailures} failed probe(s), below alert threshold`);
    }
    consecutiveFailures = 0;
    outageStartedAt = null;
    alertedAt = null;
    return result;
  }

  // ── Unhealthy ─────────────────────────────────────────────────────────────
  consecutiveFailures += 1;
  if (!outageStartedAt) outageStartedAt = new Date();

  console.error(
    `[db-health] Probe FAILED (${consecutiveFailures} consecutive): ` +
    `${result.code || 'no-code'} - ${result.message || 'no message'}`
  );

  const isReminder = !!alertedAt;
  const dueForReminder = alertedAt && (Date.now() - alertedAt.getTime() >= REMINDER_INTERVAL_MS);
  // First alert fires once we've crossed the threshold and haven't emailed yet.
  // Using >= (not ===) means a failed send is retried on the next tick rather
  // than silently skipped forever.
  const dueForFirstAlert = !alertedAt && consecutiveFailures >= FAILURES_BEFORE_ALERT;

  if (dueForFirstAlert || dueForReminder) {
    try {
      await sendOutageAlert(result, isReminder);
      alertedAt = new Date(); // only on success, so a send failure retries
      console.log(`[db-health] ${isReminder ? 'Reminder' : 'Outage'} alert sent`);
    } catch (err) {
      console.error('[db-health] Outage alert failed to send:', err.message);
    }
  }

  return result;
}

module.exports = {
  runDbHealthCheck,
  // Exposed so tests can reset between cases without reaching into the module.
  _resetState() {
    consecutiveFailures = 0;
    outageStartedAt = null;
    alertedAt = null;
  },
  _internal: { FAILURES_BEFORE_ALERT, REMINDER_INTERVAL_MS, formatDuration },
};
