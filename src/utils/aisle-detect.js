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
    pattern: /\b(milk|cheese|yoghurt|yogurt|butter|eggs?|cream)\b/i,
  },
  {
    category: 'Produce',
    pattern: /\b(apple|banana|mango|broccoli|carrot|tomato|onion|potato|pepper|lettuce|cucumber|spinach|avocado|lemon|garlic|fruit|vegetable|berries|strawberr|blueberr|grapes?|oranges?|pear|celery|mushroom|courgette|zucchini|sweetcorn|corn)\b/i,
  },
  {
    category: 'Meat & Seafood',
    pattern: /\b(chicken|beef|pork|lamb|sausage|mince|steak|bacon|ham|salmon|fish|prawn|turkey|droewors|biltong)\b/i,
  },
  {
    category: 'Bakery',
    pattern: /\b(bread|rolls?|baguette|croissant|muffin|bagel|wraps?|cake)\b/i,
  },
  {
    category: 'Pantry & Grains',
    pattern: /\b(rice|pasta|noodle|cereal|flour|sugar|oil|vinegar|sauce|ketchup|beans?|lentils?|stock|spice|bolognese|honey|jam|peanut butter|oats|canned|tin)\b/i,
  },
  {
    category: 'Frozen Foods',
    pattern: /\b(frozen|ice cream|pizza|chips|fish fingers|nuggets|smoothie melts)\b/i,
  },
  {
    category: 'Beverages',
    pattern: /\b(juice|water|cola|coffee|tea|squash|wine|beer|drink|soda|lemonade)\b/i,
  },
  {
    category: 'Personal Care',
    pattern: /\b(soap|shampoo|toothpaste|toothbrush|deodorant|napp(y|ies)|wipes)\b/i,
  },
  {
    category: 'Household & Cleaning',
    pattern: /\b(paper towel|kitchen roll|bin bag|cling film|foil|sponge|bleach|detergent|washing|dishwasher|cleaning)\b/i,
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
