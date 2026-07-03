/**
 * Weekly calendar_events tombstone purge.
 *
 * Hard-deletes soft-deleted events (deleted_at set) older than 30 days so
 * the tombstone graveyard never regrows. The one-off backlog of ~2.3M
 * sync-era tombstones is cleared by
 * supabase/migration-calendar-tombstone-purge.sql; this job is the
 * ongoing sweep that keeps steady state at "a few hundred rows"
 * (deletion rate is ~100/month post-leak).
 *
 * Why 30 days is safe:
 *   - Every live-path reader filters deleted_at IS NULL (calendar views,
 *     outbound ICS feed, event reminders, search, stats counters).
 *   - The bot/kids undo restores a tombstone within a 10-MINUTE window
 *     (MUTATION_UNDO_WINDOW_MS in src/bot/handlers.js).
 *   - The "recently deleted" restore UI (GET /api/calendar/deleted) is an
 *     accident-recovery surface; 30 days matches what users expect from
 *     a trash can, and trimming it keeps the list usable.
 *
 * Delegates the actual DELETE to the purge_calendar_tombstones() SQL
 * function (created by the migration above) via RPC, in batches - each
 * RPC call is its own transaction, so no long-held locks and no risk of
 * re-creating the giant-transaction conditions that once let a stuck
 * COPY block ALTER TABLE migrations. FK cascades clean up reminders,
 * assignees, attachments and sync mappings with each event.
 *
 * If the migration hasn't been applied yet the RPC fails with
 * "function does not exist"; the job logs a pointed hint and no-ops.
 *
 * Scheduled weekly (Sunday 04:30 UTC) by src/jobs/scheduler.js -
 * steady-state work is one batch, so weekly is plenty. Idempotent; a
 * second run right after the first finds nothing to delete.
 */

const { supabaseAdmin } = require('../db/client');

const TOMBSTONE_RETENTION_DAYS = 30;
const PURGE_BATCH_SIZE = 10000;
// Runaway-loop backstop: 100 batches = 1M rows, far above any steady-state
// week but enough to chew through a re-accumulated backlog in a few runs.
const MAX_BATCHES_PER_RUN = 100;

async function runCalendarTombstonePurge() {
  let total = 0;
  let batches = 0;

  while (batches < MAX_BATCHES_PER_RUN) {
    let deleted;
    try {
      const { data, error } = await supabaseAdmin.rpc('purge_calendar_tombstones', {
        p_retention_days: TOMBSTONE_RETENTION_DAYS,
        p_batch_size: PURGE_BATCH_SIZE,
      });
      if (error) throw error;
      deleted = data || 0;
    } catch (err) {
      const msg = err.message || `${err}`;
      // PGRST202 = PostgREST "function not found" (code field); the raw
      // Postgres error says "does not exist". Either means the migration
      // that creates purge_calendar_tombstones() hasn't been applied.
      if (err.code === 'PGRST202' || /does not exist|could not find the function/i.test(msg)) {
        console.warn(
          '[tombstone-purge] purge_calendar_tombstones() missing - apply ' +
          'supabase/migration-calendar-tombstone-purge.sql. Skipping this run.'
        );
      } else {
        console.error('[tombstone-purge] batch failed:', msg);
      }
      break;
    }

    total += deleted;
    batches += 1;
    // A short batch means the backlog is drained.
    if (deleted < PURGE_BATCH_SIZE) break;
  }

  if (batches >= MAX_BATCHES_PER_RUN) {
    console.warn(`[tombstone-purge] hit ${MAX_BATCHES_PER_RUN}-batch cap - remainder picked up next run`);
  }
  if (total > 0) {
    console.log(`[tombstone-purge] hard-deleted ${total} tombstone(s) older than ${TOMBSTONE_RETENTION_DAYS} days (${batches} batch(es))`);
  }
  return total;
}

module.exports = {
  runCalendarTombstonePurge,
  _constants: { TOMBSTONE_RETENTION_DAYS, PURGE_BATCH_SIZE, MAX_BATCHES_PER_RUN },
};
