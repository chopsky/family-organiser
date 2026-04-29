// Google Calendar provider — reduced to a single export.
//
// Two-way sync was removed in favour of read-only inbound iCal feeds
// (see src/services/externalFeed.js + the external_calendar_feeds
// table). The OAuth flow, push/pull/webhook handlers, and supporting
// helpers are all gone. The one piece worth keeping is
// `deleteEventsBatch` — used by the disconnect-cleanup path on the
// off-chance any future user is mid-migration with leftover sync_mappings
// pointing at events Housemait once pushed into their Google calendar.
//
// If the disconnect-cleanup path ever goes away too (no users still on
// the old model), this file can be deleted entirely.

// Lazy-load googleapis (it's ~800ms to require) to keep server startup fast
let _google = null;
function getGoogle() {
  if (!_google) _google = require('googleapis').google;
  return _google;
}

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const API_URL = process.env.API_URL || 'http://localhost:3000';
const REDIRECT_URI = `${API_URL}/api/calendar/connect/google/callback`;

function createOAuth2Client() {
  return new (getGoogle()).auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

function createCalendarClient(accessToken) {
  const auth = createOAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return getGoogle().calendar({ version: 'v3', auth });
}

/**
 * Bulk-delete events from Google Calendar during a connection cleanup.
 *
 * Iterates the user's sync mappings and issues `events.delete` for each.
 * 404/410 from Google means the event is already gone — counted as a
 * success because the end state is what the user wanted. Other errors
 * count as failures so the UI can warn about orphaned events.
 */
async function deleteEventsBatch(connection, syncMappings) {
  const result = { succeeded: 0, failed: 0, errors: [] };
  if (!syncMappings || syncMappings.length === 0) return result;

  let calendar;
  try {
    calendar = createCalendarClient(connection.access_token);
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
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: externalId,
      });
      result.succeeded++;
    } catch (err) {
      const status = err?.code || err?.response?.status;
      if (status === 404 || status === 410) {
        result.succeeded++;
      } else {
        result.failed++;
        result.errors.push({ uid: externalId, message: err.message || String(err) });
        console.warn(`[google cleanup] Failed to delete ${externalId}:`, err.message || err);
      }
    }
  }

  return result;
}

module.exports = { deleteEventsBatch };
