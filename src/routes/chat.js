const { Router } = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db/queries');
const { requireAuth, requireHousehold } = require('../middleware/auth');
const { CHAT_ASSISTANT_SYSTEM } = require('../services/prompts');

const router = Router();
const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Build the system prompt with family context injected.
 */
async function buildSystemPrompt(householdId, householdName) {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];

  const [members, notes, shopping, tasks, events] = await Promise.all([
    db.getHouseholdMembers(householdId),
    db.getHouseholdNotes(householdId),
    db.getShoppingList(householdId),
    db.getAllIncompleteTasks(householdId),
    db.getCalendarEvents(householdId, today, twoWeeks),
  ]);

  const membersStr = members.map(m => `${m.name}${m.family_role ? ` (${m.family_role})` : ''}`).join(', ') || 'none';
  const notesStr = notes.length > 0
    ? notes.map(n => `- ${n.key}: ${n.value}`).join('\n')
    : '(none saved yet)';
  const shoppingStr = shopping.filter(i => !i.completed).length > 0
    ? shopping.filter(i => !i.completed).map(i => `- ${i.item}${i.category ? ` [${i.category}]` : ''}`).join('\n')
    : '(empty)';
  const tasksStr = tasks.length > 0
    ? tasks.map(t => `- ${t.title}${t.assigned_to_name ? ` (${t.assigned_to_name})` : ''}${t.due_date ? ` due ${t.due_date}` : ''}`).join('\n')
    : '(none)';
  const eventsStr = events.length > 0
    ? events.map(e => `- ${e.title} on ${e.start_time?.split('T')[0] || 'TBD'}${e.assigned_to_name ? ` (${e.assigned_to_name})` : ''}`).join('\n')
    : '(none)';

  return CHAT_ASSISTANT_SYSTEM
    .replace(/{{HOUSEHOLD_NAME}}/g, householdName || 'your')
    .replace(/{{DATE}}/g, today)
    .replace(/{{MEMBERS}}/g, membersStr)
    .replace(/{{SHOPPING_LIST}}/g, shoppingStr)
    .replace(/{{TASKS}}/g, tasksStr)
    .replace(/{{EVENTS}}/g, eventsStr)
    .replace(/{{NOTES}}/g, notesStr);
}

/**
 * Extract all action JSON blocks from assistant response.
 * Returns { cleanContent, actions[] } where actions may be empty.
 */
function extractActions(content) {
  const actionRegex = /```json\s*\n?\s*(\{[\s\S]*?\})\s*\n?\s*```/g;
  const actions = [];
  let cleanContent = content;
  let m;

  while ((m = actionRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed.action) {
        actions.push(parsed);
      } else if (parsed.note_action) {
        // Backwards compat with old format
        if (parsed.note_action === 'save') actions.push({ action: 'save_note', key: parsed.key, value: parsed.value });
        else if (parsed.note_action === 'delete') actions.push({ action: 'delete_note', key: parsed.key });
      }
      cleanContent = cleanContent.replace(m[0], '');
    } catch {
      // Skip malformed JSON
    }
  }

  return { cleanContent: cleanContent.trim(), actions };
}

/**
 * GET /api/chat/history
 * Returns recent chat messages for the authenticated user.
 */
router.get('/history', requireAuth, requireHousehold, async (req, res) => {
  try {
    const messages = await db.getChatHistory(req.user.id, 50);
    return res.json({ messages });
  } catch (err) {
    console.error('GET /api/chat/history error:', err);
    return res.status(500).json({ error: 'Failed to load chat history.' });
  }
});

/**
 * DELETE /api/chat/history
 * Clear all chat messages for the authenticated user.
 */
router.delete('/history', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.clearChatHistory(req.user.id);
    return res.json({ message: 'Chat history cleared.' });
  } catch (err) {
    console.error('DELETE /api/chat/history error:', err);
    return res.status(500).json({ error: 'Failed to clear chat history.' });
  }
});

/**
 * POST /api/chat
 * Send a message to the AI assistant and get a response.
 */
router.post('/', requireAuth, requireHousehold, async (req, res) => {
  const { message } = req.body;

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    // Build context-rich system prompt
    const household = await db.getHouseholdById(req.householdId);
    const systemPrompt = await buildSystemPrompt(req.householdId, household?.name);

    // Get recent conversation history for context
    const history = await db.getChatHistory(req.user.id, 30);

    // Build messages array
    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message.trim() },
    ];

    // Call Claude
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text in AI response');

    // Extract and process all actions
    const { cleanContent, actions } = extractActions(textBlock.text);
    const members = await db.getHouseholdMembers(req.householdId);
    const executedActions = [];

    for (const act of actions) {
      try {
        if (act.action === 'save_note' && act.key && act.value) {
          await db.upsertHouseholdNote(req.householdId, act.key, act.value, req.user.id);
          executedActions.push({ type: 'save_note', key: act.key });

        } else if (act.action === 'delete_note' && act.key) {
          await db.deleteHouseholdNote(req.householdId, act.key);
          executedActions.push({ type: 'delete_note', key: act.key });

        } else if (act.action === 'create_event') {
          const assignee = act.assigned_to ? members.find(m => m.name.toLowerCase() === act.assigned_to.toLowerCase()) : null;
          const startTime = act.all_day
            ? `${act.date}T00:00:00Z`
            : `${act.date}T${act.start_time || '09:00'}:00Z`;
          const endTime = act.all_day
            ? `${act.date}T23:59:59Z`
            : `${act.date}T${act.end_time || act.start_time || '10:00'}:00Z`;

          await db.createCalendarEvent(req.householdId, {
            title: act.title,
            start_time: startTime,
            end_time: endTime,
            all_day: !!act.all_day,
            assigned_to: assignee?.id || null,
            assigned_to_name: assignee?.name || null,
            color: assignee?.color_theme || 'lavender',
          }, req.user.id);
          executedActions.push({ type: 'create_event', title: act.title });

        } else if (act.action === 'add_shopping' && act.items?.length) {
          await db.addShoppingItems(req.householdId, act.items, req.user.id);
          executedActions.push({ type: 'add_shopping', count: act.items.length });

        } else if (act.action === 'create_task') {
          await db.addTasks(req.householdId, [{
            title: act.title,
            assigned_to_name: act.assigned_to || null,
            due_date: act.due_date || null,
          }], req.user.id, members);
          executedActions.push({ type: 'create_task', title: act.title });
        }
      } catch (actionErr) {
        console.error(`Action ${act.action} failed (non-fatal):`, actionErr.message);
      }
    }

    // Save both messages to DB
    await db.saveChatMessage(req.householdId, req.user.id, 'user', message.trim());
    await db.saveChatMessage(req.householdId, req.user.id, 'assistant', cleanContent);

    return res.json({
      message: cleanContent,
      actions: executedActions.length > 0 ? executedActions : undefined,
    });
  } catch (err) {
    console.error('POST /api/chat error:', err);
    return res.status(500).json({ error: 'Failed to get AI response. Please try again.' });
  }
});

module.exports = router;
