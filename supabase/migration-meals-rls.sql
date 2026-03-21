-- Meals Feature RLS Policies
-- Run this in the Supabase SQL editor AFTER migration-meals.sql

-- Recipes
DROP POLICY IF EXISTS "Allow all for authenticated" ON recipes;
CREATE POLICY "Allow all for authenticated" ON recipes FOR ALL USING (true) WITH CHECK (true);

-- Meal plan
DROP POLICY IF EXISTS "Allow all for authenticated" ON meal_plan;
CREATE POLICY "Allow all for authenticated" ON meal_plan FOR ALL USING (true) WITH CHECK (true);

-- Meal categories
DROP POLICY IF EXISTS "Allow all for authenticated" ON meal_categories;
CREATE POLICY "Allow all for authenticated" ON meal_categories FOR ALL USING (true) WITH CHECK (true);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
