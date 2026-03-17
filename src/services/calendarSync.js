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

  for (const sub of subscriptions) {
    try {
      const changes = await provider.pullChanges(connection, sub.external_calendar_id, sub.sync_token);

      for (const change of changes) {
        await processChange(connection, sub, change);
      }

      // Update last_synced_at
      await db.updateSubscription(sub.id, { last_synced_at: new Date().toISOString() });
    } catch (err) {
      console.error(
        `Failed to pull changes for subscription ${sub.id} (${sub.display_name}) on connection ${connection.id}:`,
        err
      );
    }
  }
}

/**
 * Initial full import of all events from an external calendar subscription.
 * Called when a subscription is first created.
 */
async function initialImportFromSubscription(connection, subscription) {
  try {
    await refreshTokenIfNeeded(connection);
  } catch (err) {
    console.error(`Failed to refresh token for initial import, connection ${connection.id}:`, err);
    return;
  }

  const provider = getProvider(connection.provider);

  try {
    const events = await provider.pullAllEvents(connection, subscription.external_calendar_id);

    let imported = 0;
    for (const change of events) {
      try {
        const existing = await db.getSyncMappingByExternalId(connection.id, change.externalEventId);
        if (existing) continue; // Already imported

        const newEvent = await db.createCalendarEventFromSync(
          connection.household_id,
          change.eventData,
          connection.user_id,
          subscription.id,
          subscription.category,
          subscription.visibility,
        );

        await db.createSyncMappingWithSubscription(
          newEvent.id,
          connection.id,
          subscription.id,
          change.externalEventId,
          change.etag || null,
        );
        imported++;
      } catch (err) {
        console.error(`Failed to import event ${change.externalEventId}:`, err);
      }
    }

    await db.updateSubscription(subscription.id, { last_synced_at: new Date().toISOString() });
    console.log(`Imported ${imported} events for subscription ${subscription.id} (${subscription.display_name})`);
  } catch (err) {
    console.error(`Initial import failed for subscription ${subscription.id}:`, err);
  }
}

/**
 * Process a single change from an external provider.
 */
async function processChange(connection, subscription, change) {
  const { externalEventId, action, eventData, etag } = change;

  try {
    const existingMapping = await db.getSyncMappingByExternalId(connection.id, externalEventId);

    if (action === 'upsert' || action === 'create') {
      if (existingMapping) {
        // Update existing event
        await db.updateCalendarEvent(existingMapping.event_id, connection.household_id, eventData);
        await db.createSyncMappingWithSubscription(
          existingMapping.event_id, connection.id, subscription.id, externalEventId, etag,
        );
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
      }
    } else if (action === 'delete') {
      if (existingMapping) {
        await db.deleteCalendarEvent(existingMapping.event_id, connection.household_id);
        await db.deleteSyncMapping(existingMapping.event_id, connection.id);
      }
    }
  } catch (err) {
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
