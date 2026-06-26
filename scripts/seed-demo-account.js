#!/usr/bin/env node
/**
 * Seed a demo Housemait household for App Store screenshots + live demos.
 *
 * Populates a "Bennett family" account with realistic data across every
 * screen: dashboard, calendar, tasks (chores + routines + stars), rewards,
 * lists (to-dos + shopping), meals, family.
 *
 * Idempotent + safe to re-run. Rather than deleting the household (whose
 * cascade across the prod DB hits a statement timeout), it REFRESHES IN
 * PLACE: it reuses the existing account + members, clears only the demo
 * content tables (each a small scoped delete), resets the password to a
 * known value, and re-inserts. If the account doesn't exist yet it creates
 * the household + family from scratch.
 *
 * Usage:
 *   node scripts/seed-demo-account.js
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env (prod keys).
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { supabaseAdmin: db } = require('../src/db/client');
const RECIPE_CONTENT = require('./demo-recipes'); // ingredients + method keyed by recipe name

// ─── Config ──────────────────────────────────────────────────────────────────

const DEMO_PASSWORD = 'DemoHousemait2026!';
const DEMO_TZ       = 'Europe/London';

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const NOW = new Date().toISOString();

function dateOffset(days) { const d = new Date(TODAY); d.setDate(d.getDate() + days); return d; }
function ymd(date) { return date.toISOString().split('T')[0]; }
function iso(date, h = 0, m = 0) { const d = new Date(date); d.setHours(h, m, 0, 0); return d.toISOString(); }
const TODAY_YMD = ymd(TODAY);

// ─── Low-level helpers ───────────────────────────────────────────────────────

async function insert(table, row) {
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`Insert ${table} failed: ${error.message}`);
  return data;
}
async function insertMany(table, rows) {
  if (rows.length === 0) return [];
  const { data, error } = await db.from(table).insert(rows).select();
  if (error) throw new Error(`Insert many ${table} failed: ${error.message}`);
  return data;
}
// Scoped delete; tolerate a table that doesn't exist yet (migration not applied).
async function clearTable(table, householdId) {
  const { error } = await db.from(table).delete().eq('household_id', householdId);
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    throw new Error(`Clear ${table} failed: ${error.message}`);
  }
}

// Wipe only the demo CONTENT for a household, child tables before parents.
// Scoped per-table by household_id (indexed) so each is a fast statement -
// unlike a household cascade delete, which times out on the prod DB.
async function clearContent(hid) {
  for (const t of [
    'chore_completions', 'chore_skips', 'star_transactions', 'reward_redemptions',
    'chore_definitions', 'rewards',
    'shopping_items', 'shopping_lists',
    'meal_plan', 'recipes', 'meal_categories',
    'calendar_events', 'tasks',
  ]) {
    await clearTable(t, hid);
  }
}

// ─── Resolve (or create) the account + members ───────────────────────────────

async function ensureDependent(hid, { name, color_theme, family_role, birthday }) {
  const { data: existing } = await db.from('users')
    .select('id, name').eq('household_id', hid).eq('member_type', 'dependent').eq('name', name).maybeSingle();
  if (existing) return existing;
  return insert('users', {
    name, email: null, password_hash: null, household_id: hid,
    role: 'member', member_type: 'dependent', email_verified: false,
    color_theme, family_role, birthday,
  });
}

async function resolveAccount(passwordHash) {
  const { data: sarahRow } = await db.from('users')
    .select('id, household_id').eq('email', 'sarah.demo@housemait.com').maybeSingle();

  // ── Existing account → refresh in place (no household/user delete) ──
  if (sarahRow) {
    const hid = sarahRow.household_id;
    console.log(`→ Existing demo found (household ${hid}) - refreshing in place`);

    await db.from('households').update({
      name: 'The Bennetts', country: 'GB', is_internal: true,
      subscription_status: 'active', trial_ends_at: ymd(dateOffset(3650)),
      timezone: DEMO_TZ, reminder_time: '07:30:00',
    }).eq('id', hid);

    // Sarah + James: reset to known password, mark onboarded so login lands on
    // the dashboard (not the onboarding flow).
    await db.from('users').update({
      password_hash: passwordHash, onboarded_at: NOW, email_verified: true,
      color_theme: 'plum', family_role: 'Mum', member_type: 'account', role: 'admin',
    }).eq('id', sarahRow.id);

    let { data: james } = await db.from('users')
      .select('id, name').eq('email', 'james.demo@housemait.com').maybeSingle();
    if (james) {
      await db.from('users').update({
        password_hash: passwordHash, onboarded_at: NOW, email_verified: true,
        household_id: hid, color_theme: 'sage', family_role: 'Dad', member_type: 'account', role: 'member',
      }).eq('id', james.id);
    } else {
      james = await insert('users', {
        name: 'James Bennett', email: 'james.demo@housemait.com', password_hash: passwordHash,
        household_id: hid, role: 'member', member_type: 'account', email_verified: true,
        onboarded_at: NOW, color_theme: 'sage', family_role: 'Dad', birthday: '1986-11-02',
        timezone: DEMO_TZ, reminder_time: '07:30:00',
      });
    }

    const olivia = await ensureDependent(hid, { name: 'Olivia', color_theme: 'coral', family_role: 'Daughter', birthday: '2017-03-22' });
    const henry  = await ensureDependent(hid, { name: 'Henry',  color_theme: 'amber', family_role: 'Son',      birthday: '2020-09-08' });

    await clearContent(hid);
    return { household: { id: hid, name: 'The Bennetts' }, sarah: { id: sarahRow.id, name: 'Sarah Bennett' }, james, olivia, henry };
  }

  // ── Fresh account → create household + family ──
  console.log('→ No existing demo account, creating fresh');
  const household = await insert('households', {
    name: 'The Bennetts', join_code: crypto.randomBytes(3).toString('hex').toUpperCase(),
    timezone: DEMO_TZ, reminder_time: '07:30:00', country: 'GB', is_internal: true,
    subscription_status: 'active', trial_ends_at: ymd(dateOffset(3650)),
  });
  const sarah = await insert('users', {
    name: 'Sarah Bennett', email: 'sarah.demo@housemait.com', password_hash: passwordHash,
    household_id: household.id, role: 'admin', member_type: 'account', email_verified: true,
    onboarded_at: NOW, color_theme: 'plum', family_role: 'Mum', birthday: '1988-06-14',
    timezone: DEMO_TZ, reminder_time: '07:30:00',
  });
  const james = await insert('users', {
    name: 'James Bennett', email: 'james.demo@housemait.com', password_hash: passwordHash,
    household_id: household.id, role: 'member', member_type: 'account', email_verified: true,
    onboarded_at: NOW, color_theme: 'sage', family_role: 'Dad', birthday: '1986-11-02',
    timezone: DEMO_TZ, reminder_time: '07:30:00',
  });
  const olivia = await ensureDependent(household.id, { name: 'Olivia', color_theme: 'coral', family_role: 'Daughter', birthday: '2017-03-22' });
  const henry  = await ensureDependent(household.id, { name: 'Henry',  color_theme: 'amber', family_role: 'Son',      birthday: '2020-09-08' });
  return { household, sarah, james, olivia, henry };
}

// ─── Seed the demo content ───────────────────────────────────────────────────

async function seedContent({ household, sarah, james, olivia, henry }) {
  const hid = household.id;

  // Shopping lists — a Groceries staple (🛒) + a themed second list.
  const groceries = await insert('shopping_lists', { household_id: hid, name: 'Groceries' });
  const party     = await insert('shopping_lists', { household_id: hid, name: "Mia's party" });

  await insertMany('meal_categories', [
    { household_id: hid, name: 'Breakfast', colour: '#FFD8A8', sort_order: 1, active: true },
    { household_id: hid, name: 'Lunch',     colour: '#AEDFF7', sort_order: 2, active: true },
    { household_id: hid, name: 'Dinner',    colour: '#C8E6C9', sort_order: 3, active: true },
  ]);

  const recipes = await insertMany('recipes', [
    { household_id: hid, name: 'Overnight oats with berries', category: 'breakfast', servings: 4, prep_time_mins: 5, is_favourite: true },
    { household_id: hid, name: 'Avocado toast & poached egg', category: 'breakfast', servings: 2, prep_time_mins: 10 },
    { household_id: hid, name: 'Full English fry-up',         category: 'breakfast', servings: 4, prep_time_mins: 25 },
    { household_id: hid, name: 'Tomato & mozzarella salad',   category: 'lunch',     servings: 4, prep_time_mins: 10 },
    { household_id: hid, name: 'Ham & cheese sandwiches',     category: 'lunch',     servings: 4, prep_time_mins: 5 },
    { household_id: hid, name: 'Chicken Caesar wrap',         category: 'lunch',     servings: 2, prep_time_mins: 15 },
    { household_id: hid, name: 'Spaghetti bolognese',         category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 45, is_favourite: true },
    { household_id: hid, name: 'Thai green curry with rice',  category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 30 },
    { household_id: hid, name: 'Roast chicken with veg',      category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 75, is_favourite: true },
    { household_id: hid, name: 'Homemade pizza night',        category: 'dinner',    servings: 4, prep_time_mins: 30, cook_time_mins: 15 },
    { household_id: hid, name: 'Fish & chips',                category: 'dinner',    servings: 4, prep_time_mins: 10, cook_time_mins: 25 },
    { household_id: hid, name: 'Tacos al pastor',             category: 'dinner',    servings: 4, prep_time_mins: 20, cook_time_mins: 20 },
    { household_id: hid, name: 'Butternut squash risotto',    category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 35 },
  ].map((rc) => ({ ...rc, ...(RECIPE_CONTENT[rc.name] || {}) }))); // merge ingredients + method
  const r = Object.fromEntries(recipes.map((x) => [x.name, x.id]));

  const dayOfWeek = (TODAY.getDay() + 6) % 7; // 0 = Mon
  const breakfasts = ['Overnight oats with berries', 'Avocado toast & poached egg', 'Overnight oats with berries', 'Avocado toast & poached egg', 'Overnight oats with berries', 'Full English fry-up', 'Avocado toast & poached egg'];
  const lunches    = ['Ham & cheese sandwiches', 'Chicken Caesar wrap', 'Tomato & mozzarella salad', 'Ham & cheese sandwiches', 'Chicken Caesar wrap', 'Tomato & mozzarella salad', 'Ham & cheese sandwiches'];
  const dinners    = ['Spaghetti bolognese', 'Tacos al pastor', 'Thai green curry with rice', 'Butternut squash risotto', 'Fish & chips', 'Homemade pizza night', 'Roast chicken with veg'];
  const mealRows = [];
  for (let i = 0; i < 7; i++) {
    const d = dateOffset(-dayOfWeek + i);
    mealRows.push(
      { household_id: hid, recipe_id: r[breakfasts[i]], date: ymd(d), category: 'breakfast', meal_name: breakfasts[i], added_by: sarah.id },
      { household_id: hid, recipe_id: r[lunches[i]],    date: ymd(d), category: 'lunch',     meal_name: lunches[i],    added_by: sarah.id },
      { household_id: hid, recipe_id: r[dinners[i]],    date: ymd(d), category: 'dinner',    meal_name: dinners[i],    added_by: sarah.id },
    );
  }
  await insertMany('meal_plan', mealRows);
  console.log(`✓ Meals: 13 recipes, 7 days × 3 planned`);

  await insertMany('shopping_items', [
    { household_id: hid, list_id: groceries.id, item: 'Milk (2 pints)',    aisle_category: 'Dairy & Eggs',        category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Free-range eggs',   aisle_category: 'Dairy & Eggs',        category: 'groceries', added_by: james.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Greek yoghurt',     aisle_category: 'Dairy & Eggs',        category: 'groceries', added_by: sarah.id, completed: true,  completed_at: NOW },
    { household_id: hid, list_id: groceries.id, item: 'Bananas',           aisle_category: 'Produce',             category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Avocados (3)',      aisle_category: 'Produce',             category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Baby spinach',      aisle_category: 'Produce',             category: 'groceries', added_by: james.id, completed: true,  completed_at: NOW },
    { household_id: hid, list_id: groceries.id, item: 'Cherry tomatoes',   aisle_category: 'Produce',             category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Chicken thighs',    aisle_category: 'Meat & Seafood',      category: 'groceries', added_by: james.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Salmon fillets',    aisle_category: 'Meat & Seafood',      category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Sourdough loaf',    aisle_category: 'Bakery',              category: 'groceries', added_by: sarah.id, completed: true,  completed_at: NOW },
    { household_id: hid, list_id: groceries.id, item: 'Pasta (penne)',     aisle_category: 'Pantry & Grains',     category: 'groceries', added_by: james.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Olive oil',         aisle_category: 'Pantry & Grains',     category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Washing-up liquid', aisle_category: 'Household & Cleaning', category: 'household',  added_by: sarah.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Kitchen roll',      aisle_category: 'Household & Cleaning', category: 'household',  added_by: james.id, completed: false },
    { household_id: hid, list_id: groceries.id, item: 'Shampoo',           aisle_category: 'Personal Care',       category: 'other',      added_by: sarah.id, completed: false },
    { household_id: hid, list_id: party.id, item: 'Birthday candles', aisle_category: 'Other',  category: 'other',     added_by: sarah.id, completed: false },
    { household_id: hid, list_id: party.id, item: 'Balloons',         aisle_category: 'Other',  category: 'other',     added_by: sarah.id, completed: true, completed_at: NOW },
    { household_id: hid, list_id: party.id, item: 'Party bags',       aisle_category: 'Other',  category: 'other',     added_by: james.id, completed: false },
    { household_id: hid, list_id: party.id, item: 'Chocolate cake',   aisle_category: 'Bakery', category: 'groceries', added_by: sarah.id, completed: false },
  ]);
  console.log(`✓ Shopping: Groceries (15) + Mia's party (4)`);

  // To-dos (tasks) - multi-assignee array columns the app reads.
  const A = (u) => ({ assigned_to_ids: u ? [u.id] : [], assigned_to_names: u ? [u.name] : [] });
  const tasks = [
    { title: 'Pay council tax',            due_date: ymd(dateOffset(-3)), due_time: '17:00:00', ...A(sarah), priority: 'high' },
    { title: 'Book dentist for Olivia',    due_date: ymd(dateOffset(-2)), ...A(sarah), priority: 'medium' },
    { title: 'School reading - sign form', due_date: TODAY_YMD, due_time: '18:00:00', ...A(james), priority: 'medium' },
    { title: 'Put bins out',               due_date: TODAY_YMD, ...A(null), recurrence: 'weekly', priority: 'low' },
    { title: 'Water the plants',           due_date: TODAY_YMD, ...A(null), recurrence: 'weekly', priority: 'low' },
    { title: 'Book Henry swimming lesson', due_date: ymd(dateOffset(1)), ...A(sarah), priority: 'medium' },
    { title: 'Car MOT booking',            due_date: ymd(dateOffset(3)), due_time: '09:00:00', ...A(james), priority: 'high', notification: '1_day' },
    { title: 'Wrap birthday gift for Mia', due_date: ymd(dateOffset(4)), ...A(sarah), priority: 'medium' },
    { title: 'Weekly grocery shop',        due_date: ymd(dateOffset(2)), ...A(null), recurrence: 'weekly', priority: 'medium' },
    { title: 'Change bed sheets',          due_date: ymd(dateOffset(5)), ...A(null), recurrence: 'weekly', priority: 'low' },
    { title: 'Reply to Mrs Peters email',  due_date: ymd(dateOffset(-1)), ...A(sarah), priority: 'medium', completed: true, completed_at: new Date(Date.now() - 86400000).toISOString() },
    { title: 'Return library books',       due_date: ymd(dateOffset(-1)), ...A(james), priority: 'low', completed: true, completed_at: new Date(Date.now() - 86400000).toISOString() },
  ];
  await insertMany('tasks', tasks.map((t) => ({ household_id: hid, added_by: sarah.id, completed: false, ...t })));
  console.log(`✓ To-dos: ${tasks.length}`);

  // Chores + routines (Tasks board). All daily so the board is always populated.
  const chore = (def) => ({
    household_id: hid, title: def.title, emoji: def.emoji || null, type: def.type || 'chore',
    anyone: !!def.anyone, assignee_ids: def.assignee_ids || [], whens: def.whens || [],
    repeat: 'daily', days: [], reward: !!def.reward, stars: def.reward ? (def.stars || 0) : 0,
    position: def.position ?? 0, created_by: sarah.id,
  });
  const choreDefs = await insertMany('chore_definitions', [
    chore({ title: 'Make the bed',   emoji: '🛏️', assignee_ids: [olivia.id], reward: true, stars: 1, position: 0 }),
    chore({ title: 'Tidy bedroom',   emoji: '🧸', assignee_ids: [olivia.id], reward: true, stars: 2, position: 1 }),
    chore({ title: 'Practise piano', emoji: '🎹', type: 'routine', whens: ['evening'], assignee_ids: [olivia.id], reward: true, stars: 2, position: 2 }),
    chore({ title: 'Brush teeth',    emoji: '🪥', type: 'routine', whens: ['morning', 'evening'], assignee_ids: [henry.id], reward: true, stars: 1, position: 0 }),
    chore({ title: 'Put toys away',  emoji: '🧱', assignee_ids: [henry.id], reward: true, stars: 1, position: 1 }),
    chore({ title: 'Feed the cat',   emoji: '🐱', assignee_ids: [olivia.id, henry.id], reward: true, stars: 1, position: 3 }),
    chore({ title: 'Empty the dishwasher', emoji: '🍽️', anyone: true, reward: true, stars: 1, position: 0 }),
    chore({ title: 'Take the bins out',    emoji: '🗑️', assignee_ids: [james.id], position: 0 }),
    chore({ title: 'Water the plants',     emoji: '🪴', assignee_ids: [sarah.id], position: 1 }),
  ]);
  const c = Object.fromEntries(choreDefs.map((x) => [x.title, x.id]));
  console.log(`✓ Chores: ${choreDefs.length} (chores + routines, some with stars)`);

  await insertMany('chore_completions', [
    { definition_id: c['Make the bed'],  member_id: olivia.id, household_id: hid, date: TODAY_YMD, slot: '' },
    { definition_id: c['Feed the cat'],  member_id: olivia.id, household_id: hid, date: TODAY_YMD, slot: '' },
    { definition_id: c['Put toys away'], member_id: henry.id,  household_id: hid, date: TODAY_YMD, slot: '' },
    { definition_id: c['Brush teeth'],   member_id: henry.id,  household_id: hid, date: TODAY_YMD, slot: 'morning' },
  ]);

  // Star balances (balance = sum of star_transactions.delta per member)
  const starRows = [];
  const earn = (member, deltas) => deltas.forEach((delta) => starRows.push({ household_id: hid, member_id: member.id, delta, reason: 'earn', ref_type: null, ref_id: null }));
  earn(olivia, [2, 2, 1, 2, 2, 1, 2, 2]); // 14
  earn(henry,  [1, 2, 1, 1, 2, 1]);       // 8
  starRows.push({ household_id: hid, member_id: olivia.id, delta: -5, reason: 'spend', ref_type: 'redeem', ref_id: null });
  await insertMany('star_transactions', starRows);
  console.log(`✓ Stars: Olivia 9 ⭐, Henry 8 ⭐`);

  // Rewards are scoped to the children only (who_ids); the frontend filters
  // purely on who_ids, so the adults don't see them.
  const kidIds = [olivia.id, henry.id];
  const rewards = await insertMany('rewards', [
    { household_id: hid, title: '30 mins extra screen time', emoji: '📺', cost: 5,  who: 'any', who_ids: kidIds, position: 0, created_by: sarah.id },
    { household_id: hid, title: 'Stay up 30 mins late',      emoji: '🌙', cost: 6,  who: 'any', who_ids: kidIds, position: 1, created_by: sarah.id },
    { household_id: hid, title: 'Choose family dinner',      emoji: '🍕', cost: 8,  who: 'any', who_ids: kidIds, position: 2, created_by: sarah.id },
    { household_id: hid, title: '£5 pocket money',           emoji: '💷', cost: 10, who: 'any', who_ids: kidIds, position: 3, created_by: sarah.id },
    { household_id: hid, title: 'Trip to the cinema',        emoji: '🎬', cost: 20, who: 'any', who_ids: kidIds, position: 4, created_by: sarah.id },
  ]);
  const screenTime = rewards.find((x) => x.title.startsWith('30 mins'));
  await insert('reward_redemptions', {
    household_id: hid, reward_id: screenTime.id, member_id: olivia.id,
    title: screenTime.title, emoji: screenTime.emoji, cost: screenTime.cost,
  });
  console.log(`✓ Rewards: ${rewards.length} + 1 redeemed (Olivia)`);

  const events = [
    { title: 'School drop-off',         start: iso(TODAY, 8, 30),  end: iso(TODAY, 9, 0),   who: sarah,  color: 'plum',  recurrence: 'weekly' },
    { title: 'Team standup',            start: iso(TODAY, 9, 30),  end: iso(TODAY, 10, 0),  who: james,  color: 'sage' },
    { title: 'Olivia - ballet class',   start: iso(TODAY, 16, 30), end: iso(TODAY, 17, 30), who: olivia, color: 'coral', location: 'Dance studio' },
    { title: 'Dinner with the Taylors', start: iso(TODAY, 19, 30), end: iso(TODAY, 22, 0),  who: sarah,  color: 'plum',  location: '27 Ashford Rd' },
    { title: 'Henry - playdate w/ Leo', start: iso(dateOffset(1), 10, 0),  end: iso(dateOffset(1), 12, 0),  who: henry,  color: 'amber', location: 'Our house' },
    { title: 'Football training',       start: iso(dateOffset(1), 17, 0),  end: iso(dateOffset(1), 18, 30), who: james,  color: 'sage', recurrence: 'weekly' },
    { title: 'Yoga class',              start: iso(dateOffset(1), 18, 30), end: iso(dateOffset(1), 19, 30), who: sarah,  color: 'plum' },
    { title: 'Grocery shop',            start: iso(dateOffset(2), 10, 0),  end: iso(dateOffset(2), 11, 30), who: james,  color: 'sage' },
    { title: 'Parents evening',         start: iso(dateOffset(2), 18, 0),  end: iso(dateOffset(2), 20, 0),  who: null,   color: 'coral', location: "St. Mary's Primary" },
    { title: "Mia's birthday party",    start: iso(dateOffset(4), 14, 0),  end: iso(dateOffset(4), 16, 30), who: olivia, color: 'coral', location: 'Pizza Express, High St' },
    { title: 'Book club',               start: iso(dateOffset(4), 20, 0),  end: iso(dateOffset(4), 22, 0),  who: sarah,  color: 'plum' },
    { title: 'Swimming lesson',         start: iso(dateOffset(5), 9, 0),   end: iso(dateOffset(5), 10, 0),  who: henry,  color: 'amber', location: 'Leisure centre', recurrence: 'weekly' },
    { title: 'Brunch at Riverside',     start: iso(dateOffset(6), 11, 0),  end: iso(dateOffset(6), 13, 0),  who: null,   color: 'sage', location: 'Riverside Café' },
    { title: 'Dentist - Olivia',        start: iso(dateOffset(8), 15, 30), end: iso(dateOffset(8), 16, 15), who: olivia, color: 'coral', location: 'Smile Dental, Hampstead' },
    { title: 'Work trip - Manchester',  start: iso(dateOffset(10), 8, 0),  end: iso(dateOffset(11), 18, 0), who: james,  color: 'sage' },
  ];
  await insertMany('calendar_events', events.map((e) => ({
    household_id: hid, title: e.title, description: null,
    start_time: e.start, end_time: e.end, all_day: false,
    location: e.location || null, color: e.color, recurrence: e.recurrence || null,
    assigned_to_ids: e.who ? [e.who.id] : [], assigned_to_names: e.who ? [e.who.name] : [],
    created_by: sarah.id,
  })));
  console.log(`✓ Calendar: ${events.length} events across this + next week`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🏠 Seeding Bennett family demo account…\n');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const ctx = await resolveAccount(passwordHash);
  await seedContent(ctx);

  console.log('\n─────────────────────────────────────');
  console.log('🎉 Demo account ready');
  console.log('─────────────────────────────────────');
  console.log(`Email:     sarah.demo@housemait.com`);
  console.log(`Password:  ${DEMO_PASSWORD}`);
  console.log(`Household: ${ctx.household.name}  (id: ${ctx.household.id})`);
  console.log(`Also:      james.demo@housemait.com (same password)`);
  console.log('─────────────────────────────────────');
  console.log('Safe to re-run any time - it refreshes the content in place.');
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err);
  process.exit(1);
});
