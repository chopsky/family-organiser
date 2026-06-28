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
const futureISO = (days) => new Date(Date.now() + days * 86400000).toISOString();

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
  {
    name: 'delete_task: "cancel the dentist task" grounds on the right task_id',
    message: 'cancel the dentist task',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant'],
      tasks: [
        { id: 't1', title: 'Call EUSS' },
        { id: 't2', title: 'Book dentist appointment' },
      ],
    },
    check: (r) => {
      if (r.intent !== 'delete_task') return `expected delete_task, got ${r.intent}`;
      if (Number(r.target?.target_id) !== 2) return `expected target.target_id 2 (dentist), got ${r.target?.target_id}`;
      return null;
    },
  },
  {
    name: 'delete_event: "cancel my haircut" grounds on the right event id',
    message: 'cancel my haircut',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant'],
      tasks: [],
      calendarEvents: [
        { id: 'e1', title: 'Dentist', start_time: futureISO(2), all_day: false },
        { id: 'e2', title: 'Haircut', start_time: futureISO(3), all_day: false },
      ],
    },
    check: (r) => {
      if (r.intent !== 'delete_event') return `expected delete_event, got ${r.intent}`;
      if (Number(r.target?.target_id) !== 2) return `expected target.target_id 2 (haircut), got ${r.target?.target_id}`;
      return null;
    },
  },
  {
    name: 'redirect-to-app: "import school calendars" points to the app, not a dead-end',
    message: 'I need to add the school calendars for my three children. Can you import them from a website?',
    ctx: {
      sender: 'Jade',
      memberNames: ['Jade', 'Angus', 'Elowen', 'Isla'],
      tasks: [],
    },
    check: (r) => {
      if (r.intent !== 'chat') return `expected chat, got ${r.intent}`;
      const msg = (r.response_message || '').toLowerCase();
      // Must NOT dead-end ("add each one manually"); must name a real in-app
      // place to import them.
      const pointsToApp = /family setup|term dates|connect calendars|in the app/.test(msg);
      if (!pointsToApp) return `reply doesn't point to the app: "${r.response_message}"`;
      return null;
    },
  },

  // ── Route-by-time: action-to-do vs timed calendar event ──
  {
    name: 'routing: "take the car in for a service" is a to-do, not a calendar event',
    message: 'I need to take the car in for a service',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent === 'create_event' || r.calendar_event) return `routed to calendar, expected a to-do (${JSON.stringify(r.calendar_event)})`;
      const a = adds(r);
      if (a.length < 1) return `expected a to-do add, got intent ${r.intent} / ${a.length} adds`;
      if (!/car|service/i.test(a[0].title || '')) return `wrong to-do title: "${a[0].title}"`;
      return null;
    },
  },
  {
    name: 'routing: "Dentist appointment Tuesday at 3pm" is a timed calendar event',
    message: 'Dentist appointment Tuesday at 3pm',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent !== 'create_event' || !r.calendar_event) return `expected create_event, got ${r.intent}`;
      if (!/dentist/i.test(r.calendar_event.title || '')) return `wrong title: "${r.calendar_event.title}"`;
      if (r.calendar_event.start_time !== '15:00') return `expected start_time 15:00, got ${r.calendar_event.start_time}`;
      if (r.calendar_event.all_day === true) return `should not be all_day`;
      if (adds(r).length) return `should not also add a to-do: ${JSON.stringify(r.tasks)}`;
      return null;
    },
  },
  {
    name: 'routing: "Remind Lynn to call the plumber" is a to-do assigned to Lynn',
    message: 'Remind Lynn to call the plumber',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.calendar_event) return `routed to calendar, expected a to-do`;
      const a = adds(r);
      if (a.length < 1) return `expected a to-do, got intent ${r.intent}`;
      if (!/plumber|call/i.test(a[0].title || '')) return `wrong title: "${a[0].title}"`;
      if (!(a[0].assigned_to_names || []).some((n) => /lynn/i.test(n))) return `not assigned to Lynn: ${JSON.stringify(a[0].assigned_to_names)}`;
      return null;
    },
  },
  {
    name: 'routing: "book a dentist appointment" (no time) is a to-do',
    message: 'I need to book a dentist appointment',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent === 'create_event' || r.calendar_event) return `routed to calendar, expected a to-do`;
      const a = adds(r);
      if (a.length !== 1) return `expected exactly 1 to-do, got ${a.length}`;
      if (!/dentist/i.test(a[0].title || '')) return `wrong title: "${a[0].title}"`;
      return null;
    },
  },
  {
    name: 'graduation: "my dentist appointment is Tuesday at 3" → event, handler (not model) ticks the to-do',
    message: 'My dentist appointment is on Tuesday at 3',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [{ id: 't1', title: 'Book dentist appointment' }] },
    check: (r) => {
      if (r.intent !== 'create_event' || !r.calendar_event) return `expected create_event, got ${r.intent}`;
      if (!/dentist/i.test(r.calendar_event.title || '')) return `wrong title: "${r.calendar_event.title}"`;
      if (r.calendar_event.start_time !== '15:00') return `expected start_time 15:00, got ${r.calendar_event.start_time}`;
      // The handler graduates the "Book..." to-do deterministically; the model
      // must NOT emit a completion for it.
      if (completions(r).length) return `model emitted a completion; handler should graduate instead: ${JSON.stringify(completions(r))}`;
      return null;
    },
  },
  {
    name: 'no false completion: "Need to book a doctor appointment" (future intent) is NOT done',
    message: 'Need to book a doctor appointment',
    ctx: { sender: 'Sarah', memberNames: ['Sarah', 'James'], tasks: [{ id: 't1', title: 'Book doctor appointment' }] },
    check: (r) => {
      // "Need to" is future intent - it must NEVER complete the matching open task.
      if (completions(r).length) return `wrongly completed the existing task: ${JSON.stringify(completions(r))}`;
      // It should route as an add (the handler then asks about the duplicate).
      if (r.intent !== 'add' && adds(r).length === 0) return `expected an add (future intent), got intent ${r.intent}`;
      return null;
    },
  },
];
