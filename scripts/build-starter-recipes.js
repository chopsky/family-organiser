// Dev tool (run occasionally, not in prod): snapshot the demo household's
// recipes into src/lib/starterRecipes.js and copy their images to a stable
// avatars/starter-recipes/ path, so the starter set seeded into every
// household is self-contained and decoupled from the demo account (which gets
// wiped + re-seeded). Re-runnable; image copies are idempotent.
//
//   node scripts/build-starter-recipes.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { supabaseAdmin: db } = require('../src/db/client');

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  const { data: u } = await db.from('users').select('household_id').eq('email', 'sarah.demo@housemait.com').single();
  const { data: recipes, error } = await db.from('recipes')
    .select('name, category, ingredients, method, prep_time_mins, cook_time_mins, servings, dietary_tags, image_url, notes')
    .eq('household_id', u.household_id)
    .order('category');
  if (error) { console.error(error.message); process.exit(1); }

  const out = [];
  for (const r of recipes) {
    let image_url = null;
    if (r.image_url) {
      const srcPath = decodeURIComponent((r.image_url.split('/avatars/')[1] || '').split('?')[0]);
      const ext = path.extname(srcPath) || '.png';
      const destPath = `starter-recipes/${slugify(r.name)}${ext}`;
      const { error: copyErr } = await db.storage.from('avatars').copy(srcPath, destPath);
      if (copyErr && !/exist/i.test(copyErr.message)) console.warn(`  copy failed for ${r.name}: ${copyErr.message}`);
      image_url = db.storage.from('avatars').getPublicUrl(destPath).data.publicUrl;
    }
    out.push({
      name: r.name, category: r.category, ingredients: r.ingredients || [], method: r.method || null,
      prep_time_mins: r.prep_time_mins, cook_time_mins: r.cook_time_mins, servings: r.servings,
      dietary_tags: r.dietary_tags || [], notes: r.notes || null, image_url,
    });
    console.log(`✓ ${r.name}${image_url ? ' (image copied)' : ''}`);
  }

  const header = `// Starter recipes seeded into every household (new ones on creation, existing\n` +
    `// ones via scripts/seed-starter-recipes.js). Snapshotted from the demo box and\n` +
    `// images copied to avatars/starter-recipes/, so this set is self-contained.\n` +
    `// Regenerate with: node scripts/build-starter-recipes.js\n\n`;
  const file = path.join(__dirname, '..', 'src', 'lib', 'starterRecipes.js');
  fs.writeFileSync(file, header + 'module.exports = ' + JSON.stringify(out, null, 2) + ';\n');
  console.log(`\nWrote ${out.length} recipes to src/lib/starterRecipes.js`);
})();
