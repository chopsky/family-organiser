/**
 * Monthly LA term-dates import job.
 *
 * Wired into the scheduler to run once a month (1st, 03:00 UTC). Runs in
 * "stale" mode: refresh authorities whose data is older than the staleness
 * window or never succeeded, and skip councils that have already hit the
 * attempt cap. So it still picks up newly-published years and keeps retrying
 * winnable councils, without re-paying the full web_search bill for all 183 -
 * and for dead councils - every month. A per-month scheduler lock makes it
 * safe across rolling deploys / multiple instances - only one wins.
 */
const { importAllAuthorities } = require('../services/laTermDatesImport');
const db = require('../db/queries');

async function runMonthlyLAImport() {
  // lock_date = first of the current month, so the lock is unique per month
  // and the daily lock-cleanup (which prunes locks older than ~7 days) won't
  // remove it until well after the run has finished.
  const monthLock = `${new Date().toISOString().slice(0, 7)}-01`;
  const acquired = await db.acquireSchedulerLock('la_term_dates_import', monthLock);
  if (!acquired) {
    console.log('[la-import] Monthly import already ran this month - skipping');
    return;
  }

  console.log('[la-import] Starting monthly stale-refresh of LA term dates');
  try {
    const result = await importAllAuthorities({ trigger: 'cron', onlyStale: true });
    console.log(
      `[la-import] Monthly import complete: ${result.succeeded} ok, ` +
        `${result.partial} partial, ${result.failed} failed of ${result.total}`,
    );
  } catch (err) {
    console.error('[la-import] Monthly import failed:', err.message);
  }
}

module.exports = { runMonthlyLAImport };
