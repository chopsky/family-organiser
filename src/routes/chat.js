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
 * Extract note action JSON from assistant response (if present).
 * Returns { cleanContent, noteAction } where noteAction may be null.
 */
function extractNoteAction(content) {
  const match = content.match(/```json\s*\n?\s*(\{[\s\S]*?"note_action"[\s\S]*?\})\s*\n?\s*```/);
  if (!match) return { cleanContent: content.trim(), noteAction: null };

  try {
    const noteAction = JSON.parse(match[1]);
    const cleanContent = content.replace(match[0], '').trim();
    return { cleanContent, noteAction };
  } catch {
    return { cleanContent: content.trim(), noteAction: null };
  }
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

    // Extract and process any note actions
    const { cleanContent, noteAction } = extractNoteAction(textBlock.text);

    if (noteAction) {
      try {
        if (noteAction.note_action === 'save' && noteAction.key && noteAction.value) {
          await db.upsertHouseholdNote(req.householdId, noteAction.key, noteAction.value, req.user.id);
        } else if (noteAction.note_action === 'delete' && noteAction.key) {
          await db.deleteHouseholdNote(req.householdId, noteAction.key);
        }
      } catch (noteErr) {
        console.error('Note action failed (non-fatal):', noteErr.message);
      }
    }

    // Save both messages to DB
    await db.saveChatMessage(req.householdId, req.user.id, 'user', message.trim());
    await db.saveChatMessage(req.householdId, req.user.id, 'assistant', cleanContent);

    return res.json({
      message: cleanContent,
      note_action: noteAction || undefined,
    });
  } catch (err) {
    console.error('POST /api/chat error:', err);
    return res.status(500).json({ error: 'Failed to get AI response. Please try again.' });
  }
});

module.exports = router;
