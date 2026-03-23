// Aisle categories in display order
export const AISLE_CATEGORIES = [
  'Meat & Seafood', 'Produce', 'Dairy & Eggs', 'Pantry & Grains',
  'Bakery', 'Frozen Foods', 'Beverages', 'Household & Cleaning',
  'Personal Care', 'Other'
];

// Per-aisle config: background colour for icon container, stroke colour for SVG icon, fallback emoji, pill colours for purchased section
export const AISLE_CONFIG = {
  'Meat & Seafood':       { bg: '#FDF0EB', stroke: '#C4522A', emoji: '🥩', pillBg: '#FDF0EB', pillText: '#993C1D' },
  'Produce':              { bg: '#EDF5EE', stroke: '#4A7D50', emoji: '🥬', pillBg: '#EDF5EE', pillText: '#3A6B40' },
  'Dairy & Eggs':         { bg: '#E6F1FB', stroke: '#3B7DD8', emoji: '🥛', pillBg: '#E6F1FB', pillText: '#185FA5' },
  'Pantry & Grains':      { bg: '#FAEEDA', stroke: '#B07D1A', emoji: '🌾', pillBg: '#FAEEDA', pillText: '#854F0B' },
  'Bakery':               { bg: '#FAEEDA', stroke: '#B07D1A', emoji: '🍞', pillBg: '#FAEEDA', pillText: '#854F0B' },
  'Frozen Foods':         { bg: '#E6F1FB', stroke: '#185FA5', emoji: '🧊', pillBg: '#E6F1FB', pillText: '#185FA5' },
  'Beverages':            { bg: '#FDF0EB', stroke: '#C4522A', emoji: '🥤', pillBg: '#FDF0EB', pillText: '#993C1D' },
  'Household & Cleaning': { bg: '#F3EDFC', stroke: '#6B3FA0', emoji: '🧹', pillBg: '#F3EDFC', pillText: '#6B3FA0' },
  'Personal Care':        { bg: '#FDF0EB', stroke: '#C4522A', emoji: '🧴', pillBg: '#FDF0EB', pillText: '#993C1D' },
  'Other':                { bg: '#FBF8F3', stroke: '#6B6774', emoji: '📦', pillBg: '#FBF8F3', pillText: '#6B6774' },
};

// Item name → emoji lookup (partial substring matching, case-insensitive)
const ITEM_EMOJI_MAP = [
  [/milk/i, '🥛'], [/chicken/i, '🍗'], [/bread/i, '🍞'], [/eggs?$/i, '🥚'],
  [/cheese|cheddar|mozzarella|parmesan|feta|brie/i, '🧀'], [/mango/i, '🥭'],
  [/broccoli/i, '🥦'], [/rice/i, '🍚'], [/pasta|spaghetti|penne|fusilli/i, '🍝'],
  [/beef|mince/i, '🥩'], [/sausage/i, '🌭'], [/apple/i, '🍎'], [/banana/i, '🍌'],
  [/butter/i, '🧈'], [/yoghurt|yogurt/i, '🥛'], [/salmon|fish|cod|tuna|prawn/i, '🐟'],
  [/ice cream/i, '🍦'], [/coffee/i, '☕'], [/juice/i, '🧃'], [/soap|shampoo/i, '🧴'],
  [/toothpaste|toothbrush/i, '🪥'], [/paper towel|kitchen roll/i, '🧻'],
  [/tomato/i, '🍅'], [/onion/i, '🧅'], [/carrot/i, '🥕'], [/potato/i, '🥔'],
  [/pepper/i, '🌶️'], [/lemon|lime/i, '🍋'], [/orange/i, '🍊'], [/grape/i, '🍇'],
  [/avocado/i, '🥑'], [/corn/i, '🌽'], [/mushroom/i, '🍄'], [/garlic/i, '🧄'],
  [/bacon|ham/i, '🥓'], [/pizza/i, '🍕'], [/tea/i, '🍵'], [/wine/i, '🍷'],
  [/beer/i, '🍺'], [/water/i, '💧'], [/cereal|oat/i, '🥣'], [/honey/i, '🍯'],
  [/lamb/i, '🐑'], [/pork/i, '🐷'], [/steak/i, '🥩'], [/droewors|biltong/i, '🥩'],
];

export function getItemEmoji(itemName, aisleCategory) {
  const name = (itemName || '').toLowerCase();
  for (const [pattern, emoji] of ITEM_EMOJI_MAP) {
    if (pattern.test(name)) return emoji;
  }
  return AISLE_CONFIG[aisleCategory]?.emoji || '📦';
}
