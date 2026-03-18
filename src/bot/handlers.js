/**
 * Channel-agnostic message handlers.
 *
 * These functions process incoming messages (text, voice, photos) and return
 * response strings. They don't depend on any specific messaging
 * platform — the WhatsApp webhook calls them.
 */

const db = require('../db/queries');
const { classify, scanReceipt, matchReceiptToList } = require('../services/ai');
const { transcribeVoice } = require('../services/transcribe');

// ─── Format helpers ───────────────────────────────────────────────────────────

const CATEGORY_EMOJI = {
  groceries: '🛒',
  clothing:  '👕',
  household: '🏠',
  school:    '🎒',
  pets:      '🐾',
  party:     '🎉',
  gifts:     '🎁',
  other:     '📦',
};

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatShoppingList(items) {
  if (!items.length) return '✅ Shopping list is empty!';

  const grouped = {};
  for (const item of items) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  const lines = [];
  for (const [cat, catItems] of Object.entries(grouped)) {
    const emoji = CATEGORY_EMOJI[cat] || '📦';
    lines.push(`\n${emoji} *${capitalise(cat)}*`);
    for (const i of catItems) {
      const qty = i.quantity ? ` (${i.quantity})` : '';
      lines.push(`  • ${i.item}${qty}`);
    }
  }
  return lines.join('\n').trim();
}

function formatTaskList(tasks, heading = 'Tasks') {
  if (!tasks.length) return `✅ No ${heading.toLowerCase()}!`;

  const today = new Date().toISOString().split('T')[0];
  const lines = [`*${heading}*`];

  for (const t of tasks) {
    const overdue = t.due_date < today;
    const dueToday = t.due_date === today;
    const statusIcon = overdue ? '🔴' : dueToday ? '🟡' : '⚪';
    const who = t.assigned_to_name ? ` — ${t.assigned_to_name}` : ' — Everyone';
    const rec = t.recurrence ? ` _(${t.recurrence})_` : '';
    const dateLabel = overdue
      ? ` _(overdue: ${t.due_date})_`
      : dueToday ? ' _(today)_' : ` _(${t.due_date})_`;
    lines.push(`${statusIcon} ${t.title}${who}${rec}${dateLabel}`);
  }
  return lines.join('\n');
}

// ─── Core handlers ────────────────────────────────────────────────────────────

/**
 * Handle a natural language text message.
 * Classifies with AI and performs shopping/task operations.
 *
 * @param {string} text       - The message text
 * @param {object} user       - User row from DB
 * @param {object} household  - { id, members }
 * @returns {Promise<{response: string, actions: object}>} Response message and action details
 */
async function handleTextMessage(text, user, household) {
  const memberNames = household.members.map((m) => m.name);
  const result = await classify(text, memberNames);

  const actions = {
    shoppingAdded: [],
    shoppingCompleted: [],
    tasksAdded: [],
    tasksCompleted: [],
  };

  // Handle specific query intents
  if (result.intent === 'query_list') {
    const listResponse = await handleList(user, household);
    return { response: listResponse, actions };
  }
  if (result.intent === 'query_tasks') {
    const taskResponse = await handleTasks(user, household);
    return { response: taskResponse, actions };
  }

  // Handle general chat — just return the AI's conversational response
  if (result.intent === 'chat') {
    return { response: result.response_message || "I'm not sure how to help with that. Try asking me about shopping, tasks, or anything around the house!", actions };
  }

  // Handle shopping items
  if (result.shopping_items?.length) {
    const toAdd = result.shopping_items.filter((i) => i.action === 'add');
    const toRemove = result.shopping_items.filter((i) => i.action === 'remove');
    if (toAdd.length) {
      await db.addShoppingItems(household.id, toAdd, user.id);
      actions.shoppingAdded = toAdd.map((i) => i.item);
    }
    if (toRemove.length) {
      await db.completeShoppingItemsByName(household.id, toRemove.map((i) => i.item));
      actions.shoppingCompleted = toRemove.map((i) => i.item);
    }
  }

  // Handle tasks
  if (result.tasks?.length) {
    const toAdd = result.tasks.filter((t) => t.action === 'add');
    const toComplete = result.tasks.filter((t) => t.action === 'complete');
    if (toAdd.length) {
      await db.addTasks(household.id, toAdd, user.id, household.members);
      actions.tasksAdded = toAdd.map((t) => t.title);
    }
    for (const t of toComplete) {
      const done = await db.completeTasksByName(household.id, [t.title], t.assigned_to_name);
      actions.tasksCompleted.push(t.title);
      for (const completedTask of done) {
        if (completedTask.recurrence) await db.generateNextRecurrence(completedTask);
      }
    }
  }

  return {
    response: result.response_message || 'Done! ✅',
    actions,
  };
}

/**
 * Build a short broadcast notification message for other household members.
 * Returns null if no meaningful actions were taken.
 *
 * @param {string} userName - Name of the person who made the change
 * @param {object} actions  - { shoppingAdded, shoppingCompleted, tasksAdded, tasksCompleted }
 * @returns {string|null}
 */
function buildBroadcastMessage(userName, actions) {
  const lines = [];

  if (actions.shoppingAdded.length) {
    lines.push(`🛒 ${userName} added: ${actions.shoppingAdded.join(', ')}`);
  }
  if (actions.shoppingCompleted.length) {
    lines.push(`✅ ${userName} checked off: ${actions.shoppingCompleted.join(', ')}`);
  }
  if (actions.tasksAdded.length) {
    lines.push(`📋 ${userName} added task: ${actions.tasksAdded.join(', ')}`);
  }
  if (actions.tasksCompleted.length) {
    lines.push(`✅ ${userName} completed: ${actions.tasksCompleted.join(', ')}`);
  }

  return lines.length ? lines.join('\n') : null;
}

/**
 * Handle a voice note (audio buffer).
 * Transcribes with Whisper, then feeds to AI classification.
 *
 * @param {Buffer} audioBuffer - Audio file buffer
 * @param {string} filename    - e.g. "voice.ogg" or "audio.ogg"
 * @param {object} user
 * @param {object} household
 * @returns {Promise<{transcription: string, response: string}>}
 */
async function handleVoiceNote(audioBuffer, filename, user, household) {
  const transcribedText = await transcribeVoice(audioBuffer, filename);

  if (!transcribedText) {
    return { transcription: null, response: "🎙️ Couldn't hear anything in that voice note. Please try again." };
  }

  const result = await handleTextMessage(transcribedText, user, household);
  return {
    transcription: transcribedText,
    response: `🎙️ _"${transcribedText}"_\n\n${result.response}`,
    actions: result.actions,
  };
}

/**
 * Handle a photo (receipt scanning).
 * Extracts items with Claude Vision, matches against shopping list.
 *
 * @param {Buffer} imageBuffer
 * @param {string} mimeType - e.g. "image/jpeg"
 * @param {object} user
 * @param {object} household
 * @returns {Promise<{response: string, actions: object}>}
 */
async function handlePhoto(imageBuffer, mimeType, user, household) {
  const noActions = { shoppingAdded: [], shoppingCompleted: [], tasksAdded: [], tasksCompleted: [] };
  const extracted = await scanReceipt(imageBuffer, mimeType);

  if (!extracted.items?.length) {
    return {
      response: "🧾 I couldn't find any items on that receipt. Is this a grocery receipt? Try sending a clearer photo.",
      actions: noActions,
    };
  }

  // Fuzzy-match against the household shopping list
  const shoppingList = await db.getShoppingList(household.id);
  const matchResult = await matchReceiptToList(extracted.items, shoppingList);

  // Complete matched items
  const checkedOff = [];
  for (const match of matchResult.matches || []) {
    if (match.confidence >= 0.7) {
      await db.completeShoppingItemById(match.list_item_id);
      checkedOff.push(match.list_item_name);
    }
  }

  // Build confirmation message
  const store = extracted.store_name ? ` from *${extracted.store_name}*` : '';
  const lines = [`🧾 Receipt scanned${store}`];

  if (checkedOff.length) {
    lines.push(`\n✅ *Checked off:* ${checkedOff.join(', ')}`);
  } else {
    lines.push('\n✅ No shopping list items matched this receipt.');
  }

  if (matchResult.unmatched_receipt_items?.length) {
    lines.push(`\n❓ *Not on your list:* ${matchResult.unmatched_receipt_items.join(', ')}`);
  }

  return {
    response: lines.join('\n'),
    actions: { ...noActions, shoppingCompleted: checkedOff },
  };
}

/**
 * Handle a "list" command — show shopping list.
 */
async function handleList(user, household) {
  const items = await db.getShoppingList(household.id);
  return formatShoppingList(items);
}

/**
 * Handle a "tasks" command.
 * @param {boolean} showAll - Show all pending tasks (not just today/overdue)
 */
async function handleTasks(user, household, showAll = false) {
  const tasks = showAll
    ? await db.getAllIncompleteTasks(household.id)
    : await db.getTasks(household.id);
  const heading = showAll ? 'All Pending Tasks' : 'Tasks Due Today & Overdue';
  return formatTaskList(tasks, heading);
}

/**
 * Handle a "my tasks" command.
 */
async function handleMyTasks(user, household) {
  const tasks = await db.getTasks(household.id, { assignedToId: user.id });
  const heading = `${user.name}'s Tasks`;
  return formatTaskList(tasks, heading);
}

module.exports = {
  handleTextMessage,
  handleVoiceNote,
  handlePhoto,
  handleList,
  handleTasks,
  handleMyTasks,
  buildBroadcastMessage,
  formatShoppingList,
  formatTaskList,
  CATEGORY_EMOJI,
  capitalise,
};
