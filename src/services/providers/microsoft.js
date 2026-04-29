// Microsoft Graph (Outlook) provider — reduced to a single export.
//
// Two-way sync was removed in favour of read-only inbound iCal feeds
// (see src/services/externalFeed.js + the external_calendar_feeds
// table). The OAuth flow, push/pull/webhook handlers, and supporting
// helpers are all gone. The one piece worth keeping is
// `deleteEventsBatch` — used by the disconnect-cleanup path on the
// off-chance any future user is mid-migration with leftover sync_mappings
// pointing at events Housemait once pushed into their Outlook calendar.
//
// If the disconnect-cleanup path ever goes away too (no users still on
// the old model), this file can be deleted entirely.

// Lazy-load microsoft-graph-client to keep server startup fast
let _GraphClient = null;
function getGraphClient() {
  if (!_GraphClient) _GraphClient = require('@microsoft/microsoft-graph-client').Client;
  return _GraphClient;
}

function getClient(accessToken) {
  return getGraphClient().init({
    authProvider: (done) => done(null, accessToken),
  });
}

/**
 * Bulk-delete events from Outlook during a connection cleanup.
 *
 * Iterates the user's sync mappings and issues a Graph DELETE for each.
 * 404 from Graph means the event is already gone — counted as a success
 * because the end state is what the user wanted. Other errors count as
 * failures so the UI can warn about orphaned events.
 */
async function deleteEventsBatch(connection, syncMappings) {
  const result = { succeeded: 0, failed: 0, errors: [] };
  if (!syncMappings || syncMappings.length === 0) return result;

  let client;
  try {
    client = getClient(connection.access_token);
  } catch (err) {
    return {
      succeeded: 0,
      failed: syncMappings.length,
      errors: [{ code: 'CONNECTION_FAILED', message: err.message || String(err) }],
    };
  }

  for (const mapping of syncMappings) {
    const externalId = mapping.external_event_id;
    try {
      await client.api(`/me/events/${externalId}`).delete();
      result.succeeded++;
    } catch (err) {
      const status = err?.statusCode || err?.code || err?.response?.status;
      if (status === 404) {
        result.succeeded++;
      } else {
        result.failed++;
        result.errors.push({ uid: externalId, message: err.message || String(err) });
        console.warn(`[microsoft cleanup] Failed to delete ${externalId}:`, err.message || err);
      }
    }
  }

  return result;
}

module.exports = { deleteEventsBatch };
