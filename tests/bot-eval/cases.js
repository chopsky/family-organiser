/**
 * Golden-set eval cases for the WhatsApp classifier.
 *
 * Each case feeds a real message + context through classify() (a real LLM
 * call) and asserts STRUCTURAL properties of the result (intent, which
 * actions, all_day, etc.) - never exact wording, so it's stable across runs
 * and models. A `check` returns null on pass, or a short failure string.
 *
 * Seeded with the bugs we've actually hit. Add a case every time the bot
 * does something silly - that's how this stops being whack-a-mole.
 *
 * NOTE: deterministic logic bugs (e.g. completeTasksByName over-matching)
 * live in jest unit tests, not here - this file is for behaviours that
 * depend on the model + prompt.
 */

const completions = (r) => (r.tasks || []).filter((t) => t.action === 'complete');
const adds = (r) => (r.tasks || []).filter((t) => t.action === 'add');
const shoppingAdds = (r) => (r.shopping_items || []).filter((s) => (s.action || 'add') === 'add');

module.exports = [
  {
    name: 'completion: "I called EUSS" completes exactly one task',
    message: 'I called EUSS',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn'],
      tasks: [
        { id: 't1', title: 'Call EUSS' },
        { id: 't2', title: 'Call eye doctor and make new app' },
        { id: 't3', title: 'Call vet to discuss Odie neutering and insurance coverage' },
      ],
    },
    check: (r) => {
      const c = completions(r);
      if (c.length !== 1) return `expected 1 completion, got ${c.length} (${c.map((x) => x.title).join(' | ')})`;
      if (!/euss/i.test(c[0].title || '')) return `expected EUSS, got "${c[0].title}"`;
      // Phase 2: the model must ground on the [1] reference number for EUSS.
      if (Number(c[0].task_id) !== 1) return `expected task_id 1 (EUSS), got ${c[0].task_id}`;
      return null;
    },
  },
  {
    name: 'completion: "Mallorca dinner booked" ticks the matching task',
    message: 'Mallorca dinner booked',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn'],
      tasks: [
        { id: 't1', title: 'Book dinner for Saturday night in Mallorca' },
        { id: 't2', title: 'Pack suitcases' },
      ],
    },
    check: (r) => {
      const c = completions(r);
      if (c.length !== 1) return `expected 1 completion, got ${c.length}`;
      if (!/mallorca|dinner/i.test(c[0].title || '')) return `wrong task: "${c[0].title}"`;
      if (Number(c[0].task_id) !== 1) return `expected task_id 1, got ${c[0].task_id}`;
      return null;
    },
  },
  {
    name: 'short verb does not over-match: "Paid Elementor" != electricity',
    message: 'Paid Elementor',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant'],
      tasks: [
        { id: 't1', title: 'Pay Elementor' },
        { id: 't2', title: 'Pay the electricity bill' },
      ],
    },
    check: (r) => {
      const c = completions(r);
      if (c.length !== 1) return `expected 1 completion, got ${c.length}`;
      if (!/elementor/i.test(c[0].title || '')) return `wrong task: "${c[0].title}"`;
      return null;
    },
  },
  {
    name: 'trivial chat: "Testing" creates no tasks/events/shopping',
    message: 'Testing',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn'],
      tasks: [{ id: 't1', title: 'Buy milk' }],
    },
    check: (r) => {
      if (completions(r).length || adds(r).length) return `invented task actions: ${JSON.stringify(r.tasks)}`;
      if (r.calendar_event) return 'invented a calendar event';
      if ((r.shopping_items || []).length) return 'invented shopping items';
      return null;
    },
  },
  {
    name: 'no invented time: "Sports day on Friday" is all-day',
    message: 'Add sports day on Friday',
    ctx: { sender: 'Grant', memberNames: ['Grant'], tasks: [] },
    check: (r) => {
      const ev = r.calendar_event;
      if (!ev) return 'no calendar_event emitted';
      if (ev.all_day !== true) return `expected all_day:true, got ${ev.all_day}`;
      if (ev.start_time) return `invented a time: ${ev.start_time}`;
      return null;
    },
  },
  {
    name: 'no event without a date: "Elementor paid" is completion-only',
    message: 'Elementor paid',
    ctx: { sender: 'Grant', memberNames: ['Grant'], tasks: [{ id: 't1', title: 'Pay Elementor' }] },
    check: (r) => {
      if (r.calendar_event) return `emitted a spurious calendar_event: ${JSON.stringify(r.calendar_event)}`;
      if (completions(r).length !== 1) return `expected 1 completion, got ${completions(r).length}`;
      return null;
    },
  },
  {
    name: 'shopping: "we need milk and eggs" adds two items',
    message: 'we need milk and eggs',
    ctx: { sender: 'Grant', memberNames: ['Grant'], tasks: [] },
    check: (r) => {
      const items = shoppingAdds(r).map((s) => (s.item || '').toLowerCase());
      if (!items.some((i) => i.includes('milk'))) return `missing milk (got ${items.join(', ')})`;
      if (!items.some((i) => i.includes('egg'))) return `missing eggs (got ${items.join(', ')})`;
      return null;
    },
  },
  {
    name: 'relay: "tell Lynn to take the bins out" → task for Lynn',
    message: 'tell Lynn to take the bins out',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      const a = adds(r);
      if (a.length < 1) return 'no task added';
      const forLynn = a.some((t) => (t.assigned_to_names || []).some((n) => /lynn/i.test(n)));
      if (!forLynn) return `task not assigned to Lynn: ${JSON.stringify(a.map((t) => t.assigned_to_names))}`;
      return null;
    },
  },
];
