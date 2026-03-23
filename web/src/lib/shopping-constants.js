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

// Item name to emoji lookup — more specific patterns first, then generic
const ITEM_EMOJI_MAP = [
  // Fruits
  [/apple/i, '🍎'], [/banana/i, '🍌'], [/mango/i, '🥭'], [/orange/i, '🍊'],
  [/lemon/i, '🍋'], [/lime/i, '🍋'], [/grape/i, '🍇'], [/pear/i, '🍐'],
  [/peach|nectarine/i, '🍑'], [/cherry|cherries/i, '🍒'],
  [/strawberr/i, '🍓'], [/blueberr/i, '🫐'], [/raspberr/i, '🍓'],
  [/watermelon/i, '🍉'], [/melon|cantaloupe|honeydew/i, '🍈'],
  [/pineapple/i, '🍍'], [/coconut/i, '🥥'], [/kiwi/i, '🥝'],
  [/grapefruit/i, '🍊'], [/tangerine|clementine|satsuma/i, '🍊'],
  [/berry|berries/i, '🍓'], [/plum/i, '🍑'], [/fig/i, '🍑'],
  [/fruit/i, '🍎'],
  // Vegetables
  [/broccoli/i, '🥦'], [/carrot/i, '🥕'], [/sweet potato/i, '🍠'],
  [/potato|spud/i, '🥔'], [/tomato/i, '🍅'], [/onion|shallot/i, '🧅'],
  [/garlic/i, '🧄'], [/corn|sweetcorn/i, '🌽'], [/mushroom/i, '🍄'],
  [/avocado/i, '🥑'], [/cucumber/i, '🥒'], [/courgette|zucchini/i, '🥒'],
  [/aubergine|eggplant/i, '🍆'], [/chilli|chili/i, '🌶️'],
  [/pepper|capsicum/i, '🌶️'], [/lettuce|salad leaves/i, '🥬'],
  [/spinach|kale/i, '🥬'], [/cabbage/i, '🥬'], [/celery/i, '🥬'],
  [/asparagus/i, '🥬'], [/pea/i, '🫛'], [/bean|lentil/i, '🫘'],
  [/ginger/i, '🫚'], [/beetroot|beet/i, '🥬'],
  [/turnip|swede|parsnip/i, '🥕'], [/leek|spring onion/i, '🧅'],
  [/coriander|parsley|basil|mint|herb|dill|rosemary|thyme/i, '🌿'],
  [/cauliflower/i, '🥦'],
  // Meat and Seafood
  [/chicken/i, '🍗'], [/beef|mince/i, '🥩'], [/steak/i, '🥩'],
  [/sausage/i, '🌭'], [/bacon/i, '🥓'], [/ham/i, '🥓'],
  [/pork/i, '🥩'], [/lamb/i, '🥩'], [/turkey/i, '🦃'], [/duck/i, '🦆'],
  [/salmon/i, '🐟'], [/tuna/i, '🐟'], [/cod/i, '🐟'],
  [/prawn|shrimp/i, '🦐'], [/crab/i, '🦀'], [/lobster/i, '🦞'],
  [/mussel|clam|oyster/i, '🦪'], [/squid|calamari/i, '🦑'],
  [/fish/i, '🐟'], [/droewors|biltong/i, '🥩'], [/venison/i, '🥩'],
  // Dairy and Eggs
  [/milk/i, '🥛'], [/eggs?/i, '🥚'],
  [/cheese|cheddar|mozzarella|parmesan|feta|brie|gouda|halloumi|camembert|stilton/i, '🧀'],
  [/butter/i, '🧈'], [/yoghurt|yogurt/i, '🥛'], [/cream/i, '🥛'],
  [/ice cream/i, '🍦'],
  // Bakery
  [/bread/i, '🍞'], [/croissant/i, '🥐'], [/bagel/i, '🥯'],
  [/pretzel/i, '🥨'], [/pancake|crepe/i, '🥞'], [/waffle/i, '🧇'],
  [/cake/i, '🎂'], [/cupcake|muffin/i, '🧁'], [/cookie|biscuit/i, '🍪'],
  [/pie|tart/i, '🥧'], [/doughnut|donut/i, '🍩'], [/roll|bun/i, '🍞'],
  [/wrap|tortilla|pitta|pita|naan|flatbread/i, '🫓'],
  // Pantry and Grains
  [/rice/i, '🍚'], [/pasta|spaghetti|penne|fusilli|macaroni|lasagne|noodle/i, '🍝'],
  [/cereal|oat|granola|muesli/i, '🥣'], [/honey/i, '🍯'],
  [/flour/i, '🌾'], [/sugar/i, '🌾'], [/oil|olive oil/i, '🫒'],
  [/sauce|ketchup|mustard|mayo/i, '🫙'], [/vinegar/i, '🫙'],
  [/jam|marmalade/i, '🫙'], [/peanut butter|nutella/i, '🥜'],
  [/nut|almond|walnut|cashew|pistachio/i, '🥜'],
  [/chocolate/i, '🍫'], [/candy|sweet/i, '🍬'],
  [/crisp|chip/i, '🍟'], [/popcorn/i, '🍿'],
  [/salt|seasoning|spice|cumin|paprika|cinnamon|turmeric/i, '🧂'],
  [/stock|bouillon|broth/i, '🫙'], [/tin|can|baked beans/i, '🥫'],
  [/bolognese/i, '🍝'], [/soy sauce/i, '🫙'],
  // Frozen
  [/frozen/i, '🧊'], [/pizza/i, '🍕'], [/nugget/i, '🍗'],
  [/fish finger/i, '🐟'], [/smoothie melt/i, '🧊'],
  // Beverages
  [/coffee/i, '☕'], [/tea\b/i, '🍵'], [/juice/i, '🧃'],
  [/water/i, '💧'], [/cola|coke|pepsi|fanta|sprite|soda|fizzy/i, '🥤'],
  [/squash|cordial/i, '🧃'], [/wine/i, '🍷'], [/beer|lager|ale/i, '🍺'],
  [/champagne|prosecco/i, '🍾'], [/whisky|vodka|gin|rum/i, '🥃'],
  [/smoothie/i, '🥤'], [/oat milk|almond milk|soy milk/i, '🥛'],
  // Household
  [/paper towel|kitchen roll/i, '🧻'], [/toilet paper|loo roll/i, '🧻'],
  [/tissue/i, '🧻'], [/bin bag|rubbish bag/i, '🗑️'],
  [/sponge/i, '🧽'], [/bleach|disinfectant/i, '🧴'],
  [/detergent|washing liquid|washing powder|laundry/i, '🧴'],
  [/dishwasher/i, '🧴'], [/cleaning/i, '🧹'], [/candle/i, '🕯️'],
  [/light\s?bulb/i, '💡'], [/batter/i, '🔋'],
  // Personal Care
  [/soap/i, '🧴'], [/shampoo|conditioner/i, '🧴'],
  [/toothpaste/i, '🪥'], [/toothbrush/i, '🪥'],
  [/deodorant/i, '🧴'], [/moisturis|lotion|sunscreen|sun cream/i, '🧴'],
  [/razor|shav/i, '🪒'], [/napp(y|ies)/i, '🧒'], [/wipe/i, '🧻'],
  [/plaster|bandage/i, '🩹'], [/medicine|paracetamol|ibuprofen/i, '💊'],
  [/vitamin/i, '💊'],
  // Prepared food
  [/sandwich/i, '🥪'], [/burger/i, '🍔'], [/taco/i, '🌮'],
  [/burrito/i, '🌯'], [/sushi/i, '🍣'], [/curry/i, '🍛'],
  [/soup/i, '🍲'], [/salad/i, '🥗'], [/hummus/i, '🫘'],
  [/olive/i, '🫒'], [/hot dog/i, '🌭'], [/kebab/i, '🥙'],
  [/ramen/i, '🍜'], [/roast/i, '🍖'],
  // Pet
  [/dog food|cat food|pet food/i, '🐾'],
];

export function getItemEmoji(itemName, aisleCategory) {
  const name = (itemName || '').toLowerCase();
  for (const [pattern, emoji] of ITEM_EMOJI_MAP) {
    if (pattern.test(name)) return emoji;
  }
  return AISLE_CONFIG[aisleCategory]?.emoji || '📦';
}
