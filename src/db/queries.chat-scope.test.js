/**
 * Regression test for the chat-history IDOR fix: getChatHistory /
 * clearChatHistory must filter chat_messages by household_id so a guessed
 * conversation id can't read or wipe another household's chat.
 *
 * queries.js only imports ./client + crypto at load, so we stub the client to
 * import it, then pass a chainable fake `db` (the functions accept one) and
 * assert which .eq() filters get applied.
 */
jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {} }));

const queries = require('./queries');

function makeDb(result = { data: [], error: null }) {
  const eqCalls = [];
  const chain = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    delete: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    eq: jest.fn((col, val) => { eqCalls.push([col, val]); return chain; }),
    // Thenable so `await query` resolves to the supabase-style result.
    then: (resolve) => resolve(result),
  };
  return { chain, eqCalls };
}

describe('chat history is household-scoped (IDOR fix)', () => {
  test('getChatHistory filters by household_id when provided', async () => {
    const { chain, eqCalls } = makeDb({ data: [], error: null });
    await queries.getChatHistory('conv-1', 50, 'hh-1', chain);
    expect(eqCalls).toContainEqual(['conversation_id', 'conv-1']);
    expect(eqCalls).toContainEqual(['household_id', 'hh-1']);
  });

  test('clearChatHistory filters by household_id when provided', async () => {
    const { chain, eqCalls } = makeDb({ error: null });
    await queries.clearChatHistory('conv-1', 'hh-1', chain);
    expect(eqCalls).toContainEqual(['conversation_id', 'conv-1']);
    expect(eqCalls).toContainEqual(['household_id', 'hh-1']);
  });

  test('omits the household filter when not supplied (back-compat callers)', async () => {
    const { chain, eqCalls } = makeDb({ data: [], error: null });
    await queries.getChatHistory('conv-1', 50, null, chain);
    expect(eqCalls).toContainEqual(['conversation_id', 'conv-1']);
    expect(eqCalls.find((c) => c[0] === 'household_id')).toBeUndefined();
  });
});
