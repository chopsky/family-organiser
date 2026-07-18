/**
 * Agent-loop tests. The Anthropic client and the calendar fetcher are
 * injected (deps seam), so these run offline and deterministic:
 *
 *   1. The Nici Bournemouth shape: a narrow search misses, the model widens,
 *      finds the event, answers - and the loop reports the referent.
 *   2. Turn cap exhaustion → null (caller falls back).
 *   3. Provider error → null.
 *   4. Invalid tool input → error payload returned to the model, loop continues.
 *   5. BOT_AGENT flag gate.
 */

jest.mock('../db/queries', () => ({}));
jest.mock('../db/client', () => ({ supabaseAdmin: { from: () => ({ insert: () => ({ then: () => ({ catch: () => {} }) }) }) } }));

const { agentCalendarAnswer, agentEnabled, MAX_TURNS } = require('./agent-loop');

const user = { id: 'u1', name: 'Grant' };
const household = { id: 'h1', members: [{ name: 'Grant' }, { name: 'Lynn' }] };
const TZ = 'Europe/London';

const NICI = {
  id: 'ev-nici',
  title: 'Staying at Nici Bournemouth',
  start_time: '2026-08-23T00:00:00Z',
  end_time: '2026-08-26T23:59:59Z',
  all_day: true,
  assigned_to_names: [],
};

/** Scripted client: returns queued responses in order; records requests. */
function scriptedClient(script) {
  const calls = [];
  return {
    calls,
    messages: {
      create: jest.fn(async (req) => {
        calls.push(req);
        const next = script.shift();
        if (!next) throw new Error('script exhausted');
        if (next instanceof Error) throw next;
        return next;
      }),
    },
  };
}

const toolUse = (id, input) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'search_calendar', input }],
  usage: { input_tokens: 100, output_tokens: 20 },
});
const finalText = (text) => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text }],
  usage: { input_tokens: 100, output_tokens: 30 },
});

describe('agentCalendarAnswer', () => {
  test('Nici shape: narrow miss → widen → answer, with referents', async () => {
    const client = scriptedClient([
      toolUse('t1', { start_date: '2026-07-21', end_date: '2026-08-04', topic: 'nici' }),
      toolUse('t2', { start_date: '2026-07-21', end_date: '2027-07-21', topic: 'nici' }),
      finalText("You're at Nici Bournemouth Sun 23 - Wed 26 Aug."),
    ]);
    const fetchCalendar = jest.fn(async ({ startDate, endDate }) =>
      (endDate >= '2026-08-23' ? [NICI] : []));

    const res = await agentCalendarAnswer(
      { text: 'What dates are we at nici bournemouth?', user, household, userTz: TZ },
      { client, fetchCalendar },
    );

    expect(res.response).toMatch(/23.*26 Aug/);
    expect(res.referents).toEqual([{ kind: 'event', id: 'ev-nici', label: NICI.title }]);
    expect(fetchCalendar).toHaveBeenCalledTimes(2);
    // The second tool_result carried the found event back to the model.
    const secondToolResult = client.calls[2].messages.at(-1).content[0];
    expect(secondToolResult.type).toBe('tool_result');
    expect(secondToolResult.content).toContain('Nici Bournemouth');
    // Static system block is cache-marked; dynamic values live in the user turn.
    expect(client.calls[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(client.calls[0].system[0].text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(client.calls[0].messages[0].content).toMatch(/Today is \d{4}-\d{2}-\d{2}/);
  });

  test('turn cap exhausted → null (caller falls back)', async () => {
    const endless = Array.from({ length: MAX_TURNS + 2 }, (_, i) =>
      toolUse(`t${i}`, { start_date: '2026-01-01', end_date: '2026-01-02' }));
    const client = scriptedClient(endless);
    const res = await agentCalendarAnswer(
      { text: 'when is x?', user, household, userTz: TZ },
      { client, fetchCalendar: jest.fn(async () => []) },
    );
    expect(res).toBeNull();
    // never more than MAX_TURNS tool executions + the capped call
    expect(client.messages.create.mock.calls.length).toBeLessThanOrEqual(MAX_TURNS + 1);
  });

  test('provider error → null, never throws', async () => {
    const client = scriptedClient([new Error('529 overloaded')]);
    const res = await agentCalendarAnswer(
      { text: 'when is x?', user, household, userTz: TZ },
      { client, fetchCalendar: jest.fn() },
    );
    expect(res).toBeNull();
  });

  test('invalid tool dates → error payload to the model, loop continues to an answer', async () => {
    const client = scriptedClient([
      toolUse('t1', { start_date: 'next week', end_date: 'later' }),
      finalText('Nothing on the calendar for that.'),
    ]);
    const fetchCalendar = jest.fn();
    const res = await agentCalendarAnswer(
      { text: 'when is x?', user, household, userTz: TZ },
      { client, fetchCalendar },
    );
    expect(res.response).toMatch(/Nothing on the calendar/);
    expect(fetchCalendar).not.toHaveBeenCalled();
    const errResult = client.calls[1].messages.at(-1).content[0];
    expect(errResult.content).toContain('YYYY-MM-DD');
  });

  test('empty final answer → null', async () => {
    const client = scriptedClient([finalText('')]);
    const res = await agentCalendarAnswer(
      { text: 'when is x?', user, household, userTz: TZ },
      { client, fetchCalendar: jest.fn() },
    );
    expect(res).toBeNull();
  });
});

describe('agentEnabled', () => {
  const OLD = process.env.BOT_AGENT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.BOT_AGENT;
    else process.env.BOT_AGENT = OLD;
  });
  test('off unless BOT_AGENT=1', () => {
    delete process.env.BOT_AGENT;
    expect(agentEnabled()).toBe(false);
    process.env.BOT_AGENT = '1';
    expect(agentEnabled()).toBe(true);
  });
});
