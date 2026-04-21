const { supabaseAdmin: supabase } = require('./client');
const crypto = require('crypto');

// ─── Households ───────────────────────────────────────────────────────────────

function generateJoinCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9B2"
}

async function createHousehold(name, timezone, db = supabase) {
  const join_code = generateJoinCode();
  const inbound_email_token = crypto.randomBytes(6).toString('hex');
  const row = { name, join_code, inbound_email_token };
  if (timezone) row.timezone = timezone;
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

async function createUserWithEmail({ email, passwordHash, name, householdId = null, emailVerified = false, role = 'member' }, db = supabase) {
  const { data, error } = await db
    .from('users')
    .insert({
      email,
      password_hash: passwordHash,
      name,
      household_id: householdId,
      email_verified: emailVerified,
      role,
    })
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

async function createRefreshToken(userId, token, expiresAt, db = supabase) {
  const { data, error } = await db
    .from('refresh_tokens')
    .insert({ user_id: userId, token, expires_at: expiresAt })
    .select()
    .single();
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

// ─── Dependent helpers ───────────────────────────────────────────────────────

async function createDependent(householdId, { name, family_role, birthday, color_theme, school_id, year_group }, db = supabase) {
  const { data, error } = await db
    .from('users')
    .insert({
      household_id: householdId,
      name,
      family_role: family_role || null,
      birthday: birthday || null,
      color_theme: color_theme || 'sage',
      school_id: school_id || null,
      year_group: year_group || null,
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
  const { error } = await db
    .from('users')
    .delete()
    .eq('id', id)
    .eq('household_id', householdId)
    .eq('member_type', 'dependent');
  if (error) throw error;
}

// ─── Chat message helpers ────────────────────────────────────────────────────

async function getChatHistory(conversationId, limit = 50, db = supabase) {
  const { data, error } = await db
    .from('chat_messages')
    .select()
    .eq('conversation_id', conversationId)
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

async function clearChatHistory(conversationId, db = supabase) {
  const { error } = await db
    .from('chat_messages')
    .delete()
    .eq('conversation_id', conversationId);
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
 * missed a whole class of multi-word queries — e.g. "Queen Elizabeth's School
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
    .limit(200); // generous — JS filter below tightens this to 10

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
    applies_to_year_groups: d.applies_to_year_groups || null,
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
    })
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
 * Record that we've just received an inbound WhatsApp message from a user.
 * Used by the webhook to refresh their 24-hour customer-service window so
 * broadcast.js knows when free-form outbound is allowed vs when we must
 * fall back to a pre-approved Content Template.
 *
 * Fire-and-forget from the caller's perspective — the webhook has already
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
 * Idempotent — a subsequent call keeps the original timestamp so we don't
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

async function createInvite({ householdId, email, token, invitedBy, expiresAt, name, family_role, birthday, color_theme }, db = supabase) {
  const row = { household_id: householdId, email, token, invited_by: invitedBy, expires_at: expiresAt };
  if (name) row.name = name;
  if (family_role) row.family_role = family_role;
  if (birthday) row.birthday = birthday;
  if (color_theme) row.color_theme = color_theme;
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

// Coarse-grained shopping category — shopping_items.category has a CHECK
// constraint limiting it to this set (see migration-shopping-categories.sql).
// Keep in sync with that migration.
const VALID_SHOPPING_CATEGORIES = new Set([
  'groceries', 'clothing', 'household', 'school', 'pets', 'party', 'gifts', 'other',
]);

async function addShoppingItems(householdId, items, addedByUserId, db = supabase) {
  if (!items.length) return [];
  const rows = items.map((i) => {
    // Two columns that sound alike but aren't:
    //   `category`        — coarse DB enum (groceries/clothing/household/…)
    //   `aisle_category`  — grocery-aisle enum the classifier returns
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
      // Default to 'groceries' for AI-classified rows — they're almost
      // always groceries, and the old 'other' default silently stripped
      // every aisle-categorised item's category signal.
      category: isValidDbCategory ? rawCategory : 'groceries',
      quantity: i.quantity || null,
      added_by: addedByUserId,
      list_id: i.list_id || null,
      aisle_category: i.aisle_category || aisleFromCategory || 'Other',
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

async function completeShoppingItemsByName(householdId, itemNames, db = supabase) {
  // Find items matching the names (case-insensitive, incomplete only)
  const lowerNames = itemNames.map((n) => n.toLowerCase());
  const { data: items, error: fetchErr } = await db
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false);
  if (fetchErr) throw fetchErr;

  const matched = items.filter((i) => lowerNames.some((n) => i.item.toLowerCase().includes(n) || n.includes(i.item.toLowerCase())));
  if (!matched.length) return [];

  const ids = matched.map((i) => i.id);
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

async function addTasks(householdId, tasks, addedByUserId, members = [], db = supabase) {
  if (!tasks.length) return [];

  const rows = await Promise.all(tasks.map(async (t) => {
    let assignedToId = null;
    if (t.assigned_to_name) {
      const member = members.find((m) => m.name.toLowerCase() === t.assigned_to_name.toLowerCase());
      assignedToId = member ? member.id : null;
    }
    return {
      household_id: householdId,
      title: t.title,
      assigned_to: assignedToId,
      assigned_to_name: t.assigned_to_name || null,
      due_date: t.due_date || new Date().toISOString().split('T')[0],
      due_time: t.due_time || null,
      recurrence: t.recurrence || null,
      priority: t.priority || 'medium',
      description: t.description || null,
      notification: t.notification || null,
      added_by: addedByUserId,
    };
  }));

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
  if (assignedToId) query = query.or(`assigned_to.eq.${assignedToId},assigned_to.is.null`);
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
  let query = db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false);

  if (assigneeName) query = query.ilike('assigned_to_name', assigneeName);

  const { data: tasks, error: fetchErr } = await query;
  if (fetchErr) throw fetchErr;

  // Match tasks using fuzzy word overlap — the AI often paraphrases task titles
  // (e.g. "Mason's party planning" for "Plan Mason's party")
  function extractWords(str) {
    return str.toLowerCase().replace(/['']/g, '').split(/\s+/).filter(w => w.length > 2);
  }

  function fuzzyMatch(taskTitle, aiTitle) {
    const tLower = taskTitle.toLowerCase();
    const aLower = aiTitle.toLowerCase();
    // Exact or substring match
    if (tLower.includes(aLower) || aLower.includes(tLower)) return true;
    // Word overlap: if more than half the significant words match, it's the same task
    const taskWords = extractWords(taskTitle);
    const aiWords = extractWords(aiTitle);
    if (taskWords.length === 0 || aiWords.length === 0) return false;
    const overlap = taskWords.filter(w => aiWords.some(aw => aw.includes(w) || w.includes(aw)));
    return overlap.length >= Math.min(taskWords.length, aiWords.length) * 0.5;
  }

  const matched = tasks.filter((t) =>
    lowerTitles.some((n) => fuzzyMatch(t.title, n))
  );
  if (!matched.length) return [];

  const completed = await Promise.all(matched.map((t) => completeTask(t.id, db)));
  return completed;
}

async function generateNextRecurrence(task, db = supabase) {
  const due = new Date(task.due_date);
  switch (task.recurrence) {
    case 'daily':     due.setDate(due.getDate() + 1); break;
    case 'weekly':    due.setDate(due.getDate() + 7); break;
    case 'biweekly':  due.setDate(due.getDate() + 14); break;
    case 'monthly':   due.setMonth(due.getMonth() + 1); break;
    case 'yearly':    due.setFullYear(due.getFullYear() + 1); break;
    default: return null;
  }

  // Delete any previous uncompleted instances of this recurring task.
  // A recurring task should only ever have one active instance — if the user
  // didn't complete the old one before the new one is due, remove it.
  await db
    .from('tasks')
    .delete()
    .eq('household_id', task.household_id)
    .eq('title', task.title)
    .eq('recurrence', task.recurrence)
    .eq('completed', false)
    .neq('id', task.id);

  const { data, error } = await db
    .from('tasks')
    .insert({
      household_id: task.household_id,
      title: task.title,
      assigned_to: task.assigned_to,
      assigned_to_name: task.assigned_to_name,
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
  if (assignedToName) query = query.ilike('assigned_to_name', assignedToName.trim());
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

  // Fallback — no upcoming match, scan all (including past).
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
 * Generic task update — applies whichever fields are present in `updates`.
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

// Seeds every new household with this set on first access. Shared by
// getShoppingLists (read path) and getDefaultShoppingList (write path) so
// the two can't drift.
const DEFAULT_SHOPPING_LISTS = ['Default', 'M&S', 'Tesco', 'Waitrose', "Sainsbury's", 'Aldi'];

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
  // returned without ever clearing its loading=true initial state — i.e. an
  // infinite spinner for first-time users.
  if (!data || data.length === 0) {
    const rows = DEFAULT_SHOPPING_LISTS.map((name) => ({ household_id: householdId, name }));
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
    // Create all default lists for this household (DEFAULT_SHOPPING_LISTS is
    // declared above getShoppingLists — shared so the two seeding paths
    // can't drift out of sync).
    const rows = DEFAULT_SHOPPING_LISTS.map(name => ({ household_id: householdId, name }));
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
  const { data, error } = await db
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .eq('assigned_to', userId)
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
    .eq('assigned_to', userId)
    .order('due_date')
    .order('created_at');
  if (error) throw error;
  return data;
}

// ─── Calendar Events ─────────────────────────────────────────────────────────

async function getCalendarEvents(householdId, startDate, endDate, { userId, category } = {}, db = supabase) {
  let query = db
    .from('calendar_events')
    .select()
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .lte('start_time', endDate)
    .gte('end_time', startDate);

  // category/visibility columns may not exist until migration is run — try filtered
  // query first, fall back to unfiltered if it fails
  if (category) {
    query = query.eq('category', category);
  }

  // Visibility: show family events + personal events belonging to the requesting user
  if (userId) {
    query = query.or(`visibility.eq.family,source_user_id.eq.${userId},source_user_id.is.null`);
  }

  const { data, error } = await query.order('start_time');

  if (error && (category || userId)) {
    // Retry without category/visibility filters (columns may not exist yet)
    const fallback = await db
      .from('calendar_events')
      .select()
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .lte('start_time', endDate)
      .gte('end_time', startDate)
      .order('start_time');
    if (fallback.error) throw fallback.error;
    return fallback.data;
  }

  if (error) throw error;
  return data;
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

async function findCalendarEventByTitleAndTime(householdId, title, startTime, db = supabase) {
  const { data, error } = await db
    .from('calendar_events')
    .select('id')
    .eq('household_id', householdId)
    .eq('title', title)
    .eq('start_time', startTime)
    .is('deleted_at', null)
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
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

async function createCalendarEvent(householdId, eventData, createdByUserId, db = supabase) {
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
      category: eventData.category || 'general',
      recurrence: eventData.recurrence || null,
      assigned_to: eventData.assigned_to || null,
      assigned_to_name: eventData.assigned_to_name || null,
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
 * UTC day — a second all-day event with the same title is almost always
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
  // for duplicate detection — and all-day events in our system are stored
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
    .select('id, title, start_time, created_by, assigned_to_name, all_day')
    .eq('household_id', householdId)
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
    .not('deleted_at', 'is', null)
    .select()
    .single();
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

async function getAllEventsForFeed(householdId, db = supabase) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const oneYearAhead = new Date();
  oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);

  const [{ data: events }, { data: tasks }] = await Promise.all([
    db
      .from('calendar_events')
      .select()
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .gte('start_time', thirtyDaysAgo.toISOString())
      .lte('start_time', oneYearAhead.toISOString())
      .order('start_time'),
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

async function getCalendarConnections(userId, db = supabase) {
  const { data, error } = await db
    .from('calendar_connections')
    .select()
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

async function upsertCalendarConnection(userId, householdId, provider, connectionData, db = supabase) {
  const { data, error } = await db
    .from('calendar_connections')
    .upsert({
      user_id: userId,
      household_id: householdId,
      provider,
      ...connectionData,
    }, { onConflict: 'user_id,provider' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteCalendarConnection(userId, provider, db = supabase) {
  // Schema has ON DELETE CASCADE on subscriptions and sync_mappings,
  // so deleting the connection row cascades automatically.
  const { data, error } = await db
    .from('calendar_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
    .select();

  console.log(`[deleteCalendarConnection] user=${userId} provider=${provider} deleted=${data?.length || 0} rows`);
  if (error) {
    console.error('[deleteCalendarConnection] Error:', error);
    throw error;
  }
  if (!data || data.length === 0) {
    console.warn('[deleteCalendarConnection] No rows matched — connection may not exist for this user');
  }
}

async function getConnectionsByHousehold(householdId, db = supabase) {
  const { data, error } = await db
    .from('calendar_connections')
    .select()
    .eq('household_id', householdId)
    .eq('sync_enabled', true);
  if (error) throw error;
  return data;
}

async function createSyncMapping(eventId, connectionId, externalEventId, etag, db = supabase) {
  // Conflict key aligns with the unique constraint added in
  // migration-sync-mapping-unique-fix.sql. Keying on
  // (connection_id, external_event_id) means each Apple UID owns its own
  // mapping row instead of overwriting a previous UID's row, which is
  // what caused the original "re-link every poll" ping-pong.
  const { data, error } = await db
    .from('calendar_sync_mappings')
    .upsert({
      event_id: eventId,
      connection_id: connectionId,
      external_event_id: externalEventId,
      external_etag: etag || null,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,external_event_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getSyncMapping(eventId, connectionId, db = supabase) {
  const { data, error } = await db
    .from('calendar_sync_mappings')
    .select()
    .eq('event_id', eventId)
    .eq('connection_id', connectionId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getSyncMappingByExternalId(connectionId, externalEventId, db = supabase) {
  const { data, error } = await db
    .from('calendar_sync_mappings')
    .select()
    .eq('connection_id', connectionId)
    .eq('external_event_id', externalEventId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getSyncMappingsByConnection(connectionId, db = supabase) {
  const { data, error } = await db
    .from('calendar_sync_mappings')
    .select()
    .eq('connection_id', connectionId);
  if (error) throw error;
  return data || [];
}

/**
 * Remove every sync mapping an event has for a given connection. Called
 * when we push a local delete to the provider — the event itself is
 * being removed, so all of its remote tracking should go too.
 */
async function deleteSyncMappingsForEvent(eventId, connectionId, db = supabase) {
  const { error } = await db
    .from('calendar_sync_mappings')
    .delete()
    .eq('event_id', eventId)
    .eq('connection_id', connectionId);
  if (error) throw error;
}

/**
 * Remove a single mapping identified by the external UID. Called when an
 * INCOMING delete arrives from the provider — Apple says "this UID is
 * gone", we remove the mapping for THAT UID only. Other mappings for
 * the same event (other UIDs, other calendar subscriptions, shared-
 * calendar mirrors) stay intact. Caller is responsible for soft-deleting
 * the event separately if no mappings remain.
 */
async function deleteSyncMappingByExternalId(connectionId, externalEventId, db = supabase) {
  const { error } = await db
    .from('calendar_sync_mappings')
    .delete()
    .eq('connection_id', connectionId)
    .eq('external_event_id', externalEventId);
  if (error) throw error;
}

/**
 * Count how many mappings reference this event, across every connection.
 * Used after processing an incoming delete: if zero mappings remain, the
 * event has no external source left and can be safely soft-deleted.
 * If any remain, we leave the event alone — another sync could have it
 * mirrored.
 */
async function countSyncMappingsForEvent(eventId, db = supabase) {
  const { count, error } = await db
    .from('calendar_sync_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId);
  if (error) throw error;
  return count || 0;
}

// Backwards-compat alias: original callers passed (eventId, connectionId)
// and expected "nuke all mappings for this event+connection". Preserve
// that meaning so existing call sites don't silently change behaviour.
const deleteSyncMapping = deleteSyncMappingsForEvent;

// ─── Calendar Subscriptions ──────────────────────────────────────────────────

async function getSubscriptionsByConnection(connectionId, db = supabase) {
  const { data, error } = await db
    .from('calendar_subscriptions')
    .select()
    .eq('connection_id', connectionId)
    .order('display_name');
  // Table may not exist until migration is run
  if (error && error.code === '42P01') return [];
  if (error) throw error;
  return data;
}

async function getEnabledSubscriptionsByConnection(connectionId, db = supabase) {
  const { data, error } = await db
    .from('calendar_subscriptions')
    .select()
    .eq('connection_id', connectionId)
    .eq('sync_enabled', true)
    .order('display_name');
  if (error) throw error;
  return data;
}

async function upsertSubscription(connectionId, subData, db = supabase) {
  const { data, error } = await db
    .from('calendar_subscriptions')
    .upsert({
      connection_id: connectionId,
      external_calendar_id: subData.external_calendar_id,
      display_name: subData.display_name,
      category: subData.category || 'general',
      visibility: subData.visibility || 'family',
      sync_enabled: subData.sync_enabled !== false,
    }, { onConflict: 'connection_id,external_calendar_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getSubscriptionById(subscriptionId, db = supabase) {
  const { data, error } = await db
    .from('calendar_subscriptions')
    .select()
    .eq('id', subscriptionId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function updateSubscription(subscriptionId, updates, db = supabase) {
  const allowed = {};
  if (updates.category !== undefined) allowed.category = updates.category;
  if (updates.visibility !== undefined) allowed.visibility = updates.visibility;
  if (updates.sync_enabled !== undefined) allowed.sync_enabled = updates.sync_enabled;
  if (updates.last_synced_at !== undefined) allowed.last_synced_at = updates.last_synced_at;
  if (updates.sync_token !== undefined) allowed.sync_token = updates.sync_token;
  const { data, error } = await db
    .from('calendar_subscriptions')
    .update(allowed)
    .eq('id', subscriptionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Sync health tracking ───────────────────────────────────────────────
//
// Auto-disable threshold: after this many consecutive failures, flip
// sync_enabled = false so we stop hammering the provider. At a 15-min
// Apple poll cadence, 12 failures ≈ 3 hours of retries.
const MAX_CONSECUTIVE_SYNC_FAILURES = 12;

/**
 * Mark a successful sync attempt on a subscription.
 * Clears any prior error and resets the failure counter.
 */
async function recordSyncSuccess(subscriptionId, db = supabase) {
  const now = new Date().toISOString();
  const { error } = await db
    .from('calendar_subscriptions')
    .update({
      last_synced_at: now,
      last_attempted_at: now,
      last_sync_error: null,
      consecutive_failures: 0,
    })
    .eq('id', subscriptionId);
  if (error) throw error;
}

/**
 * Mark a failed sync attempt. Increments the failure counter, records the
 * error message and attempt timestamp, and auto-disables the subscription
 * once it has failed MAX_CONSECUTIVE_SYNC_FAILURES times in a row.
 *
 * Returns { consecutive_failures, auto_disabled } for logging.
 */
async function recordSyncFailure(subscriptionId, errorMessage, db = supabase) {
  // Read current counter (the DB doesn't support atomic increment in the
  // PostgREST query builder cleanly; a read-then-write is fine here — sync
  // attempts for a given subscription are serialized by the scheduler).
  const { data: current, error: readErr } = await db
    .from('calendar_subscriptions')
    .select('consecutive_failures')
    .eq('id', subscriptionId)
    .single();
  if (readErr && readErr.code !== 'PGRST116') throw readErr;

  const nextCount = (current?.consecutive_failures || 0) + 1;
  const autoDisable = nextCount >= MAX_CONSECUTIVE_SYNC_FAILURES;

  const updates = {
    last_attempted_at: new Date().toISOString(),
    last_sync_error: String(errorMessage || 'Unknown error').slice(0, 1000),
    consecutive_failures: nextCount,
  };
  if (autoDisable) updates.sync_enabled = false;

  const { error: writeErr } = await db
    .from('calendar_subscriptions')
    .update(updates)
    .eq('id', subscriptionId);
  if (writeErr) throw writeErr;

  return { consecutive_failures: nextCount, auto_disabled: autoDisable };
}

/**
 * Return any subscriptions in a failing state for the given household.
 * Used by the UI to show a "sync broken" banner on the calendar page.
 */
async function getFailingSubscriptionsByHousehold(householdId, db = supabase) {
  // Join via calendar_connections — there's no direct household_id on subs.
  const { data, error } = await db
    .from('calendar_subscriptions')
    .select(`
      id, display_name, last_synced_at, last_attempted_at,
      last_sync_error, consecutive_failures, sync_enabled,
      calendar_connections!inner (
        id, provider, caldav_username, household_id
      )
    `)
    .eq('calendar_connections.household_id', householdId)
    .not('last_sync_error', 'is', null);
  if (error) throw error;
  return (data || []).map((sub) => ({
    id: sub.id,
    display_name: sub.display_name,
    last_synced_at: sub.last_synced_at,
    last_attempted_at: sub.last_attempted_at,
    last_sync_error: sub.last_sync_error,
    consecutive_failures: sub.consecutive_failures,
    sync_enabled: sub.sync_enabled,
    provider: sub.calendar_connections?.provider,
    account: sub.calendar_connections?.caldav_username,
  }));
}

async function deleteSubscription(subscriptionId, db = supabase) {
  // Delete synced events first
  await db
    .from('calendar_events')
    .delete()
    .eq('subscription_id', subscriptionId);
  // Then delete the subscription (cascade deletes sync mappings)
  const { error } = await db
    .from('calendar_subscriptions')
    .delete()
    .eq('id', subscriptionId);
  if (error) throw error;
}

async function getConnectionByUserAndProvider(userId, provider, db = supabase) {
  const { data, error } = await db
    .from('calendar_connections')
    .select()
    .eq('user_id', userId)
    .eq('provider', provider)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getSyncMappingsBySubscription(subscriptionId, db = supabase) {
  const { data, error } = await db
    .from('calendar_sync_mappings')
    .select()
    .eq('subscription_id', subscriptionId);
  if (error) throw error;
  return data;
}

async function createSyncMappingWithSubscription(eventId, connectionId, subscriptionId, externalEventId, etag, db = supabase) {
  // See createSyncMapping for why the conflict key is
  // (connection_id, external_event_id) and not (event_id, connection_id).
  const { data, error } = await db
    .from('calendar_sync_mappings')
    .upsert({
      event_id: eventId,
      connection_id: connectionId,
      subscription_id: subscriptionId,
      external_event_id: externalEventId,
      external_etag: etag || null,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'connection_id,external_event_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

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

async function getSyncMappingsByExternalIds(connectionId, externalIds, db = supabase) {
  if (!externalIds || externalIds.length === 0) return [];
  // Supabase .in() has a limit of ~1000, so chunk if needed
  const CHUNK = 500;
  const results = [];
  for (let i = 0; i < externalIds.length; i += CHUNK) {
    const chunk = externalIds.slice(i, i + CHUNK);
    const { data, error } = await db
      .from('calendar_sync_mappings')
      .select('external_event_id')
      .eq('connection_id', connectionId)
      .in('external_event_id', chunk);
    if (error) throw error;
    results.push(...(data || []));
  }
  return results;
}

async function batchCreateCalendarEvents(eventRows, db = supabase) {
  if (!eventRows || eventRows.length === 0) return [];
  const { data, error } = await db
    .from('calendar_events')
    .insert(eventRows)
    .select();
  if (error) throw error;
  return data;
}

async function batchCreateSyncMappings(mappingRows, db = supabase) {
  if (!mappingRows || mappingRows.length === 0) return [];
  const { data, error } = await db
    .from('calendar_sync_mappings')
    .upsert(mappingRows, { onConflict: 'event_id,connection_id' })
    .select();
  if (error) throw error;
  return data;
}

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

async function getAllUsersAdmin({ search, page = 1, limit = 50 } = {}, db = supabase) {
  let query = db
    .from('users')
    .select('id, name, email, role, household_id, is_platform_admin, member_type, color_theme, avatar_url, email_verified, whatsapp_linked, disabled_at, created_at', { count: 'exact' });

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  }

  const from = (page - 1) * limit;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) throw error;
  return { users: data, total: count };
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

  return { ...user, household };
}

async function getAllHouseholdsAdmin({ search, page = 1, limit = 50 } = {}, db = supabase) {
  let query = db
    .from('households')
    .select('id, name, join_code, timezone, reminder_time, created_at', { count: 'exact' });

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const from = (page - 1) * limit;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) throw error;

  // Attach member counts
  const householdIds = data.map((h) => h.id);
  if (householdIds.length > 0) {
    const { data: users } = await db
      .from('users')
      .select('household_id')
      .in('household_id', householdIds);

    const countMap = {};
    for (const u of users || []) {
      countMap[u.household_id] = (countMap[u.household_id] || 0) + 1;
    }
    for (const h of data) {
      h.member_count = countMap[h.id] || 0;
    }
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

  const { data: members } = await db
    .from('users')
    .select('id, name, email, role, member_type, color_theme, avatar_url, is_platform_admin, disabled_at, created_at')
    .eq('household_id', householdId)
    .order('created_at');

  return { ...household, members: members || [] };
}

async function getPlatformStats(db = supabase) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [usersResult, householdsResult, newUsersResult, newHouseholdsResult] = await Promise.all([
    db.from('users').select('id', { count: 'exact', head: true }),
    db.from('households').select('id', { count: 'exact', head: true }),
    db.from('users').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    db.from('households').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
  ]);

  return {
    totalUsers: usersResult.count || 0,
    totalHouseholds: householdsResult.count || 0,
    newUsersThisWeek: newUsersResult.count || 0,
    newHouseholdsThisWeek: newHouseholdsResult.count || 0,
  };
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
  const { error } = await db
    .from('users')
    .delete()
    .eq('id', userId);
  if (error) throw error;
}

async function deleteHouseholdCascade(householdId, db = supabase) {
  // Delegates to the delete_household_cascade() Postgres function (see
  // supabase/migration-household-delete-fix.sql). The function runs with
  // SET statement_timeout = '5min' so the cascade across a fully-loaded
  // household doesn't hit Supabase's default ~30s timeout.
  //
  // Falls back to a plain DELETE if the function isn't installed yet —
  // covers the brief window between code deploy and migration run.
  const { error: rpcErr } = await db.rpc('delete_household_cascade', { p_household_id: householdId });
  if (!rpcErr) return;

  // 42883 = undefined_function — function isn't deployed yet.
  if (rpcErr.code === '42883' || /function .*does not exist/i.test(rpcErr.message || '')) {
    console.warn('[db] delete_household_cascade() not installed — falling back to direct DELETE. Run migration-household-delete-fix.sql.');
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
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('ai_usage_log')
    .select('provider, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });
  if (error) throw error;

  // Group by date
  const timeline = {};
  for (const row of data || []) {
    const date = row.created_at.split('T')[0];
    if (!timeline[date]) timeline[date] = { date, total: 0, gemini: 0, claude: 0, 'gpt-4o': 0 };
    timeline[date].total++;
    timeline[date][row.provider] = (timeline[date][row.provider] || 0) + 1;
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
  const { data, error } = await db
    .from('whatsapp_message_log')
    .select('direction, body, response, created_at, error, message_type')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[whatsapp-log] getRecentWhatsAppTurns failed:', error.message);
    return [];
  }
  const rows = (data || []).filter((r) => !r.error);
  if (!rows.length) return [];

  // Only include rows from the same "conversation window" — i.e. within
  // `windowMinutes` of the most recent row.
  const mostRecentMs = new Date(rows[0].created_at).getTime();
  const cutoffMs = mostRecentMs - windowMinutes * 60 * 1000;
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

async function getCalendarSyncHealth(db = supabase) {
  const { data: connections, error } = await db
    .from('calendar_connections')
    .select('id, user_id, household_id, provider, sync_enabled, token_expires_at, created_at');
  if (error) throw error;

  // Get user names
  const userIds = [...new Set((connections || []).map((c) => c.user_id))];
  const userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await db.from('users').select('id, name, email').in('id', userIds);
    for (const u of users || []) userMap[u.id] = u;
  }

  // Get sync mapping stats per connection
  const result = [];
  for (const conn of connections || []) {
    const { data: mappings } = await db
      .from('calendar_sync_mappings')
      .select('last_synced_at')
      .eq('connection_id', conn.id);

    const syncedEvents = mappings?.length || 0;
    const lastSynced = mappings?.length > 0
      ? mappings.reduce((max, m) => (m.last_synced_at > max ? m.last_synced_at : max), '')
      : null;

    result.push({
      ...conn,
      user_name: userMap[conn.user_id]?.name || 'Unknown',
      user_email: userMap[conn.user_id]?.email || '',
      synced_events: syncedEvents,
      last_synced_at: lastSynced,
    });
  }

  return result;
}

// ─── Phase 2 Admin: Analytics ───────────────────────────────────────────────

async function getAnalytics({ days = 30 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // DAU: distinct users with activity per day
  const [shoppingRes, tasksRes, calendarRes, chatRes] = await Promise.all([
    db.from('shopping_items').select('added_by, created_at').gte('created_at', since),
    db.from('tasks').select('added_by, created_at').gte('created_at', since),
    db.from('calendar_events').select('created_by, created_at').gte('created_at', since),
    db.from('chat_messages').select('user_id, created_at').gte('created_at', since).eq('role', 'user'),
  ]);

  // Build DAU map
  const dauMap = {};
  function addActivity(rows, userField) {
    for (const row of rows || []) {
      const date = row.created_at.split('T')[0];
      if (!dauMap[date]) dauMap[date] = new Set();
      if (row[userField]) dauMap[date].add(row[userField]);
    }
  }
  addActivity(shoppingRes.data, 'added_by');
  addActivity(tasksRes.data, 'added_by');
  addActivity(calendarRes.data, 'created_by');
  addActivity(chatRes.data, 'user_id');

  const dau = Object.entries(dauMap)
    .map(([date, users]) => ({ date, activeUsers: users.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Feature usage counts
  const featureUsage = {
    shopping: shoppingRes.data?.length || 0,
    tasks: tasksRes.data?.length || 0,
    calendar: calendarRes.data?.length || 0,
    chat: chatRes.data?.length || 0,
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

// ─── Phase 2 Admin: Per-user/household breakdowns ───────────────────────────

async function getAiUsageTopHouseholds({ days = 30, limit = 10 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('ai_usage_log')
    .select('household_id')
    .gte('created_at', since)
    .not('household_id', 'is', null);
  if (error) throw error;

  const counts = {};
  for (const row of data || []) {
    counts[row.household_id] = (counts[row.household_id] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (sorted.length === 0) return [];

  const ids = sorted.map(([id]) => id);
  const { data: households } = await db.from('households').select('id, name').in('id', ids);
  const nameMap = {};
  for (const h of households || []) nameMap[h.id] = h.name;

  return sorted.map(([id, calls]) => ({ household_id: id, name: nameMap[id] || 'Unknown', calls }));
}

async function getAiUsageTopUsers({ days = 30, limit = 10 } = {}, db = supabase) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('ai_usage_log')
    .select('user_id')
    .gte('created_at', since)
    .not('user_id', 'is', null);
  if (error) throw error;

  const counts = {};
  for (const row of data || []) {
    counts[row.user_id] = (counts[row.user_id] || 0) + 1;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (sorted.length === 0) return [];

  const ids = sorted.map(([id]) => id);
  const { data: users } = await db.from('users').select('id, name, email').in('id', ids);
  const userMap = {};
  for (const u of users || []) userMap[u.id] = u;

  return sorted.map(([id, calls]) => ({ user_id: id, name: userMap[id]?.name || 'Unknown', email: userMap[id]?.email || '', calls }));
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
  let aiTotalLatency = 0;
  let aiLatencyCount = 0;
  for (const r of aiRows) {
    aiByProvider[r.provider] = (aiByProvider[r.provider] || 0) + 1;
    aiByFeature[r.feature] = (aiByFeature[r.feature] || 0) + 1;
    if (r.latency_ms) { aiTotalLatency += r.latency_ms; aiLatencyCount++; }
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
      byProvider: aiByProvider,
      byFeature: aiByFeature,
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

async function createInboundEmailLog(householdId, fromEmail, subject, db = supabase) {
  const { data, error } = await db
    .from('inbound_email_log')
    .insert({
      household_id: householdId,
      from_email: fromEmail,
      subject: subject || null,
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
    // Table doesn't exist yet — allow sending (don't block notifications)
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

async function registerDeviceToken(userId, householdId, token, platform = 'ios') {
  const { data, error } = await supabase
    .from('device_tokens')
    .upsert(
      {
        user_id: userId,
        household_id: householdId,
        token,
        platform,
        active: true,
        updated_at: new Date(),
      },
      { onConflict: 'token' }
    )
    .select()
    .single();
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

module.exports = {
  getAllHouseholds,
  getTasksDueNextWeek,
  createHousehold,
  getHouseholdByCode,
  getHouseholdById,
  updateHouseholdSettings,
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
  // Notes
  getHouseholdNotes,
  upsertHouseholdNote,
  deleteHouseholdNote,
  // WhatsApp
  getUserByWhatsAppPhone,
  createWhatsAppVerificationCode,
  getWhatsAppVerificationCode,
  markWhatsAppVerificationCodeUsed,
  touchWhatsAppInbound,
  markUserOnboarded,
  createInvite,
  getInviteByToken,
  markInviteAccepted,
  deleteInvite,
  getPendingInvites,
  addShoppingItems,
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
  getCompletedThisWeek,
  getOverdueTasksForUser,
  getTasksForUser,
  getRecentlyCompletedTasks,
  getRecentlyCompletedShopping,
  uncompleteTask,
  uncompleteShoppingItem,
  deleteShoppingItem,
  deleteTask,
  findTasksByFuzzyTitle,
  findShoppingItemsByFuzzyName,
  findEventsByFuzzyTitle,
  updateTask,
  updateShoppingItem,
  // Calendar
  getCalendarEvents,
  getCalendarEventById,
  findCalendarEventByTitleAndTime,
  getTasksByDateRange,
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
  getAllEventsForFeed,
  // Calendar connections (two-way sync)
  getCalendarConnections,
  upsertCalendarConnection,
  deleteCalendarConnection,
  getConnectionsByHousehold,
  createSyncMapping,
  getSyncMapping,
  getSyncMappingByExternalId,
  getSyncMappingsByConnection,
  deleteSyncMapping,
  deleteSyncMappingsForEvent,
  deleteSyncMappingByExternalId,
  countSyncMappingsForEvent,
  // Calendar subscriptions
  getSubscriptionsByConnection,
  getEnabledSubscriptionsByConnection,
  recordSyncSuccess,
  recordSyncFailure,
  getFailingSubscriptionsByHousehold,
  MAX_CONSECUTIVE_SYNC_FAILURES,
  upsertSubscription,
  getSubscriptionById,
  updateSubscription,
  deleteSubscription,
  getConnectionByUserAndProvider,
  getSyncMappingsBySubscription,
  getSyncMappingsByExternalIds,
  batchCreateCalendarEvents,
  batchCreateSyncMappings,
  createSyncMappingWithSubscription,
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
  getTermDatesBySchoolIds,
  deleteSchoolTermDate,
  updateSchoolTermDate,
  updateHouseholdSchoolMeta,
  deleteTermDatesBySchoolAndAcademicYear,
  deleteAllTermDatesBySchool,
  getSchoolsWithIcalUrls,
  addChildActivity,
  getChildActivities,
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
  getCalendarSyncHealth,
  getAnalytics,
  getAiUsageTopHouseholds,
  getAiUsageTopUsers,
  getUserUsageStats,
  // Inbound email
  getHouseholdByInboundToken,
  createInboundEmailLog,
  updateInboundEmailLog,
  getRecentInboundEmails,
  checkDuplicateEmail,
  // Event reminders & assignees
  saveEventReminders,
  saveEventAssignees,
  getPendingReminders,
  markReminderSent,
  getEventAssignees,
  getEventAssigneesBatch,
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
  getHouseholdStorageUsage,
  // Device tokens & notification preferences
  registerDeviceToken,
  unregisterDeviceToken,
  getActiveDeviceTokens,
  getHouseholdDeviceTokens,
  getNotificationPreferences,
  upsertNotificationPreferences,
};
