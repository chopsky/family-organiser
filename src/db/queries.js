const { supabase } = require('./client');
const crypto = require('crypto');

// ─── Households ───────────────────────────────────────────────────────────────

function generateJoinCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // e.g. "A3F9B2"
}

async function createHousehold(name) {
  const join_code = generateJoinCode();
  const { data, error } = await supabase
    .from('households')
    .insert({ name, join_code })
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

async function createUser({ householdId, name, telegramChatId, telegramUsername, role = 'member' }) {
  const { data, error } = await supabase
    .from('users')
    .insert({
      household_id: householdId,
      name,
      telegram_chat_id: String(telegramChatId),
      telegram_username: telegramUsername || null,
      role,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getUserByTelegramId(telegramChatId) {
  const { data, error } = await supabase
    .from('users')
    .select()
    .eq('telegram_chat_id', String(telegramChatId))
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
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

// ─── Token helpers (verification, reset, telegram link) ─────────────────────

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

const createTelegramLinkToken = (userId, token, expiresAt) => createToken('telegram_link_tokens', { userId, token, expiresAt });
const getTelegramLinkToken = (token) => getValidToken('telegram_link_tokens', token);
const markTelegramLinkTokenUsed = (id) => markTokenUsed('telegram_link_tokens', id);

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
      recurrence: t.recurrence || null,
      priority: t.priority || 'medium',
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

module.exports = {
  getAllHouseholds,
  getTasksDueNextWeek,
  createHousehold,
  getHouseholdByCode,
  getHouseholdById,
  updateHouseholdSettings,
  createUser,
  getUserByTelegramId,
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
  createTelegramLinkToken,
  getTelegramLinkToken,
  markTelegramLinkTokenUsed,
  createInvite,
  getInviteByToken,
  markInviteAccepted,
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
};
