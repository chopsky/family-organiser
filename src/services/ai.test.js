/**
 * Unit tests for AI classification, receipt scanning, and receipt matching.
 * The Anthropic SDK is mocked so these tests run without an API key.
 */

jest.mock('@anthropic-ai/sdk');
const Anthropic = require('@anthropic-ai/sdk');

const { classify, scanReceipt, matchReceiptToList, parseJSON } = require('./ai');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock stream that resolves to a message with a single text block. */
function mockStream(jsonPayload) {
  const finalMessage = {
    content: [{ type: 'text', text: JSON.stringify(jsonPayload) }],
  };
  return {
    finalMessage: jest.fn().mockResolvedValue(finalMessage),
  };
}

/** Build a mock stream that returns text wrapped in a markdown fence. */
function mockStreamMarkdown(jsonPayload) {
  const finalMessage = {
    content: [{ type: 'text', text: '```json\n' + JSON.stringify(jsonPayload) + '\n```' }],
  };
  return {
    finalMessage: jest.fn().mockResolvedValue(finalMessage),
  };
}

// ─── classify() ───────────────────────────────────────────────────────────────

describe('classify()', () => {
  let mockMessagesStream;

  beforeEach(() => {
    mockMessagesStream = jest.fn();
    Anthropic.mockImplementation(() => ({
      messages: { stream: mockMessagesStream },
    }));
  });

  afterEach(() => jest.clearAllMocks());

  test('parses mixed shopping and task message correctly', async () => {
    const expected = {
      intent: 'add',
      shopping_items: [
        { item: 'milk', category: 'groceries', quantity: null, action: 'add' },
        { item: 'dog food', category: 'pets', quantity: null, action: 'add' },
      ],
      tasks: [
        {
          title: 'Do homework',
          assigned_to_name: 'Jake',
          due_date: new Date().toISOString().split('T')[0],
          recurrence: 'weekly',
          priority: 'medium',
          action: 'add',
        },
      ],
      response_message: "Added milk and dog food, and set a weekly homework reminder for Jake.",
    };

    mockMessagesStream.mockReturnValue(mockStream(expected));

    const result = await classify(
      "We need milk and dog food, and remind Jake to do his homework by Friday, weekly",
      ['Sarah', 'Jake']
    );

    expect(result.intent).toBe('add');
    expect(result.shopping_items).toHaveLength(2);
    expect(result.shopping_items[0]).toMatchObject({ item: 'milk', category: 'groceries', action: 'add' });
    expect(result.shopping_items[1]).toMatchObject({ item: 'dog food', category: 'pets', action: 'add' });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      title: 'Do homework',
      assigned_to_name: 'Jake',
      recurrence: 'weekly',
      action: 'add',
    });
    expect(result.response_message).toBeTruthy();
  });

  test('handles removal intent', async () => {
    const expected = {
      intent: 'remove',
      shopping_items: [
        { item: 'milk', category: 'groceries', quantity: null, action: 'remove' },
      ],
      tasks: [],
      response_message: "Got it — I've marked milk as done.",
    };

    mockMessagesStream.mockReturnValue(mockStream(expected));

    const result = await classify("We got the milk", ['Sarah']);
    expect(result.intent).toBe('remove');
    expect(result.shopping_items[0].action).toBe('remove');
    expect(result.tasks).toHaveLength(0);
  });

  test('handles task completion', async () => {
    const expected = {
      intent: 'remove',
      shopping_items: [],
      tasks: [
        {
          title: 'Do homework',
          assigned_to_name: 'Jake',
          due_date: new Date().toISOString().split('T')[0],
          recurrence: null,
          priority: 'medium',
          action: 'complete',
        },
      ],
      response_message: "Great — marked Jake's homework as done!",
    };

    mockMessagesStream.mockReturnValue(mockStream(expected));

    const result = await classify("Jake finished his homework", ['Sarah', 'Jake']);
    expect(result.tasks[0].action).toBe('complete');
    expect(result.tasks[0].assigned_to_name).toBe('Jake');
  });

  test('passes correct date and member names to the prompt', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'add', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    await classify("test message", ['Alice', 'Bob']);

    const call = mockMessagesStream.mock.calls[0][0];
    expect(call.system).toContain('Alice, Bob');
    expect(call.system).toContain(new Date().toISOString().split('T')[0]);
  });

  test('includes the sender in the prompt so "me/I/my" can resolve', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'add', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    await classify("remind me to book car service", ['Grant', 'Lynn'], [], { sender: 'Grant' });

    const call = mockMessagesStream.mock.calls[0][0];
    // Both the "current user" line and the example inside the sender-resolution
    // block should reference the sender by name.
    expect(call.system).toContain('The current user (sender of this message) is: Grant');
    expect(call.system).toContain('assigned_to_name: "Grant"');
  });

  test('prompt requires an explicit date for calendar events (no silent "today")', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));
    await classify('add dentist', ['Grant'], [], { sender: 'Grant' });
    const sys = mockMessagesStream.mock.calls[0][0].system;
    expect(sys).toContain('DATE-REQUIRED FOR CALENDAR EVENTS');
    expect(sys).toMatch(/do not silently default to today/i);
  });

  test('prompt exposes update/delete intents and target/updates schema', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));
    await classify('hi', ['Grant'], [], { sender: 'Grant' });
    const sys = mockMessagesStream.mock.calls[0][0].system;
    // Intents are in the enum
    for (const intent of ['update_event', 'delete_event', 'update_task', 'delete_task', 'update_shopping_item', 'delete_shopping_item']) {
      expect(sys).toContain(`"${intent}"`);
    }
    // Rules block is present
    expect(sys).toContain('UPDATE & DELETE');
    // Schema carries target and updates
    expect(sys).toContain('"target"');
    expect(sys).toContain('"updates"');
  });

  test('prompt includes a strict JSON-only output enforcement block', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));
    await classify('hi', ['Grant'], [], { sender: 'Grant' });
    const sys = mockMessagesStream.mock.calls[0][0].system;
    // Defends against the failure mode where Gemini/Claude emit plain prose
    // ('My apologies…', 'I've added…') instead of JSON on meta or apologetic
    // turns, tripping parseJSON with no recoverable block.
    expect(sys).toContain('CRITICAL OUTPUT FORMAT');
    expect(sys).toContain("Your ENTIRE reply MUST be a single valid JSON");
    expect(sys).toContain("first character MUST be '{'");
  });

  test('prompt includes an accurate self-description so the bot can answer meta questions', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));
    await classify('how do you work?', ['Grant'], [], { sender: 'Grant' });
    const sys = mockMessagesStream.mock.calls[0][0].system;
    // Ensure the HOW YOU ACTUALLY WORK block is present with the key facts
    // the bot must be able to describe when asked.
    expect(sys).toContain('HOW YOU ACTUALLY WORK');
    expect(sys).toContain('Automatic broadcasts');
    expect(sys).toContain('whatsapp_linked');
    expect(sys).toContain('Never invent or speculate about notification behaviour');
  });

  test('prompt tells the model to be conservative about update_* / delete_* intents', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));
    await classify('hi', ['Grant'], [], { sender: 'Grant' });
    const sys = mockMessagesStream.mock.calls[0][0].system;
    // The "BE CONSERVATIVE" guidance and the trampoline worked example should
    // both be present — they were added to prevent the classifier from
    // hijacking new scheduling statements into updates of same-topic items.
    expect(sys).toContain('BE CONSERVATIVE');
    expect(sys).toContain('trampoline');
    expect(sys).toContain('When in doubt between update and create, prefer create');
  });

  test('prompt includes FORCE-ADD rules so "Yes" after a dupe prompt force-adds instead of looping', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    await classify('hi', ['Grant'], [], { sender: 'Grant' });

    const call = mockMessagesStream.mock.calls[0][0];
    // The AI must be told how to handle an affirmative reply to a dupe prompt.
    expect(call.system).toContain('FORCE-ADD');
    expect(call.system).toContain('force: true');
    // And the schema must expose the field so the model can actually emit it.
    expect(call.system).toContain('"force": boolean');
  });

  test('formats calendar event times in the user timezone, not the server timezone', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    // 13:00 UTC on a July date = 14:00 BST (Europe/London in summer)
    await classify('what time is my haircut?', ['Grant'], [], {
      sender: 'Grant',
      timezone: 'Europe/London',
      calendarEvents: [{
        start_time: '2026-07-17T13:00:00Z',
        title: 'Haircut',
        all_day: false,
      }],
    });

    const call = mockMessagesStream.mock.calls[0][0];
    // Must see 14:00 (local BST), never 13:00 (server UTC).
    expect(call.system).toContain('Haircut');
    expect(call.system).toContain('14:00');
    // The substring "13:00" must not appear as a time for the event — this
    // was the exact bug where the AI told users their 2PM event was at 1PM.
    expect(call.system).not.toContain(' 13:00:');
  });

  test('prompt includes OPEN TASKS section with formatted task list', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    // Defends against the "Elementor paid" bug: the classifier needs to see
    // open tasks in context to recognise a completion signal for an existing
    // task instead of creating a brand-new one.
    await classify('hi', ['Grant'], [], {
      sender: 'Grant',
      timezone: 'Europe/London',
      tasks: [
        { title: 'Pay Elementor', due_date: '2026-04-20', priority: 'medium', assigned_to_name: 'Grant' },
        { title: 'Book car service', due_date: '2026-04-25', priority: 'high', assigned_to_name: 'Lynn' },
      ],
    });

    const sys = mockMessagesStream.mock.calls[0][0].system;
    expect(sys).toContain('OPEN TASKS');
    expect(sys).toContain('Pay Elementor');
    expect(sys).toContain('Book car service');
    // Priority label only appears for non-medium priorities.
    expect(sys).toContain('[high]');
    // Assignee should be shown in parens.
    expect(sys).toContain('(Grant)');
    expect(sys).toContain('(Lynn)');
  });

  test('prompt shows "(no open tasks)" placeholder when task list is empty', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    await classify('hi', ['Grant'], [], { sender: 'Grant' });

    const sys = mockMessagesStream.mock.calls[0][0].system;
    expect(sys).toContain('OPEN TASKS');
    expect(sys).toContain('(no open tasks)');
  });

  test('prompt includes TASK COMPLETION SIGNALS rules with the Elementor example', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    await classify('hi', ['Grant'], [], { sender: 'Grant' });

    const sys = mockMessagesStream.mock.calls[0][0].system;
    // The rules block teaches the model to recognise past-tense / completion
    // phrasing ("Elementor paid") and match it against an existing open task
    // rather than creating a new task.
    expect(sys).toContain('TASK COMPLETION SIGNALS');
    expect(sys).toContain('BEFORE adding a new task, check the OPEN TASKS list');
    expect(sys).toContain('Elementor paid');
    expect(sys).toContain('Pay Elementor');
    // And guards against over-matching future-intent phrasing.
    expect(sys).toMatch(/Do NOT over-match/i);
  });

  test('prompt includes COMPLETION + SCHEDULING rules so "booked car service for Wednesday" creates an event too', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    await classify('hi', ['Grant'], [], { sender: 'Grant' });

    const sys = mockMessagesStream.mock.calls[0][0].system;
    // Regression anchor for the reported bug where "Booked my car in for a
    // service on Wednesday morning" completed the task but didn't create a
    // calendar event. The prompt must teach the model to emit BOTH in a
    // single turn when a completion message carries scheduling context.
    expect(sys).toContain('COMPLETION + SCHEDULING');
    expect(sys).toContain('populate BOTH');
    // The car-service walked example — both the original failing phrasing
    // and the hint to derive the event title from the task title.
    expect(sys).toContain('Booked my car in for a service on Wednesday morning');
    expect(sys).toContain('Book car service');
    expect(sys).toContain('Car service');
    // Vague-time resolution rules ("morning" → 09:00).
    expect(sys).toMatch(/morning.*09:00/);
    // Guard: no calendar_event when no date/time is mentioned (so plain
    // "Elementor paid" still behaves as a pure completion).
    expect(sys).toMatch(/no.*calendar_event.*doesn't mention a date/i);
  });

  test('caps open tasks at 50 and notes the overflow count', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'chat', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    const manyTasks = Array.from({ length: 63 }, (_, i) => ({
      title: `Task ${i + 1}`,
      due_date: '2026-04-20',
      priority: 'medium',
      assigned_to_name: null,
    }));

    await classify('hi', ['Grant'], [], { sender: 'Grant', tasks: manyTasks });

    const sys = mockMessagesStream.mock.calls[0][0].system;
    // First 50 should be rendered, 51+ should be truncated with a count.
    expect(sys).toContain('Task 1');
    expect(sys).toContain('Task 50');
    expect(sys).not.toContain('"Task 51"');
    expect(sys).toContain('... and 13 more tasks');
  });

  test('falls back to "Unknown" when no sender is provided', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      intent: 'add', shopping_items: [], tasks: [], response_message: 'ok',
    }));

    await classify("test", ['Alice']);

    const call = mockMessagesStream.mock.calls[0][0];
    expect(call.system).toContain('The current user (sender of this message) is: Unknown');
  });

  test('strips markdown fences from response', async () => {
    const payload = { intent: 'add', shopping_items: [], tasks: [], response_message: 'ok' };
    mockMessagesStream.mockReturnValue(mockStreamMarkdown(payload));

    const result = await classify("hello", []);
    expect(result.intent).toBe('add');
  });

  test('throws on malformed JSON response', async () => {
    // Override the mock for this test only
    Anthropic.mockImplementation(() => ({
      messages: {
        stream: jest.fn().mockReturnValue({
          finalMessage: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'not json at all' }],
          }),
        }),
      },
    }));

    await expect(classify("test", [])).rejects.toThrow('Failed to parse classification JSON');
  });
});

// ─── scanReceipt() ─────────────────────────────────────────────────────────────

describe('scanReceipt()', () => {
  let mockMessagesStream;

  beforeEach(() => {
    mockMessagesStream = jest.fn();
    Anthropic.mockImplementation(() => ({
      messages: { stream: mockMessagesStream },
    }));
  });

  afterEach(() => jest.clearAllMocks());

  test('extracts and normalises receipt items', async () => {
    const expected = {
      store_name: "Sainsbury's",
      date: '2026-03-12',
      total: '£45.23',
      items: [
        { normalised_name: 'butter', original_text: 'LURPAK SLTD 250G', price: '£2.50' },
        { normalised_name: 'white bread', original_text: 'HOVIS WHTMED 800G', price: '£1.20' },
        { normalised_name: 'milk', original_text: '2PT SEMI SKIMMED', price: '£1.10' },
      ],
    };

    mockMessagesStream.mockReturnValue(mockStream(expected));

    const fakeImageBuffer = Buffer.from('fake-image-data');
    const result = await scanReceipt(fakeImageBuffer);

    expect(result.store_name).toBe("Sainsbury's");
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ normalised_name: 'butter', original_text: 'LURPAK SLTD 250G' });
  });

  test('sends image as base64 in the message', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      store_name: null, date: null, total: null, items: [],
    }));

    const imageBuffer = Buffer.from('test-image');
    await scanReceipt(imageBuffer, 'image/png');

    const call = mockMessagesStream.mock.calls[0][0];
    const imageBlock = call.messages[0].content.find((b) => b.type === 'image');
    expect(imageBlock.source.type).toBe('base64');
    expect(imageBlock.source.media_type).toBe('image/png');
    expect(imageBlock.source.data).toBe(imageBuffer.toString('base64'));
  });

  test('accepts base64 string directly', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      store_name: null, date: null, total: null, items: [],
    }));

    const b64 = 'aGVsbG8='; // "hello" in base64
    await scanReceipt(b64);

    const call = mockMessagesStream.mock.calls[0][0];
    const imageBlock = call.messages[0].content.find((b) => b.type === 'image');
    expect(imageBlock.source.data).toBe(b64);
  });
});

// ─── matchReceiptToList() ──────────────────────────────────────────────────────

describe('matchReceiptToList()', () => {
  let mockMessagesStream;

  beforeEach(() => {
    mockMessagesStream = jest.fn();
    Anthropic.mockImplementation(() => ({
      messages: { stream: mockMessagesStream },
    }));
  });

  afterEach(() => jest.clearAllMocks());

  test('matches receipt items to shopping list with confidence scores', async () => {
    const expected = {
      matches: [
        { receipt_item: 'butter', list_item_id: 'uuid-1', list_item_name: 'butter', confidence: 0.98 },
        { receipt_item: 'milk', list_item_id: 'uuid-2', list_item_name: 'milk (2 pints)', confidence: 0.95 },
      ],
      unmatched_receipt_items: ['kitchen roll'],
      summary: 'Matched 2 of 3 items. Could not match: kitchen roll.',
    };

    mockMessagesStream.mockReturnValue(mockStream(expected));

    const receiptItems = [
      { normalised_name: 'butter', original_text: 'LURPAK 250G' },
      { normalised_name: 'milk', original_text: '2PT SEMI' },
      { normalised_name: 'kitchen roll', original_text: 'KTCHN ROLL 3PK' },
    ];
    const shoppingList = [
      { id: 'uuid-1', item: 'butter' },
      { id: 'uuid-2', item: 'milk (2 pints)' },
      { id: 'uuid-3', item: 'eggs' },
    ];

    const result = await matchReceiptToList(receiptItems, shoppingList);

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({ receipt_item: 'butter', list_item_id: 'uuid-1', confidence: 0.98 });
    expect(result.unmatched_receipt_items).toContain('kitchen roll');
    expect(result.summary).toContain('kitchen roll');
  });

  test('returns empty result without calling API when inputs are empty', async () => {
    const result = await matchReceiptToList([], []);

    expect(mockMessagesStream).not.toHaveBeenCalled();
    expect(result.matches).toHaveLength(0);
  });

  test('returns all unmatched when shopping list is empty', async () => {
    const receiptItems = [
      { normalised_name: 'butter', original_text: 'LURPAK' },
    ];

    const result = await matchReceiptToList(receiptItems, []);

    expect(mockMessagesStream).not.toHaveBeenCalled();
    expect(result.unmatched_receipt_items).toContain('butter');
  });

  test('includes item IDs and names in the prompt', async () => {
    mockMessagesStream.mockReturnValue(mockStream({
      matches: [], unmatched_receipt_items: [], summary: 'No matches.',
    }));

    const receiptItems = [{ normalised_name: 'milk', original_text: 'MILK 2PT' }];
    const shoppingList = [{ id: 'abc-123', item: 'semi-skimmed milk' }];

    await matchReceiptToList(receiptItems, shoppingList);

    const call = mockMessagesStream.mock.calls[0][0];
    const userMsg = call.messages[0].content;
    expect(userMsg).toContain('abc-123');
    expect(userMsg).toContain('semi-skimmed milk');
    expect(userMsg).toContain('milk');
  });
});

// ─── parseJSON() — AI output parsing robustness ─────────────────────────────

describe('parseJSON()', () => {
  const originalError = console.error;
  beforeAll(() => { console.error = jest.fn(); });
  afterAll(() => { console.error = originalError; });

  test('parses plain JSON', () => {
    expect(parseJSON('{"a":1}', 'test')).toEqual({ a: 1 });
  });

  test('parses JSON array', () => {
    expect(parseJSON('[1,2,3]', 'test')).toEqual([1, 2, 3]);
  });

  test('strips markdown fences (```json)', () => {
    const text = '```json\n{"title":"Book car service"}\n```';
    expect(parseJSON(text, 'test')).toEqual({ title: 'Book car service' });
  });

  test('strips markdown fences (``` no language)', () => {
    const text = '```\n{"ok":true}\n```';
    expect(parseJSON(text, 'test')).toEqual({ ok: true });
  });

  test('extracts JSON wrapped in prose (before and after)', () => {
    const text = "Sure! Here's the classification:\n{\"title\":\"Book car service & MOT\"}\nHope that helps!";
    expect(parseJSON(text, 'test')).toEqual({ title: 'Book car service & MOT' });
  });

  test('extracts JSON wrapped only with trailing prose', () => {
    const text = '{"intent":"task_add"}\n\nLet me know if you want to change anything!';
    expect(parseJSON(text, 'test')).toEqual({ intent: 'task_add' });
  });

  test('respects braces inside string values', () => {
    const text = 'Preamble.\n{"note":"use {curly} braces"}\nPostamble.';
    expect(parseJSON(text, 'test')).toEqual({ note: 'use {curly} braces' });
  });

  test('respects escaped quotes inside strings', () => {
    const text = 'Here: {"quote":"she said \\"hi\\""}';
    expect(parseJSON(text, 'test')).toEqual({ quote: 'she said "hi"' });
  });

  test('repairs trailing comma before closing brace', () => {
    const text = '{"a":1,"b":2,}';
    expect(parseJSON(text, 'test')).toEqual({ a: 1, b: 2 });
  });

  test('repairs trailing comma before closing bracket', () => {
    const text = '{"arr":[1,2,3,]}';
    expect(parseJSON(text, 'test')).toEqual({ arr: [1, 2, 3] });
  });

  test('handles the ampersand regression case', () => {
    // Gemini-style response wrapping JSON in prose when user text contains '&'
    const text = 'I\'ll add that task for you.\n\n{"intent":"task_add","tasks":[{"action":"add","title":"Book car service & MOT"}],"response_message":"Got it!"}';
    const parsed = parseJSON(text, 'test');
    expect(parsed.intent).toBe('task_add');
    expect(parsed.tasks[0].title).toBe('Book car service & MOT');
  });

  test('throws with informative message on total garbage', () => {
    expect(() => parseJSON('this is not json at all', 'test'))
      .toThrow(/Failed to parse test JSON/);
  });

  test('throws when no balanced block exists', () => {
    expect(() => parseJSON('{"unclosed":"value', 'test'))
      .toThrow(/Failed to parse test JSON/);
  });
});

