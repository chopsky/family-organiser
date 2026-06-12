const { supabaseAdmin: supabase } = require('./client');
const crypto = require('crypto');

// Sanitise a free-text value before embedding it in a PostgREST `.or()` filter
// STRING. PostgREST parses that whole string, so commas / parentheses (its
// condition + group delimiters) and backslashes in user input could break out
// of an `ilike` value and inject extra filter conditions. Strip those
// structural metacharacters; `%` and `_` stay (harmless ilike wildcards that
// only ever over-match). Safe to interpolate into `col.ilike.%VALUE%`.
function sanitizeOrFilterValue(value) {
  return String(value == null ? '' : value).replace(/[,()\\]/g, ' ').trim();
}

// ─── Admin audit log ────────────────────────────────────────────────────────────
// Insert one record of a platform-admin action. Called fire-and-forget by the
// adminAudit middleware, so it throws on error and the caller swallows it -
// auditing must never break the underlying admin request.
async function recordAdminAction(entry, db = supabase) {
  const { error } = await db.from('admin_audit_log').insert(entry);
  if (error) throw error;
}

// Newest-first page of the audit log for the admin viewer.
async function getAdminAuditLog({ limit = 100, offset = 0 } = {}, db = supabase) {
  const { data, error, count } = await db
    .from('admin_audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { entries: data || [], total: count || 0 };
}

// ─── Households ───────────────────────────────────────────────────────────────

function generateJoinCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9B2"
}

async function createHousehold(name, timezone, country, db = supabase) {
  const join_code = generateJoinCode();
  const inbound_email_token = crypto.randomBytes(6).toString('hex');
  const row = { name, join_code, inbound_email_token };
  if (timezone) row.timezone = timezone;
  // Country is validated by the route layer (allowed values from a fixed
  // list). Only set if provided - otherwise the DB default 'GB' applies,
  // which is the right fallback for the dominant tenant.
  if (country) row.country = country;
  const { data, error } = await db
    .from('households')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getHouseholdByCode(code, db = supabase) {
  const { data, error } = await db
    .from('households')
    .select()
    .eq('join_code', code.toUpperCase())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getHouseholdById(id, db = supabase) {
  const { data, error } = await db
    .from('households')
    .select()
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function updateHouseholdSettings(id, settings, db = supabase) {
  const { data, error } = await db
    .from('households')
    .update(settings)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Users ────────────────────────────────────────────────────────────────────

/**
 * The 16 colour themes shown in the Settings → Edit Profile picker
 * and on every avatar in the app. Order is deliberate - earlier
 * colours are picked first when auto-assigning to new members of a
 * household so two members never share a colour until the household
 * grows past 16 people.
 *
 * Kept in sync with the `avatarColors` map duplicated across the web
 * pages (Settings, Layout, Dashboard, AdminUserDetail, etc.); the
 * names here MUST match those keys exactly because the UI looks up
 * the className/bg-colour by name.
 */
const COLOR_THEMES = [
  'red', 'burnt-orange', 'amber', 'gold',
  'leaf', 'emerald', 'teal', 'sky',
  'cobalt', 'indigo', 'purple', 'magenta',
  'rose', 'terracotta', 'moss', 'slate',
];

/**
 * Pick a colour theme for a newly-joining household member.
 *
 * Walks the canonical 16-colour list in order and returns the first
 * one not yet used by anyone else in the household. Stable: the first
 * member always gets red, the second burnt-orange, etc. - so the
 * "who's who" colour-coding in the calendar and avatars stays
 * predictable.
 *
 * If a household somehow has more than 16 members, falls back to a
 * random colour from the list (collisions become inevitable past 16).
 *
 * @param {string} householdId
 * @returns {Promise<string>}
 */
async function pickColorForNewMember(householdId, db = supabase) {
  if (!householdId) return COLOR_THEMES[0];
  try {
    const { data, error } = await db
      .from('users')
      .select('color_theme')
      .eq('household_id', householdId);
    if (error) {
      console.warn('[pickColorForNewMember] members lookup failed:', error.message);
      return COLOR_THEMES[0];
    }
    const used = new Set((data || []).map((r) => r.color_theme).filter(Boolean));
    for (const c of COLOR_THEMES) {
      if (!used.has(c)) return c;
    }
    return COLOR_THEMES[Math.floor(Math.random() * COLOR_THEMES.length)];
  } catch (err) {
    console.warn('[pickColorForNewMember] threw:', err?.message || err);
    return COLOR_THEMES[0];
  }
}

async function createUser({ householdId, name, role = 'member' }, db = supabase) {
  const { data, error } = await db
    .from('users')
    .insert({
      household_id: householdId,
      name,
      role,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getHouseholdMembers(householdId, db = supabase) {
  const { data, error } = await db
    .from('users')
    .select()
    .eq('household_id', householdId)
    .order('created_at');
  if (error) throw error;
  return data;
}

async function findUserByName(householdId, name, db = supabase) {
  const { data, error } = await db
    .from('users')
    .select()
    .eq('household_id', householdId)
    .ilike('name', name)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getUserById(userId, db = supabase) {
  const { data, error } = await db
    .from('users')
    .select()
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getUserByEmail(email, db = supabase) {
  const { data, error } = await db
    .from('users')
    .select()
    .ilike('email', email)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function createUserWithEmail({ email, passwordHash, name, householdId = null, emailVerified = false, role = 'member', authProvider = null, signupPromoCode = null }, db = supabase) {
  const row = {
    email,
    password_hash: passwordHash,
    name,
    household_id: householdId,
    email_verified: emailVerified,
    role,
  };
  // Campaign promo captured at signup (e.g. school-fair flyer code).
  if (signupPromoCode) row.signup_promo_code = signupPromoCode;
  // Stamp how this user joined - read in Settings to show "Signed in
  // with Google" / "Signed in with Apple" / "Signed in with email".
  // Optional: callers from older code paths pass nothing and we leave
  // the column NULL.
  if (authProvider) row.auth_provider = authProvider;
  const { data, error } = await db
    .from('users')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateUser(userId, fields, db = supabase) {
  const { data, error } = await db
    .from('users')
    .update(fields)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Find users eligible for the T+24h WhatsApp re-engagement email.
 * Used by scheduler.runWhatsAppFollowupCheck (engagement audit Tier 2).
 *
 * Criteria:
 *   - email_verified = true   (don't bother emailing unverified users)
 *   - whatsapp_linked = false (they haven't completed the activation)
 *   - whatsapp_followup_sent_at IS NULL (we've never emailed them)
 *   - created_at older than 24h (give them a full day to come back on
 *     their own before nudging)
 *   - created_at newer than 7 days (don't blast stale signups - a user
 *     who signed up a month ago and never came back is not going to
 *     activate from an out-of-the-blue email)
 *   - disabled_at IS NULL    (skip disabled accounts)
 *
 * Returns: array of { id, name, email }.
 */
async function findUsersAwaitingWhatsAppFollowup(db = supabase) {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff7d  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('users')
    .select('id, name, email')
    .eq('email_verified', true)
    .eq('whatsapp_linked', false)
    .is('whatsapp_followup_sent_at', null)
    .is('disabled_at', null)
    .lt('created_at', cutoff24h)
    .gt('created_at', cutoff7d)
    .not('email', 'is', null);
  if (error) {
    console.error('[findUsersAwaitingWhatsAppFollowup] query failed:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Stamp users.whatsapp_followup_sent_at on a user after the re-engagement
 * email is sent. Idempotent - second call is a no-op since the cron only
 * picks up users with the column still NULL.
 */
async function markWhatsAppFollowupSent(userId, db = supabase) {
  const { error } = await db
    .from('users')
    .update({ whatsapp_followup_sent_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) console.error('[markWhatsAppFollowupSent] update failed:', error.message);
}

// ─── Token helpers (verification, reset) ─────────────────────────────────────

async function createToken(table, { userId, token, expiresAt }, db = supabase) {
  const { data, error } = await db
    .from(table)
    .insert({ user_id: userId, token, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getValidToken(table, token, db = supabase) {
  const { data, error } = await db
    .from(table)
    .select()
    .eq('token', token)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function markTokenUsed(table, tokenId, db = supabase) {
  const { error } = await db
    .from(table)
    .update({ used: true })
    .eq('id', tokenId);
  if (error) throw error;
}

// Convenience wrappers
const createEmailVerificationToken = (userId, token, expiresAt) => createToken('email_verification_tokens', { userId, token, expiresAt });
const getEmailVerificationToken = (token) => getValidToken('email_verification_tokens', token);
const markEmailVerificationTokenUsed = (id) => markTokenUsed('email_verification_tokens', id);

const createPasswordResetToken = (userId, token, expiresAt) => createToken('password_reset_tokens', { userId, token, expiresAt });
const getPasswordResetToken = (token) => getValidToken('password_reset_tokens', token);
const markPasswordResetTokenUsed = (id) => markTokenUsed('password_reset_tokens', id);

// ─── Refresh tokens (session security) ───────────────────────────────────────

// True when a query failed only because the app_version column doesn't exist
// yet (migration-app-version.sql not run). Lets the app_version touchpoints
// degrade gracefully — write/read without it — instead of hard-failing core
// flows like login while the migration is pending.
function isMissingColumnError(error) {
  if (!error) return false;
  const code = error.code;
  const msg = (error.message || '').toLowerCase();
  return code === '42703' || code === 'PGRST204'
    || (msg.includes('app_version'))
    || (msg.includes('column') && msg.includes('does not exist'));
}

async function createRefreshToken(userId, token, expiresAt, meta = {}, db = supabase) {
  const baseRow = {
    user_id: userId,
    token,
    expires_at: expiresAt,
    user_agent: meta.userAgent || null,
    ip_address: meta.ipAddress || null,
    last_used_at: new Date().toISOString(),
  };
  let { data, error } = await db
    .from('refresh_tokens')
    .insert({ ...baseRow, app_version: meta.appVersion || null })
    .select()
    .single();
  // Pre-migration fallback: retry without app_version so login never breaks.
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await db.from('refresh_tokens').insert(baseRow).select().single());
  }
  if (error) throw error;
  return data;
}

async function getValidRefreshToken(token, db = supabase) {
  const { data, error } = await db
    .from('refresh_tokens')
    .select()
    .eq('token', token)
    .eq('revoked', false)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function revokeRefreshToken(tokenId, db = supabase) {
  const { error } = await db
    .from('refresh_tokens')
    .update({ revoked: true })
    .eq('id', tokenId);
  if (error) throw error;
}

async function revokeAllUserRefreshTokens(userId, db = supabase) {
  const { error } = await db
    .from('refresh_tokens')
    .update({ revoked: true })
    .eq('user_id', userId)
    .eq('revoked', false);
  if (error) throw error;
}

/**
 * Return the caller's active (non-revoked, non-expired) refresh tokens
 * with their session metadata. Used by Settings → Active sessions.
 *
 * The token string itself is deliberately NOT returned - only enough to
 * identify the session in the UI (id, device, location, timestamps).
 * `current_token_id` parameter lets the UI flag "this is the one you're
 * using right now" and show a distinct button label.
 */
async function getActiveSessionsForUser(userId, db = supabase) {
  const { data, error } = await db
    .from('refresh_tokens')
    .select('id, user_agent, ip_address, created_at, last_used_at, expires_at')
    .eq('user_id', userId)
    .eq('revoked', false)
    .gt('expires_at', new Date().toISOString())
    .order('last_used_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Revoke every active refresh token for this user EXCEPT one (typically
 * the caller's current session, identified by the token string they hold).
 * Safe if keepTokenId is null - revokes everything.
 */
async function revokeOtherUserRefreshTokens(userId, keepTokenId, db = supabase) {
  let query = db
    .from('refresh_tokens')
    .update({ revoked: true })
    .eq('user_id', userId)
    .eq('revoked', false);
  if (keepTokenId) query = query.neq('id', keepTokenId);
  const { error } = await query;
  if (error) throw error;
}

/**
 * Update last_used_at on an existing refresh token. Called each time the
 * token is rotated via /auth/refresh so the "last used X ago" timestamp
 * in Settings reflects reality.
 */
async function touchRefreshToken(tokenId, db = supabase) {
  const { error } = await db
    .from('refresh_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', tokenId);
  if (error) console.warn('[db] touchRefreshToken failed:', error.message);
}

// ─── Household notes ─────────────────────────────────────────────────────────

async function getHouseholdNotes(householdId, db = supabase) {
  const { data, error } = await db
    .from('household_notes')
    .select()
    .eq('household_id', householdId)
    .order('key');
  if (error) throw error;
  return data || [];
}

async function upsertHouseholdNote(householdId, key, value, userId, db = supabase) {
  const { data, error } = await db
    .from('household_notes')
    .upsert(
      { household_id: householdId, key: key.toLowerCase().trim(), value, created_by: userId, updated_at: new Date().toISOString() },
      { onConflict: 'household_id,key' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteHouseholdNote(householdId, key, db = supabase) {
  const { error } = await db
    .from('household_notes')
    .delete()
    .eq('household_id', householdId)
    .eq('key', key.toLowerCase().trim());
  if (error) throw error;
}

// ─── Household preferences ────────────────────────────────────────────────
// Structured AI-consulted facts (dietary, allergies, member-specific
// quirks, schedule anchors). Distinct from household_notes (free-form,
// recall-on-demand KV) - preferences are auto-surfaced into every
// classifier prompt so the model considers them on every relevant
// turn without being asked.

// Whitelisted preference keys. Keeping this short on purpose: the
// classifier needs a constrained vocabulary or it'll invent its own
// keys (e.g. "food_preference", "person_dislikes") and the auto-surface
// becomes noisy. Anything outside this set gets coerced to 'preference'.
const PREFERENCE_KEYS = new Set([
  'allergy',     // hard medical constraint - "Lynn is allergic to nuts"
  'dietary',     // dietary stance - "we're vegetarian", "we don't eat pork"
  'dislike',     // soft food/topic aversion - "Mason hates mushrooms"
  'like',        // positive preference - "Logan loves pasta"
  'schedule',    // recurring time anchor - "Tuesdays are soccer night"
  'preference',  // generic catch-all when none of the above fits
]);

async function addHouseholdPreference(householdId, { memberId, key, value, source = 'inferred' }, db = supabase) {
  if (!householdId || !key || !value) return null;
  const safeKey = PREFERENCE_KEYS.has(key) ? key : 'preference';
  const safeValue = String(value).trim();
  if (!safeValue) return null;
  // Upsert behaviour: if the same (household, member, key, value) tuple
  // already exists, touch updated_at via the trigger; otherwise insert.
  // The unique index uses COALESCE(member_id, zero-uuid) so null
  // member_id collides with null member_id correctly.
  const { data, error } = await db
    .from('household_preferences')
    .upsert(
      {
        household_id: householdId,
        member_id: memberId || null,
        key: safeKey,
        value: safeValue,
        source,
      },
      { onConflict: 'household_id,member_id,key,value', ignoreDuplicates: false },
    )
    .select()
    .single();
  if (error) {
    // The COALESCE-based unique index isn't a true conflict target for
    // PostgREST when member_id is null; fall back to a select-then-decide
    // pattern so duplicate inserts don't crash the bot.
    if (error.code === '23505') {
      console.log('[preferences] duplicate prevented by unique index:', safeKey, '=', safeValue);
      return null;
    }
    throw error;
  }
  return data;
}

async function getHouseholdPreferences(householdId, db = supabase) {
  if (!householdId) return [];
  const { data, error } = await db
    .from('household_preferences')
    .select('id, member_id, key, value, source, created_at')
    .eq('household_id', householdId)
    .order('key')
    .order('value');
  if (error) throw error;
  return data || [];
}

async function deleteHouseholdPreference(id, householdId, db = supabase) {
  if (!id || !householdId) return false;
  const { error } = await db
    .from('household_preferences')
    .delete()
    .eq('id', id)
    .eq('household_id', householdId);
  if (error) throw error;
  return true;
}

// ─── Dependent helpers ───────────────────────────────────────────────────────

async function createDependent(householdId, { name, family_role, birthday, color_theme, school_id }, db = supabase) {
  const { data, error } = await db
    .from('users')
    .insert({
      household_id: householdId,
      name,
      family_role: family_role || null,
      birthday: birthday || null,
      color_theme: color_theme || 'sage',
      school_id: school_id || null,
      member_type: 'dependent',
      role: 'member',
      email_verified: false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteDependent(id, householdId, db = supabase) {
  // Dependents are rows in the `users` table with member_type='dependent'.
  // Deleting them cascades through every users.id-referencing table
  // (event_reminders, event_assignees, chat_messages, school_activities,
  // shopping_items.added_by, calendar_events.created_by, audit logs, etc.).
  // On real households with weeks/months of activity that cascade exceeds
  // Supabase's default ~30s statement_timeout and the delete fails with
  // 57014 - same failure mode the admin user-delete had before we wrapped
  // it in delete_user_cascade(). So we route dependent deletes through
  // the same RPC for the same reason.
  //
  // Ownership check first: confirm the row is genuinely a dependent in
  // this household before invoking the RPC (which takes only a user_id
  // and would otherwise let any household admin delete any user by
  // guessing the UUID).
  const { data: target, error: lookupErr } = await db
    .from('users')
    .select('id, member_type, household_id')
    .eq('id', id)
    .eq('household_id', householdId)
    .eq('member_type', 'dependent')
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!target) {
    const err = new Error('Dependent not found in this household.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Call delete_user_cascade (5-min timeout) - same as admin user delete.
  const { error: rpcErr } = await db.rpc('delete_user_cascade', { p_user_id: id });
  if (!rpcErr) return;

  // 42883 = undefined_function. Brief deploy-window fallback to direct
  // DELETE; will still hit the 30s timeout on big households but at
  // least small ones can be deleted before the migration is run.
  if (rpcErr.code === '42883' || /function .*does not exist/i.test(rpcErr.message || '')) {
    console.warn('[db] delete_user_cascade() not installed - falling back to direct DELETE. Run migration-user-delete-fix.sql.');
    const { error } = await db.from('users').delete().eq('id', id);
    if (error) throw error;
    return;
  }
  throw rpcErr;
}

// ─── Chat message helpers ────────────────────────────────────────────────────

async function getChatHistory(conversationId, limit = 50, householdId = null, db = supabase) {
  let query = db
    .from('chat_messages')
    .select()
    .eq('conversation_id', conversationId);
  // Scope to the household so a guessed conversation id can't read another
  // household's chat history (IDOR). Callers always pass req.householdId.
  if (householdId) query = query.eq('household_id', householdId);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse();
}

async function saveChatMessage(householdId, userId, role, content, conversationId, db = supabase) {
  const { data, error } = await db
    .from('chat_messages')
    .insert({ household_id: householdId, user_id: userId, role, content, conversation_id: conversationId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function clearChatHistory(conversationId, householdId = null, db = supabase) {
  let query = db
    .from('chat_messages')
    .delete()
    .eq('conversation_id', conversationId);
  if (householdId) query = query.eq('household_id', householdId);
  const { error } = await query;
  if (error) throw error;
}

async function createConversation(householdId, userId, title, db = supabase) {
  const { data, error } = await db
    .from('chat_conversations')
    .insert({ household_id: householdId, user_id: userId, title: title || 'New conversation' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getConversations(userId, limit = 30, db = supabase) {
  const { data, error } = await db
    .from('chat_conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function deleteConversation(conversationId, userId, db = supabase) {
  const { error } = await db
    .from('chat_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

async function updateConversationTitle(conversationId, title, db = supabase) {
  const { error } = await db
    .from('chat_conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}

async function touchConversation(conversationId, db = supabase) {
  const { error } = await db
    .from('chat_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) throw error;
}

// ─── School helpers ──────────────────────────────────────────────────────────

const { tokenize, buildOrFilter, filterAndRank } = require('../utils/school-search');

/**
 * Search the GIAS schools directory.
 *
 * The old version ILIKE'd the raw query against the `name` column only, which
 * missed a whole class of multi-word queries - e.g. "Queen Elizabeth's School
 * in Barnet" returned nothing because "in Barnet" is not in the name (the DB
 * row is stored as "Queen Elizabeth's School, Barnet" with a comma, and the
 * town lives in the `local_authority` column anyway).
 *
 * Now:
 *   1. Tokenise (drop connectives + generic school nouns).
 *   2. DB filter: any token matches name / LA / address via PostgREST `or()`.
 *   3. Pull 200 candidates, then JS-filter down to rows where *every* token
 *      appears in the combined text. Rank name-matches above LA/address-only
 *      matches.
 *   4. Return the top 10.
 */
async function searchSchools(query, postcode, db = supabase) {
  const { distinctive } = tokenize(query);
  if (distinctive.length === 0) return [];

  const orFilter = buildOrFilter(distinctive);
  if (!orFilter) return [];

  let q = db
    .from('schools_directory')
    .select('urn, name, type, phase, local_authority, address, postcode')
    .eq('status', 'open')
    .or(orFilter)
    .limit(200); // generous - JS filter below tightens this to 10

  if (postcode) {
    q = q.ilike('postcode', `${postcode}%`);
  }

  const { data, error } = await q;
  if (error) throw error;

  return filterAndRank(data || [], distinctive).slice(0, 10);
}

async function searchSchoolByUrn(urn, db = supabase) {
  const { data, error } = await db
    .from('schools_directory')
    .select('urn, name, type, phase, local_authority, address, postcode')
    .eq('urn', urn)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createHouseholdSchool(householdId, data, db = supabase) {
  const { data: school, error } = await db
    .from('household_schools')
    .insert({
      household_id: householdId,
      school_name: data.school_name,
      school_urn: data.school_urn || null,
      school_type: data.school_type || null,
      local_authority: data.local_authority || null,
      postcode: data.postcode || null,
      uses_la_dates: data.uses_la_dates !== false,
      colour: data.colour || '#4A90D9',
    })
    .select()
    .single();
  if (error) throw error;
  return school;
}

async function getHouseholdSchools(householdId, db = supabase) {
  const { data, error } = await db
    .from('household_schools')
    .select('*')
    .eq('household_id', householdId)
    .order('school_name');
  if (error) throw error;
  return data || [];
}

async function getHouseholdSchoolByUrn(householdId, urn, db = supabase) {
  const { data, error } = await db
    .from('household_schools')
    .select('*')
    .eq('household_id', householdId)
    .eq('school_urn', urn)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function deleteHouseholdSchool(schoolId, householdId, db = supabase) {
  const { error } = await db
    .from('household_schools')
    .delete()
    .eq('id', schoolId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function updateHouseholdSchool(schoolId, updates, db = supabase) {
  const { data, error } = await db
    .from('household_schools')
    .update(updates)
    .eq('id', schoolId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getCachedLATermDates(localAuthority, academicYear, db = supabase) {
  const { data, error } = await db
    .from('la_term_dates_cache')
    .select('dates')
    .eq('local_authority', localAuthority.toLowerCase().trim())
    .eq('academic_year', academicYear)
    .maybeSingle();
  if (error) throw error;
  return data?.dates || null;
}

async function cacheLATermDates(localAuthority, academicYear, dates, db = supabase) {
  const { error } = await db
    .from('la_term_dates_cache')
    .upsert({
      local_authority: localAuthority.toLowerCase().trim(),
      academic_year: academicYear,
      dates,
    }, { onConflict: 'local_authority,academic_year' });
  if (error) console.error('Failed to cache LA term dates:', error.message);
}

async function addSchoolTermDates(schoolId, dates, db = supabase) {
  const rows = dates.map(d => ({
    school_id: schoolId,
    academic_year: d.academic_year,
    event_type: d.event_type,
    date: d.date,
    end_date: d.end_date || null,
    label: d.label || null,
    source: d.source || 'manual',
  }));
  const { data, error } = await db
    .from('school_term_dates')
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}

async function getSchoolTermDates(schoolId, db = supabase) {
  const { data, error } = await db
    .from('school_term_dates')
    .select('*')
    .eq('school_id', schoolId)
    .order('date');
  if (error) throw error;
  return data || [];
}

// Fetch a single term-date row by id (used by the route to resolve its
// school_id for household-ownership checks before delete).
async function getSchoolTermDateById(dateId, db = supabase) {
  const { data, error } = await db
    .from('school_term_dates')
    .select('*')
    .eq('id', dateId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getTermDatesBySchoolIds(schoolIds, db = supabase) {
  if (!schoolIds.length) return [];
  const { data, error } = await db
    .from('school_term_dates')
    .select('*')
    .in('school_id', schoolIds)
    .order('date');
  if (error) throw error;
  return data || [];
}

async function getActivitiesByChildIds(childIds, db = supabase) {
  if (!childIds.length) return [];
  const { data, error } = await db
    .from('child_weekly_schedule')
    .select('*')
    .in('child_id', childIds)
    .order('day_of_week');
  if (error) throw error;
  return data || [];
}

async function deleteSchoolTermDate(dateId, db = supabase) {
  const { error } = await db
    .from('school_term_dates')
    .delete()
    .eq('id', dateId);
  if (error) throw error;
}

async function updateSchoolTermDate(dateId, updates, db = supabase) {
  const allowed = {};
  if (updates.date !== undefined) allowed.date = updates.date;
  if (updates.end_date !== undefined) allowed.end_date = updates.end_date;
  if (updates.label !== undefined) allowed.label = updates.label;
  if (updates.event_type !== undefined) allowed.event_type = updates.event_type;
  const { data, error } = await db
    .from('school_term_dates')
    .update(allowed)
    .eq('id', dateId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateHouseholdSchoolMeta(schoolId, meta, db = supabase) {
  const allowed = {};
  if (meta.term_dates_source !== undefined) allowed.term_dates_source = meta.term_dates_source;
  if (meta.term_dates_last_updated !== undefined) allowed.term_dates_last_updated = meta.term_dates_last_updated;
  if (meta.ical_last_sync !== undefined) allowed.ical_last_sync = meta.ical_last_sync;
  if (meta.ical_last_sync_status !== undefined) allowed.ical_last_sync_status = meta.ical_last_sync_status;
  const { data, error } = await db
    .from('household_schools')
    .update(allowed)
    .eq('id', schoolId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTermDatesBySchoolAndAcademicYear(schoolId, academicYear, db = supabase) {
  const { error } = await db
    .from('school_term_dates')
    .delete()
    .eq('school_id', schoolId)
    .eq('academic_year', academicYear);
  if (error) throw error;
}

async function deleteAllTermDatesBySchool(schoolId, db = supabase) {
  const { error } = await db
    .from('school_term_dates')
    .delete()
    .eq('school_id', schoolId);
  if (error) throw error;
}

async function getSchoolsWithIcalUrls(db = supabase) {
  const { data, error } = await db
    .from('household_schools')
    .select('*')
    .not('ical_url', 'is', null)
    .neq('ical_url', '');
  if (error) throw error;
  return data || [];
}

async function addChildActivity(data, db = supabase) {
  const { data: activity, error } = await db
    .from('child_weekly_schedule')
    .insert({
      child_id: data.child_id,
      day_of_week: data.day_of_week,
      activity: data.activity,
      time_start: data.time_start || null,
      time_end: data.time_end || null,
      reminder_text: data.reminder_text || null,
      reminder_offset: data.reminder_offset || 'morning_of',
      term_only: data.term_only !== false,
      pickup_member_id: data.pickup_member_id || null,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      term_label: data.term_label || null,
    })
    .select()
    .single();
  if (error) throw error;
  return activity;
}

/**
 * Update an existing after-school activity. Only whitelisted fields are
 * applied; pickup_member_id of null clears the pickup person.
 */
async function updateChildActivity(activityId, fields, db = supabase) {
  const patch = {};
  if (fields.day_of_week !== undefined) patch.day_of_week = fields.day_of_week;
  if (fields.activity !== undefined) patch.activity = fields.activity;
  if (fields.time_end !== undefined) patch.time_end = fields.time_end || null;
  if (fields.time_start !== undefined) patch.time_start = fields.time_start || null;
  if ('pickup_member_id' in fields) patch.pickup_member_id = fields.pickup_member_id || null;
  if ('start_date' in fields) patch.start_date = fields.start_date || null;
  if ('end_date' in fields) patch.end_date = fields.end_date || null;
  if ('term_label' in fields) patch.term_label = fields.term_label || null;
  const { data: activity, error } = await db
    .from('child_weekly_schedule')
    .update(patch)
    .eq('id', activityId)
    .select()
    .single();
  if (error) throw error;
  return activity;
}

async function getChildActivities(childId, db = supabase) {
  const { data, error } = await db
    .from('child_weekly_schedule')
    .select('*')
    .eq('child_id', childId)
    .order('day_of_week');
  if (error) throw error;
  return data || [];
}

// All weekly activities across every child in a household, regardless of
// whether the child is linked to a school. The household-level Activities card
// needs this because, under the household-level Schools model, a child in a
// single-school household carries no school_id and so wouldn't appear under any
// school's children in GET /schools. Joins child_weekly_schedule -> users to
// scope by household_id (IDOR-safe).
async function getHouseholdActivities(householdId, db = supabase) {
  const { data, error } = await db
    .from('child_weekly_schedule')
    .select('*, users!inner(household_id)')
    .eq('users.household_id', householdId)
    .order('day_of_week');
  if (error) throw error;
  // Strip the joined users object so callers get clean activity rows.
  return (data || []).map(({ users, ...activity }) => activity);
}

// Fetch a single activity by id (used by the routes to resolve its child_id
// for household-ownership checks before edit/delete).
async function getChildActivityById(activityId, db = supabase) {
  const { data, error } = await db
    .from('child_weekly_schedule')
    .select('*')
    .eq('id', activityId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function deleteChildActivity(activityId, db = supabase) {
  const { error } = await db
    .from('child_weekly_schedule')
    .delete()
    .eq('id', activityId);
  if (error) throw error;
}

async function addChildSchoolEvent(data, db = supabase) {
  const { data: event, error } = await db
    .from('child_school_events')
    .insert({
      child_id: data.child_id,
      school_id: data.school_id,
      title: data.title,
      date: data.date,
      event_type: data.event_type || 'other',
      notes: data.notes || null,
    })
    .select()
    .single();
  if (error) throw error;
  return event;
}

async function getChildSchoolEvents(childId, db = supabase) {
  const { data, error } = await db
    .from('child_school_events')
    .select('*')
    .eq('child_id', childId)
    .order('date');
  if (error) throw error;
  return data || [];
}

// ─── WhatsApp helpers ────────────────────────────────────────────────────────

async function getUserByWhatsAppPhone(phone, db = supabase) {
  // Normalise: strip whatsapp: prefix and ensure + prefix
  const clean = phone.replace(/^whatsapp:/, '').trim();
  const normalised = clean.startsWith('+') ? clean : `+${clean}`;

  const { data, error } = await db
    .from('users')
    .select()
    .eq('whatsapp_phone', normalised)
    .eq('whatsapp_linked', true)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function createWhatsAppVerificationCode(userId, phone, code, expiresAt, db = supabase) {
  const { data, error } = await db
    .from('whatsapp_verification_codes')
    .insert({ user_id: userId, phone, code, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getWhatsAppVerificationCode(userId, code, db = supabase) {
  const { data, error } = await db
    .from('whatsapp_verification_codes')
    .select()
    .eq('user_id', userId)
    .eq('code', code)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function markWhatsAppVerificationCodeUsed(id, db = supabase) {
  const { error } = await db
    .from('whatsapp_verification_codes')
    .update({ used: true })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Pull-push pairing: create a code without a phone number yet. The
 * user opens WhatsApp and messages the bot with this code; the inbound
 * webhook then consumes it via consumeWhatsAppPairingCode below.
 */
async function createWhatsAppPairingCode(userId, code, expiresAt, db = supabase) {
  const { data, error } = await db
    .from('whatsapp_verification_codes')
    .insert({ user_id: userId, code, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Look up an unused, unexpired pairing code (case-insensitive on the
 * code itself). Returns the row or null. Caller is responsible for
 * marking it used AND linking the phone on the user.
 */
async function findUnusedPairingCode(code, db = supabase) {
  const { data, error } = await db
    .from('whatsapp_verification_codes')
    .select()
    .ilike('code', code)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Race-safe consume: atomically marks the row used + records the phone.
 * Updates only if used is still false (so two webhook retries can't
 * both consume the same code). Returns the row that was actually
 * updated, or null if someone else already took it.
 */
async function consumePairingCode(rowId, phone, db = supabase) {
  const { data, error } = await db
    .from('whatsapp_verification_codes')
    .update({ used: true, phone })
    .eq('id', rowId)
    .eq('used', false)
    .select()
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Has the pairing code (created by createWhatsAppPairingCode) been
 * consumed yet? Returns the row if used + phone set, else null. The
 * frontend polls this to know when to flip the UI to "Connected".
 */
async function getPairingCodeStatus(userId, code, db = supabase) {
  const { data, error } = await db
    .from('whatsapp_verification_codes')
    .select()
    .eq('user_id', userId)
    .ilike('code', code)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Record that we've just received an inbound WhatsApp message from a user.
 * Used by the webhook to refresh their 24-hour customer-service window so
 * broadcast.js knows when free-form outbound is allowed vs when we must
 * fall back to a pre-approved Content Template.
 *
 * Fire-and-forget from the caller's perspective - the webhook has already
 * returned 200 to Twilio before this runs, and a write failure here must
 * never affect the user's reply. Errors are logged and swallowed.
 */
async function touchWhatsAppInbound(userId, db = supabase) {
  const { error } = await db
    .from('users')
    .update({ whatsapp_last_inbound_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) console.error('[db] touchWhatsAppInbound failed:', error.message);
}

/**
 * Mark a user as having completed the onboarding wizard.
 * Idempotent - a subsequent call keeps the original timestamp so we don't
 * overwrite when-did-you-onboard data if the client accidentally posts twice.
 * Returns the updated row so the frontend can refresh its auth state.
 */
async function markUserOnboarded(userId, db = supabase) {
  const { data, error } = await db
    .from('users')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', userId)
    .is('onboarded_at', null) // only flip NULL → now; no-op if already set
    .select()
    .maybeSingle();
  if (error) throw error;
  // maybeSingle returns null when the WHERE didn't match (user was already
  // onboarded). Fall back to a plain fetch so the caller always gets the
  // current row.
  if (!data) {
    const { data: existing, error: fetchErr } = await db
      .from('users')
      .select()
      .eq('id', userId)
      .single();
    if (fetchErr) throw fetchErr;
    return existing;
  }
  return data;
}

// ─── Invites ────────────────────────────────────────────────────────────────

async function createInvite({ householdId, email, token, invitedBy, expiresAt, name, family_role, birthday, color_theme, school_id }, db = supabase) {
  const row = { household_id: householdId, email, token, invited_by: invitedBy, expires_at: expiresAt };
  if (name) row.name = name;
  if (family_role) row.family_role = family_role;
  if (birthday) row.birthday = birthday;
  if (color_theme) row.color_theme = color_theme;
  if (school_id) row.school_id = school_id;
  const { data, error } = await db
    .from('invites')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getInviteByToken(token, db = supabase) {
  const { data, error } = await db
    .from('invites')
    .select()
    .eq('token', token)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Find the most-recent non-expired, non-accepted invite matching an
 * email address (case-insensitive). Used as a safety net on signup:
 * if an admin invited foo@bar.com but foo signed up directly via the
 * App Store without clicking the invite link, we still want to attach
 * them to the inviting household instead of creating a duplicate.
 *
 * Returns the invite row or null. .ilike() is the case-insensitive
 * match operator in PostgREST; the `%` wildcards are intentionally
 * absent so we only match exact addresses (just case-insensitive).
 */
async function getInviteByEmail(email, db = supabase) {
  if (!email?.trim()) return null;
  const { data, error } = await db
    .from('invites')
    .select()
    .ilike('email', email.trim())
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function markInviteAccepted(inviteId, db = supabase) {
  const { error } = await db
    .from('invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inviteId);
  if (error) throw error;
}

async function deleteInvite(inviteId, householdId, db = supabase) {
  const { error } = await db
    .from('invites')
    .delete()
    .eq('id', inviteId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function getPendingInvites(householdId, db = supabase) {
  const { data, error } = await db
    .from('invites')
    .select()
    .eq('household_id', householdId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function deleteUser(userId, householdId, db = supabase) {
  const { error } = await db
    .from('users')
    .delete()
    .eq('id', userId)
    .eq('household_id', householdId);
  if (error) throw error;
}

// ─── Shopping Items ───────────────────────────────────────────────────────────

// Coarse-grained shopping category - shopping_items.category has a CHECK
// constraint limiting it to this set (see migration-shopping-categories.sql).
// Keep in sync with that migration.
const VALID_SHOPPING_CATEGORIES = new Set([
  'groceries', 'clothing', 'household', 'school', 'pets', 'party', 'gifts', 'other',
]);

const { normalizeItemName } = require('../utils/shoppingDedupe');

/**
 * Dedupe-aware add. Skips items whose normalized name already exists
 * as an incomplete row on the same list. Returns:
 *   { created:   [<row>, ...]   newly-inserted rows
 *     duplicates:[{ submitted, existing }, ...]  skipped because already on list
 *     updated:   [<row>, ...]   existing rows whose quantity was bumped
 *   }
 *
 * Behaviour:
 *   • overrideHint = true → dedupe is bypassed entirely; everything is inserted.
 *   • else if existing item's quantity differs from incoming AND incoming
 *     has a non-empty quantity → update the existing row's quantity.
 *     This handles "milk is on the list with no quantity, I want 2".
 *   • else → skip the incoming item, return the existing row as a duplicate.
 */
async function addShoppingItemsWithDedupe(householdId, items, addedByUserId, options = {}, db = supabase) {
  const { overrideHint = false } = options;
  if (!items.length) return { created: [], duplicates: [], updated: [] };

  // Bypass: act exactly like addShoppingItems for compatibility.
  if (overrideHint) {
    const created = await addShoppingItems(householdId, items, addedByUserId, db);
    return { created, duplicates: [], updated: [] };
  }

  // Determine which list(s) we'll be inserting into so we can fetch
  // their existing active rows. Most calls target a single list, but
  // a batch could span multiple if the caller pre-routed items.
  const listIds = Array.from(new Set(items.map(i => i.list_id).filter(Boolean)));

  // Load existing incomplete items for the target lists. If a row
  // has no list_id (legacy), we still check household-wide to be
  // safe against grandfathered rows that pre-date the list_id column.
  let existingQuery = db
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false);
  if (listIds.length) existingQuery = existingQuery.in('list_id', listIds);
  const { data: existing, error: existingErr } = await existingQuery;
  if (existingErr) throw existingErr;

  // Build (listId, normalizedName) → existing row index. Items
  // without a list_id fall back to a 'none' bucket so they still match
  // each other.
  const indexKey = (listId, normalized) => `${listId || 'none'}|${normalized}`;
  const existingByKey = new Map();
  for (const row of existing || []) {
    const k = indexKey(row.list_id, normalizeItemName(row.item));
    // Keep the OLDEST one if there are already duplicates lurking - the
    // newer ones we'll either delete via a separate cleanup or leave
    // alone. Dedupe-on-write is forward-looking, not retroactive.
    if (!existingByKey.has(k)) existingByKey.set(k, row);
  }

  const toInsert = [];
  const duplicates = [];
  const toBumpQuantity = []; // { id, quantity }

  for (const item of items) {
    const normalized = normalizeItemName(item.item);
    if (!normalized) {
      // Defensive - shouldn't happen given upstream validation, but
      // an empty name shouldn't match every other empty key.
      toInsert.push(item);
      continue;
    }
    const k = indexKey(item.list_id, normalized);
    const match = existingByKey.get(k);
    if (!match) {
      toInsert.push(item);
      continue;
    }
    // Match found. Decide: bump quantity, or skip.
    const incomingQty = item.quantity ? String(item.quantity).trim() : '';
    const existingQty = match.quantity ? String(match.quantity).trim() : '';
    if (incomingQty && incomingQty !== existingQty) {
      // User supplied a specific quantity that differs from what's
      // stored - update the existing row rather than creating a dup.
      toBumpQuantity.push({ id: match.id, quantity: incomingQty });
    } else {
      duplicates.push({ submitted: item, existing: match });
    }
  }

  let created = [];
  if (toInsert.length) {
    created = await addShoppingItems(householdId, toInsert, addedByUserId, db);
  }

  const updated = [];
  for (const bump of toBumpQuantity) {
    const { data, error } = await db
      .from('shopping_items')
      .update({ quantity: bump.quantity })
      .eq('id', bump.id)
      .select()
      .single();
    if (error) {
      console.warn('[addShoppingItemsWithDedupe] failed to bump quantity:', error.message);
      continue;
    }
    if (data) updated.push(data);
  }

  return { created, duplicates, updated };
}

async function addShoppingItems(householdId, items, addedByUserId, db = supabase) {
  if (!items.length) return [];
  const rows = items.map((i) => {
    // Two columns that sound alike but aren't:
    //   `category`        - coarse DB enum (groceries/clothing/household/…)
    //   `aisle_category`  - grocery-aisle enum the classifier returns
    //                       (Dairy & Eggs / Produce / Meat & Seafood / …)
    //
    // The AI paths (classifier, chat, image-scan, inbound email) give us an
    // AISLE name as `i.category` because the classifier's own schema names
    // that field "category" even though it's aisle-scoped. Older app-form
    // callers give us a real DB category. Detect which one we got by
    // checking it against the DB enum, and route it to the right column.
    const rawCategory = typeof i.category === 'string' ? i.category.toLowerCase() : '';
    const isValidDbCategory = VALID_SHOPPING_CATEGORIES.has(rawCategory);
    // If i.category is an aisle name and the caller didn't separately set
    // aisle_category, promote it there rather than losing it.
    const aisleFromCategory = !isValidDbCategory && i.category ? i.category : null;

    return {
      household_id: householdId,
      item: i.item,
      // Default to 'groceries' for AI-classified rows - they're almost
      // always groceries, and the old 'other' default silently stripped
      // every aisle-categorised item's category signal.
      category: isValidDbCategory ? rawCategory : 'groceries',
      quantity: i.quantity || null,
      added_by: addedByUserId,
      list_id: i.list_id || null,
      aisle_category: i.aisle_category || aisleFromCategory || 'Other',
      // Optional: callers can insert items pre-completed (e.g. a
      // forwarded receipt with items the user has already bought but
      // never had on the active list - those land in "Previously
      // purchased" rather than as new pending rows).
      ...(i.completed === true ? { completed: true } : {}),
    };
  });
  const { data, error } = await db.from('shopping_items').insert(rows).select();
  if (error) throw error;
  return data;
}

async function getShoppingList(householdId, { includeCompleted = false, listId } = {}, db = supabase) {
  let query = db
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .order('created_at');
  if (!includeCompleted) query = query.eq('completed', false);
  if (listId) query = query.eq('list_id', listId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Score how well a list item matches a requested name. 1.0 = exact. The
// product of "fraction of query words found" and "fraction of item words
// used" deliberately demotes a partial hit: "milk" scores 1.0 against the
// item "milk" but only 0.5 against "almond milk" - so "got the milk" picks
// the plain milk and never checks off almond milk + milk chocolate too.
function shoppingMatchScore(itemStr, queryStr) {
  const item = String(itemStr || '').toLowerCase().trim();
  const query = String(queryStr || '').toLowerCase().trim();
  if (!item || !query) return 0;
  if (item === query) return 1;
  const iw = item.split(/\s+/).filter((w) => w.length > 1);
  const qw = query.split(/\s+/).filter((w) => w.length > 1);
  if (!iw.length || !qw.length) return 0;
  const iset = new Set(iw);
  const hits = qw.filter((w) => iset.has(w)).length;
  if (hits === 0) return 0;
  return (hits / qw.length) * (hits / iset.size);
}

async function completeShoppingItemsByName(householdId, itemNames, db = supabase) {
  const { data: items, error: fetchErr } = await db
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false);
  if (fetchErr) throw fetchErr;
  if (!items?.length) return [];

  // Pick the SINGLE best item per requested name (exact first, then best
  // fuzzy). The old code checked off EVERY substring match for one name -
  // an over-completion (the shopping analogue of the "Call EUSS" task bug).
  const chosen = new Map(); // id -> item, dedup if two names resolve to one
  for (const name of itemNames) {
    let best = null;
    let bestScore = 0;
    for (const it of items) {
      if (chosen.has(it.id)) continue;
      const score = shoppingMatchScore(it.item, name);
      if (score > bestScore) { best = it; bestScore = score; }
    }
    if (best && bestScore > 0) chosen.set(best.id, best);
  }
  if (!chosen.size) return [];

  const ids = [...chosen.keys()];
  const { data, error } = await db
    .from('shopping_items')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .in('id', ids)
    .select();
  if (error) throw error;
  return data;
}

async function completeShoppingItemById(id, db = supabase) {
  const { data, error } = await db
    .from('shopping_items')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

// Resolve a list of member names to a parallel { ids, names } pair using
// the supplied household members list. Names that don't match a member
// are dropped silently (the classifier sometimes hallucinates a name that
// isn't in the household). Returns canonical-cased names so the stored
// row matches how the member is listed elsewhere.
function resolveAssignees(rawNames, members = []) {
  const ids = [];
  const names = [];
  if (!Array.isArray(rawNames)) return { ids, names };
  for (const raw of rawNames) {
    if (!raw || typeof raw !== 'string') continue;
    const member = members.find((m) => m.name.toLowerCase() === raw.toLowerCase());
    if (!member) continue;
    if (ids.includes(member.id)) continue;
    ids.push(member.id);
    names.push(member.name);
  }
  return { ids, names };
}

// Accept either the new assigned_to_names: string[] field or the legacy
// singular assigned_to_name: string field on the input task. Callers in
// the bot and routes may still pass the singular form during the
// transition window.
function pickAssigneeNames(t) {
  if (Array.isArray(t.assigned_to_names)) return t.assigned_to_names;
  if (t.assigned_to_name) return [t.assigned_to_name];
  return [];
}

async function addTasks(householdId, tasks, addedByUserId, members = [], db = supabase) {
  if (!tasks.length) return [];

  const rows = tasks.map((t) => {
    const { ids, names } = resolveAssignees(pickAssigneeNames(t), members);
    return {
      household_id: householdId,
      title: t.title,
      assigned_to_ids: ids,
      assigned_to_names: names,
      due_date: t.due_date || new Date().toISOString().split('T')[0],
      due_time: t.due_time || null,
      recurrence: t.recurrence || null,
      priority: t.priority || 'medium',
      description: t.description || null,
      notification: t.notification || null,
      added_by: addedByUserId,
    };
  });

  const { data, error } = await db.from('tasks').insert(rows).select();
  if (error) throw error;
  return data;
}

async function getTasks(householdId, { assignedToId = null, includeCompleted = false, all = false } = {}, db = supabase) {
  let query = db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .order('due_date')
    .order('created_at');

  if (!includeCompleted) query = query.eq('completed', false);
  // assignedToId filter: include tasks where the user is in the array
  // OR the array is empty (= "everyone"). Postgres array contains uses
  // the PostgREST `cs` operator with the {value} literal syntax.
  if (assignedToId) {
    query = query.or(`assigned_to_ids.cs.{${assignedToId}},assigned_to_ids.eq.{}`);
  }
  if (!all) {
    // Default: today + overdue only
    const today = new Date().toISOString().split('T')[0];
    query = query.lte('due_date', today);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getAllIncompleteTasks(householdId, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .order('due_date')
    .order('created_at');
  if (error) throw error;
  return data;
}

async function completeTask(taskId, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function completeTasksByName(householdId, taskTitles, assigneeName = null, db = supabase) {
  const lowerTitles = taskTitles.map((t) => t.toLowerCase());

  // Fetch ALL incomplete household tasks and match client-side. The AI's
  // paraphrasing + potential assignee mis-guessing makes DB-side filters
  // too strict - "CREO website done" said by Grant should match "Do CREO
  // website updates" whether that task is assigned to Grant, Everyone
  // (null), or someone else. Assignee is a soft disambiguator, not a
  // hard filter - see bottom of the function.
  const { data: tasks, error: fetchErr } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false);
  if (fetchErr) throw fetchErr;

  // Match tasks using fuzzy word overlap - the AI often paraphrases task titles
  // (e.g. "Mason's party planning" for "Plan Mason's party")
  function extractWords(str) {
    return str.toLowerCase().replace(/['']/g, '').split(/\s+/).filter(w => w.length > 2);
  }

  function fuzzyMatch(taskTitle, aiTitle) {
    const tLower = taskTitle.toLowerCase();
    const aLower = aiTitle.toLowerCase();
    // Exact or substring match
    if (tLower.includes(aLower) || aLower.includes(tLower)) return true;
    // Word overlap: require at least half of the LONGER title's significant
    // words to overlap. The denominator is deliberately max(), not min():
    // with min(), a short query like "Call EUSS" (significant words
    // "call","euss") gets a threshold of 1, so a single shared generic verb
    // ("call") matches every "Call …" task - and they all get ticked off.
    // max() makes a short query cover a real share of the candidate title,
    // so "Call EUSS" matches "Call EUSS" but not "Call the eye doctor".
    const taskWords = extractWords(taskTitle);
    const aiWords = extractWords(aiTitle);
    if (taskWords.length === 0 || aiWords.length === 0) return false;
    const overlap = taskWords.filter(w => aiWords.some(aw => aw.includes(w) || w.includes(aw)));
    return overlap.length >= Math.max(taskWords.length, aiWords.length) * 0.5;
  }

  let matched = tasks.filter((t) =>
    lowerTitles.some((n) => fuzzyMatch(t.title, n))
  );

  // Soft assignee preference: when the AI provides an assignee AND the
  // fuzzy title matched multiple candidates, prefer the ones whose
  // assignee array includes that person. If none of the candidates
  // match the assignee, we keep the full matched set rather than
  // returning empty - assignee was a hint, not a gate. This stops
  // "tasks assigned to Everyone" from being invisible just because the
  // AI guessed a person's name.
  if (assigneeName && matched.length > 1) {
    const target = assigneeName.toLowerCase();
    const preferred = matched.filter((t) =>
      Array.isArray(t.assigned_to_names) &&
      t.assigned_to_names.some((n) => n && n.toLowerCase() === target)
    );
    if (preferred.length > 0) matched = preferred;
  }

  if (!matched.length) return [];

  const completed = await Promise.all(matched.map((t) => completeTask(t.id, db)));
  return completed;
}

/**
 * Advance a date by one recurrence period. Pure helper, returns a NEW
 * Date object (input not mutated). Returns null for unknown recurrence
 * strings - caller should treat as "not recurring".
 */
function advancePeriod(date, recurrence) {
  const d = new Date(date);
  switch (recurrence) {
    case 'daily':     d.setDate(d.getDate() + 1); return d;
    case 'weekly':    d.setDate(d.getDate() + 7); return d;
    case 'biweekly':  d.setDate(d.getDate() + 14); return d;
    case 'monthly':   d.setMonth(d.getMonth() + 1); return d;
    case 'yearly':    d.setFullYear(d.getFullYear() + 1); return d;
    default: return null;
  }
}

/**
 * Expand recurring calendar events into concrete occurrences within a window.
 * A calendar_events row stores a single base occurrence plus a `recurrence`
 * cadence; this materialises every occurrence between startDate and endDate so
 * the calendar (and morning brief) actually show the repeats. Occurrences keep
 * the row's real `id` (edit/delete act on the series) and get a unique
 * `occurrence_key` for rendering. Pure; bounded by maxPerEvent.
 */
function expandRecurringEvents(events, startDate, endDate, maxPerEvent = 500) {
  const winStart = new Date(startDate).getTime();
  const winEnd = new Date(endDate).getTime();
  const out = [];
  for (const ev of events || []) {
    if (!ev.recurrence) continue;
    const baseStart = new Date(ev.start_time);
    const baseEnd = new Date(ev.end_time || ev.start_time);
    if (Number.isNaN(baseStart.getTime())) continue;
    const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());
    let occ = new Date(baseStart);
    let n = 0;
    // Skip occurrences that end before the window starts.
    while (occ.getTime() + durationMs < winStart && n < maxPerEvent) {
      const next = advancePeriod(occ, ev.recurrence);
      if (!next) { occ = null; break; }
      occ = next; n++;
    }
    if (!occ) continue;
    // Emit occurrences that start on/before the window end.
    while (occ.getTime() <= winEnd && n < maxPerEvent) {
      const occEnd = new Date(occ.getTime() + durationMs);
      out.push({
        ...ev,
        start_time: occ.toISOString(),
        end_time: occEnd.toISOString(),
        occurrence_key: `${ev.id}|${occ.toISOString()}`,
        recurrence_instance: occ.getTime() !== baseStart.getTime(),
      });
      const next = advancePeriod(occ, ev.recurrence);
      if (!next) break;
      occ = next; n++;
    }
  }
  return out;
}

/**
 * Compute the next valid due date for a recurring task - the earliest
 * scheduled instance that's >= today. Used by both completion-time
 * regeneration and the daily auto-advance cron.
 *
 * Example: a weekly task due 2026-04-01 advanced today (2026-04-23)
 * walks Apr 8 → Apr 15 → Apr 22 → Apr 29; returns 2026-04-29 because
 * Apr 22 < today (Apr 23) and Apr 29 is the first >=.
 */
function nextValidDueDate(currentDueISO, recurrence, todayISO = null) {
  if (!currentDueISO || !recurrence) return null;
  const todayStr = todayISO || new Date().toISOString().split('T')[0];
  let due = new Date(currentDueISO + 'T00:00:00Z');
  const today = new Date(todayStr + 'T00:00:00Z');
  // Safety cap: 365 iterations covers the worst case (a daily task
  // overdue by a year) without risking a runaway loop on bad data.
  for (let i = 0; i < 365; i++) {
    if (due >= today) break;
    const next = advancePeriod(due, recurrence);
    if (!next) return null;
    due = next;
  }
  return due.toISOString().split('T')[0];
}

async function generateNextRecurrence(task, db = supabase) {
  // Compute the next due date, advancing past any "still in the past"
  // instances. Without this, completing a 3-week-overdue weekly task
  // would create a NEW instance also in the past - that's the original
  // bug that left "Take the bins out (weekly)" stuck at "overdue 22 days".
  let due = advancePeriod(task.due_date, task.recurrence);
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 365 && due < today; i++) {
    due = advancePeriod(due, task.recurrence);
    if (!due) return null;
  }

  // Look at any other uncompleted instances of this recurring task in
  // the household. We split them into:
  //   - NEWER: created after the task we just completed. These are
  //     explicit replacements - e.g. the bot just created a new task
  //     with a different assignee list in the same turn ("remind Lynn
  //     AND me to give Logan eye drops weekly"). Honour the user's
  //     intent: don't delete, don't insert.
  //   - OLDER: stale leftovers from a previous auto-regen cycle that
  //     the user never ticked off. These are duplicates we want to
  //     clean up before inserting a fresh instance.
  const { data: otherInstances } = await db
    .from('tasks')
    .select('id, created_at')
    .eq('household_id', task.household_id)
    .eq('title', task.title)
    .eq('recurrence', task.recurrence)
    .eq('completed', false)
    .neq('id', task.id);

  const completedCreatedAt = task.created_at ? new Date(task.created_at).getTime() : 0;
  const newer = [];
  const older = [];
  for (const row of (otherInstances || [])) {
    const t = row.created_at ? new Date(row.created_at).getTime() : 0;
    if (t > completedCreatedAt) newer.push(row);
    else older.push(row);
  }

  if (newer.length > 0) {
    // User (or another flow) has already added a fresh future instance
    // since this one was created. Skip regeneration - that newer task
    // is the user's intended next iteration.
    return null;
  }

  // Delete any older stale uncompleted instances before inserting the
  // fresh one. Keeps the "one active instance per recurring task"
  // invariant on the happy path.
  if (older.length > 0) {
    const olderIds = older.map(r => r.id);
    await db
      .from('tasks')
      .delete()
      .in('id', olderIds);
  }

  const { data, error } = await db
    .from('tasks')
    .insert({
      household_id: task.household_id,
      title: task.title,
      assigned_to_ids: task.assigned_to_ids || [],
      assigned_to_names: task.assigned_to_names || [],
      due_date: due.toISOString().split('T')[0],
      recurrence: task.recurrence,
      priority: task.priority,
      added_by: task.added_by,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Daily auto-advance for recurring tasks the user never completed.
 *
 * For every incomplete recurring task whose due_date is in the past,
 * advance the due_date in place to the next scheduled instance >=
 * today. This prevents the "overdue by 22 days" bug where a weekly
 * task sits accumulating overdue days because the regeneration code
 * (generateNextRecurrence) only fires on completion.
 *
 * In-place update (no new task row) because:
 *   • The user never completed it, so there's no history to preserve.
 *   • A second row would cause confusion + stale-row cleanup.
 *   • Matches user expectation: "by the time it's the next week, it
 *     should reset" - same task, fresh due date.
 *
 * Called by scheduler.js at 00:30 local time daily, after midnight has
 * crossed every UK timezone but before reminder crons fire (07:00).
 *
 * Returns the array of advanced tasks for logging / observability.
 */
async function advanceOverdueRecurringTasks(db = supabase) {
  const today = new Date().toISOString().split('T')[0];

  const { data: overdueTasks, error } = await db
    .from('tasks')
    .select('id, household_id, title, due_date, recurrence')
    .not('recurrence', 'is', null)
    .eq('completed', false)
    .lt('due_date', today);
  if (error) throw error;
  if (!overdueTasks || overdueTasks.length === 0) return [];

  const advanced = [];
  for (const task of overdueTasks) {
    const newDue = nextValidDueDate(task.due_date, task.recurrence, today);
    if (!newDue || newDue === task.due_date) continue;

    const { error: updateErr } = await db
      .from('tasks')
      .update({ due_date: newDue })
      .eq('id', task.id);
    if (updateErr) {
      // Don't abort the batch on one failure - log and continue so
      // a single bad row doesn't block the rest of the cleanup.
      console.error(`[advanceOverdueRecurringTasks] failed to advance ${task.id}:`, updateErr.message);
      continue;
    }
    advanced.push({ id: task.id, title: task.title, oldDue: task.due_date, newDue });
  }
  return advanced;
}

// ─── Scheduler helpers ────────────────────────────────────────────────────────

async function getAllHouseholds(db = supabase) {
  const { data, error } = await db.from('households').select();
  if (error) throw error;
  return data;
}

async function getTasksDueNextWeek(householdId, db = supabase) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() + 1);
  const to = new Date(today);
  to.setDate(to.getDate() + 7);

  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .gte('due_date', from.toISOString().split('T')[0])
    .lte('due_date', to.toISOString().split('T')[0])
    .order('due_date');
  if (error) throw error;
  return data;
}

// ─── Digest helpers ───────────────────────────────────────────────────────────

async function getCompletedThisWeek(householdId, db = supabase) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [{ data: tasks }, { data: items }] = await Promise.all([
    db.from('tasks').select().eq('household_id', householdId).eq('completed', true).gte('completed_at', weekAgo.toISOString()),
    db.from('shopping_items').select().eq('household_id', householdId).eq('completed', true).gte('completed_at', weekAgo.toISOString()),
  ]);

  return { tasks: tasks || [], shoppingItems: items || [] };
}

async function getRecentlyCompletedTasks(householdId, hours = 24, db = supabase) {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', true)
    .gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getRecentlyCompletedShopping(householdId, hours = 24, db = supabase) {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const { data, error } = await db
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', true)
    .gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Distinct item names completed in the last N days. Used as
 * normalisation context for AI extraction: if the household consistently
 * buys "Cathedral City cheddar", a receipt line "CATHEDRAL CITY 350G"
 * should map to the wording the family actually uses on their list,
 * not a generic "cheese". Caps at 50 to keep prompts compact.
 */
async function getRecentlyPurchasedNames(householdId, days = 60, db = supabase) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await db
    .from('shopping_items')
    .select('item')
    .eq('household_id', householdId)
    .eq('completed', true)
    .gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    const norm = (row.item || '').toLowerCase().trim();
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(row.item);
    }
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Titles of recurring tasks (recurrence column non-null). Passed to AI
 * extraction so a forwarded bill / subscription receipt doesn't get
 * duplicated as a new task when an existing recurring task already
 * covers it.
 */
async function getRecurringTaskTitles(householdId, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .select('title')
    .eq('household_id', householdId)
    .not('recurrence', 'is', null)
    .order('title');
  if (error) throw error;
  return (data || []).map((r) => r.title).filter(Boolean);
}

async function uncompleteTask(taskId, householdId, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .update({ completed: false, completed_at: null })
    .eq('id', taskId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function uncompleteShoppingItem(itemId, householdId, db = supabase) {
  const { data, error } = await db
    .from('shopping_items')
    .update({ completed: false, completed_at: null })
    .eq('id', itemId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTask(taskId, householdId, db = supabase) {
  const { error } = await db
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function deleteShoppingItem(itemId, householdId, db = supabase) {
  const { error } = await db
    .from('shopping_items')
    .delete()
    .eq('id', itemId)
    .eq('household_id', householdId);
  if (error) throw error;
}

/**
 * Delete *prior* completed shopping items with the same name in the same
 * (household, list), keeping the row identified by `keepItemId`.
 *
 * Called from the PATCH /shopping/:id route when an item is freshly
 * checked off. The intent: "Previously purchased" should show one entry
 * per item, dated to the most recent purchase - not three rows of "milk".
 *
 * Match semantics:
 *   • Same household + same list (Tesco list and Sainsbury's list are
 *     deliberately separate scopes).
 *   • `completed = true` only - never touches open/active items.
 *   • Case-insensitive exact-string match on `item`. Postgres ILIKE
 *     without wildcards is a literal case-folded equality. Whitespace
 *     differences in stored values aren't normalised - addItem already
 *     trims on insert (src/routes/shopping.js), so this matters only
 *     for legacy rows. The follow-up backfill migration handles those.
 *
 * Returns the count of rows deleted. Errors are surfaced to the caller
 * (the route logs and continues - purge failure shouldn't block the
 * primary check-off flow).
 */
async function purgePriorPurchases(keepItemId, listId, householdId, itemName, db = supabase) {
  const trimmed = (itemName || '').trim();
  if (!trimmed || !listId || !householdId || !keepItemId) return 0;

  const { data, error } = await db
    .from('shopping_items')
    .delete()
    .eq('household_id', householdId)
    .eq('list_id', listId)
    .eq('completed', true)
    .neq('id', keepItemId)
    .ilike('item', trimmed)
    .select('id');

  if (error) throw error;
  return data?.length || 0;
}

// ─── Fuzzy find + generic update helpers (used by WhatsApp edit/delete intents) ──

/**
 * Find open tasks in a household whose title contains the given substring
 * (case-insensitive). Optional assignee filter.
 *
 * Returns up to `limit` matches, ordered by due_date ascending (nulls last).
 */
async function findTasksByFuzzyTitle(householdId, title, { assignedToName, limit = 10 } = {}, db = supabase) {
  if (!title?.trim()) return [];
  let query = db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .ilike('title', `%${title.trim()}%`)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit);
  // assignedToName filter: array contains the name. PostgREST array
  // contains uses {value} literal syntax with the `cs` operator. Note
  // this is case-sensitive on Postgres array equality, so callers should
  // pass the canonical member name (resolveAssignees output) where
  // possible. We keep this as a soft filter - fuzzy match still wins.
  if (assignedToName) {
    const trimmed = assignedToName.trim();
    query = query.contains('assigned_to_names', [trimmed]);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Find incomplete shopping items whose `item` contains the substring.
 * Scoped to a list if listId given, otherwise all lists.
 */
async function findShoppingItemsByFuzzyName(householdId, name, { listId, limit = 10 } = {}, db = supabase) {
  if (!name?.trim()) return [];
  let query = db
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .ilike('item', `%${name.trim()}%`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (listId) query = query.eq('list_id', listId);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Find non-deleted calendar events whose title contains the substring.
 * Prefers future events (start_time >= now); falls back to any match
 * (including past) if none are upcoming.
 */
async function findEventsByFuzzyTitle(householdId, title, { dateHint, limit = 10 } = {}, db = supabase) {
  if (!title?.trim()) return [];
  const nowIso = new Date().toISOString();

  // Future events first. If a dateHint is given, constrain to that day.
  let query = db
    .from('calendar_events')
    .select()
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .ilike('title', `%${title.trim()}%`)
    .order('start_time', { ascending: true })
    .limit(limit);
  if (dateHint && /^\d{4}-\d{2}-\d{2}$/.test(dateHint)) {
    query = query
      .gte('start_time', `${dateHint}T00:00:00.000Z`)
      .lte('start_time', `${dateHint}T23:59:59.999Z`);
  } else {
    query = query.gte('start_time', nowIso);
  }
  const { data: primary, error: primaryErr } = await query;
  if (primaryErr) throw primaryErr;
  if ((primary || []).length > 0) return primary;

  // Fallback - no upcoming match, scan all (including past).
  const { data: anyData, error: anyErr } = await db
    .from('calendar_events')
    .select()
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .ilike('title', `%${title.trim()}%`)
    .order('start_time', { ascending: false })
    .limit(limit);
  if (anyErr) throw anyErr;
  return anyData || [];
}

/**
 * Generic task update - applies whichever fields are present in `updates`.
 */
async function updateTask(taskId, householdId, updates, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Generic shopping-item update.
 */
async function updateShoppingItem(itemId, householdId, updates, db = supabase) {
  const { data, error } = await db
    .from('shopping_items')
    .update(updates)
    .eq('id', itemId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Shopping Lists ──────────────────────────────────────────────────────────

// New households get a single "Default" list seeded on first access so
// the Shopping page never opens to an empty state.
//
// Earlier versions of this code shipped per-country supermarket presets
// (UK: Tesco/M&S/Waitrose/Sainsbury's/Aldi) on the theory that ready-to-
// go store-specific lists would feel native. The data ran the other way:
// across every household with shopping items, 100% only ever used the
// "Default" list. The supermarket-named lists were dead weight on the
// Shopping UI. So we now seed only "Default" everywhere and let users
// create named lists themselves if they want them.
//
// Kept as a per-country map (rather than a flat constant) so a future
// locale can opt back into named presets without restructuring callers.
const DEFAULT_LISTS_BY_COUNTRY = {};
const DEFAULT_LISTS_FALLBACK = ['Default'];

function defaultShoppingListsFor(country) {
  return DEFAULT_LISTS_BY_COUNTRY[country] || DEFAULT_LISTS_FALLBACK;
}

async function getShoppingLists(householdId, db = supabase) {
  const { data, error } = await db
    .from('shopping_lists')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at');
  if (error) throw error;

  // Lazy-create the default lists on first read so a brand-new household
  // never sees an empty state. Before this, the lists were only created on
  // the first write (adding an item), which left the Shopping page with an
  // empty lists array, a null activeListId, and a loadItems() that early-
  // returned without ever clearing its loading=true initial state - i.e. an
  // infinite spinner for first-time users.
  if (!data || data.length === 0) {
    // Look up the household's country so we can seed locale-appropriate
    // store names. If the country isn't set (legacy household) we fall
    // back to the international "Default" list.
    const { data: hh } = await db
      .from('households')
      .select('country')
      .eq('id', householdId)
      .single();
    const presets = defaultShoppingListsFor(hh?.country);
    const rows = presets.map((name) => ({ household_id: householdId, name }));
    await db.from('shopping_lists').insert(rows);
    const { data: seeded, error: seedErr } = await db
      .from('shopping_lists')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at');
    if (seedErr) throw seedErr;
    return seeded || [];
  }

  return data;
}

async function createShoppingList(householdId, name, db = supabase) {
  const { data, error } = await db
    .from('shopping_lists')
    .insert({ household_id: householdId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteShoppingList(listId, householdId, db = supabase) {
  const { data, error } = await db
    .from('shopping_lists')
    .delete()
    .eq('id', listId)
    .eq('household_id', householdId);
  if (error) throw error;
  return data;
}

async function getDefaultShoppingList(householdId, db = supabase) {
  let { data } = await db
    .from('shopping_lists')
    .select('*')
    .eq('household_id', householdId)
    .eq('name', 'Default')
    .single();
  if (!data) {
    // Create all default lists for this household. The preset set is
    // locale-aware (UK gets Tesco/M&S/etc., SA gets Pick n Pay/Woolies,
    // everywhere else gets just "Default") - see DEFAULT_LISTS_BY_COUNTRY
    // above getShoppingLists for the rationale.
    const { data: hh } = await db
      .from('households')
      .select('country')
      .eq('id', householdId)
      .single();
    const presets = defaultShoppingListsFor(hh?.country);
    const rows = presets.map(name => ({ household_id: householdId, name }));
    await db.from('shopping_lists').insert(rows);
    const result = await db
      .from('shopping_lists')
      .select('*')
      .eq('household_id', householdId)
      .eq('name', 'Default')
      .single();
    data = result.data;
  }
  return data;
}

async function getOverdueTasksForUser(householdId, userId, db = supabase) {
  const today = new Date().toISOString().split('T')[0];
  // Match tasks whose assignee array contains the user. We do not also
  // include empty-array "everyone" tasks here because the overdue digest
  // would otherwise hammer every linked member for an unowned task -
  // historically the single-FK version also required an explicit match.
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .contains('assigned_to_ids', [userId])
    .lt('due_date', today)
    .order('due_date');
  if (error) throw error;
  return data;
}

async function getTasksForUser(householdId, userId, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .contains('assigned_to_ids', [userId])
    .order('due_date')
    .order('created_at');
  if (error) throw error;
  return data;
}

// ─── Calendar Events ─────────────────────────────────────────────────────────

function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

/**
 * Synthesise all-day birthday events from members' `birthday` field — the
 * single source of truth. Generates one occurrence per year in the window so
 * birthdays always show (regardless of how they were entered) and recur every
 * year, with no stored rows to keep in sync. IDs are synthetic strings.
 */
async function getBirthdayEvents(householdId, startDate, endDate, db = supabase) {
  let res;
  try {
    res = await db.from('users')
      .select('id, name, birthday')
      .eq('household_id', householdId)
      .not('birthday', 'is', null);
  } catch { return []; }
  if (res.error || !res.data) return [];

  const startStr = String(startDate).slice(0, 10);
  const endStr = String(endDate).slice(0, 10);
  const startY = Number(startStr.slice(0, 4));
  const endY = Number(endStr.slice(0, 4));
  if (!startY || !endY) return [];

  const out = [];
  for (const m of res.data) {
    if (!m.birthday || !m.name) continue;
    const b = new Date(m.birthday);
    if (isNaN(b.getTime())) continue;
    const mo = b.getUTCMonth(); // 0-11
    const day = b.getUTCDate();
    for (let y = startY; y <= endY; y++) {
      const d = (mo === 1 && day === 29 && !isLeapYear(y)) ? 28 : day; // clamp Feb 29
      const dateStr = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dateStr < startStr || dateStr > endStr) continue;
      const startTime = `${dateStr}T00:00:00Z`;
      out.push({
        id: `birthday-${m.id}-${y}`,
        occurrence_key: `birthday-${m.id}-${y}`,
        household_id: householdId,
        title: `${m.name}'s Birthday 🎂`,
        description: null,
        start_time: startTime,
        end_time: startTime,
        all_day: true,
        category: 'birthday',
        source_user_id: m.id,
        color: 'plum',
        recurrence: null,
        visibility: 'family',
      });
    }
  }
  return out;
}

async function getCalendarEvents(householdId, startDate, endDate, { userId, category, birthdays } = {}, db = supabase) {
  // Apply the household/visibility/category filters common to both queries.
  const applyFilters = (q) => {
    let query = q.eq('household_id', householdId).is('deleted_at', null);
    if (category) query = query.eq('category', category);
    if (userId) query = query.or(`visibility.eq.family,source_user_id.eq.${userId},source_user_id.is.null`);
    return query;
  };

  // Query 1: events that overlap the window directly (non-recurring, plus the
  // base occurrence of any recurring event whose start lands in the window).
  let overlap = await applyFilters(db.from('calendar_events').select())
    .lte('start_time', endDate).gte('end_time', startDate).order('start_time');

  if (overlap.error && (category || userId)) {
    // category/visibility columns may not exist yet - retry unfiltered.
    overlap = await db.from('calendar_events').select()
      .eq('household_id', householdId).is('deleted_at', null)
      .lte('start_time', endDate).gte('end_time', startDate).order('start_time');
  }
  if (overlap.error) throw overlap.error;
  const overlapRows = overlap.data || [];

  // Query 2: every recurring event that started on/before the window end, so we
  // can materialise its occurrences inside the window (the row itself may sit
  // far in the past). Degrades to no expansion if the recurrence column is
  // missing, so the calendar never breaks - it just won't repeat.
  let recurringRows = [];
  try {
    let rec = await applyFilters(db.from('calendar_events').select())
      .lte('start_time', endDate).not('recurrence', 'is', null).neq('recurrence', '').order('start_time');
    if (rec.error && (category || userId)) {
      rec = await db.from('calendar_events').select()
        .eq('household_id', householdId).is('deleted_at', null)
        .lte('start_time', endDate).not('recurrence', 'is', null).neq('recurrence', '').order('start_time');
    }
    if (!rec.error) recurringRows = rec.data || [];
  } catch { recurringRows = []; }

  // Non-recurring overlapping events pass through; recurring events come from
  // expansion (so the base occurrence isn't double-counted).
  const nonRecurring = overlapRows.filter((e) => !e.recurrence);
  const expanded = expandRecurringEvents(recurringRows, startDate, endDate);
  let merged = [...nonRecurring, ...expanded];

  // Birthdays are derived live from members' birthday field (single source of
  // truth, recurs yearly). Drop any legacy stored birthday rows to avoid
  // duplicates, then append the synthesised occurrences.
  if (birthdays) {
    merged = merged.filter((e) => e.category !== 'birthday');
    if (!category || category === 'birthday') {
      merged = merged.concat(await getBirthdayEvents(householdId, startDate, endDate, db));
    }
  }

  return merged.sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
}

async function getCalendarEventById(eventId, householdId, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .select()
    .eq('id', eventId)
    .eq('household_id', householdId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// ─── Event attachments (files linked to a calendar event) ──────────────────
async function createEventAttachment(householdId, { event_id, name, file_path, file_size, mime_type, uploaded_by }, db = supabase) {
  const { data, error } = await db
    .from('event_attachments')
    .insert({ household_id: householdId, event_id, name, file_path, file_size: file_size || null, mime_type: mime_type || null, uploaded_by: uploaded_by || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getEventAttachments(eventId, db = supabase) {
  const { data, error } = await db
    .from('event_attachments')
    .select()
    .eq('event_id', eventId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function getEventAttachmentById(id, householdId, db = supabase) {
  const { data, error } = await db
    .from('event_attachments')
    .select()
    .eq('id', id)
    .eq('household_id', householdId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function deleteEventAttachment(id, db = supabase) {
  const { error } = await db.from('event_attachments').delete().eq('id', id);
  if (error) throw error;
}

async function getTasksByDateRange(householdId, startDate, endDate, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .gte('due_date', startDate.split('T')[0])
    .lte('due_date', endDate.split('T')[0])
    .order('due_date');
  if (error) throw error;
  return data;
}

/**
 * Substring search across calendar_events + tasks for a household.
 *
 * Powers the calendar page's search bar without a date filter - so
 * searching "wedding" finds an event two years out, not just events
 * in the currently-rendered month. Replaces the prior client-side
 * filter, which was bounded by whatever ±1-month window had been
 * loaded into memory.
 *
 * Match semantics:
 *   • Events: title / description / location ILIKE %q% (case-insensitive
 *     substring match, mirrors the previous client-side String.includes).
 *   • Tasks: title ILIKE %q% (the tasks table has no description column,
 *     so the prior client-side check on t.description was always falsy).
 *   • deleted_at IS NULL on events; tasks have no soft-delete.
 *   • Both completed and incomplete tasks are returned - search history
 *     is useful ("when did we book the photographer?") even for things
 *     that have already happened.
 *
 * Returns up to `limit` of each type, ordered most-recent-first so the
 * dropdown surfaces stuff close to today before stuff from years ago.
 * Capped at 100 per type as a safety bound.
 */
async function searchCalendar(householdId, query, { limit = 50 } = {}, db = supabase) {
  const trimmed = (query || '').trim();
  if (!trimmed) return { events: [], tasks: [], schoolDates: [] };

  const cap = Math.min(Math.max(1, limit), 100);
  // ILIKE pattern: surround in % so it matches the term anywhere in
  // the field. % and _ act as wildcards - fine for our use case (a
  // stray % someone typed just over-matches). sanitizeOrFilterValue
  // strips PostgREST .or() structural chars so the term can't break
  // out of the ilike value (the .or() at line below embeds it).
  const pattern = `%${sanitizeOrFilterValue(trimmed)}%`;

  // school_term_dates is joined to household_schools to filter by
  // household. We embed the parent so we can return the school name
  // alongside each match - both for context in the search UI and so
  // clicking a result can route to the right place.
  const [eventsRes, tasksRes, schoolDatesRes] = await Promise.all([
    db
      .from('calendar_events')
      .select('id, title, description, location, start_time, end_time, all_day, color, assigned_to_names, category')
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .or(`title.ilike.${pattern},description.ilike.${pattern},location.ilike.${pattern}`)
      .order('start_time', { ascending: false })
      .limit(cap),
    db
      .from('tasks')
      .select('id, title, due_date, completed, assigned_to_names')
      .eq('household_id', householdId)
      .ilike('title', pattern)
      .order('due_date', { ascending: false })
      .limit(cap),
    db
      .from('school_term_dates')
      .select('id, event_type, date, end_date, label, academic_year, household_schools!inner(id, household_id, school_name, colour)')
      .eq('household_schools.household_id', householdId)
      .ilike('label', pattern)
      .order('date', { ascending: false })
      .limit(cap),
  ]);

  if (eventsRes.error) throw eventsRes.error;
  if (tasksRes.error) throw tasksRes.error;
  if (schoolDatesRes.error) throw schoolDatesRes.error;

  return {
    events: eventsRes.data || [],
    tasks: tasksRes.data || [],
    schoolDates: (schoolDatesRes.data || []).map((row) => ({
      id: row.id,
      event_type: row.event_type,
      date: row.date,
      end_date: row.end_date,
      label: row.label,
      academic_year: row.academic_year,
      school_id: row.household_schools?.id,
      school_name: row.household_schools?.school_name,
      colour: row.household_schools?.colour,
    })),
  };
}

// Decide whether an event title represents SOMEONE'S ACTUAL BIRTHDAY (which
// should file under the Birthdays filter and recur yearly) rather than an
// errand or note that merely mentions a birthday ("buy birthday gift for
// John", "birthday card for Sara", "plan Mia's birthday party shopping").
//
// Two stages:
//   1. Reject if the title contains an errand/admin verb or object - those are
//      tasks about a birthday, not the birthday itself.
//   2. Otherwise accept only if it reads like a birthday: a possessive name +
//      birthday ("John's birthday", "Mia's 7th bday"), "happy birthday ...",
//      a title that starts with "birthday", a "<birthday> party/celebration"
//      phrase, or an explicit 🎂.
const BIRTHDAY_MENTION_RE = /\bbirthdays?\b|\bb-?day\b|🎂/i;
const BIRTHDAY_ERRAND_RE = /\b(buy|buying|bought|get|getting|order|ordering|ordered|wrap|wrapping|collect|collecting|pick|shop|shopping|book|booking|pay|paying|plan|planning|organi[sz]e|organi[sz]ing|sort|rsvp|invite|inviting|invitation|invitations|gift|gifts|present|presents|card|cards|cake|decorations?|balloons?|message|text|call|email|remind|reminder|ideas?|list|drop|dropping)\b/i;
// A party / celebration is a separate event that may not fall on the actual
// birthday, so it must NOT be filed under the Birthdays category.
const BIRTHDAY_CELEBRATION_RE = /\b(party|parties|celebration|celebrations|bash|do|drinks|dinner|lunch|brunch|tea|meal|gathering|get-?together|outing|treat|play\s?date|date\s+night|night\s+out)\b/i;
const BIRTHDAY_AFFIRMATIVE_RES = [
  /[\w’'-]+['’]s?\s+(?:\d{1,3}(?:st|nd|rd|th)?\s+)?b(?:irth)?-?day\b/i, // "John's birthday", "Philips' birthday", "Mia's 7th bday"
  /\bhappy\s+b(?:irth)?-?day\b/i,                                       // "Happy Birthday ..."
  /^\s*b(?:irth)?-?day\b/i,                                             // starts with "Birthday"
  /\bb(?:irth)?-?day\b[^a-z]*$/i,                                       // ends with "birthday"/"bday" ("Felicity birthday", "Ruby bday")
  /🎂/,                                                                 // explicit cake emoji
];
function isBirthdayTitle(title) {
  if (typeof title !== 'string') return false;
  const t = title.trim();
  if (!t || !BIRTHDAY_MENTION_RE.test(t)) return false;
  if (BIRTHDAY_ERRAND_RE.test(t)) return false;
  if (BIRTHDAY_CELEBRATION_RE.test(t)) return false;
  return BIRTHDAY_AFFIRMATIVE_RES.some((re) => re.test(t));
}

async function createCalendarEvent(householdId, eventData, createdByUserId, db = supabase) {
  // Accept either the new arrays or the legacy singular fields. Callers
  // in transitional code paths may still pass assigned_to / assigned_to_name.
  const ids = Array.isArray(eventData.assigned_to_ids)
    ? eventData.assigned_to_ids
    : (eventData.assigned_to ? [eventData.assigned_to] : []);
  const names = Array.isArray(eventData.assigned_to_names)
    ? eventData.assigned_to_names
    : (eventData.assigned_to_name ? [eventData.assigned_to_name] : []);
  // Auto-categorise birthdays from the title when the caller hasn't set a
  // specific category (treat 'general'/'event' as unset). An explicit category
  // always wins. We only set the category - recurrence is left to the user
  // (the event form's "repeat yearly" option, or the bot asking), so the title
  // is stored exactly as given.
  const explicitCategory = eventData.category;
  const category =
    (!explicitCategory || explicitCategory === 'general' || explicitCategory === 'event')
    && isBirthdayTitle(eventData.title)
      ? 'birthday'
      : (explicitCategory || 'general');
  const { data, error } = await db
    .from('calendar_events')
    .insert({
      household_id: householdId,
      title: eventData.title,
      description: eventData.description || null,
      start_time: eventData.start_time,
      end_time: eventData.end_time,
      all_day: eventData.all_day || false,
      location: eventData.location || null,
      color: eventData.color || 'sage',
      category,
      recurrence: eventData.recurrence || null,
      assigned_to_ids: ids,
      assigned_to_names: names,
      created_by: createdByUserId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Look for an existing calendar event with the same title close to the same
 * time as the given start_time. Used to catch duplicates when multiple family
 * members add the same event independently.
 *
 * For TIMED events: matches only if an existing event with the same title
 * starts within ±30 minutes. "Haircut at 2PM" and "Haircut at 4:55PM" on the
 * same day are legitimately different events and must not collide.
 *
 * For ALL-DAY events (start_time at 00:00Z): matches anywhere in the same
 * UTC day - a second all-day event with the same title is almost always
 * an actual duplicate.
 *
 * Case-insensitive exact title match.
 *
 * @returns {Promise<object|null>} The existing event, or null if none found.
 */
async function findSimilarEvent(householdId, title, startTime, db = supabase) {
  if (!title?.trim() || !startTime) return null;
  const dateOnly = String(startTime).slice(0, 10); // "YYYY-MM-DD"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const proposed = new Date(startTime);
  if (isNaN(proposed.getTime())) return null;

  // Treat a 00:00:00 UTC start_time as all-day. Not perfect (a deliberately-
  // scheduled midnight event would be treated as all-day) but close enough
  // for duplicate detection - and all-day events in our system are stored
  // this way anyway.
  const timePart = String(startTime).slice(11, 16);
  const isAllDayLike = timePart === '00:00';

  let rangeStart, rangeEnd;
  if (isAllDayLike) {
    rangeStart = `${dateOnly}T00:00:00.000Z`;
    rangeEnd   = `${dateOnly}T23:59:59.999Z`;
  } else {
    const WINDOW_MS = 30 * 60 * 1000;
    rangeStart = new Date(proposed.getTime() - WINDOW_MS).toISOString();
    rangeEnd   = new Date(proposed.getTime() + WINDOW_MS).toISOString();
  }

  const { data, error } = await db
    .from('calendar_events')
    .select('id, title, start_time, created_by, assigned_to_names, all_day')
    .eq('household_id', householdId)
    .is('deleted_at', null) // soft-deleted events shouldn't block recreation
    .ilike('title', title.trim()) // case-insensitive exact match (no wildcards)
    .gte('start_time', rangeStart)
    .lte('start_time', rangeEnd)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? data[0] : null;
}

async function updateCalendarEvent(eventId, householdId, updates, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .update(updates)
    .eq('id', eventId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function softDeleteCalendarEvent(eventId, householdId, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', eventId)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .select();
  if (error) throw error;
  return data?.[0] || null;
}

async function deleteCalendarEvent(eventId, householdId) {
  return softDeleteCalendarEvent(eventId, householdId);
}

async function getDeletedCalendarEvents(householdId, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .select()
    .eq('household_id', householdId)
    // Feed-pruned synced copies are sync bookkeeping, not user deletions -
    // restoring one would resurrect an event its source calendar cancelled.
    .is('external_feed_id', null)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function restoreCalendarEvent(eventId, householdId, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .update({ deleted_at: null })
    .eq('id', eventId)
    .eq('household_id', householdId)
    .is('external_feed_id', null)
    .not('deleted_at', 'is', null)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function permanentlyDeleteCalendarEvent(eventId, householdId, db = supabase) {
  const { error } = await db
    .from('calendar_events')
    .delete()
    .eq('id', eventId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function getOrCreateFeedToken(userId, householdId, db = supabase) {
  // Check for existing token
  const { data: existing } = await db
    .from('calendar_feed_tokens')
    .select()
    .eq('user_id', userId)
    .eq('household_id', householdId)
    .single();

  if (existing) return existing;

  // Create new token
  const token = crypto.randomBytes(32).toString('hex');
  const { data, error } = await db
    .from('calendar_feed_tokens')
    .insert({ user_id: userId, household_id: householdId, token })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function regenerateFeedToken(userId, householdId, db = supabase) {
  // Delete old token
  await db
    .from('calendar_feed_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('household_id', householdId);

  // Create new token
  const token = crypto.randomBytes(32).toString('hex');
  const { data, error } = await db
    .from('calendar_feed_tokens')
    .insert({ user_id: userId, household_id: householdId, token })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getFeedTokenData(token, db = supabase) {
  const { data, error } = await db
    .from('calendar_feed_tokens')
    .select()
    .eq('token', token)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// ─── External calendar feeds (read-only inbound subscriptions) ──────────────
//
// Replaces the inbound side of the old two-way sync. Each row in
// external_calendar_feeds points at an iCal URL the user pasted; events
// pulled from that URL live in calendar_events with external_feed_id set
// and a non-null external_uid. The pull/dedup logic lives in
// services/externalFeed.js - these helpers are thin DB wrappers.

async function getExternalFeedsByHousehold(householdId, db = supabase) {
  const { data, error } = await db
    .from('external_calendar_feeds')
    .select()
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * All feeds across all households that should be refreshed by the
 * scheduler. Filters out:
 *   - Feeds with sync_enabled=false (user-paused)
 *   - Feeds with consecutive_failures >= MAX_FAILURES (auto-skipped
 *     after a streak of errors, so a permanently-broken URL doesn't
 *     hammer the failing host every cron tick - the user will need to
 *     edit-or-delete the feed for it to come back, or we can reset the
 *     counter by hand).
 *
 * Ordered with newest-stale-data first (last_synced_at ASC, NULLS first
 * for never-synced rows) so a brand new feed gets attention on the very
 * next cron tick, and a fresh-ish feed waits its turn.
 */
const EXTERNAL_FEED_MAX_FAILURES = 10;

async function getAllActiveExternalFeeds(db = supabase) {
  // ONLY URL feeds. Device-sourced rows (EventKit) have synthetic device://
  // URLs that the HTTP poller can't fetch - polling them would rack up
  // consecutive_failures until the link auto-disabled. Falls back to an
  // unfiltered query while the source column's migration hasn't run yet.
  let res = await db
    .from('external_calendar_feeds')
    .select()
    .eq('sync_enabled', true)
    .eq('source', 'ical')
    .lt('consecutive_failures', EXTERNAL_FEED_MAX_FAILURES)
    .order('last_synced_at', { ascending: true, nullsFirst: true });
  // Fall back to the unfiltered query ONLY when the source column doesn't
  // exist yet (42703 = undefined column, pre-migration). A blanket fallback
  // would hand device:// rows to the HTTP poller on any transient error and
  // walk their consecutive_failures toward auto-disable.
  if (res.error && res.error.code === '42703') {
    res = await db
      .from('external_calendar_feeds')
      .select()
      .eq('sync_enabled', true)
      .lt('consecutive_failures', EXTERNAL_FEED_MAX_FAILURES)
      .order('last_synced_at', { ascending: true, nullsFirst: true });
  }
  if (res.error) throw res.error;
  return res.data || [];
}

// ─── Device calendar links (EventKit sync) ──────────────────────────────────────

async function findDeviceCalendarLink(householdId, userId, deviceCalendarId, db = supabase) {
  const { data, error } = await db
    .from('external_calendar_feeds')
    .select()
    .eq('household_id', householdId)
    .eq('device_owner_user_id', userId)
    .eq('source', 'device')
    .eq('device_calendar_id', deviceCalendarId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Adopt-on-reconnect lookup: device calendar ids are device-local, so a new
// phone presents new ids. Match the user's existing device link by calendar
// display name instead, so the old row (events, colour, history) carries over.
async function findDeviceLinkByOwnerAndName(householdId, userId, displayName, db = supabase) {
  const { data, error } = await db
    .from('external_calendar_feeds')
    .select()
    .eq('household_id', householdId)
    .eq('device_owner_user_id', userId)
    .eq('source', 'device')
    .eq('display_name', displayName)
    .limit(1);
  if (error) throw error;
  return (data || [])[0] || null;
}

// Internal update by id - callers resolve the link via the household-scoped
// finders above first.
async function updateDeviceCalendarLink(linkId, fields, db = supabase) {
  const { error } = await db
    .from('external_calendar_feeds')
    .update(fields)
    .eq('id', linkId);
  if (error) throw error;
}

// Household-level UID dedupe: which of these uids already exist on calendar
// events under a DIFFERENT feed/link in this household, and under WHICH link?
// (Two parents syncing the same shared calendar, or a device calendar
// overlapping a URL feed - the feedId lets the caller surface "you're
// subscribed to this twice" to the user.) Returns [{ uid, feedId }].
async function findHouseholdUidsUnderOtherFeeds(householdId, uids, excludeFeedId, db = supabase) {
  const found = [];
  // Small chunks: uids can be 400 chars (Exchange/Google external identifiers
  // run long) and .in() encodes them into the GET query string - 200 per
  // chunk could exceed proxy URL caps and fail the whole sync.
  for (let i = 0; i < uids.length; i += 50) {
    const chunk = uids.slice(i, i + 50);
    const { data, error } = await db
      .from('calendar_events')
      .select('external_uid, external_feed_id')
      .eq('household_id', householdId)
      .neq('external_feed_id', excludeFeedId)
      .not('external_feed_id', 'is', null)
      .in('external_uid', chunk);
    if (error) throw error;
    for (const r of data || []) found.push({ uid: r.external_uid, feedId: r.external_feed_id });
  }
  return found;
}

// Remove every event a feed/device link produced (used when tombstoning a
// device link from the web - the row stays as a sync_enabled=false marker so
// the owning phone is told to stop, but the copies disappear immediately).
async function deleteEventsForFeed(feedId, db = supabase) {
  const { error } = await db
    .from('calendar_events')
    .delete()
    .eq('external_feed_id', feedId);
  if (error) throw error;
}

// Replace one link's events within a window: delete then chunked UPSERT.
//
// Two subtleties, both learned the hard way (adversarial review):
//   - The delete must match by OVERLAP (end_time >= start AND start_time <=
//     end), not by start_time-in-window. EventKit's predicate returns events
//     that OVERLAP the window, so a long/multi-day event that began before
//     windowStart arrives in the payload with its real (earlier) start_time.
//     A start_time-bounded delete would miss its old row and the re-insert
//     would hit the (external_feed_id, external_uid) unique index.
//   - Upsert (not insert) as the second belt: even if some residual row
//     escapes the delete bound, the apply merges instead of throwing - a
//     thrown apply would leave the window deleted but not repopulated.
async function replaceFeedEventsInWindow(feedId, windowStartIso, windowEndIso, rows, db = supabase) {
  const del = await db
    .from('calendar_events')
    .delete()
    .eq('external_feed_id', feedId)
    .gte('end_time', windowStartIso)
    .lte('start_time', windowEndIso);
  if (del.error) throw del.error;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from('calendar_events')
      .upsert(rows.slice(i, i + 500), { onConflict: 'external_feed_id,external_uid' });
    if (error) throw error;
  }
}

async function getExternalFeedById(feedId, db = supabase) {
  const { data, error } = await db
    .from('external_calendar_feeds')
    .select()
    .eq('id', feedId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function createExternalFeed(feed, db = supabase) {
  const { data, error } = await db
    .from('external_calendar_feeds')
    .insert(feed)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteExternalFeed(feedId, householdId, db = supabase) {
  // Scoped by household_id so a user can't delete a feed they don't
  // belong to even if they guess the id.
  const { error } = await db
    .from('external_calendar_feeds')
    .delete()
    .eq('id', feedId)
    .eq('household_id', householdId);
  if (error) throw error;
}

/**
 * Update editable fields on an external feed. Currently scoped to
 * display_name + color - the URL is intentionally immutable (changing
 * it would mean a different feed; the user should delete and re-add).
 * Household-scoped UPDATE so the bare id can't be used cross-tenant.
 */
async function updateExternalFeed(feedId, householdId, fields, db = supabase) {
  const allowed = {};
  if (typeof fields.display_name === 'string' && fields.display_name.trim()) {
    allowed.display_name = fields.display_name.trim().slice(0, 200);
  }
  if (typeof fields.color === 'string' && fields.color.trim()) {
    allowed.color = fields.color.trim();
  }
  if (Object.keys(allowed).length === 0) return null;
  const { data, error } = await db
    .from('external_calendar_feeds')
    .update(allowed)
    .eq('id', feedId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function recordExternalFeedSuccess(feedId, db = supabase) {
  const { error } = await db
    .from('external_calendar_feeds')
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: null,
      consecutive_failures: 0,
    })
    .eq('id', feedId);
  if (error) throw error;
}

// A pull that landed but had its deletions withheld (suspected partial
// response). Not a success - that would clear the pending-shrink marker the
// next refresh needs - and not a failure - the upserts committed, so
// consecutive_failures must not creep towards alerting.
async function recordExternalFeedPartial(feedId, message, db = supabase) {
  const { error } = await db
    .from('external_calendar_feeds')
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: (message || '').slice(0, 1000),
      // The fetch SUCCEEDED (upserts committed) - without this a feed
      // recovering from an outage via a shrunken pull would keep its old
      // failure streak and could cross the auto-disable threshold.
      consecutive_failures: 0,
    })
    .eq('id', feedId);
  if (error) throw error;
}

async function recordExternalFeedFailure(feedId, message, db = supabase) {
  // Increment via a read-modify-write since Supabase doesn't expose
  // atomic SQL operators here. Acceptable race for a once-per-hour cron.
  const { data: existing } = await db
    .from('external_calendar_feeds')
    .select('consecutive_failures')
    .eq('id', feedId)
    .single();
  const failures = (existing?.consecutive_failures || 0) + 1;
  const { error } = await db
    .from('external_calendar_feeds')
    .update({
      last_error: (message || '').slice(0, 1000),
      consecutive_failures: failures,
    })
    .eq('id', feedId);
  if (error) throw error;
}

async function getExternalFeedEvents(feedId, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .select('id, external_uid, start_time, end_time')
    .eq('external_feed_id', feedId)
    .is('deleted_at', null);
  if (error) throw error;
  return data || [];
}

async function createExternalFeedEvent(row, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Idempotent upsert of a feed-sourced event keyed by
 * (external_feed_id, external_uid). Use this from the refresh path
 * instead of insert/update - it removes the race between "is this UID
 * already in DB?" and the actual write, and quietly handles edge cases
 * the diff-then-write approach can't:
 *   - same UID appearing multiple times in one pull (EXCEPTION events,
 *     duplicate VEVENTs in the source feed)
 *   - rows that were soft-deleted by a previous 7-day guard pass and
 *     are now coming back (the upsert resurrects them via deleted_at)
 *   - rows the SELECT-then-decide flow missed because the SELECT
 *     filtered deleted_at while the unique index does not
 *
 * The row is expected to include `external_feed_id` and `external_uid`;
 * we explicitly set `deleted_at: null` so a previously soft-deleted row
 * comes back to life on conflict.
 */
async function upsertExternalFeedEvent(row, db = supabase) {
  const payload = { ...row, deleted_at: null };
  const { data, error } = await db
    .from('calendar_events')
    .upsert(payload, { onConflict: 'external_feed_id,external_uid' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Batched upsert - sends N rows in a single HTTP round-trip rather
 * than N round-trips. With recurring series expanded across an 18-month
 * window, an Apple iCloud Family calendar can easily produce 5–20k
 * event rows; one round-trip per row makes a refresh take minutes
 * instead of seconds. This is the path the refresh loop should use.
 *
 * Caller is responsible for chunking if the row set is large enough to
 * exceed Supabase's request payload cap (~10MB). 500 rows per chunk is
 * a comfortable default for typical event payloads.
 */
async function batchUpsertExternalFeedEvents(rows, db = supabase) {
  if (!rows || rows.length === 0) return [];
  const payload = rows.map((r) => ({ ...r, deleted_at: null }));
  const { data, error } = await db
    .from('calendar_events')
    .upsert(payload, { onConflict: 'external_feed_id,external_uid' })
    .select('id, external_uid');
  if (error) throw error;
  return data || [];
}

/**
 * Batched soft-delete by id - used by the refresh's 7-day-guard pass
 * to remove events that disappeared from the feed. Same N+1
 * motivation as batchUpsert.
 */
async function batchSoftDeleteCalendarEvents(eventIds, householdId, db = supabase) {
  if (!eventIds || eventIds.length === 0) return;
  const { error } = await db
    .from('calendar_events')
    .update({ deleted_at: new Date().toISOString() })
    .in('id', eventIds)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function updateExternalFeedEvent(eventId, householdId, fields, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .update(fields)
    .eq('id', eventId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Look up the feed token for a user without creating one.
 * Used by the Settings page to detect whether a feed is already enabled
 * (so we can show a mutual-exclusivity warning when a two-way sync is
 * also active). Returns the row or null - never inserts.
 */
async function getFeedTokenIfExists(userId, householdId, db = supabase) {
  const { data, error } = await db
    .from('calendar_feed_tokens')
    .select()
    .eq('user_id', userId)
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * Revoke the user's feed token. Used by the Settings page when the user
 * switches from feed → two-way sync, or chooses "remove feed" from the
 * mutual-exclusivity warning.
 */
async function deleteFeedToken(userId, householdId, db = supabase) {
  const { error } = await db
    .from('calendar_feed_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('household_id', householdId);
  if (error) throw error;
}

/**
 * Admin: rolled-up view of the new calendar model — every inbound iCal
 * subscription (external_calendar_feeds) with owner + household names and
 * an event_count, plus every outbound feed token (calendar_feed_tokens)
 * with owner + household. Uses the same bulk-enrichment pattern as
 * getAllHouseholdsAdmin: one query per table, then in-memory joins, so
 * the page stays O(1) round-trips regardless of household count.
 */
async function getCalendarSyncHealthAdmin(db = supabase) {
  const [feedsRes, tokensRes] = await Promise.all([
    db.from('external_calendar_feeds').select().order('created_at', { ascending: false }),
    db.from('calendar_feed_tokens').select().order('created_at', { ascending: false }),
  ]);

  const feeds = feedsRes.data || [];
  const tokens = tokensRes.data || [];

  const householdIds = new Set();
  const userIds = new Set();
  for (const f of feeds) {
    if (f.household_id) householdIds.add(f.household_id);
    if (f.user_id) userIds.add(f.user_id);
  }
  for (const t of tokens) {
    if (t.household_id) householdIds.add(t.household_id);
    if (t.user_id) userIds.add(t.user_id);
  }

  // Fetch household + user names + event counts in parallel
  const [householdsRes, usersRes, eventCountRes] = await Promise.all([
    householdIds.size > 0
      ? db.from('households').select('id, name').in('id', Array.from(householdIds))
      : Promise.resolve({ data: [] }),
    userIds.size > 0
      ? db.from('users').select('id, name, email').in('id', Array.from(userIds))
      : Promise.resolve({ data: [] }),
    feeds.length > 0
      ? db.from('calendar_events').select('external_feed_id').in('external_feed_id', feeds.map((f) => f.id)).is('deleted_at', null)
      : Promise.resolve({ data: [] }),
  ]);

  const householdMap = {};
  for (const h of householdsRes.data || []) householdMap[h.id] = h.name;
  const userMap = {};
  for (const u of usersRes.data || []) userMap[u.id] = u;
  const eventCounts = {};
  for (const row of eventCountRes.data || []) {
    eventCounts[row.external_feed_id] = (eventCounts[row.external_feed_id] || 0) + 1;
  }

  const enrichedFeeds = feeds.map((f) => ({
    id: f.id,
    household_id: f.household_id,
    household_name: householdMap[f.household_id] || 'Unknown',
    user_id: f.user_id,
    user_name: userMap[f.user_id]?.name || 'Unknown',
    user_email: userMap[f.user_id]?.email || '',
    feed_url: f.feed_url,
    display_name: f.display_name,
    color: f.color,
    sync_enabled: f.sync_enabled,
    last_synced_at: f.last_synced_at,
    last_error: f.last_error,
    consecutive_failures: f.consecutive_failures || 0,
    created_at: f.created_at,
    event_count: eventCounts[f.id] || 0,
  }));

  const enrichedTokens = tokens.map((t) => ({
    household_id: t.household_id,
    household_name: householdMap[t.household_id] || 'Unknown',
    user_id: t.user_id,
    user_name: userMap[t.user_id]?.name || 'Unknown',
    user_email: userMap[t.user_id]?.email || '',
    created_at: t.created_at,
  }));

  return { feeds: enrichedFeeds, outboundTokens: enrichedTokens };
}

async function getAllEventsForFeed(householdId, userId, db = supabase) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const oneYearAhead = new Date();
  oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);

  // Visibility mirrors the in-app read rule (getCalendarEvents): family-wide
  // events, the token owner's own events, and legacy NULL-visibility rows.
  // Without this, a member's PRIVATE events were broadcast to anyone holding
  // a feed URL. Feed tokens are per-user, so userId is always present.
  let eventsQuery = db
    .from('calendar_events')
    .select()
    .eq('household_id', householdId)
    .is('deleted_at', null)
    // Exclude events that came in via an inbound external feed. Without
    // this filter, a user who subscribes to (a) an external calendar IN
    // Housemait via the inbound iCal feed feature AND (b) the Housemait
    // outbound feed in their external calendar app sees every external
    // event TWICE in their external calendar - once as the native
    // original, once re-broadcast through Housemait. Outbound should
    // only ever ship events that originated in Housemait.
    .is('external_feed_id', null)
    .gte('start_time', thirtyDaysAgo.toISOString())
    .lte('start_time', oneYearAhead.toISOString())
    .order('start_time');
  if (userId) {
    eventsQuery = eventsQuery.or(`visibility.eq.family,source_user_id.eq.${userId},visibility.is.null`);
  }

  const [{ data: events }, { data: tasks }] = await Promise.all([
    eventsQuery,
    db
      .from('tasks')
      .select()
      .eq('household_id', householdId)
      .eq('completed', false)
      .order('due_date'),
  ]);

  return { events: events || [], tasks: tasks || [] };
}

// ─── Calendar Connections (two-way sync) ─────────────────────────────────────

/**
 * Return only sync_mappings whose underlying calendar_event originated
 * IN Housemait - i.e. events the user created via app/bot/WhatsApp that
 * Housemait pushed outward. These are the only mappings that should be
 * passed to deleteEventsBatch on disconnect: they identify the orphan
 * events the user wants removed from their external calendar.
 *
 * Mappings that point at INBOUND-mirrored events (subscription_id NOT
 * NULL) MUST be excluded - those represent the user's own native events
 * in Apple/Google/Outlook, which they obviously don't want Housemait to
 * delete on disconnect. Without this filter, a user with N events in
 * their external calendar plus 6 events Housemait pushed would lose ALL
 * N+6 to a "Disconnect and remove events" click. (Confirmed via Grant's
 * data: 8869 mappings total, only 6 outbound - the other 8863 reference
 * events Housemait should never touch.)
 */

/**
 * Remove every sync mapping an event has for a given connection. Called
 * when we push a local delete to the provider - the event itself is
 * being removed, so all of its remote tracking should go too.
 */

/**
 * Remove a single mapping identified by the external UID. Called when an
 * INCOMING delete arrives from the provider - Apple says "this UID is
 * gone", we remove the mapping for THAT UID only. Other mappings for
 * the same event (other UIDs, other calendar subscriptions, shared-
 * calendar mirrors) stay intact. Caller is responsible for soft-deleting
 * the event separately if no mappings remain.
 */

/**
 * Count how many mappings reference this event, across every connection.
 * Used after processing an incoming delete: if zero mappings remain, the
 * event has no external source left and can be safely soft-deleted.
 * If any remain, we leave the event alone - another sync could have it
 * mirrored.
 */

// (Two-way sync helpers removed - see src/services/externalFeed.js for the
// current read-only inbound flow.)

async function createCalendarEventFromSync(householdId, eventData, sourceUserId, subscriptionId, category, visibility, db = supabase) {
  // Ensure timestamps are valid for timestamptz columns (bare dates need time appended)
  let startTime = eventData.start_time;
  let endTime = eventData.end_time;
  if (startTime && !startTime.includes('T')) startTime = `${startTime}T00:00:00Z`;
  if (endTime && !endTime.includes('T')) endTime = `${endTime}T00:00:00Z`;

  const { data, error } = await db
    .from('calendar_events')
    .insert({
      household_id: householdId,
      title: eventData.title || 'Untitled event',
      description: eventData.description || null,
      start_time: startTime,
      end_time: endTime || startTime,
      all_day: eventData.all_day || false,
      location: eventData.location || null,
      color: category === 'birthday' ? 'plum' : category === 'public_holiday' ? 'coral' : 'sky',
      source_user_id: sourceUserId,
      subscription_id: subscriptionId,
      category,
      visibility,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Batch Calendar Sync ────────────────────────────────────────────────────

// ─── Meal Plan ──────────────────────────────────────────────────────────────

async function getMealPlanForWeek(householdId, startDate, endDate, db = supabase) {
  const { data, error } = await db
    .from('meal_plan')
    .select('*, recipes(*)')
    .eq('household_id', householdId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date')
    .order('category');
  if (error) throw error;
  return data;
}

async function getRecurringMeals(householdId, db = supabase) {
  const { data, error } = await db
    .from('meal_plan')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_recurring', true);
  if (error) throw error;
  return data;
}

async function createMealPlanEntry(householdId, data, userId, db = supabase) {
  const { data: meal, error } = await db
    .from('meal_plan')
    .insert({
      household_id: householdId,
      date: data.date,
      category: data.category || 'dinner',
      recipe_id: data.recipe_id || null,
      meal_name: data.meal_name,
      notes: data.notes || null,
      is_recurring: data.is_recurring || false,
      recurrence_day: data.recurrence_day !== undefined ? data.recurrence_day : null,
      added_by: userId,
    })
    .select('*, recipes(*)')
    .single();
  if (error) throw error;
  return meal;
}

async function updateMealPlanEntry(mealId, householdId, updates, db = supabase) {
  const { data, error } = await db
    .from('meal_plan')
    .update(updates)
    .eq('id', mealId)
    .eq('household_id', householdId)
    .select('*, recipes(*)')
    .single();
  if (error) throw error;
  return data;
}

async function deleteMealPlanEntry(mealId, householdId, db = supabase) {
  const { error } = await db
    .from('meal_plan')
    .delete()
    .eq('id', mealId)
    .eq('household_id', householdId);
  if (error) throw error;
}

// ─── Recipes ────────────────────────────────────────────────────────────────

async function getRecipes(householdId, filters = {}, db = supabase) {
  let query = db
    .from('recipes')
    .select()
    .eq('household_id', householdId);

  if (filters.search) {
    query = query.ilike('name', `%${filters.search}%`);
  }
  if (filters.category) {
    query = query.eq('category', filters.category);
  }
  if (filters.tag) {
    query = query.contains('dietary_tags', [filters.tag]);
  }
  if (filters.favourites) {
    query = query.eq('is_favourite', true);
  }

  const { data, error } = await query.order('name');
  if (error) throw error;
  return data;
}

async function getRecipeById(recipeId, householdId, db = supabase) {
  const { data, error } = await db
    .from('recipes')
    .select()
    .eq('id', recipeId)
    .eq('household_id', householdId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getLatestRecipe(householdId, db = supabase) {
  const { data, error } = await db
    .from('recipes')
    .select()
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function createRecipe(householdId, recipeData, db = supabase) {
  const { data, error } = await db
    .from('recipes')
    .insert({
      household_id: householdId,
      name: recipeData.name,
      category: recipeData.category || 'dinner',
      ingredients: recipeData.ingredients || [],
      method: Array.isArray(recipeData.method) ? recipeData.method.join('\n') : (recipeData.method || null),
      prep_time_mins: recipeData.prep_time_mins || null,
      cook_time_mins: recipeData.cook_time_mins || null,
      servings: recipeData.servings || null,
      dietary_tags: recipeData.dietary_tags || [],
      image_url: recipeData.image_url || null,
      source_url: recipeData.source_url || null,
      source_type: recipeData.source_type || 'manual',
      notes: recipeData.notes || null,
      is_favourite: recipeData.is_favourite || false,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateRecipe(recipeId, householdId, updates, db = supabase) {
  updates.updated_at = new Date().toISOString();
  const { data, error } = await db
    .from('recipes')
    .update(updates)
    .eq('id', recipeId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteRecipe(recipeId, householdId, db = supabase) {
  const { error } = await db
    .from('recipes')
    .delete()
    .eq('id', recipeId)
    .eq('household_id', householdId);
  if (error) throw error;
}

// ─── Meal Categories ────────────────────────────────────────────────────────

async function getMealCategories(householdId, db = supabase) {
  const { data, error } = await db
    .from('meal_categories')
    .select()
    .eq('household_id', householdId)
    .order('sort_order');
  if (error) throw error;
  return data;
}

async function createDefaultMealCategories(householdId, db = supabase) {
  const defaults = [
    { household_id: householdId, name: 'Breakfast', colour: '#F5CBA7', sort_order: 0, active: true },
    { household_id: householdId, name: 'Lunch', colour: '#A9DFBF', sort_order: 1, active: true },
    { household_id: householdId, name: 'Dinner', colour: '#AED6F1', sort_order: 2, active: true },
    { household_id: householdId, name: 'Dessert', colour: '#F5B7B1', sort_order: 3, active: true },
    { household_id: householdId, name: 'Snack', colour: '#D7BDE2', sort_order: 4, active: true },
  ];
  const { data, error } = await db
    .from('meal_categories')
    .insert(defaults)
    .select();
  if (error) throw error;
  return data;
}

async function updateMealCategory(categoryId, householdId, updates, db = supabase) {
  const { data, error } = await db
    .from('meal_categories')
    .update(updates)
    .eq('id', categoryId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getRecentMeals(householdId, days = 14, db = supabase) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await db
    .from('meal_plan')
    .select()
    .eq('household_id', householdId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}

async function getRecentPurchases(householdId, days = 14, db = supabase) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await db
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', true)
    .gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ─── Platform Admin ──────────────────────────────────────────────────────────

/**
 * "Last active" signal for admin views. Every successful JWT refresh bumps
 * refresh_tokens.last_used_at (see src/middleware/auth.js + the
 * migration-refresh-token-metadata.sql) — taking the MAX across all of a
 * user's tokens (including revoked ones, which freeze at logout time) is the
 * best proxy we have for "when did this person last actually open the app."
 *
 * Returns a Map<userId, ISO timestamp>. Missing entries mean the user has
 * never had a refresh token (e.g. password-reset-only or signed up but never
 * completed login) — UI treats them as "Never".
 */
async function fetchLastActiveByUserIds(userIds, db = supabase) {
  if (!userIds || userIds.length === 0) return new Map();
  const { data, error } = await db
    .from('refresh_tokens')
    .select('user_id, last_used_at')
    .in('user_id', userIds);
  if (error) throw error;
  const map = new Map();
  for (const r of data || []) {
    if (!r.last_used_at) continue;
    const existing = map.get(r.user_id);
    if (!existing || r.last_used_at > existing) map.set(r.user_id, r.last_used_at);
  }
  return map;
}

const { parsePlatformFromUserAgent } = require('../utils/platform-detect');

/**
 * Bulk-fetch platform usage for a set of user IDs. Combines two signals:
 *   1. refresh_tokens.user_agent — tells us whether each user has ever
 *      logged in on an iOS device, on web/desktop, etc.
 *   2. device_tokens (platform='ios') — definitive "has installed the
 *      native iOS app" signal (only the native app registers a push token).
 *
 * Returns Map<userId, {
 *   iosApp:        boolean,  // any ios device_token (active or inactive)
 *   iosAppActive:  boolean,  // any active ios device_token (push working)
 *   iosWeb:        boolean,  // iPhone/iPad UA in refresh_tokens
 *   web:           boolean,  // non-mobile UA in refresh_tokens
 *   lastIosAt:     ISO|null, // most-recent refresh on an ios device
 *   lastWebAt:     ISO|null, // most-recent refresh on web/desktop
 * }>
 *
 * Users with no data return undefined from the map.
 */
async function getPlatformsByUserIds(userIds, db = supabase) {
  if (!userIds || userIds.length === 0) return new Map();

  const selectPlatformRows = (withVersion) => Promise.all([
    db.from('refresh_tokens')
      .select(withVersion ? 'user_id, user_agent, app_version, last_used_at' : 'user_id, user_agent, last_used_at')
      .in('user_id', userIds),
    db.from('device_tokens')
      .select(withVersion ? 'user_id, active, app_version, updated_at' : 'user_id, active, updated_at')
      .in('user_id', userIds).eq('platform', 'ios'),
  ]);
  let [tokensRes, devicesRes] = await selectPlatformRows(true);
  // Pre-migration fallback: drop app_version from the projection. Rows then
  // lack app_version, so noteAppVersion below simply records nothing.
  if (isMissingColumnError(tokensRes.error) || isMissingColumnError(devicesRes.error)) {
    [tokensRes, devicesRes] = await selectPlatformRows(false);
  }

  const map = new Map();
  function entry(userId) {
    let e = map.get(userId);
    if (!e) {
      e = {
        iosApp: false, iosAppActive: false,
        iosWeb: false, web: false,
        lastIosAt: null, lastWebAt: null,
        // Most-recent reported native app build, e.g. "1.7.0 (22)". `_avAt`
        // is the timestamp it came from, used internally to keep the newest.
        appVersion: null, _avAt: null,
      };
      map.set(userId, e);
    }
    return e;
  }

  // Keep the app_version tied to the most recent signal we've seen for a user.
  function noteAppVersion(e, version, at) {
    if (!version || !at) return;
    if (!e._avAt || at > e._avAt) {
      e.appVersion = version;
      e._avAt = at;
    }
  }

  // 1. refresh_tokens → ios vs web bucket per session
  for (const row of tokensRes.data || []) {
    if (!row.user_id) continue;
    const platform = parsePlatformFromUserAgent(row.user_agent);
    if (!platform) continue;
    const e = entry(row.user_id);
    noteAppVersion(e, row.app_version, row.last_used_at);
    if (platform === 'ios') {
      e.iosWeb = true;
      if (row.last_used_at && (!e.lastIosAt || row.last_used_at > e.lastIosAt)) {
        e.lastIosAt = row.last_used_at;
      }
    } else if (platform === 'web' || platform === 'android') {
      // 'android' lumped into web for now — single bucket for "not iOS"
      e.web = true;
      if (row.last_used_at && (!e.lastWebAt || row.last_used_at > e.lastWebAt)) {
        e.lastWebAt = row.last_used_at;
      }
    }
  }

  // 2. device_tokens upgrades 'iosWeb' → 'iosApp' (proves native install)
  for (const row of devicesRes.data || []) {
    if (!row.user_id) continue;
    const e = entry(row.user_id);
    e.iosApp = true;
    if (row.active) e.iosAppActive = true;
    noteAppVersion(e, row.app_version, row.updated_at);
  }

  // Drop the internal sort key before returning.
  for (const e of map.values()) delete e._avAt;

  return map;
}

/**
 * Pure aggregation behind getChannelCohortStats - separated so it can be
 * unit-tested without a DB. Classifies each non-internal household by the
 * channels its members actually use, then tallies subscription outcomes.
 *
 *   - app          → at least one member registered a native iOS device token
 *                    (the definitive "installed the app" signal). May ALSO use
 *                    WhatsApp; "app" wins because the question is app vs not.
 *   - whatsapp_only→ no app install, but at least one member linked WhatsApp.
 *   - web_only     → neither (pure browser users).
 *
 *   conversionPct = active / (active + expired + cancelled)  — of households
 *                   that reached a decision (trial resolved), the % that pay.
 *   retentionPct  = active / (active + cancelled)            — of households
 *                   that ever subscribed, the % still active.
 */
function computeChannelCohorts({ households, members, appUserIds }) {
  const appSet = appUserIds instanceof Set ? appUserIds : new Set(appUserIds || []);
  const hhHasApp = new Set();
  const hhHasWa = new Set();
  for (const m of members || []) {
    if (!m.household_id) continue;
    if (appSet.has(m.id)) hhHasApp.add(m.household_id);
    if (m.whatsapp_linked) hhHasWa.add(m.household_id);
  }

  const blank = () => ({ total: 0, trialing: 0, active: 0, expired: 0, cancelled: 0, other: 0 });
  const cohorts = { app: blank(), whatsapp_only: blank(), web_only: blank() };

  for (const h of households || []) {
    const key = hhHasApp.has(h.id) ? 'app' : (hhHasWa.has(h.id) ? 'whatsapp_only' : 'web_only');
    const c = cohorts[key];
    c.total += 1;
    const s = h.subscription_status;
    if (s === 'trialing') c.trialing += 1;
    else if (s === 'active') c.active += 1;
    else if (s === 'expired') c.expired += 1;
    else if (s === 'cancelled') c.cancelled += 1;
    else c.other += 1;
  }

  for (const c of Object.values(cohorts)) {
    const resolved = c.active + c.expired + c.cancelled;
    const everPaid = c.active + c.cancelled;
    c.resolved = resolved;
    c.conversionPct = resolved > 0 ? Math.round((c.active / resolved) * 1000) / 10 : null;
    c.retentionPct = everPaid > 0 ? Math.round((c.active / everPaid) * 1000) / 10 : null;
  }
  return cohorts;
}

/**
 * Channel-cohort breakdown for the admin analytics page: do WhatsApp-only
 * households convert / retain better or worse than app households? The user
 * base is small (hundreds), so we pull the three relevant tables and classify
 * in memory rather than maintaining an RPC.
 */
async function getChannelCohortStats(db = supabase) {
  const [hhRes, memRes, devRes] = await Promise.all([
    db.from('households').select('id, subscription_status').eq('is_internal', false),
    db.from('users').select('id, household_id, whatsapp_linked'),
    db.from('device_tokens').select('user_id').eq('platform', 'ios'),
  ]);
  if (hhRes.error) throw hhRes.error;
  if (memRes.error) throw memRes.error;
  if (devRes.error) throw devRes.error;

  const appUserIds = new Set((devRes.data || []).map((d) => d.user_id).filter(Boolean));
  return computeChannelCohorts({
    households: hhRes.data || [],
    members: memRes.data || [],
    appUserIds,
  });
}

async function getAllUsersAdmin({ search, page = 1, limit = 50, sort = 'created_at', sortDir = 'desc' } = {}, db = supabase) {
  // Sorting by last_active_at can't be done in a single SQL query because
  // it's a derived value (MAX refresh_tokens.last_used_at). For that sort
  // we go two-step: fetch all matching IDs (no range), join the activity
  // map, sort in memory, then page through the sorted ID list. The user
  // base is small enough (hundreds, not millions) that the extra
  // round-trip is fine.
  if (sort === 'last_active_at') {
    return getAllUsersAdminByLastActive({ search, page, limit, sortDir }, db);
  }

  let query = db
    .from('users')
    .select('id, name, email, role, household_id, is_platform_admin, member_type, color_theme, avatar_url, email_verified, whatsapp_linked, disabled_at, created_at', { count: 'exact' });

  if (search) {
    const s = sanitizeOrFilterValue(search);
    query = query.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
  }

  // Whitelist sort columns to prevent injection
  const sortColumn = sort === 'name' ? 'name' : 'created_at';
  const ascending = sortDir === 'asc';

  const from = (page - 1) * limit;
  const { data, error, count } = await query
    .order(sortColumn, { ascending })
    .range(from, from + limit - 1);

  if (error) throw error;

  // Attach last_active_at (MAX refresh_tokens.last_used_at per user) and
  // platform usage (iOS app / web) - both queries are bounded by the
  // current page's user IDs so they stay cheap.
  const ids = (data || []).map((u) => u.id);
  const [lastActiveMap, platformsMap] = await Promise.all([
    fetchLastActiveByUserIds(ids, db),
    getPlatformsByUserIds(ids, db),
  ]);
  for (const u of data || []) {
    u.last_active_at = lastActiveMap.get(u.id) || null;
    u.platforms = platformsMap.get(u.id) || null;
  }

  return { users: data, total: count };
}

/**
 * Two-step path for sort=last_active_at. Fetches all matching user IDs
 * + last_active_at, sorts (nulls always last so users who've never logged
 * in surface at the bottom regardless of direction), then fetches full
 * rows for just the requested page.
 */
async function getAllUsersAdminByLastActive({ search, page, limit, sortDir }, db) {
  // 1. All matching IDs (no range, no full payload yet)
  let idQuery = db.from('users').select('id', { count: 'exact' });
  if (search) {
    const s = sanitizeOrFilterValue(search);
    idQuery = idQuery.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
  }
  const { data: idRows, error: idErr, count } = await idQuery;
  if (idErr) throw idErr;
  const allIds = (idRows || []).map((r) => r.id);
  if (allIds.length === 0) return { users: [], total: 0 };

  // 2. last_active_at for each
  const lastActiveMap = await fetchLastActiveByUserIds(allIds, db);

  // 3. Sort. Nulls always go last regardless of direction - if we're sorting
  //    most-recent-first the never-logged-in users sit at the bottom; if
  //    oldest-first they still sit at the bottom (rather than spuriously
  //    leading the list with "earliest" = null).
  const sortedIds = allIds.slice().sort((a, b) => {
    const ta = lastActiveMap.get(a);
    const tb = lastActiveMap.get(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return sortDir === 'asc' ? ta.localeCompare(tb) : tb.localeCompare(ta);
  });

  // 4. Page through sorted IDs
  const from = (page - 1) * limit;
  const pageIds = sortedIds.slice(from, from + limit);
  if (pageIds.length === 0) return { users: [], total: count || 0 };

  // 5. Fetch the actual rows for just this page
  const { data: rows, error: rowErr } = await db
    .from('users')
    .select('id, name, email, role, household_id, is_platform_admin, member_type, color_theme, avatar_url, email_verified, whatsapp_linked, disabled_at, created_at')
    .in('id', pageIds);
  if (rowErr) throw rowErr;

  // 6. Preserve the sorted order (Postgres .in() doesn't return rows in
  //    the order we asked for) + attach last_active_at and platforms to
  //    the response
  const platformsMap = await getPlatformsByUserIds(pageIds, db);
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  const ordered = pageIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((u) => ({
      ...u,
      last_active_at: lastActiveMap.get(u.id) || null,
      platforms: platformsMap.get(u.id) || null,
    }));

  return { users: ordered, total: count || 0 };
}

async function getUserByIdAdmin(userId, db = supabase) {
  const { data: user, error } = await db
    .from('users')
    .select()
    .eq('id', userId)
    .single();
  if (error) throw error;

  let household = null;
  if (user.household_id) {
    const { data: h } = await db
      .from('households')
      .select()
      .eq('id', user.household_id)
      .single();
    household = h;
  }

  const [lastActiveMap, platformsMap] = await Promise.all([
    fetchLastActiveByUserIds([userId], db),
    getPlatformsByUserIds([userId], db),
  ]);

  return {
    ...user,
    household,
    last_active_at: lastActiveMap.get(userId) || null,
    platforms: platformsMap.get(userId) || null,
  };
}

const IDLE_THRESHOLD_DAYS = 14;

/**
 * Resolve the activity filter to an explicit list of household IDs the main
 * query can constrain on. Filtering by a derived field can't be done in
 * Postgres directly without a view, so we compute it up-front in two cheap
 * queries (refresh_tokens recent → users with those tokens) and use .in().
 *
 * "active"  → any household with at least one member active in the window.
 *             Broad on purpose: a cancelled-but-still-using household is
 *             worth seeing.
 * "idle"    → at-risk in the business sense: trialing OR active subscription
 *             AND not internal AND no member active in the window. Cancelled
 *             / expired / internal accounts are excluded because they can't
 *             churn (they already did, or never will).
 *
 * Returns { householdIds, isEmpty }; caller short-circuits when isEmpty=true.
 */
async function resolveActivityFilter(activity, db = supabase) {
  if (activity !== 'idle' && activity !== 'active') return null;

  const since = new Date(Date.now() - IDLE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentTokens } = await db
    .from('refresh_tokens')
    .select('user_id')
    .gte('last_used_at', since);
  const activeUserIds = [...new Set((recentTokens || []).map((t) => t.user_id))];

  const activeHouseholdIds = new Set();
  if (activeUserIds.length > 0) {
    const { data: activeMembers } = await db
      .from('users')
      .select('household_id')
      .in('id', activeUserIds)
      .not('household_id', 'is', null);
    for (const m of activeMembers || []) activeHouseholdIds.add(m.household_id);
  }

  if (activity === 'active') {
    return { householdIds: Array.from(activeHouseholdIds), isEmpty: activeHouseholdIds.size === 0 };
  }

  // idle = at-risk: only count households that COULD still churn. Already-
  // cancelled / expired / internal-flagged households are excluded because
  // they're not paying customers we could lose.
  const { data: payingHouseholds } = await db
    .from('households')
    .select('id')
    .in('subscription_status', ['trialing', 'active'])
    .eq('is_internal', false);
  const idleIds = (payingHouseholds || [])
    .map((h) => h.id)
    .filter((id) => !activeHouseholdIds.has(id));
  return { householdIds: idleIds, isEmpty: idleIds.length === 0 };
}

async function getAllHouseholdsAdmin({ search, page = 1, limit = 50, sort = 'created_at', sortDir = 'desc', plan, activity } = {}, db = supabase) {
  // Resolve the activity filter into explicit household IDs first - if it
  // matches nothing we can short-circuit without hitting households at all.
  const activityFilter = await resolveActivityFilter(activity, db);
  if (activityFilter?.isEmpty) {
    return { households: [], total: 0 };
  }

  let query = db
    .from('households')
    .select('id, name, join_code, timezone, reminder_time, created_at, subscription_status, subscription_plan, trial_ends_at, is_internal, subscription_current_period_end, stripe_customer_id', { count: 'exact' });

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  // Plan filter - matches what SubscriptionBadge displays. Internal takes
  // priority over subscription_status, so non-internal filters must also
  // exclude internal households.
  if (plan === 'internal') {
    query = query.eq('is_internal', true);
  } else if (plan === 'trialing' || plan === 'active' || plan === 'expired' || plan === 'cancelled') {
    query = query.eq('subscription_status', plan).eq('is_internal', false);
  }

  if (activityFilter) {
    query = query.in('id', activityFilter.householdIds);
  }

  // last_active_at is a derived value (MAX across members) so the DB can't
  // sort by it. For that path we fetch ALL matching rows, enrich, then sort
  // + paginate in JS. For everything else we use the normal SQL order + range.
  const sortByActive = sort === 'last_active_at';

  // Whitelist sort columns to prevent injection
  const sortColumn = sort === 'name' ? 'name' : 'created_at';
  const ascending = sortDir === 'asc';

  let data, error, count;
  if (sortByActive) {
    const res = await query;
    data = res.data; error = res.error; count = res.count;
  } else {
    const from = (page - 1) * limit;
    const res = await query
      .order(sortColumn, { ascending })
      .range(from, from + limit - 1);
    data = res.data; error = res.error; count = res.count;
  }

  if (error) throw error;

  // Attach member counts + last_active_at + documents
  const householdIds = data.map((h) => h.id);
  if (householdIds.length > 0) {
    const { data: users } = await db
      .from('users')
      .select('id, household_id')
      .in('household_id', householdIds);

    const countMap = {};
    const membersByHousehold = {};
    for (const u of users || []) {
      countMap[u.household_id] = (countMap[u.household_id] || 0) + 1;
      if (!membersByHousehold[u.household_id]) membersByHousehold[u.household_id] = [];
      membersByHousehold[u.household_id].push(u.id);
    }
    for (const h of data) {
      h.member_count = countMap[h.id] || 0;
    }

    // Bulk fetch last_active_at across all members, then take max per household
    const allMemberIds = (users || []).map((u) => u.id);
    const lastActiveMap = await fetchLastActiveByUserIds(allMemberIds, db);
    for (const h of data) {
      const memberIds = membersByHousehold[h.id] || [];
      let max = null;
      for (const mid of memberIds) {
        const ts = lastActiveMap.get(mid);
        if (ts && (!max || ts > max)) max = ts;
      }
      h.last_active_at = max;
    }

    // Attach document counts + total bytes (single bulk fetch - same pattern as members)
    const { data: docs } = await db
      .from('documents')
      .select('household_id, file_size')
      .in('household_id', householdIds);

    const docStats = {};
    for (const d of docs || []) {
      const stat = docStats[d.household_id] || { count: 0, bytes: 0 };
      stat.count++;
      stat.bytes += d.file_size || 0;
      docStats[d.household_id] = stat;
    }
    for (const h of data) {
      h.documents_count = docStats[h.id]?.count || 0;
      h.documents_bytes = docStats[h.id]?.bytes || 0;
    }
  }

  // For sort=last_active_at we deferred ordering + pagination until after
  // enrichment (since the field is derived). Apply both now.
  // Nulls always go last so households with no activity sit at the bottom
  // regardless of direction.
  if (sortByActive) {
    data.sort((a, b) => {
      const ta = a.last_active_at;
      const tb = b.last_active_at;
      if (!ta && !tb) return 0;
      if (!ta) return 1;
      if (!tb) return -1;
      return ascending ? ta.localeCompare(tb) : tb.localeCompare(ta);
    });
    const from = (page - 1) * limit;
    data = data.slice(from, from + limit);
  }

  return { households: data, total: count };
}

async function getHouseholdDetailAdmin(householdId, db = supabase) {
  const { data: household, error } = await db
    .from('households')
    .select()
    .eq('id', householdId)
    .single();
  if (error) throw error;

  const [{ data: members }, storage] = await Promise.all([
    db
      .from('users')
      .select('id, name, email, role, member_type, color_theme, avatar_url, is_platform_admin, disabled_at, created_at')
      .eq('household_id', householdId)
      .order('created_at'),
    getHouseholdStorageUsage(householdId).catch(() => ({ totalBytes: 0, fileCount: 0 })),
  ]);

  // Enrich each member with last_active_at + platforms, and roll up the
  // max as the household's last_active_at (so the detail header can show
  // staleness at a glance).
  const memberIds = (members || []).map((m) => m.id);
  const [lastActiveMap, platformsMap] = await Promise.all([
    fetchLastActiveByUserIds(memberIds, db),
    getPlatformsByUserIds(memberIds, db),
  ]);
  let householdLastActive = null;
  for (const m of members || []) {
    m.last_active_at = lastActiveMap.get(m.id) || null;
    m.platforms = platformsMap.get(m.id) || null;
    if (m.last_active_at && (!householdLastActive || m.last_active_at > householdLastActive)) {
      householdLastActive = m.last_active_at;
    }
  }

  return {
    ...household,
    members: members || [],
    documents_count: storage.fileCount,
    documents_bytes: storage.totalBytes,
    last_active_at: householdLastActive,
  };
}

async function getPlatformStats(db = supabase) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [usersResult, householdsResult, newUsersResult, newHouseholdsResult, subStats, idleFilter, activeFilter] = await Promise.all([
    db.from('users').select('id', { count: 'exact', head: true }),
    db.from('households').select('id', { count: 'exact', head: true }),
    db.from('users').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    db.from('households').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    getSubscriptionStats(db),
    resolveActivityFilter('idle', db),
    resolveActivityFilter('active', db),
  ]);

  return {
    totalUsers: usersResult.count || 0,
    totalHouseholds: householdsResult.count || 0,
    newUsersThisWeek: newUsersResult.count || 0,
    newHouseholdsThisWeek: newHouseholdsResult.count || 0,
    subscriptions: subStats,
    atRiskHouseholds: idleFilter?.householdIds?.length || 0,
    activeHouseholds: activeFilter?.householdIds?.length || 0,
  };
}

/**
 * Counts of households grouped by subscription_status, plus internal count.
 * Internal households are mutually exclusive in the UI but counted separately
 * here so admins can see both views.
 */
async function getSubscriptionStats(db = supabase) {
  const { data, error } = await db
    .from('households')
    .select('subscription_status, is_internal');
  if (error) throw error;

  const stats = {
    trialing: 0,
    active: 0,
    expired: 0,
    cancelled: 0,
    internal: 0,
  };
  for (const h of data || []) {
    if (h.is_internal) stats.internal++;
    if (h.subscription_status && stats[h.subscription_status] !== undefined) {
      stats[h.subscription_status]++;
    }
  }
  return stats;
}

/**
 * Whitelisted subscription update for admin dashboard. Only `is_internal` and
 * `trial_ends_at` are accepted - everything else (Stripe IDs, status,
 * customer IDs) must flow through Stripe webhooks to stay consistent.
 */
async function updateHouseholdSubscriptionAdmin(householdId, updates, db = supabase) {
  const allowed = {};
  if (typeof updates.is_internal === 'boolean') allowed.is_internal = updates.is_internal;
  if (typeof updates.trial_ends_at === 'string') allowed.trial_ends_at = updates.trial_ends_at;

  if (Object.keys(allowed).length === 0) {
    const err = new Error('No valid subscription fields provided');
    err.code = 'NO_FIELDS';
    throw err;
  }

  const { data, error } = await db
    .from('households')
    .update(allowed)
    .eq('id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Pause or resume a household's trial.
 *  - pause:  stamp trial_paused_at = now (the gate then keeps access + never
 *            expires while it's set). No-op if already paused.
 *  - resume: add the paused duration back onto trial_ends_at and clear
 *            trial_paused_at, so no trial days were lost. No-op if not paused.
 * Idempotent; returns the updated household row.
 */
async function pauseOrResumeTrial(householdId, paused, db = supabase) {
  const { data: hh, error: e1 } = await db
    .from('households')
    .select('trial_ends_at, trial_paused_at')
    .eq('id', householdId)
    .single();
  if (e1) throw e1;

  const updates = {};
  if (paused) {
    if (hh.trial_paused_at) return hh; // already paused
    updates.trial_paused_at = new Date().toISOString();
  } else {
    if (!hh.trial_paused_at) return hh; // not paused
    const pausedMs = Math.max(0, Date.now() - new Date(hh.trial_paused_at).getTime());
    const base = hh.trial_ends_at ? new Date(hh.trial_ends_at).getTime() : Date.now();
    updates.trial_ends_at = new Date(base + pausedMs).toISOString();
    updates.trial_paused_at = null;
  }

  const { data, error } = await db
    .from('households')
    .update(updates)
    .eq('id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function disableUser(userId, db = supabase) {
  const { data, error } = await db
    .from('users')
    .update({ disabled_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function enableUser(userId, db = supabase) {
  const { data, error } = await db
    .from('users')
    .update({ disabled_at: null })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteUserAdmin(userId, db = supabase) {
  // Delegates to the delete_user_cascade() Postgres function (see
  // supabase/migration-user-delete-fix.sql). The function runs with
  // SET statement_timeout = '5min' so the cascade across all the user-
  // referencing tables (refresh_tokens, device_tokens, event_reminders,
  // chat_messages, audit logs, etc.) doesn't hit Supabase's default
  // ~30s timeout. Real accounts hit this even on relatively light usage.
  //
  // Falls back to a plain DELETE if the function isn't installed yet -
  // covers the brief window between code deploy and migration run.
  const { error: rpcErr } = await db.rpc('delete_user_cascade', { p_user_id: userId });
  if (!rpcErr) return;

  // 42883 = undefined_function - function isn't deployed yet.
  if (rpcErr.code === '42883' || /function .*does not exist/i.test(rpcErr.message || '')) {
    console.warn('[db] delete_user_cascade() not installed - falling back to direct DELETE. Run migration-user-delete-fix.sql.');
    const { error } = await db
      .from('users')
      .delete()
      .eq('id', userId);
    if (error) throw error;
    return;
  }
  throw rpcErr;
}

async function deleteHouseholdCascade(householdId, db = supabase) {
  // Delegates to the delete_household_cascade() Postgres function (see
  // supabase/migration-household-delete-fix.sql). The function runs with
  // SET statement_timeout = '5min' so the cascade across a fully-loaded
  // household doesn't hit Supabase's default ~30s timeout.
  //
  // Falls back to a plain DELETE if the function isn't installed yet -
  // covers the brief window between code deploy and migration run.
  const { error: rpcErr } = await db.rpc('delete_household_cascade', { p_household_id: householdId });
  if (!rpcErr) return;

  // 42883 = undefined_function - function isn't deployed yet.
  if (rpcErr.code === '42883' || /function .*does not exist/i.test(rpcErr.message || '')) {
    console.warn('[db] delete_household_cascade() not installed - falling back to direct DELETE. Run migration-household-delete-fix.sql.');
    const { error } = await db.from('households').delete().eq('id', householdId);
    if (error) throw error;
    return;
  }
  throw rpcErr;
}

async function setUserPlatformAdmin(userId, isPlatformAdmin, db = supabase) {
  const { data, error } = await db
    .from('users')
    .update({ is_platform_admin: isPlatformAdmin })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Phase 2 Admin: AI Usage ─────────────────────────────────────────────────

async function getAiUsageStats({ days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [totalRes, byProviderRes, byFeatureRes, failoverRes, avgLatencyRes] = await Promise.all([
    db.from('ai_usage_log').select('id', { count: 'exact', head: true }).gte('created_at', since),
    db.from('ai_usage_log').select('provider').gte('created_at', since),
    db.from('ai_usage_log').select('feature').gte('created_at', since),
    db.from('ai_usage_log').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('is_failover', true),
    db.from('ai_usage_log').select('latency_ms').gte('created_at', since).not('latency_ms', 'is', null),
  ]);

  // Count by provider
  const byProvider = {};
  for (const row of byProviderRes.data || []) {
    byProvider[row.provider] = (byProvider[row.provider] || 0) + 1;
  }

  // Count by feature
  const byFeature = {};
  for (const row of byFeatureRes.data || []) {
    byFeature[row.feature] = (byFeature[row.feature] || 0) + 1;
  }

  // Avg latency
  const latencies = (avgLatencyRes.data || []).map((r) => r.latency_ms);
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

  return {
    totalCalls: totalRes.count || 0,
    failoverCalls: failoverRes.count || 0,
    failoverRate: totalRes.count > 0 ? Math.round((failoverRes.count / totalRes.count) * 100) : 0,
    avgLatencyMs: avgLatency,
    byProvider,
    byFeature,
  };
}

async function getAiUsageTimeline({ days = 30 } = {}, db = supabase) {
  // Aggregate via SQL RPC (see supabase/migration-ai-usage-timeline-rpc.sql).
  // The previous .select() approach silently truncated past 1000 rows due to
  // PostgREST's project-level max-rows cap, regardless of any client-side
  // .limit(). The RPC returns ~30 days × 3 providers = ~90 pre-aggregated
  // rows, comfortably under any cap.
  const { data, error } = await db.rpc('get_ai_usage_timeline', { days_param: days });
  if (error) throw error;

  // Reshape SQL output [{day, provider, call_count}] into the chart's
  // existing shape [{date, total, gemini, claude, 'gpt-4o'}]. PostgREST
  // returns bigint as a string, so coerce with Number() before adding.
  const timeline = {};
  for (const row of data || []) {
    const date = row.day; // 'YYYY-MM-DD' from the postgres date type
    if (!timeline[date]) timeline[date] = { date, total: 0, gemini: 0, claude: 0, 'gpt-4o': 0 };
    const count = Number(row.call_count);
    timeline[date].total += count;
    timeline[date][row.provider] = (timeline[date][row.provider] || 0) + count;
  }
  return Object.values(timeline);
}

// ─── Phase 2 Admin: WhatsApp Stats ──────────────────────────────────────────

async function logWhatsAppMessage({ householdId, userId, direction, messageType, intent, processingMs, error, body, response }, db = supabase) {
  // Truncate stored text so one runaway message can't blow up the row.
  const truncate = (s, max = 2000) => (typeof s === 'string' && s.length > max ? s.slice(0, max) : s);
  db
    .from('whatsapp_message_log')
    .insert({
      household_id: householdId || null,
      user_id: userId || null,
      direction,
      message_type: messageType,
      intent: intent || null,
      processing_ms: processingMs || null,
      error: error || null,
      body: truncate(body) || null,
      response: truncate(response) || null,
    })
    .then(() => {})
    .catch((err) => console.error('[whatsapp-log] Failed to log message:', err.message));
}

/**
 * Fetch the most recent WhatsApp turns for a user, to replay as conversation
 * context for the AI. Only returns messages within `windowMinutes` of the most
 * recent one (so an old thread doesn't bleed into a brand-new conversation).
 *
 * Returns an array of { role: 'user' | 'assistant', content: string } in
 * chronological order (oldest first), ready to spread into an AI messages array.
 */
async function getRecentWhatsAppTurns(userId, { limit = 10, windowMinutes = 30 } = {}, db = supabase) {
  if (!userId) return [];
  // INBOUND rows only. A genuine user<->bot turn is logged as a single
  // inbound row carrying both `body` (what the user said) and `response`
  // (what the bot replied). Outbound rows are exclusively system broadcasts
  // - the morning brief, the weekly "Weekly roundup" digest, overdue-task
  // nudges, cross-member "Grant added event X" pings. Those are NOT
  // conversation: replaying them as context made the bot treat an unrelated
  // message as a reply (e.g. "Mallorca dinner booked" -> "Thanks for the
  // weekly roundup!") - worse, an outbound digest's body was being injected
  // with role:'user', so the AI thought the human had handed it the digest.
  const { data, error } = await db
    .from('whatsapp_message_log')
    .select('direction, body, response, created_at, error, message_type')
    .eq('user_id', userId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[whatsapp-log] getRecentWhatsAppTurns failed:', error.message);
    return [];
  }
  const rows = (data || []).filter((r) => !r.error);
  if (!rows.length) return [];

  // Only include rows from the current conversation window - i.e. within
  // `windowMinutes` of NOW. Anchoring to now (not to the most recent stored
  // row) is deliberate: anchoring to the last row meant a stale message -
  // e.g. this morning's automated "you have N overdue tasks" nudge - stayed
  // "in window" hours later and got replayed as context for an unrelated new
  // message. That made a bare "Testing" come back as "Thanks for the
  // reminder! I'll get to those overdue tasks." Anchoring to now drops
  // anything older than windowMinutes from the current turn.
  const cutoffMs = Date.now() - windowMinutes * 60 * 1000;
  const windowed = rows
    .filter((r) => new Date(r.created_at).getTime() >= cutoffMs)
    .reverse(); // chronological (oldest → newest)

  const turns = [];
  for (const r of windowed) {
    // Only text-ish content is useful as replay context.
    if (r.body) turns.push({ role: 'user', content: String(r.body).slice(0, 500) });
    if (r.response) turns.push({ role: 'assistant', content: String(r.response).slice(0, 500) });
  }
  return turns;
}

async function getWhatsAppStats({ days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('whatsapp_message_log')
    .select('direction, message_type, intent, processing_ms, error, user_id')
    .gte('created_at', since);
  if (error) throw error;

  const rows = data || [];
  const inbound = rows.filter((r) => r.direction === 'inbound');
  const withErrors = rows.filter((r) => r.error);
  const processingTimes = inbound.filter((r) => r.processing_ms).map((r) => r.processing_ms);
  const avgProcessing = processingTimes.length > 0 ? Math.round(processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length) : 0;
  const uniqueUsers = new Set(rows.map((r) => r.user_id).filter(Boolean)).size;

  // By type
  const byType = {};
  for (const r of inbound) {
    byType[r.message_type] = (byType[r.message_type] || 0) + 1;
  }

  // By intent
  const byIntent = {};
  for (const r of inbound) {
    const intent = r.intent || 'unknown';
    byIntent[intent] = (byIntent[intent] || 0) + 1;
  }

  return {
    totalMessages: rows.length,
    inboundMessages: inbound.length,
    errorCount: withErrors.length,
    errorRate: rows.length > 0 ? Math.round((withErrors.length / rows.length) * 100) : 0,
    avgProcessingMs: avgProcessing,
    uniqueUsers,
    byType,
    byIntent,
  };
}

async function getWhatsAppTimeline({ days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('whatsapp_message_log')
    .select('direction, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const timeline = {};
  for (const row of data || []) {
    const date = row.created_at.split('T')[0];
    if (!timeline[date]) timeline[date] = { date, inbound: 0, outbound: 0 };
    timeline[date][row.direction]++;
  }
  return Object.values(timeline);
}

// ─── Phase 2 Admin: Calendar Sync Health ────────────────────────────────────

// ─── Phase 2 Admin: Analytics ───────────────────────────────────────────────

async function getAnalytics({ days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Pull creates (added_by/created_by) and completions in parallel. Completions
  // are filtered by completed_at >= since, not created_at, because a task
  // created last year and completed yesterday IS recent activity.
  const [shoppingRes, tasksRes, calendarRes, chatRes, documentsRes, mealsRes, shoppingCompletedRes, tasksCompletedRes] = await Promise.all([
    db.from('shopping_items').select('added_by, created_at').gte('created_at', since),
    db.from('tasks').select('added_by, created_at').gte('created_at', since),
    db.from('calendar_events').select('created_by, created_at').gte('created_at', since).is('external_feed_id', null),
    db.from('chat_messages').select('user_id, created_at').gte('created_at', since).eq('role', 'user'),
    db.from('documents').select('uploaded_by, created_at').gte('created_at', since),
    db.from('meal_plan').select('added_by, created_at').gte('created_at', since),
    db.from('shopping_items').select('added_by, completed_at').gte('completed_at', since).not('completed_at', 'is', null),
    db.from('tasks').select('added_by, completed_at').gte('completed_at', since).not('completed_at', 'is', null),
  ]);

  // Build DAU map — completions count as activity too (checking off a task is
  // engagement even if the task was created days ago).
  const dauMap = {};
  function addActivity(rows, userField, dateField = 'created_at') {
    for (const row of rows || []) {
      const ts = row[dateField];
      if (!ts) continue;
      const date = ts.split('T')[0];
      if (!dauMap[date]) dauMap[date] = new Set();
      if (row[userField]) dauMap[date].add(row[userField]);
    }
  }
  addActivity(shoppingRes.data, 'added_by');
  addActivity(tasksRes.data, 'added_by');
  addActivity(calendarRes.data, 'created_by');
  addActivity(chatRes.data, 'user_id');
  addActivity(documentsRes.data, 'uploaded_by');
  addActivity(mealsRes.data, 'added_by');
  addActivity(shoppingCompletedRes.data, 'added_by', 'completed_at');
  addActivity(tasksCompletedRes.data, 'added_by', 'completed_at');

  const dau = Object.entries(dauMap)
    .map(([date, users]) => ({ date, activeUsers: users.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Feature usage now reports both created + completed where the concept
  // applies. Calendar / chat / documents / meals don't have a completion
  // notion, so completed is undefined for them.
  const featureUsage = {
    shopping: { created: shoppingRes.data?.length || 0, completed: shoppingCompletedRes.data?.length || 0 },
    tasks: { created: tasksRes.data?.length || 0, completed: tasksCompletedRes.data?.length || 0 },
    calendar: { created: calendarRes.data?.length || 0 },
    chat: { created: chatRes.data?.length || 0 },
    documents: { created: documentsRes.data?.length || 0 },
    meals: { created: mealsRes.data?.length || 0 },
  };

  // Onboarding funnel
  const [totalUsersRes, verifiedRes, withHouseholdRes, invitesRes] = await Promise.all([
    db.from('users').select('id', { count: 'exact', head: true }).not('email', 'is', null),
    db.from('users').select('id', { count: 'exact', head: true }).eq('email_verified', true),
    db.from('users').select('id', { count: 'exact', head: true }).not('household_id', 'is', null),
    db.from('invites').select('id, accepted_at', { count: 'exact' }),
  ]);

  const invitesAccepted = (invitesRes.data || []).filter((i) => i.accepted_at).length;

  const funnel = {
    registered: totalUsersRes.count || 0,
    verified: verifiedRes.count || 0,
    joinedHousehold: withHouseholdRes.count || 0,
    invitesSent: invitesRes.count || 0,
    invitesAccepted,
  };

  // WAU (current week avg)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const weeklyUsers = new Set();
  for (const [date, users] of Object.entries(dauMap)) {
    if (date >= weekAgo) {
      for (const u of users) weeklyUsers.add(u);
    }
  }

  return { dau, featureUsage, funnel, wau: weeklyUsers.size };
}

// ─── Retention cohorts ──────────────────────────────────────────────────────
//
// Group users by signup week (ISO week starting Monday) and report % active
// in subsequent weeks. "Active" = created any row in
// tasks/shopping/calendar/chat/documents/meals during that week. Refresh-
// token last_used_at would be cleaner but it only stores the latest use,
// not a history, so we'd lose visibility into intermediate weeks.

function weekStartMonday(isoTimestamp) {
  const d = new Date(isoTimestamp);
  d.setUTCHours(0, 0, 0, 0);
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + offsetToMon);
  return d.toISOString().slice(0, 10);
}

function addWeeksToIsoDate(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

const RETENTION_OFFSETS = [0, 1, 2, 4, 8];

async function getRetentionCohorts({ weeks = 12 } = {}, db = supabase) {
  // Pull users with signup_at within the cohort window
  const cohortWindowSince = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString();
  // Activity window extends further back so we can compute W8 retention for
  // the OLDEST cohort - it signed up `weeks` ago and we need data up to today.
  const activityWindowSince = cohortWindowSince;

  const { data: users, error: usersErr } = await db
    .from('users')
    .select('id, created_at')
    .gte('created_at', cohortWindowSince);
  if (usersErr) throw usersErr;

  const [shoppingRes, tasksRes, calendarRes, chatRes, documentsRes, mealsRes] = await Promise.all([
    db.from('shopping_items').select('added_by, created_at').gte('created_at', activityWindowSince),
    db.from('tasks').select('added_by, created_at').gte('created_at', activityWindowSince),
    db.from('calendar_events').select('created_by, created_at').gte('created_at', activityWindowSince).is('external_feed_id', null),
    db.from('chat_messages').select('user_id, created_at').gte('created_at', activityWindowSince).eq('role', 'user'),
    db.from('documents').select('uploaded_by, created_at').gte('created_at', activityWindowSince),
    db.from('meal_plan').select('added_by, created_at').gte('created_at', activityWindowSince),
  ]);

  // user_id → Set of week starts they were active in
  const userActiveWeeks = new Map();
  function noteActivity(rows, userField) {
    for (const r of rows || []) {
      const userId = r[userField];
      if (!userId || !r.created_at) continue;
      const wk = weekStartMonday(r.created_at);
      let set = userActiveWeeks.get(userId);
      if (!set) { set = new Set(); userActiveWeeks.set(userId, set); }
      set.add(wk);
    }
  }
  noteActivity(shoppingRes.data, 'added_by');
  noteActivity(tasksRes.data, 'added_by');
  noteActivity(calendarRes.data, 'created_by');
  noteActivity(chatRes.data, 'user_id');
  noteActivity(documentsRes.data, 'uploaded_by');
  noteActivity(mealsRes.data, 'added_by');

  // Group users by signup week → cohort
  const cohorts = new Map();
  for (const u of users || []) {
    const signupWk = weekStartMonday(u.created_at);
    let cohort = cohorts.get(signupWk);
    if (!cohort) {
      cohort = { signupWeek: signupWk, userIds: [], size: 0 };
      cohorts.set(signupWk, cohort);
    }
    cohort.userIds.push(u.id);
    cohort.size++;
  }

  // Compute retention at each offset. Offsets where the target week hasn't
  // happened yet (i.e. cohort is too new) are returned as null so the UI can
  // render an empty cell instead of a misleading 0%.
  const todayWk = weekStartMonday(new Date().toISOString());
  const result = [];
  for (const cohort of cohorts.values()) {
    const retention = {};
    for (const offset of RETENTION_OFFSETS) {
      const targetWk = addWeeksToIsoDate(cohort.signupWeek, offset);
      if (targetWk > todayWk) { retention[offset] = null; continue; }
      let activeCount = 0;
      for (const userId of cohort.userIds) {
        const userWeeks = userActiveWeeks.get(userId);
        if (userWeeks?.has(targetWk)) activeCount++;
      }
      retention[offset] = cohort.size > 0 ? Math.round((activeCount / cohort.size) * 100) : 0;
    }
    result.push({ signupWeek: cohort.signupWeek, size: cohort.size, retention });
  }

  result.sort((a, b) => b.signupWeek.localeCompare(a.signupWeek));
  return { offsets: RETENTION_OFFSETS, cohorts: result };
}

// ─── Revenue stats (Stripe-derived) ─────────────────────────────────────────
//
// Numbers are estimates: MRR uses fixed GBP per-plan rates (5.99/mo,
// 59.99/yr ÷ 12) regardless of the household's billing currency, because
// cross-currency conversion at the admin level isn't worth the complexity
// for a single-operator dashboard. Treat as a ballpark, not exact revenue.

const MRR_PER_PLAN_GBP = {
  monthly: 5.99,
  annual: 59.99 / 12, // ~4.9925
};

async function getRevenueStats(db = supabase) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  // 1. Active paying households (excludes internal accounts)
  const { data: activeRows } = await db
    .from('households')
    .select('subscription_plan')
    .eq('subscription_status', 'active')
    .eq('is_internal', false);

  let monthly = 0;
  let annual = 0;
  for (const h of activeRows || []) {
    if (h.subscription_plan === 'monthly') monthly++;
    else if (h.subscription_plan === 'annual') annual++;
  }
  const mrrGbp = monthly * MRR_PER_PLAN_GBP.monthly + annual * MRR_PER_PLAN_GBP.annual;

  // 2. Trial → paid conversion (last 30d):
  //    of households whose trial ended in the window, % currently active.
  const { data: endedTrials } = await db
    .from('households')
    .select('subscription_status')
    .gte('trial_ends_at', thirtyDaysAgo)
    .lte('trial_ends_at', now.toISOString())
    .eq('is_internal', false);

  const trialsEnded = (endedTrials || []).length;
  const trialsConverted = (endedTrials || []).filter((h) => h.subscription_status === 'active').length;
  const conversionPct = trialsEnded > 0 ? Math.round((trialsConverted / trialsEnded) * 100) : null;

  // 3. Churn (last 30d): cancelled households whose inactive_since lands in
  //    the window. inactive_since is written by the stripe webhook handler
  //    on customer.subscription.deleted.
  const churnRes = await db
    .from('households')
    .select('id', { count: 'exact', head: true })
    .gte('inactive_since', thirtyDaysAgo)
    .eq('subscription_status', 'cancelled');

  // 4. Net new this month: trial signups this calendar month (proxy for
  //    funnel-top growth - cleaner signal than active-conversions since
  //    those depend on a full 30-day trial having elapsed).
  const newTrialsRes = await db
    .from('households')
    .select('id', { count: 'exact', head: true })
    .gte('trial_started_at', startOfMonth)
    .eq('is_internal', false);

  return {
    activeSubscribers: monthly + annual,
    activeMonthly: monthly,
    activeAnnual: annual,
    mrrGbp: Math.round(mrrGbp * 100) / 100,
    trialsEnded,
    trialsConverted,
    conversionPct, // null when no trials ended in window
    churn30d: churnRes.count || 0,
    newTrialsThisMonth: newTrialsRes.count || 0,
  };
}

// ─── Phase 2 Admin: Per-user/household breakdowns ───────────────────────────

async function getAiUsageTopHouseholds({ days = 30, limit = 10 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('ai_usage_log')
    .select('household_id, created_at')
    .gte('created_at', since)
    .not('household_id', 'is', null);
  if (error) throw error;

  // Aggregate counts + last_used_at per household
  const stats = {};
  for (const row of data || []) {
    const s = stats[row.household_id] || { calls: 0, lastUsedAt: null };
    s.calls++;
    if (!s.lastUsedAt || row.created_at > s.lastUsedAt) s.lastUsedAt = row.created_at;
    stats[row.household_id] = s;
  }

  const sorted = Object.entries(stats).sort((a, b) => b[1].calls - a[1].calls).slice(0, limit);
  if (sorted.length === 0) return [];

  const ids = sorted.map(([id]) => id);
  const { data: households } = await db.from('households').select('id, name').in('id', ids);
  const nameMap = {};
  for (const h of households || []) nameMap[h.id] = h.name;

  return sorted.map(([id, s]) => ({
    household_id: id,
    name: nameMap[id] || 'Unknown',
    calls: s.calls,
    last_used_at: s.lastUsedAt,
  }));
}

async function getAiUsageTopUsers({ days = 30, limit = 10 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('ai_usage_log')
    .select('user_id, created_at')
    .gte('created_at', since)
    .not('user_id', 'is', null);
  if (error) throw error;

  const stats = {};
  for (const row of data || []) {
    const s = stats[row.user_id] || { calls: 0, lastUsedAt: null };
    s.calls++;
    if (!s.lastUsedAt || row.created_at > s.lastUsedAt) s.lastUsedAt = row.created_at;
    stats[row.user_id] = s;
  }

  const sorted = Object.entries(stats).sort((a, b) => b[1].calls - a[1].calls).slice(0, limit);
  if (sorted.length === 0) return [];

  const ids = sorted.map(([id]) => id);
  const { data: users } = await db.from('users').select('id, name, email').in('id', ids);
  const userMap = {};
  for (const u of users || []) userMap[u.id] = u;

  return sorted.map(([id, s]) => ({
    user_id: id,
    name: userMap[id]?.name || 'Unknown',
    email: userMap[id]?.email || '',
    calls: s.calls,
    last_used_at: s.lastUsedAt,
  }));
}

/**
 * Per-household AI usage detail: totals, daily breakdown for the last 10 days,
 * and the timestamp of the most recent call (within the window) so admins can
 * spot idle households.
 */
async function getHouseholdAiUsage(householdId, { days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('ai_usage_log')
    .select('provider, feature, latency_ms, is_failover, created_at')
    .eq('household_id', householdId)
    .gte('created_at', since);
  if (error) throw error;

  const rows = data || [];
  const byProvider = {};
  const byFeature = {};
  const byDate = {};
  let totalLatency = 0;
  let latencyCount = 0;
  let lastUsedAt = null;

  for (const r of rows) {
    byProvider[r.provider] = (byProvider[r.provider] || 0) + 1;
    byFeature[r.feature] = (byFeature[r.feature] || 0) + 1;
    if (r.latency_ms) { totalLatency += r.latency_ms; latencyCount++; }
    if (!lastUsedAt || r.created_at > lastUsedAt) lastUsedAt = r.created_at;
    const date = (r.created_at || '').slice(0, 10);
    if (date) byDate[date] = (byDate[date] || 0) + 1;
  }

  // Daily - last 10 days with zero-fill for continuous axis
  const daily = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 9; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    daily.push({ date, calls: byDate[date] || 0 });
  }

  return {
    totalCalls: rows.length,
    avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
    failoverCalls: rows.filter((r) => r.is_failover).length,
    lastUsedAt,
    byProvider,
    byFeature,
    daily,
  };
}

/**
 * Per-household product activity for the last N days, broken down by feature.
 *
 * Calendar excludes events that came in via an inbound external feed
 * (external_feed_id IS NOT NULL) — those aren't real "user activity", they're
 * pulled in by the iCal sync cron.
 *
 * Returns:
 *   {
 *     days: number,                       // window size we resolved
 *     totals: { tasks, shopping, ... },   // total creates in window
 *     daily: { tasks: [{date, count}], shopping: [...], ... }  // zero-filled
 *   }
 */
async function getHouseholdActivity(householdId, { days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [tasksRes, shoppingRes, calendarRes, documentsRes, mealsRes] = await Promise.all([
    db.from('tasks').select('created_at').eq('household_id', householdId).gte('created_at', since),
    db.from('shopping_items').select('created_at').eq('household_id', householdId).gte('created_at', since),
    db
      .from('calendar_events')
      .select('created_at')
      .eq('household_id', householdId)
      .gte('created_at', since)
      .is('external_feed_id', null),
    db.from('documents').select('created_at').eq('household_id', householdId).gte('created_at', since),
    db.from('meal_plan').select('created_at').eq('household_id', householdId).gte('created_at', since),
  ]);

  // Build zero-filled date axis covering the full window so charts have a
  // continuous x-axis even on quiet days.
  const dateAxis = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dateAxis.push(d.toISOString().slice(0, 10));
  }

  function bucketByDate(rows) {
    const byDate = {};
    for (const r of rows || []) {
      const date = (r.created_at || '').slice(0, 10);
      if (date) byDate[date] = (byDate[date] || 0) + 1;
    }
    return dateAxis.map((date) => ({ date, count: byDate[date] || 0 }));
  }

  return {
    days,
    totals: {
      tasks: tasksRes.data?.length || 0,
      shopping: shoppingRes.data?.length || 0,
      calendar: calendarRes.data?.length || 0,
      documents: documentsRes.data?.length || 0,
      meals: mealsRes.data?.length || 0,
    },
    daily: {
      tasks: bucketByDate(tasksRes.data),
      shopping: bucketByDate(shoppingRes.data),
      calendar: bucketByDate(calendarRes.data),
      documents: bucketByDate(documentsRes.data),
      meals: bucketByDate(mealsRes.data),
    },
  };
}

/**
 * Lifetime "has this user ever touched feature X" + counts. Uses head:true
 * count queries so we don't pull payloads — six counts in parallel.
 *
 * Excludes external_feed_id calendar events from the calendar count for the
 * same reason as getHouseholdActivity (those weren't created by the user).
 */
async function getUserFeatureSpread(userId, db = supabase) {
  const [calendar, shopping, tasks, chat, documents, meals] = await Promise.all([
    db.from('calendar_events').select('id', { count: 'exact', head: true }).eq('created_by', userId).is('external_feed_id', null),
    db.from('shopping_items').select('id', { count: 'exact', head: true }).eq('added_by', userId),
    db.from('tasks').select('id', { count: 'exact', head: true }).eq('added_by', userId),
    db.from('chat_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('role', 'user'),
    db.from('documents').select('id', { count: 'exact', head: true }).eq('uploaded_by', userId),
    db.from('meal_plan').select('id', { count: 'exact', head: true }).eq('added_by', userId),
  ]);

  return {
    calendar: { used: (calendar.count || 0) > 0, count: calendar.count || 0 },
    shopping: { used: (shopping.count || 0) > 0, count: shopping.count || 0 },
    tasks: { used: (tasks.count || 0) > 0, count: tasks.count || 0 },
    chat: { used: (chat.count || 0) > 0, count: chat.count || 0 },
    documents: { used: (documents.count || 0) > 0, count: documents.count || 0 },
    meals: { used: (meals.count || 0) > 0, count: meals.count || 0 },
  };
}

async function getUserUsageStats(userId, { days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [aiRes, waRes] = await Promise.all([
    db.from('ai_usage_log').select('provider, feature, latency_ms, is_failover, created_at').eq('user_id', userId).gte('created_at', since),
    db.from('whatsapp_message_log').select('direction, message_type, intent, processing_ms, error, created_at').eq('user_id', userId).gte('created_at', since),
  ]);

  const aiRows = aiRes.data || [];
  const waRows = waRes.data || [];

  // AI stats
  const aiByProvider = {};
  const aiByFeature = {};
  const aiByDate = {};
  let aiTotalLatency = 0;
  let aiLatencyCount = 0;
  let aiLastUsedAt = null;
  for (const r of aiRows) {
    aiByProvider[r.provider] = (aiByProvider[r.provider] || 0) + 1;
    aiByFeature[r.feature] = (aiByFeature[r.feature] || 0) + 1;
    if (r.latency_ms) { aiTotalLatency += r.latency_ms; aiLatencyCount++; }
    if (!aiLastUsedAt || r.created_at > aiLastUsedAt) aiLastUsedAt = r.created_at;
    const date = (r.created_at || '').slice(0, 10);
    if (date) aiByDate[date] = (aiByDate[date] || 0) + 1;
  }

  // Daily AI usage - last 10 days, including zero-call days for a continuous axis
  const dailyAi = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 9; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    dailyAi.push({ date, calls: aiByDate[date] || 0 });
  }

  // WhatsApp stats
  const waByType = {};
  const waByIntent = {};
  let waErrors = 0;
  for (const r of waRows) {
    if (r.direction === 'inbound') {
      waByType[r.message_type] = (waByType[r.message_type] || 0) + 1;
      const intent = r.intent || 'unknown';
      waByIntent[intent] = (waByIntent[intent] || 0) + 1;
    }
    if (r.error) waErrors++;
  }

  return {
    ai: {
      totalCalls: aiRows.length,
      avgLatencyMs: aiLatencyCount > 0 ? Math.round(aiTotalLatency / aiLatencyCount) : 0,
      failoverCalls: aiRows.filter((r) => r.is_failover).length,
      lastUsedAt: aiLastUsedAt,
      byProvider: aiByProvider,
      byFeature: aiByFeature,
      daily: dailyAi,
    },
    whatsapp: {
      totalMessages: waRows.length,
      inbound: waRows.filter((r) => r.direction === 'inbound').length,
      errors: waErrors,
      byType: waByType,
      byIntent: waByIntent,
    },
  };
}

// ─── Inbound Email ───────────────────────────────────────────────────────────

async function getHouseholdByInboundToken(token, db = supabase) {
  const { data, error } = await db
    .from('households')
    .select()
    .eq('inbound_email_token', token)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// Look up a household by its user-chosen email alias. Stored
// lowercase per the validator; queries here go through ilike so a
// caller that passes mixed case still matches. Returns null when no
// match (rather than throwing) so the webhook can fall back to the
// token path.
async function getHouseholdByEmailAlias(alias, db = supabase) {
  if (!alias) return null;
  const { data, error } = await db
    .from('households')
    .select()
    .ilike('email_alias', String(alias).trim())
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Update a household's email alias. Caller is responsible for
// validating the format/reserved-list (see utils/email-alias) before
// invoking. Throws on UNIQUE-constraint violation (let the route
// surface a clean "already taken" message).
async function setHouseholdEmailAlias(householdId, alias, db = supabase) {
  const value = alias == null ? null : String(alias).trim().toLowerCase() || null;
  const { data, error } = await db
    .from('households')
    .update({ email_alias: value })
    .eq('id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function isEmailAliasAvailable(alias, householdId = null, db = supabase) {
  if (!alias) return false;
  let query = db
    .from('households')
    .select('id')
    .ilike('email_alias', String(alias).trim());
  if (householdId) query = query.neq('id', householdId); // allow re-setting your own
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return (data || []).length === 0;
}

// Inbound senders allowlist - only emails on this list can have their
// forwarded mail processed for the household. Backfill populated this
// from existing member emails at migration time; new entries are
// added via the Settings UI.
async function getInboundSenders(householdId, db = supabase) {
  const { data, error } = await db
    .from('household_inbound_senders')
    .select()
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function addInboundSender(householdId, email, addedBy, db = supabase) {
  const normalised = String(email || '').trim().toLowerCase();
  if (!normalised) throw new Error('Email is required.');
  const { data, error } = await db
    .from('household_inbound_senders')
    .insert({ household_id: householdId, email: normalised, added_by: addedBy })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteInboundSender(senderId, householdId, db = supabase) {
  const { error } = await db
    .from('household_inbound_senders')
    .delete()
    .eq('id', senderId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function isInboundSenderAllowed(householdId, email, db = supabase) {
  const normalised = String(email || '').trim().toLowerCase();
  if (!normalised) return false;
  const { data, error } = await db
    .from('household_inbound_senders')
    .select('id')
    .eq('household_id', householdId)
    .ilike('email', normalised)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

// Best-effort: stamp last_used_at on a sender after we successfully
// processed mail from them. Used by the admin page to show "active"
// addresses vs ones added once and never used.
async function touchInboundSender(householdId, email, db = supabase) {
  const normalised = String(email || '').trim().toLowerCase();
  if (!normalised) return;
  await db
    .from('household_inbound_senders')
    .update({ last_used_at: new Date().toISOString() })
    .eq('household_id', householdId)
    .ilike('email', normalised);
}

async function createInboundEmailLog(householdId, fromEmail, subject, extra = {}, db = supabase) {
  // `extra` lets callers stamp the final status (+ error_message) at insert
  // time. The rejection path uses this so a blocked sender is written as
  // status:'rejected' atomically - no create-then-update window that could
  // leave the row orphaned at 'pending' (which would also hide it from the
  // rejected-sender nudge). Back-compat: callers that omit `extra` get the
  // old behaviour (status defaults to 'pending' via the column default).
  const { data, error } = await db
    .from('inbound_email_log')
    .insert({
      household_id: householdId,
      from_email: fromEmail,
      subject: subject || null,
      ...extra,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateInboundEmailLog(logId, updates, db = supabase) {
  const { data, error } = await db
    .from('inbound_email_log')
    .update(updates)
    .eq('id', logId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getRecentInboundEmails(householdId, limit = 10, db = supabase) {
  const { data, error } = await db
    .from('inbound_email_log')
    .select()
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * Distinct sender addresses whose mail was REJECTED for not being on the
 * household's allowlist, newest first. Powers the Settings "we blocked
 * mail from these addresses - allow them?" nudge so a parent forwarding
 * from an unlisted work address isn't met with silence.
 *
 * Dedupes by normalised email (the log stores the raw "Name <addr>" From),
 * so a sender who tried five times shows once. Returns at most `limit`.
 */
async function getRejectedInboundSenders(householdId, limit = 5, db = supabase) {
  const { data, error } = await db
    .from('inbound_email_log')
    .select('from_email, subject, created_at')
    .eq('household_id', householdId)
    .eq('status', 'rejected')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  const seen = new Set();
  const out = [];
  for (const row of data || []) {
    const m = String(row.from_email || '').match(/<([^>]+)>/);
    const email = (m ? m[1] : row.from_email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, subject: row.subject || null, created_at: row.created_at });
    if (out.length >= limit) break;
  }
  return out;
}

// Admin-wide view of recent inbound-email activity. Joins on
// households so the UI can show which household forwarded each email
// without firing N+1 lookups.
async function getRecentInboundEmailsAdmin({ limit = 100 } = {}, db = supabase) {
  const cap = Math.min(Math.max(1, limit), 500);
  const { data, error } = await db
    .from('inbound_email_log')
    .select('*, households!inner(id, name)')
    .order('created_at', { ascending: false })
    .limit(cap);
  if (error) throw error;
  return (data || []).map((row) => ({
    ...row,
    household_name: row.households?.name,
    households: undefined,
  }));
}

async function getInboundEmailLogByUndoToken(undoToken, db = supabase) {
  const { data, error } = await db
    .from('inbound_email_log')
    .select()
    .eq('undo_token', undoToken)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function checkDuplicateEmail(householdId, fromEmail, subject, withinMinutes = 5, db = supabase) {
  // Only dedup against successfully completed emails within 5 minutes
  // (catches genuine double-sends from email clients, but allows re-forwards)
  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('inbound_email_log')
    .select('id')
    .eq('household_id', householdId)
    .eq('from_email', fromEmail)
    .eq('subject', subject)
    .eq('status', 'completed')
    .gte('created_at', cutoff)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

// ─── Event Reminders ─────────────────────────────────────────────────────────

/**
 * Convert a reminder offset ({time, unit}) to milliseconds.
 */
function reminderOffsetToMs(time, unit) {
  const t = parseInt(time, 10);
  if (isNaN(t) || t <= 0) return 0;
  switch (unit) {
    case 'minutes': return t * 60 * 1000;
    case 'hours':   return t * 60 * 60 * 1000;
    case 'days':    return t * 24 * 60 * 60 * 1000;
    case 'weeks':   return t * 7 * 24 * 60 * 60 * 1000;
    default:        return 0;
  }
}

/**
 * Save reminders for a calendar event.
 * Deletes existing reminders first (safe for both create and edit).
 */
async function saveEventReminders(eventId, householdId, reminders, eventStartTime, db = supabase) {
  // Delete existing reminders for this event
  const { error: deleteErr } = await db
    .from('event_reminders')
    .delete()
    .eq('event_id', eventId);
  if (deleteErr) throw deleteErr;

  if (!reminders || !Array.isArray(reminders) || reminders.length === 0) return [];

  const eventStart = new Date(eventStartTime);
  const rows = reminders
    .map((r) => {
      const offsetMs = reminderOffsetToMs(r.time, r.unit);
      if (offsetMs <= 0) return null;
      const remindAt = new Date(eventStart.getTime() - offsetMs);
      const offsetLabel = `${r.time} ${r.unit}`;
      return {
        event_id: eventId,
        household_id: householdId,
        remind_at: remindAt.toISOString(),
        reminder_offset: offsetLabel,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) return [];

  const { data, error } = await db
    .from('event_reminders')
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}

/**
 * Save assignees for a calendar event.
 * Deletes existing assignees first (safe for both create and edit).
 */
async function saveEventAssignees(eventId, householdId, memberNames, members, db = supabase) {
  // Delete existing assignees for this event
  const { error: deleteErr } = await db
    .from('event_assignees')
    .delete()
    .eq('event_id', eventId);
  if (deleteErr) throw deleteErr;

  if (!memberNames || !Array.isArray(memberNames) || memberNames.length === 0) return [];

  // If members list not provided, fetch from household
  const memberList = members || await getHouseholdMembers(householdId, db);

  const rows = memberNames
    .map((name) => {
      const member = memberList.find((m) => m.name.toLowerCase() === name.toLowerCase());
      if (!member) return null;
      return {
        event_id: eventId,
        member_id: member.id,
        member_name: member.name,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) return [];

  const { data, error } = await db
    .from('event_assignees')
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}

/**
 * Get pending reminders that are due to be sent.
 * Joins with calendar_events and event_assignees.
 */
async function getPendingReminders(db = supabase) {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('event_reminders')
    .select(`
      id,
      event_id,
      household_id,
      remind_at,
      reminder_offset,
      calendar_events!inner (
        id,
        title,
        start_time,
        end_time,
        household_id,
        deleted_at
      )
    `)
    .eq('sent', false)
    .lte('remind_at', now)
    .is('calendar_events.deleted_at', null);
  if (error) throw error;
  return data || [];
}

/**
 * Mark a reminder as sent.
 */
async function markReminderSent(reminderId, db = supabase) {
  const { error } = await db
    .from('event_reminders')
    .update({ sent: true })
    .eq('id', reminderId);
  if (error) throw error;
}

/**
 * Atomically claim an event reminder for sending.
 *
 * Flips sent: false → true in a single UPDATE conditioned on the row
 * still being unsent. Returns true if this caller won the claim,
 * false if another process beat us to it. Use this *before* dispatching
 * the WhatsApp message so concurrent cron runs (multiple API replicas,
 * deploy overlaps) can't send the same reminder twice.
 */
async function claimEventReminder(reminderId, db = supabase) {
  const { data, error } = await db
    .from('event_reminders')
    .update({ sent: true })
    .eq('id', reminderId)
    .eq('sent', false)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Atomically claim a task notification for sending.
 * Same pattern as claimEventReminder but for tasks.notification_sent_at.
 */
async function claimTaskNotification(taskId, sentAt, db = supabase) {
  const { data, error } = await db
    .from('tasks')
    .update({ notification_sent_at: sentAt })
    .eq('id', taskId)
    .is('notification_sent_at', null)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Get assignees for a specific event.
 */
async function getEventAssignees(eventId, db = supabase) {
  const { data, error } = await db
    .from('event_assignees')
    .select('id, event_id, member_id, member_name')
    .eq('event_id', eventId);
  if (error) throw error;
  return data || [];
}

/**
 * Get assignees for multiple events in a single query.
 */
async function getEventAssigneesBatch(eventIds, db = supabase) {
  if (!eventIds || eventIds.length === 0) return [];
  const { data, error } = await db
    .from('event_assignees')
    .select('id, event_id, member_id, member_name')
    .in('event_id', eventIds);
  if (error) throw error;
  return data || [];
}

/**
 * Batch-fetch reminders for the given event IDs and return them in the
 * shape the frontend uses ({time, unit}). The DB stores reminder_offset
 * as a label like "10 minutes" - we parse it back so the Edit Event
 * modal can match the value against its preset dropdown.
 *
 * Real bug this exists to fix: saveEventReminders writes the row fine,
 * but the /month endpoint never joined reminders onto the events, so
 * the modal opened with formReminders = [] regardless of what was
 * actually saved. Users saw "+ Add notification" on an event that
 * already HAS a notification.
 */
async function getEventRemindersBatch(eventIds, db = supabase) {
  if (!eventIds || eventIds.length === 0) return [];
  const { data, error } = await db
    .from('event_reminders')
    .select('id, event_id, reminder_offset, remind_at, sent')
    .in('event_id', eventIds);
  if (error) throw error;
  // Parse "10 minutes" -> {time: 10, unit: "minutes"}. reminder_offset
  // is the source of truth (set by saveEventReminders via offsetLabel).
  // Anything we can't parse, we skip - the row still fires on schedule
  // because the scheduler uses remind_at, but the UI just won't show it.
  return (data || []).map((row) => {
    const parsed = parseReminderOffsetLabel(row.reminder_offset);
    if (!parsed) return null;
    return {
      id: row.id,
      event_id: row.event_id,
      time: parsed.time,
      unit: parsed.unit,
      remind_at: row.remind_at,
      sent: row.sent,
    };
  }).filter(Boolean);
}

// "10 minutes" -> {time: 10, unit: "minutes"}. Mirror of the labelling
// done by saveEventReminders. Accepts singular and plural unit words.
function parseReminderOffsetLabel(label) {
  if (typeof label !== 'string') return null;
  const m = label.trim().match(/^(\d+)\s+(min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks)$/i);
  if (!m) return null;
  const time = parseInt(m[1], 10);
  if (!Number.isFinite(time) || time <= 0) return null;
  const unitWord = m[2].toLowerCase();
  let unit;
  if (unitWord.startsWith('min')) unit = 'minutes';
  else if (unitWord.startsWith('hr') || unitWord.startsWith('hour')) unit = 'hours';
  else if (unitWord.startsWith('day')) unit = 'days';
  else if (unitWord.startsWith('week')) unit = 'weeks';
  else return null;
  return { time, unit };
}

/**
 * Attempt to acquire a scheduler lock for a given key and date.
 * Returns true if the lock was acquired (i.e. first caller), false if it already existed.
 * Uses INSERT ... ON CONFLICT DO NOTHING to ensure only one instance sends.
 */
async function acquireSchedulerLock(lockKey, lockDate) {
  const { data, error } = await supabase
    .from('scheduler_locks')
    .insert({ lock_key: lockKey, lock_date: lockDate })
    .select();
  if (error) {
    // Unique constraint violation means another instance already sent
    if (error.code === '23505') return false;
    // Table doesn't exist yet - allow sending (don't block notifications)
    if (error.code === '42P01') return true;
    console.error('[scheduler-lock] Error:', error.message);
    return true; // On unknown errors, allow sending (fail open)
  }
  return data && data.length > 0;
}

/**
 * Clean up old scheduler locks (older than 7 days).
 */
async function cleanupSchedulerLocks() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  await supabase
    .from('scheduler_locks')
    .delete()
    .lt('lock_date', cutoff.toISOString().split('T')[0]);
}

// ─── Documents ────────────────────────────────────────────────────────────────

async function createDocumentFolder(householdId, { name, visibility = 'shared', created_by, parent_folder_id = null, color = '#6B3FA0', icon = 'folder' }) {
  const { data, error } = await supabase
    .from('document_folders')
    .insert({ household_id: householdId, name, visibility, created_by, parent_folder_id, color, icon })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getDocumentFolders(householdId, userId, parentFolderId = null) {
  let query = supabase
    .from('document_folders')
    .select('*, documents:documents(id)')
    .eq('household_id', householdId)
    .order('name');

  if (parentFolderId) {
    query = query.eq('parent_folder_id', parentFolderId);
  } else {
    query = query.is('parent_folder_id', null);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Filter: shared folders visible to all, private only to creator
  return (data || [])
    .filter(f => f.visibility === 'shared' || f.created_by === userId)
    .map(f => ({ ...f, file_count: f.documents?.length || 0, documents: undefined }));
}

async function getDocumentFolderById(folderId, householdId) {
  const { data, error } = await supabase
    .from('document_folders')
    .select()
    .eq('id', folderId)
    .eq('household_id', householdId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function updateDocumentFolder(folderId, householdId, updates) {
  const allowed = {};
  if (updates.name !== undefined) allowed.name = updates.name;
  if (updates.visibility !== undefined) allowed.visibility = updates.visibility;
  if (updates.color !== undefined) allowed.color = updates.color;
  if (updates.icon !== undefined) allowed.icon = updates.icon;
  if (updates.parent_folder_id !== undefined) allowed.parent_folder_id = updates.parent_folder_id;

  const { data, error } = await supabase
    .from('document_folders')
    .update(allowed)
    .eq('id', folderId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteDocumentFolder(folderId, householdId) {
  const { error } = await supabase
    .from('document_folders')
    .delete()
    .eq('id', folderId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function createDocument(householdId, { name, file_path, file_size, mime_type, uploaded_by, folder_id = null }) {
  const { data, error } = await supabase
    .from('documents')
    .insert({ household_id: householdId, name, file_path, file_size, mime_type, uploaded_by, folder_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getDocuments(householdId, userId, folderId = null) {
  let query = supabase
    .from('documents')
    .select('*, folder:document_folders(id, visibility, created_by)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false });

  if (folderId) {
    query = query.eq('folder_id', folderId);
  } else {
    query = query.is('folder_id', null);
  }

  const { data, error } = await query;
  if (error) throw error;

  // Filter: docs in private folders only visible to folder creator
  return (data || []).filter(doc => {
    if (!doc.folder) return true; // root-level docs visible to all
    return doc.folder.visibility === 'shared' || doc.folder.created_by === userId;
  });
}

async function getDocumentById(docId, householdId) {
  const { data, error } = await supabase
    .from('documents')
    .select('*, folder:document_folders(id, visibility, created_by)')
    .eq('id', docId)
    .eq('household_id', householdId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function updateDocument(docId, householdId, updates) {
  const allowed = {};
  if (updates.name !== undefined) allowed.name = updates.name;
  if (updates.folder_id !== undefined) allowed.folder_id = updates.folder_id;

  const { data, error } = await supabase
    .from('documents')
    .update(allowed)
    .eq('id', docId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteDocument(docId, householdId) {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', docId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function getDocumentsByFolderIds(folderIds) {
  if (!folderIds.length) return [];
  const { data, error } = await supabase
    .from('documents')
    .select('id, file_path')
    .in('folder_id', folderIds);
  if (error) throw error;
  return data || [];
}

/**
 * Append one row to the document audit log.
 *
 * Called from the route that issues signed download URLs - every time a
 * user actively requests a document, we record who, what, when, and from
 * where. Failures are swallowed by the caller (logging shouldn't block
 * the actual download), but we still throw on real DB errors so they
 * surface in Railway.
 */
async function logDocumentAccess({ documentId, householdId, userId, action = 'download', ip = null, userAgent = null }) {
  const { error } = await supabase
    .from('document_access_log')
    .insert({
      document_id:  documentId,
      household_id: householdId,
      user_id:      userId,
      action,
      ip,
      user_agent:   userAgent,
    });
  if (error) throw error;
}

/**
 * Per-document access history. Newest rows first. Joined to users so the
 * caller doesn't need a follow-up query for each row.
 */
async function getDocumentAccessLog(documentId, householdId, limit = 50) {
  const { data, error } = await supabase
    .from('document_access_log')
    .select('id, action, ip, user_agent, created_at, user:users(id, name, email)')
    .eq('document_id', documentId)
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Gather data for the setup-completion nudge: every WhatsApp-linked member,
 * with their household's raw setup signals and whether they have the iOS app
 * installed (for channel routing). The caller computes gaps + filters with
 * detectSetupGaps(). Per-household signals are computed once and shared.
 *
 * @returns {Promise<Array<{ userId, name, householdId, whatsappPhone, hasApp,
 *   household: { hasCalendarFeeds, hasSchools, hasAddress, hasChildren } }>>}
 */
async function getSetupNudgeCandidates(db = supabase) {
  const { data: members, error } = await db
    .from('users')
    .select('id, name, household_id, whatsapp_phone, whatsapp_linked, whatsapp_last_inbound_at')
    .eq('whatsapp_linked', true)
    .not('household_id', 'is', null);
  if (error) throw error;
  if (!members || members.length === 0) return [];

  const householdIds = [...new Set(members.map((m) => m.household_id))];

  // Per-household setup signals, computed once.
  const signals = new Map();
  await Promise.all(householdIds.map(async (hid) => {
    const [household, feeds, schools, allMembers] = await Promise.all([
      getHouseholdById(hid, db).catch(() => null),
      getExternalFeedsByHousehold(hid, db).catch(() => []),
      getHouseholdSchools(hid, db).catch(() => []),
      getHouseholdMembers(hid, db).catch(() => []),
    ]);
    signals.set(hid, {
      hasCalendarFeeds: Array.isArray(feeds) && feeds.length > 0,
      hasSchools: Array.isArray(schools) && schools.length > 0,
      hasAddress: !!(household && household.address && String(household.address).trim()),
      hasChildren: (allMembers || []).some((m) => m.member_type === 'dependent'),
      memberCount: (allMembers || []).length,
    });
  }));

  // Channel routing: does each member have the iOS app installed?
  return Promise.all(members.map(async (m) => {
    const tokens = await getActiveDeviceTokens(m.id).catch(() => []);
    const hasApp = Array.isArray(tokens) && tokens.some((t) => t.platform === 'ios');
    return {
      userId: m.id,
      name: m.name,
      householdId: m.household_id,
      whatsappPhone: m.whatsapp_phone,
      whatsappLastInboundAt: m.whatsapp_last_inbound_at || null,
      hasApp,
      household: signals.get(m.household_id),
    };
  }));
}

/**
 * Recent document activity across the whole household. Powers the
 * "Who's been opening what?" admin view. Joined to documents and users
 * so the UI can show file names and member names without N+1 lookups.
 */
async function getRecentDocumentActivity(householdId, limit = 50) {
  const { data, error } = await supabase
    .from('document_access_log')
    .select('id, action, ip, user_agent, created_at, document:documents(id, name), user:users(id, name, email)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * Get all descendant folder IDs (including the given folder) using iterative BFS.
 */
async function getDescendantFolderIds(folderId) {
  const allIds = [folderId];
  let currentIds = [folderId];

  while (currentIds.length > 0) {
    const { data, error } = await supabase
      .from('document_folders')
      .select('id')
      .in('parent_folder_id', currentIds);
    if (error) throw error;
    if (!data || data.length === 0) break;
    const childIds = data.map(f => f.id);
    allIds.push(...childIds);
    currentIds = childIds;
  }

  return allIds;
}

/**
 * Get storage usage for a household (total bytes and file count).
 */
async function getHouseholdStorageUsage(householdId) {
  const { data, error } = await supabase
    .from('documents')
    .select('file_size')
    .eq('household_id', householdId);
  if (error) throw error;
  const totalBytes = (data || []).reduce((sum, d) => sum + (d.file_size || 0), 0);
  return { totalBytes, fileCount: (data || []).length };
}

// ─── Device Tokens & Notification Preferences ──────────────────────────────

async function registerDeviceToken(userId, householdId, token, platform = 'ios', appVersion = null) {
  const baseRow = {
    user_id: userId,
    household_id: householdId,
    token,
    platform,
    active: true,
    updated_at: new Date(),
  };
  // Only overwrite app_version when the client actually reported one, so a
  // re-register from an older client that omits the header doesn't blank it.
  const row = appVersion ? { ...baseRow, app_version: appVersion } : baseRow;
  let { data, error } = await supabase
    .from('device_tokens')
    .upsert(row, { onConflict: 'token' })
    .select()
    .single();
  // Pre-migration fallback: retry without app_version so push registration
  // never breaks while the migration is pending.
  if (error && isMissingColumnError(error) && appVersion) {
    ({ data, error } = await supabase
      .from('device_tokens')
      .upsert(baseRow, { onConflict: 'token' })
      .select()
      .single());
  }
  if (error) throw error;
  return data;
}

async function unregisterDeviceToken(token) {
  const { data, error } = await supabase
    .from('device_tokens')
    .update({ active: false, updated_at: new Date() })
    .eq('token', token)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getActiveDeviceTokens(userId) {
  const { data, error } = await supabase
    .from('device_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true);
  if (error) throw error;
  return data;
}

// All device tokens for a user, active AND inactive, newest first. For the
// admin push diagnostic - lets us see whether the current device registered
// (a recent updated_at) versus a pile of stale ghosts.
async function getDeviceTokensForUserAdmin(userId) {
  const { data, error } = await supabase
    .from('device_tokens')
    // select('*') so this never breaks if app_version doesn't exist yet
    // (migration pending); app_version flows through once the column is added.
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getHouseholdDeviceTokens(householdId, excludeUserId = null) {
  let query = supabase
    .from('device_tokens')
    .select('*')
    .eq('household_id', householdId)
    .eq('active', true);
  if (excludeUserId) {
    query = query.neq('user_id', excludeUserId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function getNotificationPreferences(userId) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function upsertNotificationPreferences(userId, prefs) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert(
      {
        user_id: userId,
        ...prefs,
        updated_at: new Date(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Announcements (admin email broadcaster) ─────────────────────────────

/**
 * Resolve the user list for an announcement audience tag. Returns
 * { user_id, email, name } rows ready for the recipients table. Drops
 * users without an email or whose email hasn't been verified - both
 * deliverability and compliance want only opted-in addresses.
 */
async function resolveAnnouncementAudience(audience, db = supabase) {
  if (audience === 'ios_users') {
    // Distinct user IDs with an active iOS device token. The join is
    // done client-side because Supabase's JS client makes the nested
    // PostgREST filter awkward for "users with at least one row in X".
    const { data: tokenRows, error: tokenErr } = await db
      .from('device_tokens')
      .select('user_id')
      .eq('platform', 'ios')
      .eq('active', true);
    if (tokenErr) throw tokenErr;
    const userIds = [...new Set((tokenRows || []).map(r => r.user_id))];
    if (userIds.length === 0) return [];
    const { data, error } = await db
      .from('users')
      .select('id, email, name')
      .in('id', userIds)
      .not('email', 'is', null)
      .eq('email_verified', true);
    if (error) throw error;
    return (data || []).map(u => ({ user_id: u.id, email: u.email, name: u.name || '' }));
  }
  if (audience === 'admins_only') {
    const { data, error } = await db
      .from('users')
      .select('id, email, name')
      .eq('role', 'admin')
      .not('email', 'is', null)
      .eq('email_verified', true);
    if (error) throw error;
    return (data || []).map(u => ({ user_id: u.id, email: u.email, name: u.name || '' }));
  }
  if (audience === 'platform_admin') {
    // Self-test audience: platform admins only. Lets the operator dry-run
    // a broadcast against their own inbox before committing to the real
    // audience. Email-verified filter still applies so a misconfigured
    // admin account doesn't break the send loop.
    const { data, error } = await db
      .from('users')
      .select('id, email, name')
      .eq('is_platform_admin', true)
      .not('email', 'is', null)
      .eq('email_verified', true);
    if (error) throw error;
    return (data || []).map(u => ({ user_id: u.id, email: u.email, name: u.name || '' }));
  }
  // Default: all_verified - every verified-email user, dependents/
  // children with no email are filtered out via the email IS NOT NULL
  // predicate.
  const { data, error } = await db
    .from('users')
    .select('id, email, name')
    .not('email', 'is', null)
    .eq('email_verified', true);
  if (error) throw error;
  return (data || []).map(u => ({ user_id: u.id, email: u.email, name: u.name || '' }));
}

/**
 * Create a draft announcement + insert one pending recipient row per
 * resolved audience member. Returns the announcement row with the
 * recipient_count populated. Send is a separate step (sendAnnouncement
 * below) so the admin can preview the audience size before committing.
 */
async function createAnnouncement({ subject, html, audience, createdBy }, db = supabase) {
  const recipients = await resolveAnnouncementAudience(audience, db);
  const { data: announcement, error: insertErr } = await db
    .from('announcements')
    .insert({
      subject,
      html,
      audience,
      created_by: createdBy || null,
      recipient_count: recipients.length,
    })
    .select()
    .single();
  if (insertErr) throw insertErr;
  if (recipients.length > 0) {
    const rows = recipients.map(r => ({
      announcement_id: announcement.id,
      user_id: r.user_id,
      email: r.email,
    }));
    const { error: recipErr } = await db
      .from('announcement_recipients')
      .insert(rows);
    if (recipErr) throw recipErr;
  }
  return { ...announcement, recipientPreview: recipients.slice(0, 5) };
}

async function getAnnouncementById(id, db = supabase) {
  const { data, error } = await db
    .from('announcements')
    .select()
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function listAnnouncements({ limit = 50 } = {}, db = supabase) {
  const { data, error } = await db
    .from('announcements')
    .select()
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getPendingRecipients(announcementId, db = supabase) {
  const { data, error } = await db
    .from('announcement_recipients')
    .select('id, user_id, email')
    .eq('announcement_id', announcementId)
    .is('sent_at', null)
    .is('error', null);
  if (error) throw error;
  return data || [];
}

async function markRecipientSent(recipientId, db = supabase) {
  const { error } = await db
    .from('announcement_recipients')
    .update({ sent_at: new Date().toISOString(), error: null })
    .eq('id', recipientId);
  if (error) throw error;
}

async function markRecipientFailed(recipientId, errorMsg, db = supabase) {
  const { error } = await db
    .from('announcement_recipients')
    .update({ sent_at: null, error: String(errorMsg).slice(0, 500) })
    .eq('id', recipientId);
  if (error) throw error;
}

async function markAnnouncementSendStarted(id, db = supabase) {
  const { error } = await db
    .from('announcements')
    .update({ sent_started_at: new Date().toISOString() })
    .eq('id', id)
    .is('sent_started_at', null); // only set once
  if (error) throw error;
}

async function markAnnouncementSendCompleted(id, { successCount, failureCount }, db = supabase) {
  const { error } = await db
    .from('announcements')
    .update({
      sent_completed_at: new Date().toISOString(),
      success_count: successCount,
      failure_count: failureCount,
    })
    .eq('id', id);
  if (error) throw error;
}

// ─── Stripe / subscription ───────────────────────────────────────────────────

/**
 * Update the subscription fields on a household. Allowed fields are
 * whitelisted here so a buggy or malicious caller can't reach outside
 * billing state (e.g. set `role` or `email`). All five writable
 * subscription columns defined in migration-subscription-trial.sql are
 * accepted - trial_started_at / trial_ends_at are deliberately excluded
 * (only the signup flow or admin tools should touch those).
 */
async function updateHouseholdSubscription(householdId, fields, db = supabase) {
  const ALLOWED = new Set([
    'subscription_status',
    'stripe_customer_id',
    'stripe_subscription_id',
    'subscription_plan',
    // Multi-currency Tier 1 - written by the Stripe webhook handler from
    // the Price object's currency (lowercase ISO-4217). Drives the in-app
    // Settings → Plan card so non-GBP subscribers see their actual
    // currency rather than a hardcoded £ figure.
    'subscription_currency',
    'subscription_current_period_end',
    // Phase 8 - retention clock. Set on trial-expiry / subscription-cancel;
    // cleared (to null) on resubscription. The cleanup cron (not yet
    // built) queries this column.
    'inactive_since',
    // IAP / RevenueCat (Phase 1 of the iOS IAP rebuild). 'stripe' on every
    // pre-IAP household; flips to 'apple' the first time we see a
    // RevenueCat webhook for that household. The app_user_id is what
    // RevenueCat echoes in every webhook payload - gives us O(1) lookup
    // when the app_user_id ≠ household_id (alias merges, etc).
    'subscription_provider',
    'revenuecat_app_user_id',
  ]);
  const clean = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (ALLOWED.has(k)) clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return null;
  const { data, error } = await db
    .from('households')
    .update(clean)
    .eq('id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function findHouseholdByStripeCustomerId(customerId, db = supabase) {
  const { data, error } = await db
    .from('households')
    .select()
    .eq('stripe_customer_id', customerId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function findHouseholdByStripeSubscriptionId(subscriptionId, db = supabase) {
  const { data, error } = await db
    .from('households')
    .select()
    .eq('stripe_subscription_id', subscriptionId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// ─── Trial email cron helpers (Phase 7) ──────────────────────────────────

/**
 * Record that an email of the given type has been sent to a household.
 * Returns true if the INSERT succeeded (first time we've sent this),
 * false if it conflicted (already sent - caller should skip the send).
 *
 * The unique (household_id, email_type) constraint on sent_emails
 * makes this a race-safe idempotency gate - two concurrent scheduler
 * runs attempting the same send can't both INSERT, so they can't both
 * proceed.
 */
async function markEmailSentIfNew(householdId, emailType, db = supabase) {
  const { error } = await db
    .from('sent_emails')
    .insert({ household_id: householdId, email_type: emailType });
  if (error) {
    if (error.code === '23505') return false; // unique_violation - already sent
    throw error;
  }
  return true;
}

/**
 * Find all households whose trial is at the given integer day-count.
 * "Day N of a 30-day trial" means NOW() is in the 24-hour window
 * starting at `trial_started_at + (N-1) days`. Boundaries are half-open
 * so [day 20, day 21) covers exactly one calendar day's worth of
 * households - matches once-per-day cron semantics.
 *
 * Filters:
 *   • subscription_status = 'trialing' (day 20/25/28 only fire while
 *     the trial is still running; if the user subscribed mid-trial
 *     they're 'active' and we skip them)
 *   • is_internal = false (internal accounts never get nudges)
 *   • subscription_provider != 'apple' (Apple subscribers get Apple's
 *     own renewal/expiry emails, and our nudge emails point at the
 *     web subscribe page which has different pricing - sending both
 *     creates conflicting messages. By design, an Apple subscriber
 *     would never be 'trialing' anyway, but the filter is defensive
 *     against any future state where the two could co-exist).
 *
 * Returns household rows joined with the primary contact email (the
 * household's creator / admin user).
 */
async function findHouseholdsAtTrialDay(dayNumber, db = supabase) {
  // 1-indexed day: day 1 = first 24h of trial. For day N, the window is
  // trial_started_at + (N-1 days, N days).
  const now = new Date();
  const windowStart = new Date(now.getTime() - dayNumber * 86_400_000).toISOString();
  const windowEnd   = new Date(now.getTime() - (dayNumber - 1) * 86_400_000).toISOString();

  const { data, error } = await db
    .from('households')
    .select('id, name, trial_started_at, trial_ends_at, subscription_status, trial_emails_enabled, is_internal, subscription_provider')
    .eq('subscription_status', 'trialing')
    .eq('is_internal', false)
    .neq('subscription_provider', 'apple')
    .gte('trial_started_at', windowStart)
    .lt('trial_started_at', windowEnd);
  if (error) throw error;
  return data || [];
}

/**
 * Find households whose trial has just expired. Used by the day-30
 * expired email. Unlike the nudges, this one fires AFTER the trial
 * ends - we look for households whose trial_ends_at crossed into the
 * past within the last 24 hours.
 *
 * Covers both statuses:
 *   • 'expired' - the subscription gate has already flipped them
 *   • 'trialing' - trial_ends_at is past but no mutation has touched
 *     the gate yet, so status hasn't been flipped. We still email them.
 *
 * Excludes 'active' (they subscribed) and 'cancelled' (they had a
 * subscription that was later cancelled - different email).
 */
async function findHouseholdsWithExpiredTrial(db = supabase) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 86_400_000).toISOString();
  const windowEnd   = now.toISOString();

  const { data, error } = await db
    .from('households')
    .select('id, name, trial_started_at, trial_ends_at, subscription_status, is_internal, subscription_provider')
    .in('subscription_status', ['expired', 'trialing'])
    .eq('is_internal', false)
    // Apple subscribers get Apple's expiry / billing-issue emails directly;
    // our day-30 email would point them at housemait.com/subscribe with web
    // pricing and a different cancel flow. Defensive against impossible
    // states like provider='apple' + status='trialing' (see findHouseholdsAtTrialDay).
    .neq('subscription_provider', 'apple')
    .gte('trial_ends_at', windowStart)
    .lt('trial_ends_at', windowEnd);
  if (error) throw error;
  return data || [];
}

/**
 * Get the admin user's email for a household - the default recipient
 * for subscription lifecycle emails. Prefers the first admin (typically
 * the household creator) and falls back to any account member with an
 * email set. Returns null if the household has no reachable members
 * (dependents-only household, or admins with no email column).
 */
async function getHouseholdPrimaryContact(householdId, db = supabase) {
  const { data, error } = await db
    .from('users')
    .select('id, name, email, role, member_type, created_at')
    .eq('household_id', householdId)
    .eq('member_type', 'account')
    .not('email', 'is', null)
    .order('role', { ascending: false })      // 'admin' > 'member' alphabetically
    .order('created_at', { ascending: true }); // oldest admin first
  if (error) throw error;
  return (data || []).find((u) => !!u.email) || null;
}

/**
 * Fetch the usage counts the nudge emails personalise on. Parallel
 * count-head queries - identical pattern to the usage-summary
 * endpoint on /api/household/usage-summary.
 */
async function getHouseholdUsageCounts(householdId, db = supabase) {
  async function count(table, filter) {
    let q = db.from(table).select('*', { count: 'exact', head: true }).eq('household_id', householdId);
    if (filter) q = filter(q);
    const { count: c, error } = await q;
    if (error) {
      console.warn(`[usage-counts] ${table} failed:`, error.message);
      return 0;
    }
    return c ?? 0;
  }
  const [
    shopping_item_count, task_count, calendar_event_count,
    meal_plan_count, member_count,
  ] = await Promise.all([
    count('shopping_items'),
    count('tasks'),
    count('calendar_events', (q) => q.is('deleted_at', null)),
    count('meal_plan'),
    count('users'),
  ]);
  return { shopping_item_count, task_count, calendar_event_count, meal_plan_count, member_count };
}

/**
 * Flip trial_emails_enabled. Used by the unsubscribe route (set to false)
 * and the Settings toggle (either direction).
 */
async function setTrialEmailsEnabled(householdId, enabled, db = supabase) {
  const { data, error } = await db
    .from('households')
    .update({ trial_emails_enabled: !!enabled })
    .eq('id', householdId)
    .select('id, trial_emails_enabled')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Idempotency gate for Stripe webhooks. Attempts to insert the event_id;
 * returns true if this is a new event we should process, false if we've
 * already handled it.
 *
 * The unique PRIMARY KEY on event_id gives us atomic dedup - two parallel
 * deliveries of the same event_id race on INSERT and exactly one wins.
 */
async function recordStripeEventIfNew(eventId, eventType, db = supabase) {
  const { error } = await db
    .from('processed_stripe_events')
    .insert({ event_id: eventId, event_type: eventType });
  if (error) {
    // 23505 = unique_violation - this event has already been processed.
    if (error.code === '23505') return false;
    throw error;
  }
  return true;
}

/**
 * Remove a processed-event marker so Stripe's retry can reprocess it.
 * Used when an event handler fails AFTER the idempotency row was written:
 * without this, the failed event would be permanently stuck.
 */
async function deleteProcessedStripeEvent(eventId, db = supabase) {
  const { error } = await db
    .from('processed_stripe_events')
    .delete()
    .eq('event_id', eventId);
  if (error) throw error;
}

// ─── RevenueCat / IAP webhook helpers ────────────────────────────────────

/**
 * Idempotency gate for RevenueCat webhooks. Mirrors recordStripeEventIfNew.
 * RevenueCat retries non-2xx events for 72h with exponential backoff, so
 * dedup is essential. The unique PRIMARY KEY on event_id gives us atomic
 * dedup - two parallel deliveries race on INSERT and exactly one wins.
 */
async function recordRevenuecatEventIfNew(eventId, eventType, appUserId, db = supabase) {
  const { error } = await db
    .from('processed_revenuecat_events')
    .insert({ event_id: eventId, event_type: eventType, app_user_id: appUserId });
  if (error) {
    if (error.code === '23505') return false; // already processed
    throw error;
  }
  return true;
}

/**
 * Remove a processed-event marker so RevenueCat's retry can reprocess it.
 * Used when an event handler fails AFTER the idempotency row was written.
 */
async function deleteProcessedRevenuecatEvent(eventId, db = supabase) {
  const { error } = await db
    .from('processed_revenuecat_events')
    .delete()
    .eq('event_id', eventId);
  if (error) throw error;
}

/**
 * Find a household by its RevenueCat app_user_id. Used by the webhook
 * handler when app_user_id isn't a valid household UUID - happens when:
 *   • RevenueCat anonymous IDs ($RCAnonymousID:...) were issued before
 *     the app called Purchases.logIn(householdId).
 *   • A SUBSCRIBER_ALIAS event remapped one user_id to another.
 *
 * In the happy path (logIn called early on app launch) app_user_id IS
 * the household id, so we try getHouseholdById first and fall back here.
 */
async function findHouseholdByRevenuecatAppUserId(appUserId, db = supabase) {
  if (!appUserId) return null;
  const { data, error } = await db
    .from('households')
    .select()
    .eq('revenuecat_app_user_id', appUserId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

// ─── Household subscriptions (Netflix, Spotify, etc.) ────────────────────────
//
// Tracked so the bot can nudge a few days before each renewal. All
// chat-managed - no Settings UI in v1.

async function listSubscriptions(householdId, db = supabase) {
  const { data, error } = await db
    .from('household_subscriptions')
    .select()
    .eq('household_id', householdId)
    .order('next_renewal_at');
  if (error) throw error;
  return data || [];
}

async function createSubscription(householdId, fields, userId, db = supabase) {
  const row = {
    household_id: householdId,
    name: fields.name,
    amount: fields.amount ?? null,
    currency: fields.currency || null,
    recurrence: fields.recurrence || 'monthly',
    renewal_day_of_month: fields.renewal_day_of_month ?? null,
    renewal_month: fields.renewal_month ?? null,
    next_renewal_at: fields.next_renewal_at,
    notes: fields.notes || null,
    created_by: userId || null,
  };
  const { data, error } = await db
    .from('household_subscriptions')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Find best-match subscription by fuzzy name match. Case-insensitive
 *  substring on either side. Returns the first hit ordered by next
 *  renewal date (earliest first) so "cancel Netflix" hits the soonest. */
async function findSubscriptionByName(householdId, name, db = supabase) {
  const all = await listSubscriptions(householdId, db);
  const needle = String(name || '').toLowerCase().trim();
  if (!needle) return null;
  return all.find((s) => {
    const haystack = String(s.name || '').toLowerCase();
    return haystack.includes(needle) || needle.includes(haystack);
  }) || null;
}

async function deleteSubscription(id, householdId, db = supabase) {
  const { error } = await db
    .from('household_subscriptions')
    .delete()
    .eq('id', id)
    .eq('household_id', householdId);
  if (error) throw error;
}

/** Rows whose next_renewal_at is between two YYYY-MM-DD strings
 *  (inclusive). Used by the daily nudge cron. */
async function getSubscriptionsRenewingBetween(startYmd, endYmd, db = supabase) {
  const { data, error } = await db
    .from('household_subscriptions')
    .select()
    .gte('next_renewal_at', startYmd)
    .lte('next_renewal_at', endYmd);
  if (error) throw error;
  return data || [];
}

async function updateSubscriptionRenewal(id, nextRenewalAt, remindedForDate, db = supabase) {
  const patch = { next_renewal_at: nextRenewalAt, updated_at: new Date().toISOString() };
  if (remindedForDate) patch.reminded_for_date = remindedForDate;
  const { error } = await db
    .from('household_subscriptions')
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

module.exports = {
  sanitizeOrFilterValue,
  recordAdminAction,
  getAdminAuditLog,
  getAllHouseholds,
  getTasksDueNextWeek,
  createHousehold,
  getHouseholdByCode,
  getHouseholdById,
  updateHouseholdSettings,
  // Subscription / Stripe
  updateHouseholdSubscription,
  findHouseholdByStripeCustomerId,
  findHouseholdByStripeSubscriptionId,
  recordStripeEventIfNew,
  deleteProcessedStripeEvent,
  // RevenueCat / iOS IAP
  recordRevenuecatEventIfNew,
  deleteProcessedRevenuecatEvent,
  findHouseholdByRevenuecatAppUserId,
  // Trial lifecycle emails
  markEmailSentIfNew,
  findHouseholdsAtTrialDay,
  findHouseholdsWithExpiredTrial,
  getHouseholdPrimaryContact,
  getHouseholdUsageCounts,
  setTrialEmailsEnabled,
  pickColorForNewMember,
  COLOR_THEMES,
  createUser,
  getHouseholdMembers,
  findUserByName,
  getUserById,
  getUserByEmail,
  createUserWithEmail,
  updateUser,
  deleteUser,
  createEmailVerificationToken,
  getEmailVerificationToken,
  markEmailVerificationTokenUsed,
  createPasswordResetToken,
  getPasswordResetToken,
  markPasswordResetTokenUsed,
  // Refresh tokens (session security)
  createRefreshToken,
  getValidRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  revokeOtherUserRefreshTokens,
  getActiveSessionsForUser,
  touchRefreshToken,
  // Notes
  getHouseholdNotes,
  upsertHouseholdNote,
  deleteHouseholdNote,
  addHouseholdPreference,
  getHouseholdPreferences,
  deleteHouseholdPreference,
  // WhatsApp
  getUserByWhatsAppPhone,
  createWhatsAppVerificationCode,
  getWhatsAppVerificationCode,
  markWhatsAppVerificationCodeUsed,
  createWhatsAppPairingCode,
  findUnusedPairingCode,
  consumePairingCode,
  getPairingCodeStatus,
  touchWhatsAppInbound,
  markUserOnboarded,
  createInvite,
  getInviteByToken,
  getInviteByEmail,
  markInviteAccepted,
  deleteInvite,
  getPendingInvites,
  addShoppingItems,
  addShoppingItemsWithDedupe,
  getShoppingList,
  getShoppingLists,
  createShoppingList,
  deleteShoppingList,
  getDefaultShoppingList,
  completeShoppingItemsByName,
  completeShoppingItemById,
  addTasks,
  getTasks,
  getAllIncompleteTasks,
  completeTask,
  completeTasksByName,
  generateNextRecurrence,
  advanceOverdueRecurringTasks,
  getCompletedThisWeek,
  getOverdueTasksForUser,
  getTasksForUser,
  getRecentlyCompletedTasks,
  getRecentlyCompletedShopping,
  getRecentlyPurchasedNames,
  getRecurringTaskTitles,
  uncompleteTask,
  uncompleteShoppingItem,
  deleteShoppingItem,
  purgePriorPurchases,
  deleteTask,
  findTasksByFuzzyTitle,
  findShoppingItemsByFuzzyName,
  findEventsByFuzzyTitle,
  updateTask,
  updateShoppingItem,
  // Calendar
  getCalendarEvents,
  getBirthdayEvents,
  isBirthdayTitle,
  expandRecurringEvents,
  getCalendarEventById,
  createEventAttachment,
  getEventAttachments,
  getEventAttachmentById,
  deleteEventAttachment,
  getTasksByDateRange,
  searchCalendar,
  createCalendarEvent,
  findSimilarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  softDeleteCalendarEvent,
  getDeletedCalendarEvents,
  restoreCalendarEvent,
  permanentlyDeleteCalendarEvent,
  getOrCreateFeedToken,
  regenerateFeedToken,
  getFeedTokenData,
  getFeedTokenIfExists,
  deleteFeedToken,
  getExternalFeedsByHousehold,
  getAllActiveExternalFeeds,
  findDeviceCalendarLink,
  findDeviceLinkByOwnerAndName,
  updateDeviceCalendarLink,
  findHouseholdUidsUnderOtherFeeds,
  replaceFeedEventsInWindow,
  deleteEventsForFeed,
  getExternalFeedById,
  createExternalFeed,
  deleteExternalFeed,
  updateExternalFeed,
  recordExternalFeedSuccess,
  recordExternalFeedPartial,
  recordExternalFeedFailure,
  getExternalFeedEvents,
  createExternalFeedEvent,
  updateExternalFeedEvent,
  upsertExternalFeedEvent,
  batchUpsertExternalFeedEvents,
  batchSoftDeleteCalendarEvents,
  getCalendarSyncHealthAdmin,
  getAllEventsForFeed,
  createCalendarEventFromSync,
  // Dependents
  createDependent,
  deleteDependent,
  // Chat
  getChatHistory,
  saveChatMessage,
  clearChatHistory,
  createConversation,
  getConversations,
  deleteConversation,
  updateConversationTitle,
  touchConversation,
  // Schools
  searchSchools,
  searchSchoolByUrn,
  createHouseholdSchool,
  getHouseholdSchools,
  getHouseholdSchoolByUrn,
  deleteHouseholdSchool,
  updateHouseholdSchool,
  getCachedLATermDates,
  cacheLATermDates,
  addSchoolTermDates,
  getSchoolTermDates,
  getSchoolTermDateById,
  getTermDatesBySchoolIds,
  deleteSchoolTermDate,
  updateSchoolTermDate,
  updateHouseholdSchoolMeta,
  deleteTermDatesBySchoolAndAcademicYear,
  deleteAllTermDatesBySchool,
  getSchoolsWithIcalUrls,
  addChildActivity,
  getChildActivityById,
  updateChildActivity,
  getChildActivities,
  getHouseholdActivities,
  getActivitiesByChildIds,
  deleteChildActivity,
  addChildSchoolEvent,
  getChildSchoolEvents,
  // Meals
  getMealPlanForWeek,
  getRecurringMeals,
  createMealPlanEntry,
  updateMealPlanEntry,
  deleteMealPlanEntry,
  getRecipes,
  getRecipeById,
  getLatestRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  getMealCategories,
  createDefaultMealCategories,
  updateMealCategory,
  getRecentMeals,
  getRecentPurchases,
  getSupabase: () => supabase,
  // Platform admin Phase 1
  getAllUsersAdmin,
  getUserByIdAdmin,
  getAllHouseholdsAdmin,
  getHouseholdDetailAdmin,
  getPlatformStats,
  getSubscriptionStats,
  updateHouseholdSubscriptionAdmin,
  pauseOrResumeTrial,
  disableUser,
  enableUser,
  deleteUserAdmin,
  setUserPlatformAdmin,
  deleteHouseholdCascade,
  // Platform admin Phase 2
  getAiUsageStats,
  getAiUsageTimeline,
  logWhatsAppMessage,
  getRecentWhatsAppTurns,
  getWhatsAppStats,
  getWhatsAppTimeline,
  getAnalytics,
  getRetentionCohorts,
  getChannelCohortStats,
  computeChannelCohorts,
  getRevenueStats,
  getAiUsageTopHouseholds,
  getAiUsageTopUsers,
  getHouseholdAiUsage,
  getHouseholdActivity,
  getUserFeatureSpread,
  getUserUsageStats,
  // Inbound email
  getHouseholdByInboundToken,
  getHouseholdByEmailAlias,
  setHouseholdEmailAlias,
  isEmailAliasAvailable,
  getInboundSenders,
  addInboundSender,
  deleteInboundSender,
  isInboundSenderAllowed,
  touchInboundSender,
  createInboundEmailLog,
  updateInboundEmailLog,
  getInboundEmailLogByUndoToken,
  getRecentInboundEmailsAdmin,
  getRecentInboundEmails,
  getRejectedInboundSenders,
  checkDuplicateEmail,
  // Event reminders & assignees
  saveEventReminders,
  saveEventAssignees,
  getPendingReminders,
  markReminderSent,
  claimEventReminder,
  claimTaskNotification,
  getEventAssignees,
  getEventAssigneesBatch,
  getEventRemindersBatch,
  // Scheduler locks
  acquireSchedulerLock,
  cleanupSchedulerLocks,
  // Documents
  createDocumentFolder,
  getDocumentFolders,
  getDocumentFolderById,
  updateDocumentFolder,
  deleteDocumentFolder,
  createDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getDocumentsByFolderIds,
  getDescendantFolderIds,
  logDocumentAccess,
  getDocumentAccessLog,
  getRecentDocumentActivity,
  getHouseholdStorageUsage,
  // Device tokens & notification preferences
  registerDeviceToken,
  unregisterDeviceToken,
  getActiveDeviceTokens,
  getDeviceTokensForUserAdmin,
  getSetupNudgeCandidates,
  getHouseholdDeviceTokens,
  getNotificationPreferences,
  upsertNotificationPreferences,
  // Announcements (admin email broadcaster)
  resolveAnnouncementAudience,
  createAnnouncement,
  getAnnouncementById,
  listAnnouncements,
  getPendingRecipients,
  markRecipientSent,
  markRecipientFailed,
  markAnnouncementSendStarted,
  markAnnouncementSendCompleted,
  // Multi-assignee helpers (shared between tasks + events + bot handlers)
  resolveAssignees,
  pickAssigneeNames,
  // Household subscriptions (Netflix, Spotify, etc.)
  listSubscriptions,
  createSubscription,
  findSubscriptionByName,
  deleteSubscription,
  getSubscriptionsRenewingBetween,
  updateSubscriptionRenewal,
  // WhatsApp re-engagement (T+24h email for signups who never linked)
  findUsersAwaitingWhatsAppFollowup,
  markWhatsAppFollowupSent,
};
