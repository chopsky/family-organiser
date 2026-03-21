const { Router } = require('express');
const db = require('../db/queries');
const { callWithFailover } = require('../services/ai-client');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

// ─── Meal Plan ──────────────────────────────────────────────────────────────

/**
 * GET /api/meals?week=2026-03-16
 * Get meals for a week (Mon-Sun). Also generates recurring meal entries.
 */
router.get('/meals', requireAuth, requireHousehold, async (req, res) => {
  try {
    const { week } = req.query;
    if (!week) {
      return res.status(400).json({ error: 'week query parameter is required (YYYY-MM-DD of Monday)' });
    }

    const startDate = week;
    const endDate = new Date(new Date(week).getTime() + 6 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    // Get existing meals for the week
    const meals = await db.getMealPlanForWeek(req.householdId, startDate, endDate);

    // Get recurring meals and generate entries for any missing days
    const recurring = await db.getRecurringMeals(req.householdId);
    const generatedMeals = [];

    for (const recurMeal of recurring) {
      // recurrence_day is 0=Monday through 6=Sunday
      const targetDay = recurMeal.recurrence_day;
      if (targetDay === null || targetDay === undefined) continue;

      const targetDate = new Date(new Date(week).getTime() + targetDay * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

      // Check if this recurring meal already exists for this date
      const alreadyExists = meals.some(
        m => m.date === targetDate &&
          m.category === recurMeal.category &&
          m.meal_name === recurMeal.meal_name
      );

      if (!alreadyExists) {
        try {
          const generated = await db.createMealPlanEntry(req.householdId, {
            date: targetDate,
            category: recurMeal.category,
            recipe_id: recurMeal.recipe_id,
            meal_name: recurMeal.meal_name,
            notes: recurMeal.notes,
            is_recurring: false, // Generated instance, not the template
          }, recurMeal.created_by);
          generatedMeals.push(generated);
        } catch (genErr) {
          console.error('Failed to generate recurring meal entry:', genErr);
        }
      }
    }

    return res.json({ meals: [...meals, ...generatedMeals] });
  } catch (err) {
    console.error('GET /api/meals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/meals
 * Add meal to plan.
 * Body: { date, category, recipe_id?, meal_name, notes?, is_recurring?, recurrence_day? }
 */
router.post('/meals', requireAuth, requireHousehold, async (req, res) => {
  const { date, category, recipe_id, meal_name, notes, is_recurring, recurrence_day } = req.body;

  if (!date || !meal_name?.trim()) {
    return res.status(400).json({ error: 'date and meal_name are required' });
  }

  try {
    const meal = await db.createMealPlanEntry(req.householdId, {
      date,
      category: category || 'dinner',
      recipe_id: recipe_id || null,
      meal_name: meal_name.trim(),
      notes: notes || null,
      is_recurring: is_recurring || false,
      recurrence_day: recurrence_day !== undefined ? recurrence_day : null,
    }, req.user.id);

    return res.status(201).json({ meal });
  } catch (err) {
    console.error('POST /api/meals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/meals/:id
 * Update meal (date, category, meal_name, notes).
 */
router.patch('/meals/:id', requireAuth, requireHousehold, async (req, res) => {
  const { date, category, meal_name, notes } = req.body;
  const updates = {};

  if (date !== undefined) updates.date = date;
  if (category !== undefined) updates.category = category;
  if (meal_name !== undefined) updates.meal_name = meal_name.trim();
  if (notes !== undefined) updates.notes = notes || null;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const meal = await db.updateMealPlanEntry(req.params.id, req.householdId, updates);
    return res.json({ meal });
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: 'Meal not found' });
    console.error('PATCH /api/meals/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/meals/:id
 * Remove meal from plan.
 */
router.delete('/meals/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deleteMealPlanEntry(req.params.id, req.householdId);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/meals/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── AI Suggestions ─────────────────────────────────────────────────────────

/**
 * POST /api/meals/suggest
 * Get AI meal suggestions based on recent meals and purchases.
 * Body: { category, count?, preferences?, dietary? }
 */
router.post('/meals/suggest', requireAuth, requireHousehold, async (req, res) => {
  const { category, count = 5, preferences, dietary } = req.body;

  try {
    const [recentMeals, recentPurchases] = await Promise.all([
      db.getRecentMeals(req.householdId, 14),
      db.getRecentPurchases(req.householdId, 14),
    ]);

    const recentMealNames = recentMeals.map(m => m.meal_name).join(', ');
    const recentItems = recentPurchases.map(p => p.item).join(', ');

    const prompt = `Suggest ${count} meal ideas${category ? ` for ${category}` : ''} for a UK family.

Recent meals (avoid repeating these): ${recentMealNames || 'None'}
Recently purchased ingredients: ${recentItems || 'None'}
${preferences ? `Preferences: ${preferences}` : ''}
${dietary ? `Dietary requirements: ${dietary}` : ''}

Return ONLY valid JSON:
{
  "suggestions": [
    {
      "meal_name": "Name of meal",
      "category": "breakfast|lunch|dinner|snack",
      "description": "Brief description",
      "prep_time_mins": 15,
      "cook_time_mins": 30,
      "servings": 4,
      "dietary_tags": ["vegetarian"],
      "ingredients": [{"name": "ingredient", "quantity": "amount", "unit": "g|ml|tsp|etc"}],
      "method": ["Step 1...", "Step 2..."]
    }
  ]
}`;

    const { text } = await callWithFailover({
      system: 'You are a helpful UK family meal planner. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
      useThinking: false,
      maxTokens: 2048,
      timeoutMs: 15000,
    });

    let parsed;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Could not parse AI suggestions' });
    }

    return res.json(parsed);
  } catch (err) {
    console.error('POST /api/meals/suggest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Accept AI Suggestion ───────────────────────────────────────────────────

/**
 * POST /api/meals/accept-suggestion
 * Accept an AI suggestion: creates a recipe in the Recipe Box and
 * a meal plan entry linked to that recipe.
 * Body: { date, category, suggestion: { meal_name, category, description, prep_time_mins, cook_time_mins, servings, dietary_tags, ingredients, method } }
 */
router.post('/meals/accept-suggestion', requireAuth, requireHousehold, async (req, res) => {
  const { date, category, suggestion } = req.body;

  if (!date || !suggestion?.meal_name?.trim()) {
    return res.status(400).json({ error: 'date and suggestion with meal_name are required' });
  }

  try {
    // 1. Create recipe in the Recipe Box
    const recipe = await db.createRecipe(req.householdId, {
      name: suggestion.meal_name.trim(),
      category: (suggestion.category || category || 'dinner').toLowerCase(),
      ingredients: suggestion.ingredients || [],
      method: suggestion.method || [],
      prep_time_mins: suggestion.prep_time_mins || null,
      cook_time_mins: suggestion.cook_time_mins || null,
      servings: suggestion.servings || null,
      dietary_tags: suggestion.dietary_tags || [],
      created_by: req.user.id,
    });

    // 2. Create meal plan entry linked to the recipe
    const meal = await db.createMealPlanEntry(req.householdId, {
      date,
      category: (category || suggestion.category || 'dinner').toLowerCase(),
      recipe_id: recipe.id,
      meal_name: suggestion.meal_name.trim(),
      notes: suggestion.description || null,
      is_recurring: false,
    }, req.user.id);

    return res.status(201).json({ meal, recipe });
  } catch (err) {
    console.error('POST /api/meals/accept-suggestion error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Shopping List Integration ──────────────────────────────────────────────

/**
 * POST /api/meals/to-shopping-list
 * Convert meal ingredients to shopping list items.
 * Body: { week } or { meal_ids }
 */
router.post('/meals/to-shopping-list', requireAuth, requireHousehold, async (req, res) => {
  const { week, meal_ids } = req.body;

  if (!week && !meal_ids) {
    return res.status(400).json({ error: 'Either week or meal_ids is required' });
  }

  try {
    let meals;
    if (week) {
      const startDate = week;
      const endDate = new Date(new Date(week).getTime() + 6 * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];
      meals = await db.getMealPlanForWeek(req.householdId, startDate, endDate);
    } else {
      // Fetch specific meals by IDs
      const allMeals = [];
      for (const mealId of meal_ids) {
        const { supabase } = require('../db/client');
        const { data } = await supabase
          .from('meal_plan')
          .select('*, recipes(*)')
          .eq('id', mealId)
          .eq('household_id', req.householdId)
          .single();
        if (data) allMeals.push(data);
      }
      meals = allMeals;
    }

    // Collect ingredients from linked recipes
    const allIngredients = [];
    for (const meal of meals) {
      const recipe = meal.recipes || meal.recipe;
      if (recipe?.ingredients) {
        const ingredients = typeof recipe.ingredients === 'string'
          ? JSON.parse(recipe.ingredients)
          : recipe.ingredients;
        allIngredients.push(...ingredients);
      }
    }

    if (allIngredients.length === 0) {
      return res.json({ added: [], skipped: [], summary: 'No recipes with ingredients found for these meals.' });
    }

    // Get recently purchased items
    const recentPurchases = await db.getRecentPurchases(req.householdId, 14);
    const purchasedNames = recentPurchases.map(p => p.item).join(', ');

    // Use AI to deduplicate and cross-reference
    const ingredientList = allIngredients.map(i =>
      `${i.quantity || ''} ${i.unit || ''} ${i.name}`.trim()
    ).join('\n');

    const { text } = await callWithFailover({
      system: 'You are a smart grocery list assistant for a UK family. Return only valid JSON.',
      messages: [{ role: 'user', content: `Compare these recipe ingredients against recently purchased items and determine what needs to be bought.

Ingredients needed:
${ingredientList}

Recently purchased (likely already have):
${purchasedNames || 'Nothing recent'}

Combine duplicate ingredients (e.g. two recipes needing onions = 1 combined entry).
Return ONLY valid JSON:
{
  "need_to_buy": [{"item": "ingredient name", "quantity": "combined amount", "unit": "g|ml|etc"}],
  "likely_have": [{"item": "ingredient name", "reason": "purchased recently"}],
  "summary": "Brief summary"
}` }],
      useThinking: false,
      maxTokens: 4096,
      timeoutMs: 30000,
    });

    let result;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      result = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Could not parse AI response' });
    }

    // Add items to shopping list
    const itemsToAdd = (result.need_to_buy || []).map(i => ({
      item: i.item,
      quantity: i.quantity || null,
      unit: i.unit || null,
      category: 'groceries',
    }));

    let added = [];
    if (itemsToAdd.length > 0) {
      added = await db.addShoppingItems(req.householdId, itemsToAdd, req.user.id);
    }

    return res.json({
      added,
      skipped: result.likely_have || [],
      summary: result.summary || `Added ${added.length} items to your shopping list.`,
    });
  } catch (err) {
    console.error('POST /api/meals/to-shopping-list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Recipes ────────────────────────────────────────────────────────────────

/**
 * GET /api/recipes?search=&category=&tag=&favourites=true
 * List recipes with filters.
 */
router.get('/recipes', requireAuth, requireHousehold, async (req, res) => {
  try {
    const filters = {
      search: req.query.search || null,
      category: req.query.category || null,
      tag: req.query.tag || null,
      favourites: req.query.favourites === 'true',
    };

    const recipes = await db.getRecipes(req.householdId, filters);
    return res.json({ recipes });
  } catch (err) {
    console.error('GET /api/recipes error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/recipes/:id
 * Get full recipe.
 */
router.get('/recipes/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const recipe = await db.getRecipeById(req.params.id, req.householdId);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    return res.json({ recipe });
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: 'Recipe not found' });
    console.error('GET /api/recipes/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/recipes
 * Add recipe manually.
 */
router.post('/recipes', requireAuth, requireHousehold, async (req, res) => {
  const { name, category, ingredients, method, prep_time_mins, cook_time_mins, servings, dietary_tags, image_url, notes, is_favourite } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ error: 'Recipe name is required' });
  }

  try {
    const recipe = await db.createRecipe(req.householdId, {
      name: name.trim(),
      category: category || null,
      ingredients: ingredients || [],
      method: method || [],
      prep_time_mins: prep_time_mins || null,
      cook_time_mins: cook_time_mins || null,
      servings: servings || null,
      dietary_tags: dietary_tags || [],
      image_url: image_url || null,
      notes: notes || null,
      is_favourite: is_favourite || false,
      created_by: req.user.id,
    });

    return res.status(201).json({ recipe });
  } catch (err) {
    console.error('POST /api/recipes error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/recipes/import-url
 * Import recipe from URL using AI.
 * Body: { url }
 */
router.post('/recipes/import-url', requireAuth, requireHousehold, async (req, res) => {
  const { url } = req.body;
  if (!url?.trim()) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Fetch the web page
    let pageText;
    try {
      const response = await fetch(url.trim(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecipeBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      if (!response.ok) {
        return res.status(400).json({ error: `Website returned HTTP ${response.status}` });
      }
      const html = await response.text();

      // Strip HTML to text, preserving structure
      pageText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<\/tr>/gi, '\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim()
        .substring(0, 12000);
    } catch (fetchErr) {
      return res.status(400).json({ error: `Could not fetch the website: ${fetchErr.message}` });
    }

    if (pageText.length < 50) {
      return res.status(400).json({ error: 'The page has very little text content.' });
    }

    const { text } = await callWithFailover({
      system: 'You extract recipes from web pages. Return only valid JSON.',
      messages: [{ role: 'user', content: `Extract the recipe from this web page content.
Return ONLY valid JSON:
{
  "name": "recipe name",
  "category": "breakfast|lunch|dinner|snack",
  "ingredients": [{"name": "ingredient", "quantity": "amount", "unit": "g|ml|tsp|etc", "optional": false}],
  "method": ["Step 1...", "Step 2..."],
  "prep_time_mins": 15,
  "cook_time_mins": 30,
  "servings": 4,
  "dietary_tags": ["vegetarian"],
  "image_url": "URL of the main recipe image if present"
}
Rules:
- Normalise ingredient names to common British English terms
- Convert American measurements to metric where reasonable
- Infer dietary tags from ingredients (no meat = vegetarian, etc.)
- If the page is not a recipe, return {"error": "No recipe found"}

Page content:
${pageText}` }],
      useThinking: false,
      maxTokens: 4096,
      timeoutMs: 30000,
    });

    let parsed;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Could not parse recipe from AI response' });
    }

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    // Save the recipe
    const recipe = await db.createRecipe(req.householdId, {
      name: parsed.name,
      category: parsed.category || null,
      ingredients: parsed.ingredients || [],
      method: parsed.method || [],
      prep_time_mins: parsed.prep_time_mins || null,
      cook_time_mins: parsed.cook_time_mins || null,
      servings: parsed.servings || null,
      dietary_tags: parsed.dietary_tags || [],
      image_url: parsed.image_url || null,
      source_url: url.trim(),
      created_by: req.user.id,
    });

    return res.status(201).json({ recipe });
  } catch (err) {
    console.error('POST /api/recipes/import-url error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/recipes/import-photo
 * Import recipe from a photo (base64 image) using AI Vision.
 * Body: { image, media_type? }
 */
router.post('/recipes/import-photo', requireAuth, requireHousehold, async (req, res) => {
  const { image, media_type } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'Base64 image data is required' });
  }

  try {
    const { text } = await callWithFailover({
      system: 'You extract recipes from photos. Return only valid JSON.',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: media_type || 'image/jpeg',
              data: image,
            },
          },
          {
            type: 'text',
            text: `Extract the recipe from this image.
Return ONLY valid JSON:
{
  "name": "recipe name",
  "category": "breakfast|lunch|dinner|snack",
  "ingredients": [{"name": "ingredient", "quantity": "amount", "unit": "g|ml|tsp|etc", "optional": false}],
  "method": ["Step 1...", "Step 2..."],
  "prep_time_mins": 15,
  "cook_time_mins": 30,
  "servings": 4,
  "dietary_tags": ["vegetarian"]
}
Rules:
- Normalise ingredient names to common British English terms
- Convert American measurements to metric where reasonable
- Infer dietary tags from ingredients (no meat = vegetarian, etc.)
- If the image is not a recipe, return {"error": "No recipe found"}`,
          },
        ],
      }],
      useThinking: false,
      maxTokens: 4096,
      timeoutMs: 30000,
    });

    let parsed;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Could not parse recipe from AI response' });
    }

    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    // Save the recipe
    const recipe = await db.createRecipe(req.householdId, {
      name: parsed.name,
      category: parsed.category || null,
      ingredients: parsed.ingredients || [],
      method: parsed.method || [],
      prep_time_mins: parsed.prep_time_mins || null,
      cook_time_mins: parsed.cook_time_mins || null,
      servings: parsed.servings || null,
      dietary_tags: parsed.dietary_tags || [],
      created_by: req.user.id,
    });

    return res.status(201).json({ recipe });
  } catch (err) {
    console.error('POST /api/recipes/import-photo error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/recipes/generate
 * Generate a recipe from a description via AI.
 * Body: { description, dietary?, servings? }
 */
router.post('/recipes/generate', requireAuth, requireHousehold, async (req, res) => {
  const { description, dietary, servings } = req.body;
  if (!description?.trim()) {
    return res.status(400).json({ error: 'Recipe description is required' });
  }

  try {
    const prompt = `Create a complete recipe based on the user's request.
${dietary ? `Dietary requirements: ${dietary}` : ''}
${servings ? `Servings: ${servings}` : ''}

User's request: ${description}

Return ONLY valid JSON:
{
  "name": "recipe name",
  "category": "breakfast|lunch|dinner|snack",
  "ingredients": [{"name": "ingredient", "quantity": "amount", "unit": "g|ml|tsp|etc", "optional": false}],
  "method": ["Step 1...", "Step 2..."],
  "prep_time_mins": 15,
  "cook_time_mins": 30,
  "servings": 4,
  "dietary_tags": ["vegetarian"]
}`;

    const { text } = await callWithFailover({
      system: 'You are a recipe creator for a UK family. Create a complete recipe based on the user\'s request.\nReturn ONLY valid JSON with the same structure as above.',
      messages: [{ role: 'user', content: prompt }],
      useThinking: false,
      maxTokens: 4096,
      timeoutMs: 30000,
    });

    let parsed;
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: 'Could not parse generated recipe' });
    }

    // Save the recipe
    const recipe = await db.createRecipe(req.householdId, {
      name: parsed.name,
      category: parsed.category || null,
      ingredients: parsed.ingredients || [],
      method: parsed.method || [],
      prep_time_mins: parsed.prep_time_mins || null,
      cook_time_mins: parsed.cook_time_mins || null,
      servings: parsed.servings || null,
      dietary_tags: parsed.dietary_tags || [],
      created_by: req.user.id,
    });

    return res.status(201).json({ recipe });
  } catch (err) {
    console.error('POST /api/recipes/generate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/recipes/:id
 * Update recipe.
 */
router.patch('/recipes/:id', requireAuth, requireHousehold, async (req, res) => {
  const { name, category, ingredients, method, prep_time_mins, cook_time_mins, servings, dietary_tags, image_url, notes, is_favourite } = req.body;
  const updates = {};

  if (name !== undefined) updates.name = name.trim();
  if (category !== undefined) updates.category = category;
  if (ingredients !== undefined) updates.ingredients = ingredients;
  if (method !== undefined) updates.method = method;
  if (prep_time_mins !== undefined) updates.prep_time_mins = prep_time_mins;
  if (cook_time_mins !== undefined) updates.cook_time_mins = cook_time_mins;
  if (servings !== undefined) updates.servings = servings;
  if (dietary_tags !== undefined) updates.dietary_tags = dietary_tags;
  if (image_url !== undefined) updates.image_url = image_url;
  if (notes !== undefined) updates.notes = notes;
  if (is_favourite !== undefined) updates.is_favourite = is_favourite;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const recipe = await db.updateRecipe(req.params.id, req.householdId, updates);
    return res.json({ recipe });
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: 'Recipe not found' });
    console.error('PATCH /api/recipes/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/recipes/:id
 * Delete recipe.
 */
router.delete('/recipes/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deleteRecipe(req.params.id, req.householdId);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/recipes/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Meal Categories ────────────────────────────────────────────────────────

/**
 * GET /api/meal-categories
 * Get household meal categories (creates defaults if none exist).
 */
router.get('/meal-categories', requireAuth, requireHousehold, async (req, res) => {
  try {
    let categories = await db.getMealCategories(req.householdId);

    if (!categories || categories.length === 0) {
      await db.createDefaultMealCategories(req.householdId);
      categories = await db.getMealCategories(req.householdId);
    }

    return res.json({ categories });
  } catch (err) {
    console.error('GET /api/meal-categories error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/meal-categories/:id
 * Update category (name, colour, sort_order, active).
 */
router.patch('/meal-categories/:id', requireAuth, requireHousehold, async (req, res) => {
  const { name, colour, sort_order, active } = req.body;
  const updates = {};

  if (name !== undefined) updates.name = name.trim();
  if (colour !== undefined) updates.colour = colour;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (active !== undefined) updates.active = active;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  try {
    const category = await db.updateMealCategory(req.params.id, req.householdId, updates);
    return res.json({ category });
  } catch (err) {
    if (err.code === 'PGRST116') return res.status(404).json({ error: 'Category not found' });
    console.error('PATCH /api/meal-categories/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
