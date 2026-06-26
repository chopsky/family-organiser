/**
 * Ingredients + method for the Bennett-family demo recipes, keyed by recipe
 * name. Shared by the demo seeder and the one-off backfill so both stay in
 * sync. ingredients: [{ name, quantity, unit }]; method: newline-separated
 * steps (the recipe detail renders it with whitespace-pre-line).
 */
module.exports = {
  'Overnight oats with berries': {
    ingredients: [
      { name: 'rolled oats', quantity: '200', unit: 'g' },
      { name: 'milk', quantity: '400', unit: 'ml' },
      { name: 'natural yoghurt', quantity: '150', unit: 'g' },
      { name: 'honey', quantity: '2', unit: 'tbsp' },
      { name: 'mixed berries', quantity: '200', unit: 'g' },
      { name: 'chia seeds (optional)', quantity: '1', unit: 'tbsp' },
    ],
    method: [
      '1. Mix the oats, milk, yoghurt and honey in a large jar or bowl.',
      '2. Stir through the chia seeds if using.',
      '3. Cover and chill overnight (at least 6 hours).',
      '4. In the morning, loosen with a splash of milk and top with the berries.',
    ].join('\n'),
  },
  'Avocado toast & poached egg': {
    ingredients: [
      { name: 'sourdough', quantity: '2', unit: 'slices' },
      { name: 'ripe avocado', quantity: '1', unit: '' },
      { name: 'eggs', quantity: '2', unit: '' },
      { name: 'lemon juice', quantity: '1', unit: 'tsp' },
      { name: 'chilli flakes', quantity: '1', unit: 'pinch' },
      { name: 'salt & pepper to taste', quantity: '', unit: '' },
    ],
    method: [
      '1. Bring a pan of water to a gentle simmer with a splash of vinegar.',
      '2. Crack each egg into the water and poach for 3 minutes.',
      '3. Toast the sourdough and mash the avocado with the lemon juice and seasoning.',
      '4. Spread the avocado on the toast, top with a poached egg and finish with chilli flakes.',
    ].join('\n'),
  },
  'Full English fry-up': {
    ingredients: [
      { name: 'pork sausages', quantity: '8', unit: '' },
      { name: 'smoked bacon', quantity: '8', unit: 'rashers' },
      { name: 'eggs', quantity: '4', unit: '' },
      { name: 'baked beans', quantity: '400', unit: 'g tin' },
      { name: 'mushrooms', quantity: '250', unit: 'g' },
      { name: 'tomatoes, halved', quantity: '4', unit: '' },
      { name: 'bread', quantity: '4', unit: 'slices' },
    ],
    method: [
      '1. Grill the sausages and bacon for 12-15 minutes, turning, until cooked through.',
      '2. Fry the mushrooms and tomatoes in a little oil until golden.',
      '3. Warm the beans in a small pan and fry the eggs to your liking.',
      '4. Toast or fry the bread and serve everything together.',
    ].join('\n'),
  },
  'Tomato & mozzarella salad': {
    ingredients: [
      { name: 'large tomatoes', quantity: '4', unit: '' },
      { name: 'mozzarella', quantity: '2', unit: 'balls' },
      { name: 'fresh basil', quantity: '1', unit: 'handful' },
      { name: 'olive oil', quantity: '3', unit: 'tbsp' },
      { name: 'balsamic vinegar', quantity: '1', unit: 'tbsp' },
      { name: 'salt & pepper to taste', quantity: '', unit: '' },
    ],
    method: [
      '1. Slice the tomatoes and mozzarella into rounds.',
      '2. Arrange alternately on a platter and scatter over the basil.',
      '3. Drizzle with the olive oil and balsamic, season and serve.',
    ].join('\n'),
  },
  'Ham & cheese sandwiches': {
    ingredients: [
      { name: 'bread', quantity: '8', unit: 'slices' },
      { name: 'ham', quantity: '8', unit: 'slices' },
      { name: 'cheddar', quantity: '4', unit: 'slices' },
      { name: 'butter', quantity: '2', unit: 'tbsp' },
      { name: 'English mustard', quantity: '2', unit: 'tsp' },
    ],
    method: [
      '1. Butter the bread on one side.',
      '2. Layer ham, cheese and a little mustard between the slices.',
      '3. Cut in half and serve, or toast in a pan for 3-4 minutes a side for a toastie.',
    ].join('\n'),
  },
  'Chicken Caesar wrap': {
    ingredients: [
      { name: 'large tortilla wraps', quantity: '2', unit: '' },
      { name: 'cooked chicken breast, sliced', quantity: '1', unit: '' },
      { name: 'baby gem lettuce, shredded', quantity: '2', unit: '' },
      { name: 'parmesan, shaved', quantity: '30', unit: 'g' },
      { name: 'Caesar dressing', quantity: '3', unit: 'tbsp' },
      { name: 'croutons', quantity: '1', unit: 'handful' },
    ],
    method: [
      '1. Toss the lettuce with the dressing and parmesan.',
      '2. Pile the chicken and dressed lettuce down the middle of each wrap.',
      '3. Scatter over the croutons, roll up tightly and cut in half.',
    ].join('\n'),
  },
  'Spaghetti bolognese': {
    ingredients: [
      { name: 'beef mince', quantity: '500', unit: 'g' },
      { name: 'onion, finely chopped', quantity: '1', unit: '' },
      { name: 'garlic cloves, crushed', quantity: '2', unit: '' },
      { name: 'carrots, grated', quantity: '2', unit: '' },
      { name: 'chopped tomatoes', quantity: '400', unit: 'g tin' },
      { name: 'tomato purée', quantity: '2', unit: 'tbsp' },
      { name: 'spaghetti', quantity: '400', unit: 'g' },
      { name: 'olive oil', quantity: '1', unit: 'tbsp' },
    ],
    method: [
      '1. Heat the oil and soften the onion, garlic and carrot for 5 minutes.',
      '2. Add the mince and brown all over.',
      '3. Stir in the tomatoes and purée, season, and simmer for 30-40 minutes.',
      '4. Cook the spaghetti to packet instructions, drain and serve topped with the sauce.',
    ].join('\n'),
  },
  'Thai green curry with rice': {
    ingredients: [
      { name: 'chicken thighs, diced', quantity: '600', unit: 'g' },
      { name: 'Thai green curry paste', quantity: '3', unit: 'tbsp' },
      { name: 'coconut milk', quantity: '400', unit: 'ml' },
      { name: 'onion, sliced', quantity: '1', unit: '' },
      { name: 'green beans', quantity: '200', unit: 'g' },
      { name: 'fish sauce', quantity: '1', unit: 'tbsp' },
      { name: 'lime', quantity: '1', unit: '' },
      { name: 'jasmine rice', quantity: '300', unit: 'g' },
    ],
    method: [
      '1. Fry the curry paste in a little oil for 1 minute until fragrant.',
      '2. Add the chicken and brown, then pour in the coconut milk.',
      '3. Add the beans and simmer for 15 minutes until the chicken is cooked.',
      '4. Season with fish sauce and a squeeze of lime. Serve with steamed jasmine rice.',
    ].join('\n'),
  },
  'Roast chicken with veg': {
    ingredients: [
      { name: 'whole chicken (about 1.5kg)', quantity: '1', unit: '' },
      { name: 'potatoes, halved', quantity: '1', unit: 'kg' },
      { name: 'carrots, in chunks', quantity: '4', unit: '' },
      { name: 'olive oil', quantity: '2', unit: 'tbsp' },
      { name: 'lemon', quantity: '1', unit: '' },
      { name: 'thyme', quantity: '1', unit: 'few sprigs' },
    ],
    method: [
      '1. Heat the oven to 200C/fan 180C. Rub the chicken with oil, season and put the lemon in the cavity.',
      '2. Roast for 20 minutes per 500g plus 20 minutes (about 1 hr 20).',
      '3. Add the potatoes and carrots around the chicken for the last 45 minutes.',
      '4. Rest the chicken for 10 minutes, then carve and serve with the veg.',
    ].join('\n'),
  },
  'Homemade pizza night': {
    ingredients: [
      { name: 'strong bread flour', quantity: '500', unit: 'g' },
      { name: 'fast-action yeast', quantity: '7', unit: 'g sachet' },
      { name: 'warm water', quantity: '325', unit: 'ml' },
      { name: 'olive oil', quantity: '1', unit: 'tbsp' },
      { name: 'passata', quantity: '200', unit: 'g' },
      { name: 'mozzarella', quantity: '2', unit: 'balls' },
      { name: 'fresh basil', quantity: '1', unit: 'handful' },
    ],
    method: [
      '1. Mix the flour, yeast, a pinch of salt, water and oil into a dough and knead for 10 minutes.',
      '2. Leave to rise for 1 hour until doubled in size.',
      '3. Divide, roll out thinly and spread with passata.',
      '4. Top with torn mozzarella and bake at 240C for 8-10 minutes. Finish with basil.',
    ].join('\n'),
  },
  'Fish & chips': {
    ingredients: [
      { name: 'white fish fillets', quantity: '4', unit: '' },
      { name: 'potatoes, cut into chips', quantity: '1', unit: 'kg' },
      { name: 'plain flour', quantity: '100', unit: 'g' },
      { name: 'cold sparkling water', quantity: '150', unit: 'ml' },
      { name: 'baking powder', quantity: '1', unit: 'tsp' },
      { name: 'peas', quantity: '200', unit: 'g' },
      { name: 'oil for frying', quantity: '', unit: '' },
    ],
    method: [
      '1. Parboil the chips for 5 minutes, drain and pat dry.',
      '2. Whisk the flour, baking powder and sparkling water into a batter.',
      '3. Fry the chips at 180C until golden, then keep warm.',
      '4. Dip the fish in the batter and fry for 5-6 minutes until crisp. Serve with mushy peas.',
    ].join('\n'),
  },
  'Tacos al pastor': {
    ingredients: [
      { name: 'pork shoulder, thinly sliced', quantity: '600', unit: 'g' },
      { name: 'chipotle paste', quantity: '2', unit: 'tbsp' },
      { name: 'ground cumin', quantity: '1', unit: 'tsp' },
      { name: 'pineapple, diced', quantity: '200', unit: 'g' },
      { name: 'small tortillas', quantity: '8', unit: '' },
      { name: 'red onion, finely chopped', quantity: '1', unit: '' },
      { name: 'coriander', quantity: '1', unit: 'handful' },
      { name: 'lime', quantity: '1', unit: '' },
    ],
    method: [
      '1. Toss the pork with the chipotle paste and cumin and marinate for 20 minutes.',
      '2. Fry over a high heat until charred and cooked through.',
      '3. Char the pineapple in the same pan.',
      '4. Warm the tortillas and fill with pork, pineapple, onion and coriander. Squeeze over lime.',
    ].join('\n'),
  },
  'Butternut squash risotto': {
    ingredients: [
      { name: 'butternut squash, diced', quantity: '1', unit: '' },
      { name: 'arborio rice', quantity: '300', unit: 'g' },
      { name: 'onion, chopped', quantity: '1', unit: '' },
      { name: 'hot vegetable stock', quantity: '1.2', unit: 'l' },
      { name: 'white wine', quantity: '100', unit: 'ml' },
      { name: 'parmesan', quantity: '50', unit: 'g' },
      { name: 'butter', quantity: '2', unit: 'tbsp' },
    ],
    method: [
      '1. Roast the squash with a little oil at 200C for 25 minutes until soft.',
      '2. Soften the onion in butter, then stir in the rice for 1 minute.',
      '3. Add the wine, then the hot stock a ladle at a time, stirring, for about 20 minutes.',
      '4. Fold through the roasted squash and parmesan, season and serve.',
    ].join('\n'),
  },
};
