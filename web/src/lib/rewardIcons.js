// Reward emoji set for the Rewards add/edit picker — a richer, reward-themed
// catalogue (treats, outings, screen time, money, toys…) shown in the same
// searchable, categorized selector the Tasks page uses (see ui/EmojiPicker).
import { CHORE_EMOJI_CATS, searchChoreEmojis } from './choreIcons';

export const REWARD_EMOJI_CATS = [
  { key: 'treats', label: 'Treats', emojis: ['🍦', '🍫', '🍪', '🍭', '🧁', '🍩', '🎂', '🍰', '🍬', '🍿', '🥤', '🧃', '🍓', '🍉', '🍌', '🍎'] },
  { key: 'foodout', label: 'Food out', emojis: ['🍕', '🍔', '🌭', '🌮', '🥪', '🍜', '🍣', '🍟', '🥡', '🥨', '🥞', '🌯', '🍱', '🍦'] },
  { key: 'screen', label: 'Screen time', emojis: ['📱', '💻', '🎮', '🕹️', '🎧', '📺', '🎬', '🍿', '⌚', '📷', '🎟️'] },
  { key: 'activities', label: 'Activities', emojis: ['⚽', '🏀', '🎾', '🏊', '🚴', '🛴', '🛹', '🎳', '🎯', '🎨', '🎭', '🤸', '🏓', '🧗', '🎤', '🎲', '🧩'] },
  { key: 'outings', label: 'Outings', emojis: ['🦁', '🐘', '🎢', '🎡', '🏖️', '🏰', '🚂', '⛺', '🏕️', '🗺️', '🎪', '🚀', '🍿', '🎟️'] },
  { key: 'money', label: 'Money', emojis: ['💷', '💰', '💵', '🪙', '🛍️', '🎁', '🎀', '💳', '🏧'] },
  { key: 'toys', label: 'Toys', emojis: ['🧸', '🪀', '🛼', '🎈', '🪁', '🧱', '🚗', '🪅', '🎏', '🪃'] },
  { key: 'privileges', label: 'Privileges', emojis: ['⏰', '🌙', '🛌', '😴', '🥳', '🎉', '⭐', '🏆', '🥇', '👑', '🎟️', '🛏️'] },
  { key: 'pets', label: 'Pets', emojis: ['🐶', '🐱', '🐰', '🐹', '🐢', '🐠', '🐾', '🦴'] },
];

export const REWARD_EMOJI_ALL = REWARD_EMOJI_CATS.flatMap((c) => c.emojis);

const KW = {
  '🍦': 'ice cream dessert', '🍫': 'chocolate', '🍪': 'cookie biscuit', '🍭': 'lollipop sweet', '🧁': 'cupcake', '🍩': 'doughnut donut', '🎂': 'cake birthday', '🍰': 'cake slice', '🍬': 'sweet candy', '🍿': 'popcorn movie', '🥤': 'drink soda', '🧃': 'juice box', '🍓': 'strawberry fruit', '🍉': 'watermelon fruit', '🍌': 'banana fruit', '🍎': 'apple fruit',
  '🍕': 'pizza', '🍔': 'burger', '🌭': 'hot dog', '🌮': 'taco', '🥪': 'sandwich', '🍜': 'noodles ramen', '🍣': 'sushi', '🍟': 'fries chips', '🥡': 'takeout', '🥨': 'pretzel', '🥞': 'pancakes', '🌯': 'burrito wrap', '🍱': 'bento lunch',
  '📱': 'phone screen time', '💻': 'laptop computer', '🎮': 'gaming video game console', '🕹️': 'joystick arcade game', '🎧': 'headphones music', '📺': 'tv television', '🎬': 'movie film cinema', '⌚': 'watch smartwatch', '📷': 'camera photo', '🎟️': 'ticket pass',
  '⚽': 'football soccer', '🏀': 'basketball', '🎾': 'tennis', '🏊': 'swimming swim', '🚴': 'bike cycling', '🛴': 'scooter', '🛹': 'skateboard', '🎳': 'bowling', '🎯': 'darts target', '🎨': 'art painting craft', '🎭': 'theatre drama', '🤸': 'gymnastics', '🏓': 'table tennis ping pong', '🧗': 'climbing', '🎤': 'singing karaoke', '🎲': 'board game dice', '🧩': 'puzzle',
  '🦁': 'zoo lion safari', '🐘': 'zoo elephant', '🎢': 'theme park rollercoaster', '🎡': 'fair ferris wheel', '🏖️': 'beach seaside', '🏰': 'castle theme park disney', '🚂': 'train trip', '⛺': 'camping tent', '🏕️': 'camping outdoors', '🗺️': 'trip adventure map', '🎪': 'circus', '🚀': 'space rocket',
  '💷': 'pocket money pounds cash', '💰': 'money bag allowance', '💵': 'cash dollars money', '🪙': 'coin money', '🛍️': 'shopping spree', '🎁': 'gift present', '🎀': 'bow present', '💳': 'card money', '🏧': 'cash money',
  '🧸': 'teddy toy bear', '🪀': 'yoyo toy', '🛼': 'roller skates', '🎈': 'balloon party', '🪁': 'kite', '🧱': 'lego bricks', '🚗': 'toy car', '🪅': 'piñata party', '🎏': 'toy',
  '⏰': 'stay up late time', '🌙': 'late bedtime stay up', '🛌': 'lie in sleep', '😴': 'lie in sleep nap', '🥳': 'party celebrate', '🎉': 'party celebrate', '⭐': 'star', '🏆': 'trophy', '🥇': 'medal', '👑': 'crown king queen', '🛏️': 'sleepover bed',
  '🐶': 'dog puppy pet', '🐱': 'cat pet', '🐰': 'rabbit bunny', '🐹': 'hamster', '🐢': 'turtle', '🐠': 'fish', '🐾': 'pet animal', '🦴': 'bone dog',
};

const CAT_OF = {};
REWARD_EMOJI_CATS.forEach((c) => c.emojis.forEach((em) => { CAT_OF[em] = c.label.toLowerCase(); }));

export function searchRewardEmojis(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return REWARD_EMOJI_ALL;
  return REWARD_EMOJI_ALL.filter((em) => ((KW[em] || '') + ' ' + (CAT_OF[em] || '')).includes(q));
}

// Reward picker shows the reward-themed categories first, then every Tasks
// (chore) category too, so it has "more icons (same as Tasks)". Categories
// with the same label are merged (emojis deduped) and keys are kept unique.
function mergeCats(...lists) {
  const out = [];
  const byLabel = new Map();
  const keys = new Set();
  for (const cat of lists.flat()) {
    let existing = byLabel.get(cat.label);
    if (!existing) {
      let key = cat.key; let n = 1;
      while (keys.has(key)) key = `${cat.key}${++n}`;
      keys.add(key);
      existing = { key, label: cat.label, emojis: [] };
      byLabel.set(cat.label, existing);
      out.push(existing);
    }
    for (const em of cat.emojis) if (!existing.emojis.includes(em)) existing.emojis.push(em);
  }
  return out;
}

export const REWARD_PLUS_TASK_CATS = mergeCats(REWARD_EMOJI_CATS, CHORE_EMOJI_CATS);

export function searchRewardPlusTaskEmojis(query) {
  return Array.from(new Set([...searchRewardEmojis(query), ...searchChoreEmojis(query)]));
}
