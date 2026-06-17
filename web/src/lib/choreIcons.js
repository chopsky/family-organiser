// Emoji icon set for the Tasks (chores/routines) add/edit picker. Ported from
// the design handoff (design_handoff_tasks_rewards_lists). Categories drive the
// picker's monotone tab filter; keywords power search. Pure data + a search
// helper so the picker component stays presentational.

export const CHORE_EMOJI_CATS = [
  { key: 'chores', label: 'Chores', emojis: ['🧹', '🧽', '🧼', '🧺', '🗑️', '♻️', '🚿', '🛁', '🪣', '🧴', '🪥', '🛏️', '🪞', '🧯', '🔌', '💡', '🚽', '🧻', '🧦', '👕', '👚', '👖'] },
  { key: 'kitchen', label: 'Kitchen', emojis: ['🍽️', '🍴', '🥄', '🔪', '🥣', '🫕', '🍳', '☕', '🫖', '🧊', '🧂', '🥫', '🍱', '🥪', '🧁', '🥡', '🧇', '🍞'] },
  { key: 'pets', label: 'Pets', emojis: ['🐶', '🐕', '🐱', '🐈', '🐠', '🐟', '🐹', '🐰', '🐢', '🦎', '🐦', '🦜', '🐾', '🦴', '🥩'] },
  { key: 'school', label: 'School', emojis: ['📚', '📖', '📝', '✏️', '🖍️', '🎒', '🧮', '📐', '📏', '🔬', '🎨', '🖌️', '📓', '🗂️', '💻'] },
  { key: 'activity', label: 'Activity', emojis: ['🎹', '🎸', '🎻', '🥁', '🎤', '⚽', '🏀', '🎾', '🏊', '🚴', '🏃', '🤸', '🩰', '🥋', '🎯', '♟️', '🎮', '🧩'] },
  { key: 'outdoor', label: 'Outdoors', emojis: ['🌱', '🪴', '🌳', '🍃', '🚮', '🚗', '🚲', '🛴', '🌧️', '🌞', '🍂', '🪟', '🚪', '📦', '📬'] },
  { key: 'self', label: 'Self-care', emojis: ['🦷', '💊', '💤', '🧘', '📱', '⏰', '🩹', '🧠', '💧', '🥗', '🍎', '🛌', '😴', '🪮'] },
  { key: 'home', label: 'Home', emojis: ['🔒', '🗝️', '🧸', '🖼️', '🛋️', '📺', '🪑', '🕯️', '🧵', '🔧', '🔨', '🪛', '🧰', '🪜'] },
  { key: 'symbols', label: 'Symbols', emojis: ['⭐', '❤️', '✅', '📌', '🔔', '🎉', '🏆', '🥇', '💰', '📅', '⏳', '✨', '🔁', '📍'] },
];

export const CHORE_EMOJI_ALL = CHORE_EMOJI_CATS.flatMap((c) => c.emojis);

const KW = {
  '🧹': 'broom sweep', '🧽': 'sponge scrub', '🧼': 'soap wash', '🧺': 'laundry basket washing', '🗑️': 'bin trash rubbish waste', '♻️': 'recycle recycling',
  '🚿': 'shower wash', '🛁': 'bath bathtub', '🪣': 'bucket mop', '🧴': 'lotion soap bottle', '🪥': 'toothbrush brush teeth', '🛏️': 'bed make the bed',
  '🪞': 'mirror', '🧯': 'fire extinguisher', '🔌': 'plug unplug socket', '💡': 'light bulb lamp', '🚽': 'toilet loo', '🧻': 'toilet paper roll',
  '🧦': 'socks laundry', '👕': 'shirt clothes laundry', '👚': 'blouse clothes', '👖': 'jeans trousers pants clothes',
  '🍽️': 'plate dishes dinner', '🍴': 'cutlery fork knife table set', '🥄': 'spoon', '🔪': 'knife chop', '🥣': 'bowl cereal', '🫕': 'pot cooking',
  '🍳': 'cook fry egg breakfast', '☕': 'coffee tea drink', '🫖': 'teapot tea', '🧊': 'ice', '🧂': 'salt season', '🥫': 'can tin food', '🍱': 'lunch bento box',
  '🥪': 'sandwich lunch', '🧁': 'cupcake bake', '🥡': 'takeout leftovers', '🧇': 'waffle breakfast', '🍞': 'bread loaf',
  '🐶': 'dog puppy pet feed walk', '🐕': 'dog walk pet', '🐱': 'cat kitten pet', '🐈': 'cat pet', '🐠': 'fish tank feed', '🐟': 'fish feed', '🐹': 'hamster pet',
  '🐰': 'rabbit bunny pet', '🐢': 'turtle tortoise pet', '🦎': 'lizard reptile pet', '🐦': 'bird pet', '🦜': 'parrot bird pet', '🐾': 'paws pet animal', '🦴': 'bone dog', '🥩': 'meat feed dog',
  '📚': 'books homework study read', '📖': 'book read reading', '📝': 'write homework note', '✏️': 'pencil write homework', '🖍️': 'crayon draw color',
  '🎒': 'backpack school bag pack', '🧮': 'abacus maths', '📐': 'ruler maths geometry', '📏': 'ruler measure', '🔬': 'microscope science', '🎨': 'art paint palette',
  '🖌️': 'paintbrush art', '📓': 'notebook journal', '🗂️': 'folder files organise', '💻': 'laptop computer screen',
  '🎹': 'piano music practice keyboard', '🎸': 'guitar music practice', '🎻': 'violin music practice', '🥁': 'drums music practice', '🎤': 'sing microphone music',
  '⚽': 'football soccer sport', '🏀': 'basketball sport', '🎾': 'tennis sport', '🏊': 'swim swimming sport', '🚴': 'cycle bike sport', '🏃': 'run running exercise',
  '🤸': 'gymnastics cartwheel sport', '🩰': 'ballet dance', '🥋': 'karate martial arts judo', '🎯': 'darts target aim', '♟️': 'chess board game', '🎮': 'gaming video game console', '🧩': 'puzzle jigsaw',
  '🌱': 'plant water seedling garden', '🪴': 'plant pot water garden', '🌳': 'tree garden', '🍃': 'leaves garden', '🚮': 'litter bin rubbish', '🚗': 'car drive',
  '🚲': 'bike bicycle cycle', '🛴': 'scooter', '🌧️': 'rain weather umbrella', '🌞': 'sun weather morning', '🍂': 'leaves rake autumn', '🪟': 'window clean',
  '🚪': 'door lock', '📦': 'box parcel package', '📬': 'mail post letter mailbox',
  '🦷': 'tooth teeth dentist brush', '💊': 'pill medicine vitamin tablet', '💤': 'sleep nap bed', '🧘': 'meditate yoga calm', '📱': 'phone screen time',
  '⏰': 'alarm clock wake time', '🩹': 'plaster bandaid first aid', '🧠': 'brain mind', '💧': 'water drink hydrate', '🥗': 'salad healthy eat', '🍎': 'apple fruit healthy eat',
  '🛌': 'sleep bed rest', '😴': 'sleep tired nap', '🪮': 'comb hair brush',
  '🔒': 'lock lock up secure', '🗝️': 'key keys', '🧸': 'teddy toy tidy', '🖼️': 'picture frame art', '🛋️': 'sofa couch', '📺': 'tv television', '🪑': 'chair',
  '🕯️': 'candle', '🧵': 'thread sew', '🔧': 'wrench fix tool', '🔨': 'hammer fix tool', '🪛': 'screwdriver fix tool', '🧰': 'toolbox tools fix', '🪜': 'ladder',
  '⭐': 'star favourite', '❤️': 'heart love', '✅': 'check done complete tick', '📌': 'pin', '🔔': 'bell reminder notify', '🎉': 'party celebrate', '🏆': 'trophy win reward',
  '🥇': 'medal first win', '💰': 'money allowance cash', '📅': 'calendar date schedule', '⏳': 'timer time hourglass', '✨': 'sparkle', '🔁': 'repeat recurring', '📍': 'pin location',
};

const CAT_OF = {};
CHORE_EMOJI_CATS.forEach((c) => c.emojis.forEach((em) => { CAT_OF[em] = c.label.toLowerCase(); }));

// Emojis matching a free-text query (keywords + category label).
export function searchChoreEmojis(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return CHORE_EMOJI_ALL;
  return CHORE_EMOJI_ALL.filter((em) => ((KW[em] || '') + ' ' + (CAT_OF[em] || '')).includes(q));
}
