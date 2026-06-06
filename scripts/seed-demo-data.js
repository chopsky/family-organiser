#!/usr/bin/env node
/**
 * Re-seed the Bennett demo DATA into the EXISTING household + users.
 *
 * Unlike seed-demo-account.js (which deletes & recreates the household — a
 * cascade that hits Supabase's statement timeout on large platform tables),
 * this reuses Sarah's existing household and members and only wipes + re-inserts
 * the data rows (recipes, meals, shopping, tasks, events…). Idempotent.
 *
 * Usage: node scripts/seed-demo-data.js
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env (prod).
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { supabaseAdmin: db } = require('../src/db/client');

const DEMO_PASSWORD = 'DemoHousemait2026!';
const DEMO_TZ = 'Europe/London';

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const dateOffset = (days) => { const d = new Date(TODAY); d.setDate(d.getDate() + days); return d; };
const ymd = (date) => date.toISOString().split('T')[0];
const iso = (date, h = 0, m = 0) => { const d = new Date(date); d.setHours(h, m, 0, 0); return d.toISOString(); };

async function insert(table, row) {
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`Insert ${table} failed: ${error.message}`);
  return data;
}
async function insertMany(table, rows) {
  if (!rows.length) return [];
  const { data, error } = await db.from(table).insert(rows).select();
  if (error) throw new Error(`Insert many ${table} failed: ${error.message}`);
  return data;
}
const isMissingColumn = (e) => e?.code === '42703' || /column .* does not exist/i.test(e?.message || '');

// Data tables to clear (leaf-first), scoped to the household. NOT users/household.
const DATA_TABLES = [
  'event_assignees', 'event_reminders', 'calendar_events',
  'shopping_items', 'shopping_lists',
  'child_school_events', 'child_weekly_schedule', 'school_term_dates', 'household_schools',
  'meal_plan', 'meal_categories', 'recipes', 'tasks',
  'documents', 'document_folders', 'household_notes',
];

async function wipeData(hid, memberIds) {
  for (const table of DATA_TABLES) {
    let { error } = await db.from(table).delete().eq('household_id', hid);
    if (error && isMissingColumn(error) && memberIds.length) {
      ({ error } = await db.from(table).delete().in('user_id', memberIds));
    }
    if (error && !isMissingColumn(error)) console.warn(`   · wipe ${table}: ${error.message}`);
  }
}

async function ensureUser(hid, members, matchFn, createRow) {
  const found = members.find(matchFn);
  if (found) return found;
  console.log(`   + creating missing member ${createRow.name}`);
  return insert('users', { household_id: hid, ...createRow });
}

async function run() {
  console.log('🏠 Re-seeding Bennett demo data…\n');

  const { data: sarahRow } = await db.from('users')
    .select('id, household_id').eq('email', 'sarah.demo@housemait.com').maybeSingle();
  if (!sarahRow?.household_id) {
    throw new Error('No existing demo household for sarah.demo@housemait.com - run seed-demo-account.js for a fresh create.');
  }
  const hid = sarahRow.household_id;
  const { data: household } = await db.from('households').select('*').eq('id', hid).single();
  const { data: members } = await db.from('users').select('*').eq('household_id', hid);
  console.log(`→ Reusing household ${household.name} (${hid}) with ${members.length} members`);

  await wipeData(hid, members.map((m) => m.id));
  console.log('✓ Wiped existing data');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const sarah = await ensureUser(hid, members, (m) => m.email === 'sarah.demo@housemait.com', {
    name: 'Sarah Bennett', email: 'sarah.demo@housemait.com', password_hash: passwordHash,
    role: 'admin', member_type: 'account', email_verified: true, color_theme: 'plum',
    family_role: 'Mum', birthday: '1988-06-14', timezone: DEMO_TZ, reminder_time: '07:30:00',
  });
  const james = await ensureUser(hid, members, (m) => m.email === 'james.demo@housemait.com', {
    name: 'James Bennett', email: 'james.demo@housemait.com', password_hash: passwordHash,
    role: 'member', member_type: 'account', email_verified: true, color_theme: 'sage',
    family_role: 'Dad', birthday: '1986-11-02', timezone: DEMO_TZ, reminder_time: '07:30:00',
  });
  const olivia = await ensureUser(hid, members, (m) => m.name === 'Olivia' && m.member_type === 'dependent', {
    name: 'Olivia', email: null, password_hash: null, role: 'member', member_type: 'dependent',
    email_verified: false, color_theme: 'coral', family_role: 'Daughter', birthday: '2017-03-22',
  });
  const henry = await ensureUser(hid, members, (m) => m.name === 'Henry' && m.member_type === 'dependent', {
    name: 'Henry', email: null, password_hash: null, role: 'member', member_type: 'dependent',
    email_verified: false, color_theme: 'amber', family_role: 'Son', birthday: '2020-09-08',
  });
  console.log('✓ Members: Sarah, James, Olivia, Henry');

  // Shopping list
  const shoppingList = await insert('shopping_lists', { household_id: hid, name: 'Default' });

  // Meal categories
  await insertMany('meal_categories', [
    { household_id: hid, name: 'Breakfast', colour: '#FFD8A8', sort_order: 1, active: true },
    { household_id: hid, name: 'Lunch',     colour: '#AEDFF7', sort_order: 2, active: true },
    { household_id: hid, name: 'Dinner',    colour: '#C8E6C9', sort_order: 3, active: true },
  ]);

  // Recipes
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
  ]);
  const r = Object.fromEntries(recipes.map((x) => [x.name, x.id]));

  // Meal plan - full current week
  const dayOfWeek = (TODAY.getDay() + 6) % 7;
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
  console.log('✓ Meal plan: 7 days × 3 meals');

  // Shopping items
  await insertMany('shopping_items', [
    { household_id: hid, list_id: shoppingList.id, item: 'Milk (2 pints)',    aisle_category: 'Dairy & Eggs',        category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Free-range eggs',   aisle_category: 'Dairy & Eggs',        category: 'groceries', added_by: james.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Greek yoghurt',     aisle_category: 'Dairy & Eggs',        category: 'groceries', added_by: sarah.id, completed: true,  completed_at: new Date().toISOString() },
    { household_id: hid, list_id: shoppingList.id, item: 'Bananas',           aisle_category: 'Produce',             category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Avocados (3)',      aisle_category: 'Produce',             category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Baby spinach',      aisle_category: 'Produce',             category: 'groceries', added_by: james.id, completed: true,  completed_at: new Date().toISOString() },
    { household_id: hid, list_id: shoppingList.id, item: 'Cherry tomatoes',   aisle_category: 'Produce',             category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Chicken thighs',    aisle_category: 'Meat & Seafood',      category: 'groceries', added_by: james.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Salmon fillets',    aisle_category: 'Meat & Seafood',      category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Sourdough loaf',    aisle_category: 'Bakery',              category: 'groceries', added_by: sarah.id, completed: true,  completed_at: new Date().toISOString() },
    { household_id: hid, list_id: shoppingList.id, item: 'Pasta (penne)',     aisle_category: 'Pantry & Grains',     category: 'groceries', added_by: james.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Olive oil',         aisle_category: 'Pantry & Grains',     category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Washing-up liquid', aisle_category: 'Household & Cleaning', category: 'household',  added_by: sarah.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Kitchen roll',      aisle_category: 'Household & Cleaning', category: 'household',  added_by: james.id, completed: false },
    { household_id: hid, list_id: shoppingList.id, item: 'Shampoo',           aisle_category: 'Personal Care',       category: 'other',      added_by: sarah.id, completed: false },
  ]);
  console.log('✓ Shopping: 15 items');

  // Tasks
  const tasks = [
    { title: 'Pay council tax',            due_date: ymd(dateOffset(-3)), due_time: '17:00:00', assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'high' },
    { title: 'Book dentist for Olivia',    due_date: ymd(dateOffset(-2)), assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium' },
    { title: 'School reading - sign form', due_date: ymd(TODAY), due_time: '18:00:00', assigned_to: james.id, assigned_to_name: 'James Bennett', priority: 'medium' },
    { title: 'Put bins out',               due_date: ymd(TODAY), assigned_to: null, recurrence: 'weekly', priority: 'low' },
    { title: 'Water the plants',           due_date: ymd(TODAY), assigned_to: null, recurrence: 'weekly', priority: 'low' },
    { title: 'Book Henry swimming lesson', due_date: ymd(dateOffset(1)), assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium' },
    { title: 'Car MOT booking',            due_date: ymd(dateOffset(3)), due_time: '09:00:00', assigned_to: james.id, assigned_to_name: 'James Bennett', priority: 'high', notification: '1_day' },
    { title: 'Wrap birthday gift for Mia', due_date: ymd(dateOffset(4)), assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium' },
    { title: 'Weekly grocery shop',        due_date: ymd(dateOffset(2)), assigned_to: null, recurrence: 'weekly', priority: 'medium' },
    { title: 'Change bed sheets',          due_date: ymd(dateOffset(5)), assigned_to: null, recurrence: 'weekly', priority: 'low' },
    { title: 'Reply to Mrs Peters email',  due_date: ymd(dateOffset(-1)), assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium', completed: true, completed_at: new Date(Date.now() - 86400000).toISOString() },
    { title: 'Return library books',       due_date: ymd(dateOffset(-1)), assigned_to: james.id, assigned_to_name: 'James Bennett', priority: 'low', completed: true, completed_at: new Date(Date.now() - 86400000).toISOString() },
  ];
  await insertMany('tasks', tasks.map((t) => {
    const { assigned_to, assigned_to_name, ...rest } = t;
    return {
      household_id: hid, added_by: sarah.id, completed: false,
      assigned_to_ids: assigned_to ? [assigned_to] : [],
      assigned_to_names: assigned_to_name ? [assigned_to_name] : [],
      ...rest,
    };
  }));
  console.log(`✓ Tasks: ${tasks.length}`);

  // Calendar events
  const events = [
    { title: 'School drop-off',         start: iso(TODAY, 8, 30),  end: iso(TODAY, 9, 0),   assigned: sarah,  color: 'plum',  recurrence: 'weekly' },
    { title: 'Team standup',            start: iso(TODAY, 9, 30),  end: iso(TODAY, 10, 0),  assigned: james,  color: 'sage' },
    { title: 'Olivia - ballet class',   start: iso(TODAY, 16, 30), end: iso(TODAY, 17, 30), assigned: olivia, color: 'coral', location: 'Dance studio' },
    { title: 'Dinner with the Taylors', start: iso(TODAY, 19, 30), end: iso(TODAY, 22, 0),  assigned: sarah,  color: 'plum',  location: '27 Ashford Rd' },
    { title: 'Henry - playdate w/ Leo', start: iso(dateOffset(1), 10, 0),  end: iso(dateOffset(1), 12, 0),  assigned: henry,  color: 'amber', location: 'Our house' },
    { title: 'Yoga class',              start: iso(dateOffset(1), 18, 30), end: iso(dateOffset(1), 19, 30), assigned: sarah,  color: 'plum' },
    { title: 'Football training',       start: iso(dateOffset(1), 17, 0),  end: iso(dateOffset(1), 18, 30), assigned: james,  color: 'sage', recurrence: 'weekly' },
    { title: 'Parents evening',         start: iso(dateOffset(2), 18, 0),  end: iso(dateOffset(2), 20, 0),  assigned: null,   color: 'coral', location: "St. Mary's Primary" },
    { title: 'Grocery shop',            start: iso(dateOffset(2), 10, 0),  end: iso(dateOffset(2), 11, 30), assigned: james,  color: 'sage' },
    { title: "Mia's birthday party",    start: iso(dateOffset(4), 14, 0),  end: iso(dateOffset(4), 16, 30), assigned: olivia, color: 'coral', location: 'Pizza Express, High St' },
    { title: 'Book club',               start: iso(dateOffset(4), 20, 0),  end: iso(dateOffset(4), 22, 0),  assigned: sarah,  color: 'plum' },
    { title: 'Swimming lesson',         start: iso(dateOffset(5), 9, 0),   end: iso(dateOffset(5), 10, 0),  assigned: henry,  color: 'amber', location: 'Leisure centre', recurrence: 'weekly' },
    { title: 'Brunch at Riverside',     start: iso(dateOffset(6), 11, 0),  end: iso(dateOffset(6), 13, 0),  assigned: null,   color: 'sage', location: 'Riverside Café' },
    { title: 'Dentist - Olivia',        start: iso(dateOffset(8), 15, 30), end: iso(dateOffset(8), 16, 15), assigned: olivia, color: 'coral', location: 'Smile Dental, Hampstead' },
    { title: 'Work trip - Manchester',  start: iso(dateOffset(10), 8, 0),  end: iso(dateOffset(11), 18, 0), assigned: james,  color: 'sage' },
  ];
  await insertMany('calendar_events', events.map((e) => ({
    household_id: hid, title: e.title, description: null,
    start_time: e.start, end_time: e.end, all_day: false,
    location: e.location || null, color: e.color, recurrence: e.recurrence || null,
    assigned_to_ids: e.assigned ? [e.assigned.id] : [],
    assigned_to_names: e.assigned ? [e.assigned.name] : [],
    created_by: sarah.id,
  })));
  console.log(`✓ Calendar: ${events.length} events`);

  console.log('\n─────────────────────────────────────');
  console.log('🎉 Demo data re-seeded');
  console.log(`Email:    sarah.demo@housemait.com`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log(`Household: ${household.name} (${hid})`);
  console.log('─────────────────────────────────────');
}

run().catch((err) => { console.error('\n❌ Seed failed:', err.message); process.exit(1); });
