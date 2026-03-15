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
 * After a Curata calendar event is created/updated/deleted, push the change
 * to all connected external calendars for the household.
 *
 * @param {string} householdId
 * @param {object} event - The Curata calendar event
 * @param {'create'|'update'|'delete'} action
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

        if (action === 'create') {
          await db.createSyncMapping({
            connection_id: connection.id,
            curata_event_id: event.id,
            external_event_id: result.externalEventId,
            etag: result.etag || null,
          });
        } else if (action === 'update') {
          await db.updateSyncMapping({
            connection_id: connection.id,
            curata_event_id: event.id,
            external_event_id: result.externalEventId,
            etag: result.etag || null,
          });
        } else if (action === 'delete') {
          await db.deleteSyncMapping(connection.id, event.id);
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
 * events from the provider and syncs them back to Curata.
 *
 * @param {object} connection - A calendar_connection record
 */
async function pullChangesFromProvider(connection) {
  try {
    await refreshTokenIfNeeded(connection);
  } catch (err) {
    console.error(`Failed to refresh token for connection ${connection.id}:`, err);
    return;
  }

  let changes;
  try {
    const provider = getProvider(connection.provider);
    changes = await provider.pullChanges(connection);
  } catch (err) {
    console.error(`Failed to pull changes for connection ${connection.id} (${connection.provider}):`, err);
    return;
  }

  for (const change of changes) {
    const { externalEventId, action, eventData, etag } = change;

    try {
      const existingMapping = await db.getSyncMappingByExternalId(connection.id, externalEventId);

      if (action === 'create') {
        if (!existingMapping) {
          const newEvent = await db.createCalendarEvent({
            ...eventData,
            household_id: connection.household_id,
          });
          await db.createSyncMapping({
            connection_id: connection.id,
            curata_event_id: newEvent.id,
            external_event_id: externalEventId,
            etag: etag || null,
          });
        }
      } else if (action === 'update') {
        if (existingMapping) {
          await db.updateCalendarEvent(existingMapping.curata_event_id, eventData);
          await db.updateSyncMapping({
            connection_id: connection.id,
            curata_event_id: existingMapping.curata_event_id,
            external_event_id: externalEventId,
            etag: etag || null,
          });
        }
      } else if (action === 'delete') {
        if (existingMapping) {
          await db.deleteCalendarEvent(existingMapping.curata_event_id);
          await db.deleteSyncMapping(connection.id, existingMapping.curata_event_id);
        }
      }
    } catch (err) {
      console.error(
        `Failed to process ${action} for external event ${externalEventId} on connection ${connection.id}:`,
        err
      );
    }
  }
}

/**
 * Checks token_expires_at on a connection. If expired, refreshes the token
 * via the provider and persists the updated connection.
 *
 * @param {object} connection - A calendar_connection record
 */
async function refreshTokenIfNeeded(connection) {
  if (!connection.token_expires_at) {
    return;
  }

  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  if (now >= expiresAt) {
    const provider = getProvider(connection.provider);
    const refreshedTokens = await provider.refreshToken(connection);
    await db.upsertCalendarConnection({
      ...connection,
      ...refreshedTokens,
    });
    Object.assign(connection, refreshedTokens);
  }
}

module.exports = {
  pushEventToConnections,
  pullChangesFromProvider,
  refreshTokenIfNeeded,
};
