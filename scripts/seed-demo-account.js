#!/usr/bin/env node
/**
 * Seed a demo Housemait household for App Store screenshots.
 *
 * Populates a "Bennett family" account with realistic data across
 * every screen: dashboard, calendar, tasks, shopping, meals, family.
 *
 * Idempotent: if sarah.demo@housemait.com already exists, her
 * household is wiped and re-seeded (cascade delete).
 *
 * Usage:
 *   node scripts/seed-demo-account.js
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env (prod keys
 * to seed the production DB that the iOS Simulator talks to).
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { supabaseAdmin: db } = require('../src/db/client');

// ─── Config ──────────────────────────────────────────────────────────────────

const DEMO_PASSWORD = 'DemoHousemait2026!';
const DEMO_TZ       = 'Europe/London';

// Today anchor — all dates are offsets from this
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function dateOffset(days) {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return d;
}
function ymd(date) {
  return date.toISOString().split('T')[0];
}
function iso(date, h = 0, m = 0) {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Cleanup existing demo ───────────────────────────────────────────────────

async function wipeExisting() {
  const { data: sarah } = await db
    .from('users')
    .select('id, household_id')
    .eq('email', 'sarah.demo@housemait.com')
    .maybeSingle();

  if (!sarah) {
    console.log('→ No existing demo account, fresh seed');
    return;
  }

  console.log(`→ Found existing demo (household ${sarah.household_id}) — wiping…`);

  // Delete the household — ON DELETE CASCADE handles users, tasks, events, etc.
  if (sarah.household_id) {
    const { error } = await db.from('households').delete().eq('id', sarah.household_id);
    if (error) throw new Error(`Failed to delete household: ${error.message}`);
  }

  // Paranoid: also delete any orphaned demo users
  await db.from('users').delete().in('email', [
    'sarah.demo@housemait.com',
    'james.demo@housemait.com',
  ]);
}

// ─── Seed ────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🏠 Seeding Bennett family demo account…\n');

  await wipeExisting();

  // 1. Household
  const household = await insert('households', {
    name: 'The Bennetts',
    join_code: crypto.randomBytes(3).toString('hex').toUpperCase(),
    timezone: DEMO_TZ,
    reminder_time: '07:30:00',
  });
  console.log(`✓ Household created: ${household.name} (${household.id})`);

  // 2. Users
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const sarah = await insert('users', {
    name: 'Sarah Bennett',
    email: 'sarah.demo@housemait.com',
    password_hash: passwordHash,
    household_id: household.id,
    role: 'admin',
    member_type: 'account',
    email_verified: true,
    color_theme: 'plum',
    family_role: 'Mum',
    birthday: '1988-06-14',
    timezone: DEMO_TZ,
    reminder_time: '07:30:00',
  });

  const james = await insert('users', {
    name: 'James Bennett',
    email: 'james.demo@housemait.com',
    password_hash: passwordHash,
    household_id: household.id,
    role: 'member',
    member_type: 'account',
    email_verified: true,
    color_theme: 'sage',
    family_role: 'Dad',
    birthday: '1986-11-02',
    timezone: DEMO_TZ,
    reminder_time: '07:30:00',
  });

  const olivia = await insert('users', {
    name: 'Olivia',
    email: null,
    password_hash: null,
    household_id: household.id,
    role: 'member',
    member_type: 'dependent',
    email_verified: false,
    color_theme: 'coral',
    family_role: 'Daughter',
    birthday: '2017-03-22',
  });

  const henry = await insert('users', {
    name: 'Henry',
    email: null,
    password_hash: null,
    household_id: household.id,
    role: 'member',
    member_type: 'dependent',
    email_verified: false,
    color_theme: 'amber',
    family_role: 'Son',
    birthday: '2020-09-08',
  });

  console.log(`✓ Family members created: Sarah, James, Olivia, Henry`);

  // 3. Shopping list (default)
  const shoppingList = await insert('shopping_lists', {
    household_id: household.id,
    name: 'Default',
  });

  // 4. Meal categories
  await insertMany('meal_categories', [
    { household_id: household.id, name: 'Breakfast', colour: '#FFD8A8', sort_order: 1, active: true },
    { household_id: household.id, name: 'Lunch',     colour: '#AEDFF7', sort_order: 2, active: true },
    { household_id: household.id, name: 'Dinner',    colour: '#C8E6C9', sort_order: 3, active: true },
  ]);

  // 5. Recipes
  const recipes = await insertMany('recipes', [
    { household_id: household.id, name: 'Overnight oats with berries', category: 'breakfast', servings: 4, prep_time_mins: 5, is_favourite: true },
    { household_id: household.id, name: 'Avocado toast & poached egg', category: 'breakfast', servings: 2, prep_time_mins: 10 },
    { household_id: household.id, name: 'Full English fry-up',         category: 'breakfast', servings: 4, prep_time_mins: 25 },
    { household_id: household.id, name: 'Tomato & mozzarella salad',   category: 'lunch',     servings: 4, prep_time_mins: 10 },
    { household_id: household.id, name: 'Ham & cheese sandwiches',     category: 'lunch',     servings: 4, prep_time_mins: 5 },
    { household_id: household.id, name: 'Chicken Caesar wrap',         category: 'lunch',     servings: 2, prep_time_mins: 15 },
    { household_id: household.id, name: 'Spaghetti bolognese',         category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 45, is_favourite: true },
    { household_id: household.id, name: 'Thai green curry with rice',  category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 30 },
    { household_id: household.id, name: 'Roast chicken with veg',      category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 75, is_favourite: true },
    { household_id: household.id, name: 'Homemade pizza night',        category: 'dinner',    servings: 4, prep_time_mins: 30, cook_time_mins: 15 },
    { household_id: household.id, name: 'Fish & chips',                category: 'dinner',    servings: 4, prep_time_mins: 10, cook_time_mins: 25 },
    { household_id: household.id, name: 'Tacos al pastor',             category: 'dinner',    servings: 4, prep_time_mins: 20, cook_time_mins: 20 },
    { household_id: household.id, name: 'Butternut squash risotto',    category: 'dinner',    servings: 4, prep_time_mins: 15, cook_time_mins: 35 },
  ]);
  const r = Object.fromEntries(recipes.map((x) => [x.name, x.id]));

  // 6. Meal plan — full current week (Mon–Sun) with breakfast, lunch, dinner
  // Figure out Monday of this week
  const dayOfWeek = (TODAY.getDay() + 6) % 7; // 0 = Mon
  const monday = dateOffset(-dayOfWeek);
  const breakfasts = ['Overnight oats with berries', 'Avocado toast & poached egg', 'Overnight oats with berries', 'Avocado toast & poached egg', 'Overnight oats with berries', 'Full English fry-up', 'Avocado toast & poached egg'];
  const lunches    = ['Ham & cheese sandwiches', 'Chicken Caesar wrap', 'Tomato & mozzarella salad', 'Ham & cheese sandwiches', 'Chicken Caesar wrap', 'Tomato & mozzarella salad', 'Ham & cheese sandwiches'];
  const dinners    = ['Spaghetti bolognese', 'Tacos al pastor', 'Thai green curry with rice', 'Butternut squash risotto', 'Fish & chips', 'Homemade pizza night', 'Roast chicken with veg'];

  const mealRows = [];
  for (let i = 0; i < 7; i++) {
    const d = dateOffset(-dayOfWeek + i);
    mealRows.push(
      { household_id: household.id, recipe_id: r[breakfasts[i]], date: ymd(d), category: 'breakfast', meal_name: breakfasts[i], added_by: sarah.id },
      { household_id: household.id, recipe_id: r[lunches[i]],    date: ymd(d), category: 'lunch',     meal_name: lunches[i],    added_by: sarah.id },
      { household_id: household.id, recipe_id: r[dinners[i]],    date: ymd(d), category: 'dinner',    meal_name: dinners[i],    added_by: sarah.id },
    );
  }
  await insertMany('meal_plan', mealRows);
  console.log(`✓ Meal plan: 7 days × 3 meals`);

  // 7. Shopping items — mix of categories, some completed
  await insertMany('shopping_items', [
    { household_id: household.id, list_id: shoppingList.id, item: 'Milk (2 pints)',       aisle_category: 'Dairy & Eggs', category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Free-range eggs',      aisle_category: 'Dairy & Eggs', category: 'groceries', added_by: james.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Greek yoghurt',        aisle_category: 'Dairy & Eggs', category: 'groceries', added_by: sarah.id, completed: true,  completed_at: new Date().toISOString() },
    { household_id: household.id, list_id: shoppingList.id, item: 'Bananas',              aisle_category: 'Produce',      category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Avocados (3)',         aisle_category: 'Produce',      category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Baby spinach',         aisle_category: 'Produce',      category: 'groceries', added_by: james.id, completed: true,  completed_at: new Date().toISOString() },
    { household_id: household.id, list_id: shoppingList.id, item: 'Cherry tomatoes',      aisle_category: 'Produce',      category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Chicken thighs',       aisle_category: 'Meat & Seafood', category: 'groceries', added_by: james.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Salmon fillets',       aisle_category: 'Meat & Seafood', category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Sourdough loaf',       aisle_category: 'Bakery',       category: 'groceries', added_by: sarah.id, completed: true,  completed_at: new Date().toISOString() },
    { household_id: household.id, list_id: shoppingList.id, item: 'Pasta (penne)',        aisle_category: 'Pantry & Grains', category: 'groceries', added_by: james.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Olive oil',            aisle_category: 'Pantry & Grains', category: 'groceries', added_by: sarah.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Washing-up liquid',    aisle_category: 'Household & Cleaning', category: 'household', added_by: sarah.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Kitchen roll',         aisle_category: 'Household & Cleaning', category: 'household', added_by: james.id, completed: false },
    { household_id: household.id, list_id: shoppingList.id, item: 'Shampoo',              aisle_category: 'Personal Care', category: 'other', added_by: sarah.id, completed: false },
  ]);
  console.log(`✓ Shopping list: 15 items (3 completed)`);

  // 8. Tasks — mix of overdue, today, upcoming, recurring, assigned & household
  const tasks = [
    // Overdue (so dashboard shows something urgent)
    { title: 'Pay council tax',             due_date: ymd(dateOffset(-3)), due_time: '17:00:00', assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'high' },
    { title: 'Book dentist for Olivia',     due_date: ymd(dateOffset(-2)), assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium' },

    // Due today
    { title: 'School reading — sign form',  due_date: ymd(TODAY), due_time: '18:00:00', assigned_to: james.id, assigned_to_name: 'James Bennett', priority: 'medium' },
    { title: 'Put bins out',                due_date: ymd(TODAY), assigned_to: null,     recurrence: 'weekly', priority: 'low' },
    { title: 'Water the plants',            due_date: ymd(TODAY), assigned_to: null,     recurrence: 'weekly', priority: 'low' },

    // Upcoming
    { title: 'Book Henry swimming lesson',  due_date: ymd(dateOffset(1)),  assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium' },
    { title: 'Car MOT booking',             due_date: ymd(dateOffset(3)),  due_time: '09:00:00', assigned_to: james.id, assigned_to_name: 'James Bennett', priority: 'high', notification: '1_day' },
    { title: 'Wrap birthday gift for Mia',  due_date: ymd(dateOffset(4)),  assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium' },
    { title: 'Weekly grocery shop',         due_date: ymd(dateOffset(2)),  assigned_to: null, recurrence: 'weekly', priority: 'medium' },
    { title: 'Change bed sheets',           due_date: ymd(dateOffset(5)),  assigned_to: null, recurrence: 'weekly', priority: 'low' },

    // Completed (so tasks screen has some ticked)
    { title: 'Reply to Mrs Peters email',   due_date: ymd(dateOffset(-1)), assigned_to: sarah.id, assigned_to_name: 'Sarah Bennett', priority: 'medium', completed: true, completed_at: new Date(Date.now() - 86400000).toISOString() },
    { title: 'Return library books',        due_date: ymd(dateOffset(-1)), assigned_to: james.id, assigned_to_name: 'James Bennett', priority: 'low', completed: true, completed_at: new Date(Date.now() - 86400000).toISOString() },
  ];
  await insertMany('tasks', tasks.map((t) => ({
    household_id: household.id,
    added_by: sarah.id,
    completed: false,
    ...t,
  })));
  console.log(`✓ Tasks: ${tasks.length} (mix of overdue/today/upcoming/completed)`);

  // 9. Calendar events — populate this week with colourful, varied events
  const events = [
    // Today
    { title: 'School drop-off',        start: iso(TODAY, 8, 30),  end: iso(TODAY, 9, 0),   assigned: sarah,  color: 'plum',  recurrence: 'weekly' },
    { title: 'Team standup',           start: iso(TODAY, 9, 30),  end: iso(TODAY, 10, 0),  assigned: james,  color: 'sage' },
    { title: 'Olivia — ballet class',  start: iso(TODAY, 16, 30), end: iso(TODAY, 17, 30), assigned: olivia, color: 'coral', location: 'Dance studio' },
    { title: 'Dinner with the Taylors',start: iso(TODAY, 19, 30), end: iso(TODAY, 22, 0),  assigned: sarah,  color: 'plum',  location: '27 Ashford Rd' },

    // Tomorrow
    { title: 'Henry — playdate w/ Leo',start: iso(dateOffset(1), 10, 0),  end: iso(dateOffset(1), 12, 0),  assigned: henry,  color: 'amber', location: 'Our house' },
    { title: 'Yoga class',             start: iso(dateOffset(1), 18, 30), end: iso(dateOffset(1), 19, 30), assigned: sarah,  color: 'plum' },
    { title: 'Football training',      start: iso(dateOffset(1), 17, 0),  end: iso(dateOffset(1), 18, 30), assigned: james,  color: 'sage', recurrence: 'weekly' },

    // Day after tomorrow
    { title: 'Parents evening',        start: iso(dateOffset(2), 18, 0),  end: iso(dateOffset(2), 20, 0),  assigned: null,   color: 'coral', location: 'St. Mary\'s Primary' },
    { title: 'Grocery shop',           start: iso(dateOffset(2), 10, 0),  end: iso(dateOffset(2), 11, 30), assigned: james,  color: 'sage' },

    // Later this week
    { title: 'Mia\'s birthday party',  start: iso(dateOffset(4), 14, 0),  end: iso(dateOffset(4), 16, 30), assigned: olivia, color: 'coral', location: 'Pizza Express, High St' },
    { title: 'Book club',              start: iso(dateOffset(4), 20, 0),  end: iso(dateOffset(4), 22, 0),  assigned: sarah,  color: 'plum' },
    { title: 'Swimming lesson',        start: iso(dateOffset(5), 9, 0),   end: iso(dateOffset(5), 10, 0),  assigned: henry,  color: 'amber', location: 'Leisure centre', recurrence: 'weekly' },
    { title: 'Brunch at Riverside',    start: iso(dateOffset(6), 11, 0),  end: iso(dateOffset(6), 13, 0),  assigned: null,   color: 'sage', location: 'Riverside Café' },

    // Next week
    { title: 'Dentist — Olivia',       start: iso(dateOffset(8), 15, 30), end: iso(dateOffset(8), 16, 15), assigned: olivia, color: 'coral', location: 'Smile Dental, Hampstead' },
    { title: 'Work trip — Manchester', start: iso(dateOffset(10), 8, 0),  end: iso(dateOffset(11), 18, 0), assigned: james,  color: 'sage' },
  ];
  await insertMany('calendar_events', events.map((e) => ({
    household_id: household.id,
    title: e.title,
    description: null,
    start_time: e.start,
    end_time: e.end,
    all_day: false,
    location: e.location || null,
    color: e.color,
    recurrence: e.recurrence || null,
    assigned_to: e.assigned?.id || null,
    assigned_to_name: e.assigned?.name || null,
    created_by: sarah.id,
  })));
  console.log(`✓ Calendar: ${events.length} events across this + next week`);

  // ─── Done ──────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log('🎉 Demo account seeded');
  console.log('─────────────────────────────────────');
  console.log(`Email:    sarah.demo@housemait.com`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log(`Household: ${household.name}  (id: ${household.id})`);
  console.log(`Also available: james.demo@housemait.com (same password)`);
  console.log('─────────────────────────────────────');
  console.log('To wipe, re-run this script OR use scripts/delete-demo-account.js');
}

seed().catch((err) => {
  console.error('\n❌ Seed failed:', err.message);
  console.error(err);
  process.exit(1);
});
