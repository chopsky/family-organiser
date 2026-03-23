/**
 * Aisle category detection for shopping items.
 * Used by both the migration (SQL has its own version) and the API layer.
 */

const AISLE_CATEGORIES = [
  'Dairy & Eggs',
  'Produce',
  'Meat & Seafood',
  'Pantry & Grains',
  'Bakery',
  'Frozen Foods',
  'Beverages',
  'Household & Cleaning',
  'Personal Care',
  'Other',
];

const AISLE_PATTERNS = [
  {
    category: 'Dairy & Eggs',
    pattern: /milk|cheese|cheddar|mozzarella|parmesan|feta|brie|gouda|halloumi|camembert|stilton|yoghurt|yogurt|butter|eggs?|cream/i,
  },
  {
    category: 'Produce',
    pattern: /apple|banana|mango|broccoli|carrot|tomato|onion|shallot|potato|pepper|capsicum|lettuce|cucumber|spinach|kale|avocado|lemon|lime|garlic|ginger|fruit|vegetable|berr(y|ies)|strawberr|blueberr|raspberr|blackberr|cranberr|grape|orange|pear|peach|nectarine|plum|cherry|cherries|celery|mushroom|courgette|zucchini|sweetcorn|corn|aubergine|eggplant|asparagus|cabbage|cauliflower|beetroot|turnip|swede|parsnip|leek|spring onion|radish|pea|chilli|chili|coriander|parsley|basil|mint|herb|dill|rosemary|thyme|pineapple|coconut|kiwi|watermelon|melon|fig|clementine|satsuma|tangerine|grapefruit|papaya|pomegranate|salad/i,
  },
  {
    category: 'Meat & Seafood',
    pattern: /chicken|beef|pork|lamb|sausage|mince|steak|bacon|ham|salmon|tuna|cod|fish|prawn|shrimp|crab|lobster|mussel|clam|oyster|squid|calamari|turkey|duck|venison|droewors|biltong|seafood/i,
  },
  {
    category: 'Bakery',
    pattern: /bread|roll|baguette|croissant|muffin|bagel|wrap|tortilla|pitta|pita|naan|flatbread|cake|cupcake|cookie|biscuit|pie|tart|doughnut|donut|bun|pastry|scone|pancake|waffle/i,
  },
  {
    category: 'Pantry & Grains',
    pattern: /rice|pasta|spaghetti|penne|fusilli|macaroni|lasagne|noodle|cereal|oat|granola|muesli|flour|sugar|oil|olive oil|vinegar|sauce|ketchup|mustard|mayo|bean|lentil|chickpea|stock|bouillon|broth|spice|cumin|paprika|cinnamon|turmeric|bolognese|soy sauce|honey|jam|marmalade|peanut butter|nutella|nut|almond|walnut|cashew|chocolate|crisp|popcorn|salt|seasoning|tin|can|baked beans/i,
  },
  {
    category: 'Frozen Foods',
    pattern: /frozen|ice cream|ice loll|pizza|fish finger|nugget|smoothie melt/i,
  },
  {
    category: 'Beverages',
    pattern: /juice|water|cola|coke|pepsi|fanta|sprite|soda|fizzy|coffee|tea|squash|cordial|wine|beer|lager|ale|champagne|prosecco|whisky|vodka|gin|rum|brandy|smoothie|milkshake|energy drink|lemonade|oat milk|almond milk|soy milk/i,
  },
  {
    category: 'Personal Care',
    pattern: /soap|shampoo|conditioner|toothpaste|toothbrush|deodorant|moisturis|lotion|sunscreen|sun cream|razor|shav|napp(y|ies)|wipe|plaster|bandage|medicine|paracetamol|ibuprofen|vitamin|cotton/i,
  },
  {
    category: 'Household & Cleaning',
    pattern: /paper towel|kitchen roll|toilet paper|loo roll|tissue|bin bag|rubbish bag|cling film|foil|aluminium|sponge|bleach|disinfectant|detergent|washing liquid|washing powder|laundry|dishwasher|cleaning|cloth|duster|candle|light\s?bulb|batter(y|ies)/i,
  },
];

/**
 * Detect the best matching aisle category for a given item name.
 * @param {string} itemName - The name of the shopping item.
 * @returns {string} The aisle category, or 'Other' if no match.
 */
function detectAisle(itemName) {
  if (!itemName || typeof itemName !== 'string') return 'Other';

  const name = itemName.trim();
  for (const { category, pattern } of AISLE_PATTERNS) {
    if (pattern.test(name)) return category;
  }
  return 'Other';
}

module.exports = { AISLE_CATEGORIES, detectAisle };
