const db = require('../db/queries');
const google = require('./providers/google');
const microsoft = require('./providers/microsoft');
const apple = require('./providers/apple');

function getProvider(providerName) {
  switch (providerName) {
    case 'google':
      return google;
    case 'microsoft':
      return microsoft;
    case 'apple':
      return apple;
    default:
      throw new Error(`Unknown calendar provider: ${providerName}`);
  }
}

/**
 * After a Anora calendar event is created/updated/deleted, push the change
 * to all connected external calendars for the household.
 * Only pushes to 'general' category subscriptions (birthday/public_holiday calendars are read-only).
 */
async function pushEventToConnections(householdId, event, action) {
  let connections;
  try {
    connections = await db.getConnectionsByHousehold(householdId);
  } catch (err) {
    console.error(`Failed to fetch calendar connections for household ${householdId}:`, err);
    return;
  }

  const enabledConnections = connections.filter((c) => c.sync_enabled);

  const results = await Promise.allSettled(
    enabledConnections.map(async (connection) => {
      try {
        await refreshTokenIfNeeded(connection);
        const provider = getProvider(connection.provider);
        const result = await provider.pushEvent(connection, event, action);

        if (action === 'create' && result?.externalEventId) {
          await db.createSyncMapping(event.id, connection.id, result.externalEventId, result.etag);
        } else if (action === 'delete') {
          await db.deleteSyncMapping(event.id, connection.id);
        }
      } catch (err) {
        console.error(
          `Failed to push ${action} for event ${event.id} to connection ${connection.id} (${connection.provider}):`,
          err
        );
      }
    })
  );

  return results;
}

/**
 * Called by webhooks (Google/Microsoft) or polling (Apple). Fetches changed
 * events from the provider and syncs them back to Anora.
 * Now iterates over all enabled subscriptions for the connection.
 */
async function pullChangesFromProvider(connection) {
  try {
    await refreshTokenIfNeeded(connection);
  } catch (err) {
    console.error(`Failed to refresh token for connection ${connection.id}:`, err);
    return;
  }

  const subscriptions = await db.getEnabledSubscriptionsByConnection(connection.id);
  if (subscriptions.length === 0) {
    // Legacy: no subscriptions yet, skip
    return;
  }

  const provider = getProvider(connection.provider);

  // Load existing sync mappings so pullChanges can detect already-synced events
  const syncMappings = await db.getSyncMappingsByConnection(connection.id);
  connection.sync_mappings = syncMappings;

  for (const sub of subscriptions) {
    try {
      const startMs = Date.now();
      const changes = await provider.pullChanges(connection, sub.external_calendar_id, sub.sync_token);

      // Per-subscription counters — populated by processChange, logged once
      // at the end. Used to be one console.log/warn PER EVENT which drowned
      // Railway logs (hundreds of lines every 15 min per user) and made real
      // errors invisible. Now: one summary line per sync.
      const stats = {
        total: 0, created: 0, updated: 0, relinked: 0,
        deleted: 0, skipDeleted: 0, errors: 0,
      };
      for (const change of changes) {
        await processChange(connection, sub, change, stats);
      }

      // Only emit a summary if there was actually something to report —
      // avoids a noisy "0 events" line every 15 minutes for idle calendars.
      if (stats.total > 0) {
        console.log(
          `[calendar-sync] "${sub.display_name}" (${connection.provider}): ` +
          `${stats.total} events, ${stats.created} created, ${stats.updated} updated, ` +
          `${stats.relinked} re-linked, ${stats.deleted} deleted, ` +
          `${stats.skipDeleted} skip-delete, ${stats.errors} errors, ` +
          `${Date.now() - startMs}ms`
        );
      }

      // Success: clears any prior error and resets the failure counter.
      await db.recordSyncSuccess(sub.id);
    } catch (err) {
      console.error(
        `Failed to pull changes for subscription ${sub.id} (${sub.display_name}) on connection ${connection.id}:`,
        err
      );
      try {
        const { auto_disabled, consecutive_failures } = await db.recordSyncFailure(sub.id, err.message || String(err));
        if (auto_disabled) {
          console.warn(
            `[calendar-sync] Auto-disabled subscription ${sub.id} (${sub.display_name}) after ${consecutive_failures} consecutive failures. Last error: ${err.message}`
          );
        }
      } catch (trackErr) {
        // If we can't even record the failure, log and move on — don't throw.
        console.error(`[calendar-sync] Failed to record sync failure for ${sub.id}:`, trackErr.message);
      }
    }
  }
}

/**
 * Initial full import of all events from an external calendar subscription.
 * Called when a subscription is first created.
 */
async function initialImportFromSubscription(connection, subscription) {
  console.log(`[initialImport] Starting for "${subscription.display_name}" (sub=${subscription.id}, conn=${connection.id})`);
  try {
    await refreshTokenIfNeeded(connection);
  } catch (err) {
    console.error(`[initialImport] Failed to refresh token for connection ${connection.id}:`, err);
    return;
  }

  const provider = getProvider(connection.provider);

  try {
    console.log(`[initialImport] Fetching all events from "${subscription.display_name}" (${subscription.external_calendar_id})`);
    const events = await provider.pullAllEvents(connection, subscription.external_calendar_id);
    console.log(`[initialImport] Fetched ${events.length} events from "${subscription.display_name}"`);

    // Load ALL existing sync mappings for this connection at once (single query, no URL overflow)
    const { supabaseAdmin: supabase } = require('../db/client');
    const { data: existingMappings } = await supabase
      .from('calendar_sync_mappings')
      .select('external_event_id')
      .eq('connection_id', connection.id);
    const existingSet = new Set((existingMappings || []).map(m => m.external_event_id));

    const newEvents = events.filter(e => !existingSet.has(e.externalEventId));
    const skipped = events.length - newEvents.length;
    console.log(`[initialImport] "${subscription.display_name}": ${newEvents.length} new, ${skipped} already exist`);

    if (newEvents.length === 0) {
      await db.updateSubscription(subscription.id, { last_synced_at: new Date().toISOString() });
      console.log(`[initialImport] Done "${subscription.display_name}": nothing new to import`);
      return;
    }

    // Batch insert events in chunks of 25 (CalDAV events can have large fields)
    const BATCH_SIZE = 25;
    let imported = 0;
    let failed = 0;
    const color = subscription.category === 'birthday' ? 'plum' : subscription.category === 'public_holiday' ? 'coral' : 'sky';

    for (let i = 0; i < newEvents.length; i += BATCH_SIZE) {
      const batch = newEvents.slice(i, i + BATCH_SIZE);
      try {
        // Prepare event rows
        const eventRows = batch.map(change => {
          let startTime = change.eventData.start_time;
          let endTime = change.eventData.end_time;
          if (startTime && !startTime.includes('T')) startTime = `${startTime}T00:00:00Z`;
          if (endTime && !endTime.includes('T')) endTime = `${endTime}T00:00:00Z`;
          return {
            household_id: connection.household_id,
            title: change.eventData.title || 'Untitled event',
            description: change.eventData.description || null,
            start_time: startTime,
            end_time: endTime || startTime,
            all_day: change.eventData.all_day || false,
            location: change.eventData.location || null,
            color,
            source_user_id: connection.user_id,
            subscription_id: subscription.id,
            category: subscription.category,
            visibility: subscription.visibility,
          };
        });

        // Batch insert events
        const insertedEvents = await db.batchCreateCalendarEvents(eventRows);

        // Build sync mapping rows
        const mappingRows = insertedEvents.map((evt, idx) => ({
          event_id: evt.id,
          connection_id: connection.id,
          subscription_id: subscription.id,
          external_event_id: batch[idx].externalEventId,
          external_etag: batch[idx].etag || null,
          last_synced_at: new Date().toISOString(),
        }));

        // Batch insert sync mappings
        await db.batchCreateSyncMappings(mappingRows);
        imported += insertedEvents.length;
        console.log(`[initialImport] "${subscription.display_name}": batch ${Math.floor(i / BATCH_SIZE) + 1} — ${insertedEvents.length} imported (${imported}/${newEvents.length})`);
      } catch (err) {
        // Fall back to one-by-one for this batch so a single bad event doesn't kill the whole batch
        console.warn(`[initialImport] Batch insert failed, falling back to individual: ${err.message}`);
        for (const change of batch) {
          try {
            const newEvent = await db.createCalendarEventFromSync(
              connection.household_id, change.eventData, connection.user_id,
              subscription.id, subscription.category, subscription.visibility,
            );
            await db.createSyncMappingWithSubscription(
              newEvent.id, connection.id, subscription.id,
              change.externalEventId, change.etag || null,
            );
            imported++;
          } catch (innerErr) {
            failed++;
            console.error(`[initialImport] Failed: "${change.eventData?.title}" — ${innerErr.message}`);
          }
        }
      }
    }

    await db.updateSubscription(subscription.id, { last_synced_at: new Date().toISOString() });
    console.log(`[initialImport] Done "${subscription.display_name}": ${imported} imported, ${skipped} skipped, ${failed} failed, ${events.length} total`);
  } catch (err) {
    console.error(`[initialImport] Pull failed for "${subscription.display_name}" (sub=${subscription.id}):`, err);
  }
}

/**
 * Process a single change from an external provider.
 *
 * The optional `stats` parameter is a counter object (see pullChangesFrom-
 * Provider) — this function increments the right field rather than logging
 * per event, because the previous per-event logging generated hundreds of
 * lines per sync and drowned out real errors. Still logs on actual errors.
 *
 * Passing stats is optional so direct/test callers don't have to care.
 */
async function processChange(connection, subscription, change, stats = null) {
  const { externalEventId, action, eventData, etag } = change;
  if (stats) stats.total += 1;

  try {
    const existingMapping = await db.getSyncMappingByExternalId(connection.id, externalEventId);

    if (action === 'upsert' || action === 'create') {
      if (existingMapping) {
        // Update existing event
        await db.updateCalendarEvent(existingMapping.event_id, connection.household_id, eventData);
        await db.createSyncMappingWithSubscription(
          existingMapping.event_id, connection.id, subscription.id, externalEventId, etag,
        );
        if (stats) stats.updated += 1;
      } else {
        // Before creating, check for duplicate by title + start_time to prevent
        // re-importing events whose sync mapping was lost
        let duplicateEvent = null;
        if (eventData.title && eventData.start_time) {
          try {
            duplicateEvent = await db.findCalendarEventByTitleAndTime(
              connection.household_id, eventData.title, eventData.start_time,
            );
          } catch (e) {
            // Non-fatal — proceed with create
          }
        }

        if (duplicateEvent) {
          // Re-link the existing event instead of creating a duplicate. Very
          // common when Apple CalDAV hands back a different UID for the same
          // event (recurring-series expansions, iCloud re-indexes). Summary
          // is printed once per sync — see pullChangesFromProvider.
          await db.updateCalendarEvent(duplicateEvent.id, connection.household_id, eventData);
          await db.createSyncMappingWithSubscription(
            duplicateEvent.id, connection.id, subscription.id, externalEventId, etag,
          );
          if (stats) stats.relinked += 1;
        } else {
          // Create new event
          const newEvent = await db.createCalendarEventFromSync(
            connection.household_id,
            eventData,
            connection.user_id,
            subscription.id,
            subscription.category,
            subscription.visibility,
          );
          await db.createSyncMappingWithSubscription(
            newEvent.id, connection.id, subscription.id, externalEventId, etag,
          );
          if (stats) stats.created += 1;
        }
      }
    } else if (action === 'delete') {
      if (existingMapping) {
        // Guard: don't soft-delete events that are recent or upcoming — Apple CalDAV
        // sometimes fails to return events that still exist. Only delete events
        // that ended more than 7 days ago to avoid losing active events.
        let shouldDelete = true;
        try {
          const event = await db.getCalendarEventById(existingMapping.event_id, connection.household_id);
          if (event) {
            const eventEnd = new Date(event.end_time || event.start_time);
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            if (eventEnd > sevenDaysAgo) {
              // Common on Apple CalDAV — future events drop out of one poll,
              // come back on the next. Summary-logged only.
              shouldDelete = false;
            }
          }
        } catch {
          // Defensive: couldn't look up the event. Still safer to skip
          // than to accidentally nuke a row. Tracked via the skip counter
          // rather than a per-event warn (see summary log).
          shouldDelete = false;
        }
        if (shouldDelete) {
          await db.softDeleteCalendarEvent(existingMapping.event_id, connection.household_id);
          await db.deleteSyncMapping(existingMapping.event_id, connection.id);
          if (stats) stats.deleted += 1;
        } else if (stats) {
          stats.skipDeleted += 1;
        }
      }
    }
  } catch (err) {
    if (stats) stats.errors += 1;
    console.error(
      `Failed to process ${action} for external event ${externalEventId} on connection ${connection.id}:`,
      err
    );
  }
}

/**
 * Checks token_expires_at on a connection. If expired, refreshes the token
 * via the provider and persists the updated connection.
 */
async function refreshTokenIfNeeded(connection) {
  if (!connection.token_expires_at) return;

  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  if (now >= expiresAt) {
    const provider = getProvider(connection.provider);
    const refreshedTokens = await provider.refreshToken(connection);
    if (refreshedTokens) {
      await db.upsertCalendarConnection(
        connection.user_id, connection.household_id, connection.provider, refreshedTokens,
      );
      Object.assign(connection, refreshedTokens);
    }
  }
}

module.exports = {
  pushEventToConnections,
  pullChangesFromProvider,
  initialImportFromSubscription,
  refreshTokenIfNeeded,
};
