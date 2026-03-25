const { supabase } = require('./client');
const crypto = require('crypto');

// ─── Households ───────────────────────────────────────────────────────────────

function generateJoinCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9B2"
}

async function createHousehold(name, timezone) {
  const join_code = generateJoinCode();
  const row = { name, join_code };
  if (timezone) row.timezone = timezone;
  const { data, error } = await supabase
    .from('households')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getHouseholdByCode(code) {
  const { data, error } = await supabase
    .from('households')
    .select()
    .eq('join_code', code.toUpperCase())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getHouseholdById(id) {
  const { data, error } = await supabase
    .from('households')
    .select()
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function updateHouseholdSettings(id, settings) {
  const { data, error } = await supabase
    .from('households')
    .update(settings)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function createUser({ householdId, name, role = 'member' }) {
  const { data, error } = await supabase
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

async function getHouseholdMembers(householdId) {
  const { data, error } = await supabase
    .from('users')
    .select()
    .eq('household_id', householdId)
    .order('created_at');
  if (error) throw error;
  return data;
}

async function findUserByName(householdId, name) {
  const { data, error } = await supabase
    .from('users')
    .select()
    .eq('household_id', householdId)
    .ilike('name', name)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select()
    .ilike('email', email)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function createUserWithEmail({ email, passwordHash, name, householdId = null, emailVerified = false, role = 'member' }) {
  const { data, error } = await supabase
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

async function updateUser(userId, fields) {
  const { data, error } = await supabase
    .from('users')
    .update(fields)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Token helpers (verification, reset) ─────────────────────────────────────

async function createToken(table, { userId, token, expiresAt }) {
  const { data, error } = await supabase
    .from(table)
    .insert({ user_id: userId, token, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getValidToken(table, token) {
  const { data, error } = await supabase
    .from(table)
    .select()
    .eq('token', token)
    .eq('used', false)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function markTokenUsed(table, tokenId) {
  const { error } = await supabase
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

// ─── Household notes ─────────────────────────────────────────────────────────

async function getHouseholdNotes(householdId) {
  const { data, error } = await supabase
    .from('household_notes')
    .select()
    .eq('household_id', householdId)
    .order('key');
  if (error) throw error;
  return data || [];
}

async function upsertHouseholdNote(householdId, key, value, userId) {
  const { data, error } = await supabase
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

async function deleteHouseholdNote(householdId, key) {
  const { error } = await supabase
    .from('household_notes')
    .delete()
    .eq('household_id', householdId)
    .eq('key', key.toLowerCase().trim());
  if (error) throw error;
}

// ─── Dependent helpers ───────────────────────────────────────────────────────

async function createDependent(householdId, { name, family_role, birthday, color_theme, school_id, year_group }) {
  const { data, error } = await supabase
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

async function deleteDependent(id, householdId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .eq('household_id', householdId)
    .eq('member_type', 'dependent');
  if (error) throw error;
}

// ─── Chat message helpers ────────────────────────────────────────────────────

async function getChatHistory(userId, limit = 50) {
  // Fetch the most recent N messages (descending), then reverse for chronological display
  const { data, error } = await supabase
    .from('chat_messages')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse();
}

async function saveChatMessage(householdId, userId, role, content) {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ household_id: householdId, user_id: userId, role, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function clearChatHistory(userId) {
  const { error } = await supabase
    .from('chat_messages')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

// ─── School helpers ──────────────────────────────────────────────────────────

async function searchSchools(query, postcode) {
  let q = supabase
    .from('schools_directory')
    .select('urn, name, type, phase, local_authority, address, postcode')
    .ilike('name', `%${query}%`)
    .eq('status', 'open')
    .limit(10);

  if (postcode) {
    q = q.ilike('postcode', `${postcode}%`);
  }

  const { data, error } = await q.order('name');
  if (error) throw error;
  return data || [];
}

async function searchSchoolByUrn(urn) {
  const { data, error } = await supabase
    .from('schools_directory')
    .select('urn, name, type, phase, local_authority, address, postcode')
    .eq('urn', urn)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createHouseholdSchool(householdId, data) {
  const { data: school, error } = await supabase
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

async function getHouseholdSchools(householdId) {
  const { data, error } = await supabase
    .from('household_schools')
    .select('*')
    .eq('household_id', householdId)
    .order('school_name');
  if (error) throw error;
  return data || [];
}

async function getHouseholdSchoolByUrn(householdId, urn) {
  const { data, error } = await supabase
    .from('household_schools')
    .select('*')
    .eq('household_id', householdId)
    .eq('school_urn', urn)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function deleteHouseholdSchool(schoolId, householdId) {
  const { error } = await supabase
    .from('household_schools')
    .delete()
    .eq('id', schoolId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function updateHouseholdSchool(schoolId, updates) {
  const { data, error } = await supabase
    .from('household_schools')
    .update(updates)
    .eq('id', schoolId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getCachedLATermDates(localAuthority, academicYear) {
  const { data, error } = await supabase
    .from('la_term_dates_cache')
    .select('dates')
    .eq('local_authority', localAuthority.toLowerCase().trim())
    .eq('academic_year', academicYear)
    .maybeSingle();
  if (error) throw error;
  return data?.dates || null;
}

async function cacheLATermDates(localAuthority, academicYear, dates) {
  const { error } = await supabase
    .from('la_term_dates_cache')
    .upsert({
      local_authority: localAuthority.toLowerCase().trim(),
      academic_year: academicYear,
      dates,
    }, { onConflict: 'local_authority,academic_year' });
  if (error) console.error('Failed to cache LA term dates:', error.message);
}

async function addSchoolTermDates(schoolId, dates) {
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
  const { data, error } = await supabase
    .from('school_term_dates')
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}

async function getSchoolTermDates(schoolId) {
  const { data, error } = await supabase
    .from('school_term_dates')
    .select('*')
    .eq('school_id', schoolId)
    .order('date');
  if (error) throw error;
  return data || [];
}

async function getTermDatesBySchoolIds(schoolIds) {
  if (!schoolIds.length) return [];
  const { data, error } = await supabase
    .from('school_term_dates')
    .select('*')
    .in('school_id', schoolIds)
    .order('date');
  if (error) throw error;
  return data || [];
}

async function getActivitiesByChildIds(childIds) {
  if (!childIds.length) return [];
  const { data, error } = await supabase
    .from('child_weekly_schedule')
    .select('*')
    .in('child_id', childIds)
    .order('day_of_week');
  if (error) throw error;
  return data || [];
}

async function deleteSchoolTermDate(dateId) {
  const { error } = await supabase
    .from('school_term_dates')
    .delete()
    .eq('id', dateId);
  if (error) throw error;
}

async function updateSchoolTermDate(dateId, updates) {
  const allowed = {};
  if (updates.date !== undefined) allowed.date = updates.date;
  if (updates.end_date !== undefined) allowed.end_date = updates.end_date;
  if (updates.label !== undefined) allowed.label = updates.label;
  if (updates.event_type !== undefined) allowed.event_type = updates.event_type;
  const { data, error } = await supabase
    .from('school_term_dates')
    .update(allowed)
    .eq('id', dateId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateHouseholdSchoolMeta(schoolId, meta) {
  const allowed = {};
  if (meta.term_dates_source !== undefined) allowed.term_dates_source = meta.term_dates_source;
  if (meta.term_dates_last_updated !== undefined) allowed.term_dates_last_updated = meta.term_dates_last_updated;
  if (meta.ical_last_sync !== undefined) allowed.ical_last_sync = meta.ical_last_sync;
  if (meta.ical_last_sync_status !== undefined) allowed.ical_last_sync_status = meta.ical_last_sync_status;
  const { data, error } = await supabase
    .from('household_schools')
    .update(allowed)
    .eq('id', schoolId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTermDatesBySchoolAndAcademicYear(schoolId, academicYear) {
  const { error } = await supabase
    .from('school_term_dates')
    .delete()
    .eq('school_id', schoolId)
    .eq('academic_year', academicYear);
  if (error) throw error;
}

async function deleteAllTermDatesBySchool(schoolId) {
  const { error } = await supabase
    .from('school_term_dates')
    .delete()
    .eq('school_id', schoolId);
  if (error) throw error;
}

async function getSchoolsWithIcalUrls() {
  const { data, error } = await supabase
    .from('household_schools')
    .select('*')
    .not('ical_url', 'is', null)
    .neq('ical_url', '');
  if (error) throw error;
  return data || [];
}

async function addChildActivity(data) {
  const { data: activity, error } = await supabase
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

async function getChildActivities(childId) {
  const { data, error } = await supabase
    .from('child_weekly_schedule')
    .select('*')
    .eq('child_id', childId)
    .order('day_of_week');
  if (error) throw error;
  return data || [];
}

async function deleteChildActivity(activityId) {
  const { error } = await supabase
    .from('child_weekly_schedule')
    .delete()
    .eq('id', activityId);
  if (error) throw error;
}

async function addChildSchoolEvent(data) {
  const { data: event, error } = await supabase
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

async function getChildSchoolEvents(childId) {
  const { data, error } = await supabase
    .from('child_school_events')
    .select('*')
    .eq('child_id', childId)
    .order('date');
  if (error) throw error;
  return data || [];
}

// ─── WhatsApp helpers ────────────────────────────────────────────────────────

async function getUserByWhatsAppPhone(phone) {
  // Normalise: strip whatsapp: prefix and ensure + prefix
  const clean = phone.replace(/^whatsapp:/, '').trim();
  const normalised = clean.startsWith('+') ? clean : `+${clean}`;

  const { data, error } = await supabase
    .from('users')
    .select()
    .eq('whatsapp_phone', normalised)
    .eq('whatsapp_linked', true)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function createWhatsAppVerificationCode(userId, phone, code, expiresAt) {
  const { data, error } = await supabase
    .from('whatsapp_verification_codes')
    .insert({ user_id: userId, phone, code, expires_at: expiresAt })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getWhatsAppVerificationCode(userId, code) {
  const { data, error } = await supabase
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

async function markWhatsAppVerificationCodeUsed(id) {
  const { error } = await supabase
    .from('whatsapp_verification_codes')
    .update({ used: true })
    .eq('id', id);
  if (error) throw error;
}

// ─── Invites ────────────────────────────────────────────────────────────────

async function createInvite({ householdId, email, token, invitedBy, expiresAt, name, family_role, birthday, color_theme }) {
  const row = { household_id: householdId, email, token, invited_by: invitedBy, expires_at: expiresAt };
  if (name) row.name = name;
  if (family_role) row.family_role = family_role;
  if (birthday) row.birthday = birthday;
  if (color_theme) row.color_theme = color_theme;
  const { data, error } = await supabase
    .from('invites')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getInviteByToken(token) {
  const { data, error } = await supabase
    .from('invites')
    .select()
    .eq('token', token)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function markInviteAccepted(inviteId) {
  const { error } = await supabase
    .from('invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', inviteId);
  if (error) throw error;
}

async function deleteInvite(inviteId, householdId) {
  const { error } = await supabase
    .from('invites')
    .delete()
    .eq('id', inviteId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function getPendingInvites(householdId) {
  const { data, error } = await supabase
    .from('invites')
    .select()
    .eq('household_id', householdId)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function deleteUser(userId, householdId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', userId)
    .eq('household_id', householdId);
  if (error) throw error;
}

// ─── Shopping Items ───────────────────────────────────────────────────────────

async function addShoppingItems(householdId, items, addedByUserId) {
  if (!items.length) return [];
  const rows = items.map((i) => ({
    household_id: householdId,
    item: i.item,
    category: i.category || 'other',
    quantity: i.quantity || null,
    added_by: addedByUserId,
    list_id: i.list_id || null,
    aisle_category: i.aisle_category || 'Other',
  }));
  const { data, error } = await supabase.from('shopping_items').insert(rows).select();
  if (error) throw error;
  return data;
}

async function getShoppingList(householdId, { includeCompleted = false, listId } = {}) {
  let query = supabase
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

async function completeShoppingItemsByName(householdId, itemNames) {
  // Find items matching the names (case-insensitive, incomplete only)
  const lowerNames = itemNames.map((n) => n.toLowerCase());
  const { data: items, error: fetchErr } = await supabase
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false);
  if (fetchErr) throw fetchErr;

  const matched = items.filter((i) => lowerNames.some((n) => i.item.toLowerCase().includes(n) || n.includes(i.item.toLowerCase())));
  if (!matched.length) return [];

  const ids = matched.map((i) => i.id);
  const { data, error } = await supabase
    .from('shopping_items')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .in('id', ids)
    .select();
  if (error) throw error;
  return data;
}

async function completeShoppingItemById(id) {
  const { data, error } = await supabase
    .from('shopping_items')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

async function addTasks(householdId, tasks, addedByUserId, members = []) {
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

  const { data, error } = await supabase.from('tasks').insert(rows).select();
  if (error) throw error;
  return data;
}

async function getTasks(householdId, { assignedToId = null, includeCompleted = false, all = false } = {}) {
  let query = supabase
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

async function getAllIncompleteTasks(householdId) {
  const { data, error } = await supabase
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false)
    .order('due_date')
    .order('created_at');
  if (error) throw error;
  return data;
}

async function completeTask(taskId) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function completeTasksByName(householdId, taskTitles, assigneeName = null) {
  const lowerTitles = taskTitles.map((t) => t.toLowerCase());
  let query = supabase
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', false);

  if (assigneeName) query = query.ilike('assigned_to_name', assigneeName);

  const { data: tasks, error: fetchErr } = await query;
  if (fetchErr) throw fetchErr;

  const matched = tasks.filter((t) =>
    lowerTitles.some((n) => t.title.toLowerCase().includes(n) || n.includes(t.title.toLowerCase()))
  );
  if (!matched.length) return [];

  const completed = await Promise.all(matched.map((t) => completeTask(t.id)));
  return completed;
}

async function generateNextRecurrence(task) {
  const due = new Date(task.due_date);
  switch (task.recurrence) {
    case 'daily':     due.setDate(due.getDate() + 1); break;
    case 'weekly':    due.setDate(due.getDate() + 7); break;
    case 'biweekly':  due.setDate(due.getDate() + 14); break;
    case 'monthly':   due.setMonth(due.getMonth() + 1); break;
    case 'yearly':    due.setFullYear(due.getFullYear() + 1); break;
    default: return null;
  }

  const { data, error } = await supabase
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

async function getAllHouseholds() {
  const { data, error } = await supabase.from('households').select();
  if (error) throw error;
  return data;
}

async function getTasksDueNextWeek(householdId) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() + 1);
  const to = new Date(today);
  to.setDate(to.getDate() + 7);

  const { data, error } = await supabase
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

async function getCompletedThisWeek(householdId) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [{ data: tasks }, { data: items }] = await Promise.all([
    supabase.from('tasks').select().eq('household_id', householdId).eq('completed', true).gte('completed_at', weekAgo.toISOString()),
    supabase.from('shopping_items').select().eq('household_id', householdId).eq('completed', true).gte('completed_at', weekAgo.toISOString()),
  ]);

  return { tasks: tasks || [], shoppingItems: items || [] };
}

async function getRecentlyCompletedTasks(householdId, hours = 24) {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const { data, error } = await supabase
    .from('tasks')
    .select()
    .eq('household_id', householdId)
    .eq('completed', true)
    .gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getRecentlyCompletedShopping(householdId, hours = 24) {
  const since = new Date();
  since.setHours(since.getHours() - hours);
  const { data, error } = await supabase
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .eq('completed', true)
    .gte('completed_at', since.toISOString())
    .order('completed_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function uncompleteTask(taskId, householdId) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ completed: false, completed_at: null })
    .eq('id', taskId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function uncompleteShoppingItem(itemId, householdId) {
  const { data, error } = await supabase
    .from('shopping_items')
    .update({ completed: false, completed_at: null })
    .eq('id', itemId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteTask(taskId, householdId) {
  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function deleteShoppingItem(itemId, householdId) {
  const { error } = await supabase
    .from('shopping_items')
    .delete()
    .eq('id', itemId)
    .eq('household_id', householdId);
  if (error) throw error;
}

// ─── Shopping Lists ──────────────────────────────────────────────────────────

async function getShoppingLists(householdId) {
  const { data, error } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at');
  if (error) throw error;
  return data;
}

async function createShoppingList(householdId, name) {
  const { data, error } = await supabase
    .from('shopping_lists')
    .insert({ household_id: householdId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteShoppingList(listId, householdId) {
  const { data, error } = await supabase
    .from('shopping_lists')
    .delete()
    .eq('id', listId)
    .eq('household_id', householdId);
  if (error) throw error;
  return data;
}

const DEFAULT_SHOPPING_LISTS = ['Default', 'M&S', 'Tesco', 'Waitrose', "Sainsbury's", 'Aldi'];

async function getDefaultShoppingList(householdId) {
  let { data } = await supabase
    .from('shopping_lists')
    .select('*')
    .eq('household_id', householdId)
    .eq('name', 'Default')
    .single();
  if (!data) {
    // Create all default lists for this household
    const rows = DEFAULT_SHOPPING_LISTS.map(name => ({ household_id: householdId, name }));
    await supabase.from('shopping_lists').insert(rows);
    const result = await supabase
      .from('shopping_lists')
      .select('*')
      .eq('household_id', householdId)
      .eq('name', 'Default')
      .single();
    data = result.data;
  }
  return data;
}

async function getOverdueTasksForUser(householdId, userId) {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
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

async function getTasksForUser(householdId, userId) {
  const { data, error } = await supabase
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

async function getCalendarEvents(householdId, startDate, endDate, { userId, category } = {}) {
  let query = supabase
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
    const fallback = await supabase
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

async function getTasksByDateRange(householdId, startDate, endDate) {
  const { data, error } = await supabase
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

async function createCalendarEvent(householdId, eventData, createdByUserId) {
  const { data, error } = await supabase
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

async function updateCalendarEvent(eventId, householdId, updates) {
  const { data, error } = await supabase
    .from('calendar_events')
    .update(updates)
    .eq('id', eventId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function softDeleteCalendarEvent(eventId, householdId) {
  const { data, error } = await supabase
    .from('calendar_events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', eventId)
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteCalendarEvent(eventId, householdId) {
  return softDeleteCalendarEvent(eventId, householdId);
}

async function getDeletedCalendarEvents(householdId) {
  const { data, error } = await supabase
    .from('calendar_events')
    .select()
    .eq('household_id', householdId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function restoreCalendarEvent(eventId, householdId) {
  const { data, error } = await supabase
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

async function permanentlyDeleteCalendarEvent(eventId, householdId) {
  const { error } = await supabase
    .from('calendar_events')
    .delete()
    .eq('id', eventId)
    .eq('household_id', householdId);
  if (error) throw error;
}

async function getOrCreateFeedToken(userId, householdId) {
  // Check for existing token
  const { data: existing } = await supabase
    .from('calendar_feed_tokens')
    .select()
    .eq('user_id', userId)
    .eq('household_id', householdId)
    .single();

  if (existing) return existing;

  // Create new token
  const token = crypto.randomBytes(32).toString('hex');
  const { data, error } = await supabase
    .from('calendar_feed_tokens')
    .insert({ user_id: userId, household_id: householdId, token })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function regenerateFeedToken(userId, householdId) {
  // Delete old token
  await supabase
    .from('calendar_feed_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('household_id', householdId);

  // Create new token
  const token = crypto.randomBytes(32).toString('hex');
  const { data, error } = await supabase
    .from('calendar_feed_tokens')
    .insert({ user_id: userId, household_id: householdId, token })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getFeedTokenData(token) {
  const { data, error } = await supabase
    .from('calendar_feed_tokens')
    .select()
    .eq('token', token)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getAllEventsForFeed(householdId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const oneYearAhead = new Date();
  oneYearAhead.setFullYear(oneYearAhead.getFullYear() + 1);

  const [{ data: events }, { data: tasks }] = await Promise.all([
    supabase
      .from('calendar_events')
      .select()
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .gte('start_time', thirtyDaysAgo.toISOString())
      .lte('start_time', oneYearAhead.toISOString())
      .order('start_time'),
    supabase
      .from('tasks')
      .select()
      .eq('household_id', householdId)
      .eq('completed', false)
      .order('due_date'),
  ]);

  return { events: events || [], tasks: tasks || [] };
}

// ─── Calendar Connections (two-way sync) ─────────────────────────────────────

async function getCalendarConnections(userId) {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select()
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

async function upsertCalendarConnection(userId, householdId, provider, connectionData) {
  const { data, error } = await supabase
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

async function deleteCalendarConnection(userId, provider) {
  const { error } = await supabase
    .from('calendar_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  if (error) throw error;
}

async function getConnectionsByHousehold(householdId) {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select()
    .eq('household_id', householdId)
    .eq('sync_enabled', true);
  if (error) throw error;
  return data;
}

async function createSyncMapping(eventId, connectionId, externalEventId, etag) {
  const { data, error } = await supabase
    .from('calendar_sync_mappings')
    .upsert({
      event_id: eventId,
      connection_id: connectionId,
      external_event_id: externalEventId,
      external_etag: etag || null,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'event_id,connection_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getSyncMapping(eventId, connectionId) {
  const { data, error } = await supabase
    .from('calendar_sync_mappings')
    .select()
    .eq('event_id', eventId)
    .eq('connection_id', connectionId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getSyncMappingByExternalId(connectionId, externalEventId) {
  const { data, error } = await supabase
    .from('calendar_sync_mappings')
    .select()
    .eq('connection_id', connectionId)
    .eq('external_event_id', externalEventId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getSyncMappingsByConnection(connectionId) {
  const { data, error } = await supabase
    .from('calendar_sync_mappings')
    .select()
    .eq('connection_id', connectionId);
  if (error) throw error;
  return data || [];
}

async function deleteSyncMapping(eventId, connectionId) {
  const { error } = await supabase
    .from('calendar_sync_mappings')
    .delete()
    .eq('event_id', eventId)
    .eq('connection_id', connectionId);
  if (error) throw error;
}

// ─── Calendar Subscriptions ──────────────────────────────────────────────────

async function getSubscriptionsByConnection(connectionId) {
  const { data, error } = await supabase
    .from('calendar_subscriptions')
    .select()
    .eq('connection_id', connectionId)
    .order('display_name');
  // Table may not exist until migration is run
  if (error && error.code === '42P01') return [];
  if (error) throw error;
  return data;
}

async function getEnabledSubscriptionsByConnection(connectionId) {
  const { data, error } = await supabase
    .from('calendar_subscriptions')
    .select()
    .eq('connection_id', connectionId)
    .eq('sync_enabled', true)
    .order('display_name');
  if (error) throw error;
  return data;
}

async function upsertSubscription(connectionId, subData) {
  const { data, error } = await supabase
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

async function getSubscriptionById(subscriptionId) {
  const { data, error } = await supabase
    .from('calendar_subscriptions')
    .select()
    .eq('id', subscriptionId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function updateSubscription(subscriptionId, updates) {
  const allowed = {};
  if (updates.category !== undefined) allowed.category = updates.category;
  if (updates.visibility !== undefined) allowed.visibility = updates.visibility;
  if (updates.sync_enabled !== undefined) allowed.sync_enabled = updates.sync_enabled;
  if (updates.last_synced_at !== undefined) allowed.last_synced_at = updates.last_synced_at;
  if (updates.sync_token !== undefined) allowed.sync_token = updates.sync_token;
  const { data, error } = await supabase
    .from('calendar_subscriptions')
    .update(allowed)
    .eq('id', subscriptionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteSubscription(subscriptionId) {
  // Delete synced events first
  await supabase
    .from('calendar_events')
    .delete()
    .eq('subscription_id', subscriptionId);
  // Then delete the subscription (cascade deletes sync mappings)
  const { error } = await supabase
    .from('calendar_subscriptions')
    .delete()
    .eq('id', subscriptionId);
  if (error) throw error;
}

async function getConnectionByUserAndProvider(userId, provider) {
  const { data, error } = await supabase
    .from('calendar_connections')
    .select()
    .eq('user_id', userId)
    .eq('provider', provider)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getSyncMappingsBySubscription(subscriptionId) {
  const { data, error } = await supabase
    .from('calendar_sync_mappings')
    .select()
    .eq('subscription_id', subscriptionId);
  if (error) throw error;
  return data;
}

async function createSyncMappingWithSubscription(eventId, connectionId, subscriptionId, externalEventId, etag) {
  const { data, error } = await supabase
    .from('calendar_sync_mappings')
    .upsert({
      event_id: eventId,
      connection_id: connectionId,
      subscription_id: subscriptionId,
      external_event_id: externalEventId,
      external_etag: etag || null,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'event_id,connection_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function createCalendarEventFromSync(householdId, eventData, sourceUserId, subscriptionId, category, visibility) {
  // Ensure timestamps are valid for timestamptz columns (bare dates need time appended)
  let startTime = eventData.start_time;
  let endTime = eventData.end_time;
  if (startTime && !startTime.includes('T')) startTime = `${startTime}T00:00:00Z`;
  if (endTime && !endTime.includes('T')) endTime = `${endTime}T00:00:00Z`;

  const { data, error } = await supabase
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

// ─── Meal Plan ──────────────────────────────────────────────────────────────

async function getMealPlanForWeek(householdId, startDate, endDate) {
  const { data, error } = await supabase
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

async function getRecurringMeals(householdId) {
  const { data, error } = await supabase
    .from('meal_plan')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_recurring', true);
  if (error) throw error;
  return data;
}

async function createMealPlanEntry(householdId, data, userId) {
  const { data: meal, error } = await supabase
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

async function updateMealPlanEntry(mealId, householdId, updates) {
  const { data, error } = await supabase
    .from('meal_plan')
    .update(updates)
    .eq('id', mealId)
    .eq('household_id', householdId)
    .select('*, recipes(*)')
    .single();
  if (error) throw error;
  return data;
}

async function deleteMealPlanEntry(mealId, householdId) {
  const { error } = await supabase
    .from('meal_plan')
    .delete()
    .eq('id', mealId)
    .eq('household_id', householdId);
  if (error) throw error;
}

// ─── Recipes ────────────────────────────────────────────────────────────────

async function getRecipes(householdId, filters = {}) {
  let query = supabase
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

async function getRecipeById(recipeId, householdId) {
  const { data, error } = await supabase
    .from('recipes')
    .select()
    .eq('id', recipeId)
    .eq('household_id', householdId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getLatestRecipe(householdId) {
  const { data, error } = await supabase
    .from('recipes')
    .select()
    .eq('household_id', householdId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function createRecipe(householdId, recipeData) {
  const { data, error } = await supabase
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

async function updateRecipe(recipeId, householdId, updates) {
  updates.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('recipes')
    .update(updates)
    .eq('id', recipeId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteRecipe(recipeId, householdId) {
  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', recipeId)
    .eq('household_id', householdId);
  if (error) throw error;
}

// ─── Meal Categories ────────────────────────────────────────────────────────

async function getMealCategories(householdId) {
  const { data, error } = await supabase
    .from('meal_categories')
    .select()
    .eq('household_id', householdId)
    .order('sort_order');
  if (error) throw error;
  return data;
}

async function createDefaultMealCategories(householdId) {
  const defaults = [
    { household_id: householdId, name: 'Breakfast', colour: '#F5CBA7', sort_order: 0, active: true },
    { household_id: householdId, name: 'Lunch', colour: '#A9DFBF', sort_order: 1, active: true },
    { household_id: householdId, name: 'Dinner', colour: '#AED6F1', sort_order: 2, active: true },
    { household_id: householdId, name: 'Snack', colour: '#D7BDE2', sort_order: 3, active: true },
  ];
  const { data, error } = await supabase
    .from('meal_categories')
    .insert(defaults)
    .select();
  if (error) throw error;
  return data;
}

async function updateMealCategory(categoryId, householdId, updates) {
  const { data, error } = await supabase
    .from('meal_categories')
    .update(updates)
    .eq('id', categoryId)
    .eq('household_id', householdId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getRecentMeals(householdId, days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from('meal_plan')
    .select()
    .eq('household_id', householdId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}

async function getRecentPurchases(householdId, days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
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

async function getAllUsersAdmin({ search, page = 1, limit = 50 } = {}) {
  let query = supabase
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

async function getUserByIdAdmin(userId) {
  const { data: user, error } = await supabase
    .from('users')
    .select()
    .eq('id', userId)
    .single();
  if (error) throw error;

  let household = null;
  if (user.household_id) {
    const { data: h } = await supabase
      .from('households')
      .select()
      .eq('id', user.household_id)
      .single();
    household = h;
  }

  return { ...user, household };
}

async function getAllHouseholdsAdmin({ search, page = 1, limit = 50 } = {}) {
  let query = supabase
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
    const { data: users } = await supabase
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

async function getHouseholdDetailAdmin(householdId) {
  const { data: household, error } = await supabase
    .from('households')
    .select()
    .eq('id', householdId)
    .single();
  if (error) throw error;

  const { data: members } = await supabase
    .from('users')
    .select('id, name, email, role, member_type, color_theme, avatar_url, is_platform_admin, disabled_at, created_at')
    .eq('household_id', householdId)
    .order('created_at');

  return { ...household, members: members || [] };
}

async function getPlatformStats() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [usersResult, householdsResult, newUsersResult, newHouseholdsResult] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('households').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('households').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
  ]);

  return {
    totalUsers: usersResult.count || 0,
    totalHouseholds: householdsResult.count || 0,
    newUsersThisWeek: newUsersResult.count || 0,
    newHouseholdsThisWeek: newHouseholdsResult.count || 0,
  };
}

async function disableUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ disabled_at: new Date().toISOString() })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function enableUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .update({ disabled_at: null })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteUser(userId) {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);
  if (error) throw error;
}

async function setUserPlatformAdmin(userId, isPlatformAdmin) {
  const { data, error } = await supabase
    .from('users')
    .update({ is_platform_admin: isPlatformAdmin })
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Phase 2 Admin: AI Usage ─────────────────────────────────────────────────

async function getAiUsageStats({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [totalRes, byProviderRes, byFeatureRes, failoverRes, avgLatencyRes] = await Promise.all([
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).gte('created_at', since),
    supabase.from('ai_usage_log').select('provider').gte('created_at', since),
    supabase.from('ai_usage_log').select('feature').gte('created_at', since),
    supabase.from('ai_usage_log').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('is_failover', true),
    supabase.from('ai_usage_log').select('latency_ms').gte('created_at', since).not('latency_ms', 'is', null),
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

async function getAiUsageTimeline({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
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

async function logWhatsAppMessage({ householdId, userId, direction, messageType, intent, processingMs, error }) {
  supabase
    .from('whatsapp_message_log')
    .insert({
      household_id: householdId || null,
      user_id: userId || null,
      direction,
      message_type: messageType,
      intent: intent || null,
      processing_ms: processingMs || null,
      error: error || null,
    })
    .then(() => {})
    .catch((err) => console.error('[whatsapp-log] Failed to log message:', err.message));
}

async function getWhatsAppStats({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
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

async function getWhatsAppTimeline({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
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

async function getCalendarSyncHealth() {
  const { data: connections, error } = await supabase
    .from('calendar_connections')
    .select('id, user_id, household_id, provider, sync_enabled, token_expires_at, created_at');
  if (error) throw error;

  // Get user names
  const userIds = [...new Set((connections || []).map((c) => c.user_id))];
  let userMap = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, name, email').in('id', userIds);
    for (const u of users || []) userMap[u.id] = u;
  }

  // Get sync mapping stats per connection
  const result = [];
  for (const conn of connections || []) {
    const { data: mappings } = await supabase
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

async function getAnalytics({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // DAU: distinct users with activity per day
  const [shoppingRes, tasksRes, calendarRes, chatRes] = await Promise.all([
    supabase.from('shopping_items').select('added_by, created_at').gte('created_at', since),
    supabase.from('tasks').select('added_by, created_at').gte('created_at', since),
    supabase.from('calendar_events').select('created_by, created_at').gte('created_at', since),
    supabase.from('chat_messages').select('user_id, created_at').gte('created_at', since).eq('role', 'user'),
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
    supabase.from('users').select('id', { count: 'exact', head: true }).not('email', 'is', null),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('email_verified', true),
    supabase.from('users').select('id', { count: 'exact', head: true }).not('household_id', 'is', null),
    supabase.from('invites').select('id, accepted_at', { count: 'exact' }),
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

async function getAiUsageTopHouseholds({ days = 30, limit = 10 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
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
  const { data: households } = await supabase.from('households').select('id, name').in('id', ids);
  const nameMap = {};
  for (const h of households || []) nameMap[h.id] = h.name;

  return sorted.map(([id, calls]) => ({ household_id: id, name: nameMap[id] || 'Unknown', calls }));
}

async function getAiUsageTopUsers({ days = 30, limit = 10 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
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
  const { data: users } = await supabase.from('users').select('id, name, email').in('id', ids);
  const userMap = {};
  for (const u of users || []) userMap[u.id] = u;

  return sorted.map(([id, calls]) => ({ user_id: id, name: userMap[id]?.name || 'Unknown', email: userMap[id]?.email || '', calls }));
}

async function getUserUsageStats(userId, { days = 30 } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [aiRes, waRes] = await Promise.all([
    supabase.from('ai_usage_log').select('provider, feature, latency_ms, is_failover, created_at').eq('user_id', userId).gte('created_at', since),
    supabase.from('whatsapp_message_log').select('direction, message_type, intent, processing_ms, error, created_at').eq('user_id', userId).gte('created_at', since),
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
  // Notes
  getHouseholdNotes,
  upsertHouseholdNote,
  deleteHouseholdNote,
  // WhatsApp
  getUserByWhatsAppPhone,
  createWhatsAppVerificationCode,
  getWhatsAppVerificationCode,
  markWhatsAppVerificationCodeUsed,
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
  // Calendar
  getCalendarEvents,
  getTasksByDateRange,
  createCalendarEvent,
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
  // Calendar subscriptions
  getSubscriptionsByConnection,
  getEnabledSubscriptionsByConnection,
  upsertSubscription,
  getSubscriptionById,
  updateSubscription,
  deleteSubscription,
  getConnectionByUserAndProvider,
  getSyncMappingsBySubscription,
  createSyncMappingWithSubscription,
  createCalendarEventFromSync,
  // Dependents
  createDependent,
  deleteDependent,
  // Chat
  getChatHistory,
  saveChatMessage,
  clearChatHistory,
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
  deleteUser,
  setUserPlatformAdmin,
  // Platform admin Phase 2
  getAiUsageStats,
  getAiUsageTimeline,
  logWhatsAppMessage,
  getWhatsAppStats,
  getWhatsAppTimeline,
  getCalendarSyncHealth,
  getAnalytics,
  getAiUsageTopHouseholds,
  getAiUsageTopUsers,
  getUserUsageStats,
};
