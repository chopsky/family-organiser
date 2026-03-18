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

// ─── Chat message helpers ────────────────────────────────────────────────────

async function getChatHistory(userId, limit = 50) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select()
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
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

async function createInvite({ householdId, email, token, invitedBy, expiresAt }) {
  const { data, error } = await supabase
    .from('invites')
    .insert({ household_id: householdId, email, token, invited_by: invitedBy, expires_at: expiresAt })
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
  }));
  const { data, error } = await supabase.from('shopping_items').insert(rows).select();
  if (error) throw error;
  return data;
}

async function getShoppingList(householdId, { includeCompleted = false } = {}) {
  let query = supabase
    .from('shopping_items')
    .select()
    .eq('household_id', householdId)
    .order('created_at');
  if (!includeCompleted) query = query.eq('completed', false);
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

async function deleteCalendarEvent(eventId, householdId) {
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
  // Chat
  getChatHistory,
  saveChatMessage,
  clearChatHistory,
  getSupabase: () => supabase,
};
