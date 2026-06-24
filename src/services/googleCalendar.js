// Google Calendar API helpers (Phase 1: read-only). The OAuth2 client is built
// from a stored connection's ENCRYPTED refresh token - googleapis mints/refreshes
// access tokens on demand from the refresh token, so we don't manage expiry here.
//
// Phase 1 exposes listCalendars (for the picker). The inbound event pull lands
// in Phase 2 of this file. No write scopes are ever requested.

const { decryptToken } = require('../utils/calendar-token-crypto');

const REDIRECT = `${process.env.API_URL || 'http://localhost:3000'}/api/calendar/connect/google/callback`;

// Build an authorised OAuth2 client for a calendar_connections row. Throws
// NO_REFRESH_TOKEN when the stored token is missing (caller marks reconnect).
function oauthClientForConnection(connection) {
  const { google } = require('googleapis');
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    REDIRECT,
  );
  const refresh = connection.refresh_token ? decryptToken(connection.refresh_token) : null;
  if (!refresh) {
    const e = new Error('NO_REFRESH_TOKEN');
    e.code = 'NO_REFRESH_TOKEN';
    throw e;
  }
  client.setCredentials({ refresh_token: refresh });
  return client;
}

function calendarApi(connection) {
  const { google } = require('googleapis');
  return google.calendar({ version: 'v3', auth: oauthClientForConnection(connection) });
}

// List the user's calendars for the picker. Read-only.
async function listCalendars(connection) {
  const cal = calendarApi(connection);
  const res = await cal.calendarList.list({ maxResults: 250 });
  return (res.data.items || [])
    .filter((c) => c.id)
    .map((c) => ({
      id: c.id,
      summary: c.summaryOverride || c.summary || c.id,
      primary: !!c.primary,
      backgroundColor: c.backgroundColor || null,
      accessRole: c.accessRole || null,
    }));
}

module.exports = { oauthClientForConnection, calendarApi, listCalendars };
