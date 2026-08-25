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
  // ── Weak-target matches (real failure 2026-07-01: a voice note asking for
  // a reminder to "cancel Logan's swimming" instead moved the unrelated task
  // "Do Logan's citizenship" to today, because both mentioned Logan) ──
  {
    name: 'weak target: "remind me to cancel Logan\'s swimming" must NOT touch the citizenship task',
    message: 'Please set a reminder for Grant to cancel Logan\'s swimming lessons next week. Set the reminder for today.',
    ctx: {
      sender: 'Lynn',
      memberNames: ['Grant', 'Lynn', 'Logan'],
      tasks: [
        { id: 't1', title: 'Do Logan\'s citizenship', due_date: futureISO(14) },
        { id: 't2', title: 'Renew car insurance' },
      ],
    },
    check: (r) => {
      // Must NOT update or delete the citizenship task.
      if (r.intent === 'update_task' || r.intent === 'delete_task') {
        return `targeted an existing task (${r.intent}, target_id ${r.target?.target_id}) instead of adding the errand`;
      }
      const updates = (r.tasks || []).filter((t) => t.action === 'update' || t.action === 'delete');
      if (updates.length) return `emitted task updates/deletes: ${JSON.stringify(updates)}`;
      if (completions(r).length) return `wrongly completed a task: ${JSON.stringify(completions(r))}`;
      // Must ADD a to-do about cancelling swimming, assigned to Grant.
      const a = adds(r);
      if (a.length < 1) return `expected a new to-do, got intent ${r.intent}`;
      if (!/swim|cancel/i.test(a[0].title || '')) return `wrong to-do title: "${a[0].title}"`;
      if (!(a[0].assigned_to_names || []).some((n) => /grant/i.test(n))) return `not assigned to Grant: ${JSON.stringify(a[0].assigned_to_names)}`;
      return null;
    },
  },
  {
    name: 'weak target: "cancel Ella\'s dentist" with no matching item creates an errand, not a delete',
    message: 'Cancel Ella\'s dentist',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Ella'],
      tasks: [{ id: 't1', title: 'Order Ella\'s school shoes' }],
      calendarEvents: [{ id: 'e1', title: 'Ella swimming gala', start_time: futureISO(4), all_day: false }],
    },
    check: (r) => {
      if (r.intent === 'delete_task' || r.intent === 'delete_event') {
        return `deleted an unrelated item (${r.intent}, target_id ${r.target?.target_id}) — "cancel X" with no matching item should become a to-do`;
      }
      if (completions(r).length) return `wrongly completed: ${JSON.stringify(completions(r))}`;
      const a = adds(r);
      if (a.length < 1) return `expected an errand to-do, got intent ${r.intent}`;
      if (!/dentist|cancel/i.test(a[0].title || '')) return `wrong title: "${a[0].title}"`;
      return null;
    },
  },
  {
    name: 'shared name only: "Logan finished his homework" does not complete "Do Logan\'s citizenship"',
    message: 'Logan finished his homework',
    ctx: {
      sender: 'Lynn',
      memberNames: ['Grant', 'Lynn', 'Logan'],
      tasks: [
        { id: 't1', title: 'Do Logan\'s citizenship' },
        { id: 't2', title: 'Logan homework: maths worksheet' },
      ],
    },
    check: (r) => {
      const c = completions(r);
      // Completing the homework task (t2) is right; completing citizenship (t1) is the bug.
      const badTarget = c.some((t) => Number(t.task_id) === 1 || /citizenship/i.test(t.title || ''));
      if (badTarget) return `completed the unrelated citizenship task: ${JSON.stringify(c)}`;
      return null;
    },
  },
  {
    name: 'voice-note phrasing: "can you move the citizenship thing to Friday" targets by topic, not by person',
    message: 'Can you move the citizenship thing to Friday',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Logan'],
      tasks: [
        { id: 't1', title: 'Do Logan\'s citizenship', due_date: futureISO(14) },
        { id: 't2', title: 'Book Logan swimming lessons' },
      ],
    },
    check: (r) => {
      // This one SHOULD be an update - action+object match ("citizenship").
      const isUpdate = r.intent === 'update_task'
        || (r.tasks || []).some((t) => t.action === 'update');
      if (!isUpdate) return `expected update_task, got intent ${r.intent}`;
      const targetId = Number(r.target?.target_id ?? (r.tasks || []).find((t) => t.action === 'update')?.task_id);
      if (targetId !== 1) return `expected target 1 (citizenship), got ${targetId}`;
      return null;
    },
  },
  {
    name: 'meta question: "Which Claude model?" stays in the JSON envelope as chat (real prose failure 2026-07-02)',
    message: 'Which Claude model?',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn'],
      tasks: [{ id: 't1', title: 'Buy milk' }],
      history: [
        { role: 'user', content: 'What AI model are you using?' },
        { role: 'assistant', content: "I'm the Housemait assistant, built on Claude (Anthropic's AI model). I use that to help manage your family's shopping lists, to-dos, calendar, and household notes right here on WhatsApp!" },
      ],
    },
    check: (r) => {
      // classify() must not throw (the prose salvage counts as a pass) and
      // the user must get a real answer, with no invented actions.
      if (r.intent !== 'chat') return `expected chat, got ${r.intent}`;
      if (!(r.response_message || '').trim()) return 'empty response_message';
      if (adds(r).length || completions(r).length) return `invented task actions: ${JSON.stringify(r.tasks)}`;
      if (!/claude|anthropic/i.test(r.response_message)) return `answer doesn't mention Claude/Anthropic: "${r.response_message.slice(0, 100)}"`;
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
  {
    name: 'activity skip: "remove wraparound care for today only" is a SKIP, not a remove (real failure 2026-07-06)',
    message: 'Remove Logan wraparound care from calendar for today only',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn', 'Logan'] },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action !== 'skip') return `expected action "skip", got "${sa.action}" (a "today only" removal must never delete the series)`;
      const today = new Date().toISOString().split('T')[0];
      if (sa.skip_date !== today) return `expected skip_date ${today}, got ${sa.skip_date}`;
      if (!/wraparound/i.test(sa.activity || '')) return `wrong activity: "${sa.activity}"`;
      if ((sa.child_name || '').toLowerCase() !== 'logan') return `wrong child: "${sa.child_name}"`;
      return null;
    },
  },
  {
    name: 'activity change: "piano is at 4pm today" is a one-date CHANGE, not a series update or skip',
    message: "Mason's piano is at 4pm today",
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason'],
      // The household really has piano - without this the new activities
      // context reads "(none)" and "change" looks impossible to the model.
      schoolActivities: 'Mason: piano (Thursdays 15:30, this term)',
    },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action !== 'change') return `expected action "change", got "${sa.action}" (one-date time move must not skip or edit the series)`;
      const today = new Date().toISOString().split('T')[0];
      if (sa.skip_date !== today) return `expected skip_date ${today}, got ${sa.skip_date}`;
      if (sa.time_start !== '16:00') return `expected time_start 16:00, got ${sa.time_start}`;
      if (!/piano/i.test(sa.activity || '')) return `wrong activity: "${sa.activity}"`;
      return null;
    },
  },
  {
    name: 'follow-up continues the QUESTION: "and the week after?" keeps the vacation frame (real transcript 2026-08-23)',
    message: 'And the week after ?',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason', 'Logan'],
      history: [
        { role: 'user', content: 'What dates next week would be good for a quick two day vacation?' },
        { role: 'assistant', content: 'Looking at next week (Mon 24 - Sun 30 Aug), the lightest days are Wed 26 - Thu 27 Aug. I\'d pencil in Wed 26-Thu 27 Aug for your quick two-day break.' },
      ],
    },
    check: (r) => {
      if (r.intent !== 'query_calendar' && r.intent !== 'chat') {
        return `expected query_calendar or chat, got ${r.intent}`;
      }
      // The regression: the classifier kept the timeframe but dropped the
      // question, so the deterministic handler dumped a bare event list.
      // A calendar query here MUST carry the analytical frame in
      // query_topic, phrased self-contained (resolvable without history).
      if (r.intent === 'query_calendar') {
        const topic = r.query_topic || '';
        if (!topic.trim()) return 'query_topic empty - the vacation question was dropped, this becomes a bare listing';
        if (!/vacation|holiday|break|getaway|days|nights|away|free|light/i.test(topic)) {
          return `query_topic "${topic}" does not carry the vacation frame`;
        }
      }
      return null;
    },
  },
  {
    name: 'duplicate principle: teacher-call reschedule of an EXISTING activity is a one-date change, not a second series (real failure 2026-08-20)',
    message: 'Mason has piano on Thursday at 13:00',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason'],
      schoolActivities: 'Mason: piano (Thursdays 16:00, all year)',
    },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action === 'add') return 'chose "add" despite an existing same-name activity (the duplicate principle)';
      if (sa.action !== 'change') return `expected "change" (no movement words = one date), got "${sa.action}"`;
      if (sa.time_start !== '13:00') return `expected time_start 13:00, got ${sa.time_start}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sa.skip_date || '')) {
        return `change without a resolvable skip_date: ${sa.skip_date}`;
      }
      return null;
    },
  },
  {
    name: 'movement-words test: bare time for an existing activity is one date, with no invented end time (real transcript 2026-08-21)',
    message: 'Mason has gym with Gavin at 8.30 sunday',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason'],
      schoolActivities: 'Mason: Gym with Gavin (Sundays 10:30, all year)',
    },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action !== 'change') return `expected "change" (no movement words), got "${sa.action}"`;
      if (sa.time_start !== '08:30') return `expected time_start 08:30, got ${sa.time_start}`;
      if (sa.time_end) return `time_end must stay empty when only the start was given, got ${sa.time_end} (the 3-hour-gym bug)`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sa.skip_date || '')) return `unresolved skip_date: ${sa.skip_date}`;
      return null;
    },
  },
  {
    name: 'correction reinterprets: "just a once off" keeps the 8:30, not a bare revert (real transcript 2026-08-21)',
    message: "No you weren't meant to move it. Was just a once off",
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason'],
      schoolActivities: 'Mason: Gym with Gavin (Sundays 08:30, all year)',
      history: [
        { role: 'user', content: 'Mason has gym with Gavin at 8.30 sunday' },
        { role: 'assistant', content: "Got it - Mason's Gym with Gavin is moving to Sundays at 08:30 going forward, instead of the current 10:30 slot. If that was just for this Sunday, let me know and I'll treat it as a one-off instead." },
      ],
    },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action === 'add') return 'a correction must never create a duplicate';
      // The one thing the correction must NOT lose: the 8:30 the parent
      // asked for. Reverting the series to 10:30 while dropping the
      // one-off 8:30 is the transcript's "runs at its normal time" bug.
      const carried = sa.time_start === '08:30'
        || /8[:.]30/.test(r.response_message || '');
      if (!carried) return `the 08:30 was lost in the correction (action ${sa.action}, time_start ${sa.time_start}, reply: "${r.response_message}")`;
      return null;
    },
  },
  {
    name: 'duplicate principle: "moving to Wednesdays" is a permanent series update',
    message: "Mason's piano is moving to Wednesdays at 14:00 from now on",
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason'],
      schoolActivities: 'Mason: piano (Thursdays 16:00, all year)',
    },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action !== 'update') return `expected action "update" (permanent move), got "${sa.action}"`;
      if (sa.day_of_week !== 2) return `expected day_of_week 2 (Wednesday), got ${sa.day_of_week}`;
      if (sa.time_start !== '14:00') return `expected time_start 14:00, got ${sa.time_start}`;
      return null;
    },
  },
  {
    name: 'stated reading: a fresh weekly add names its cadence in the reply',
    message: 'Mason has karate on Fridays at 5pm',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason'],
      schoolActivities: 'Mason: piano (Thursdays 16:00, all year)',
    },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action !== 'add') return `expected action "add" (no same-name activity exists), got "${sa.action}"`;
      if (sa.day_of_week !== 4) return `expected day_of_week 4 (Friday), got ${sa.day_of_week}`;
      if (!/every|weekly|fridays/i.test(r.response_message || '')) {
        return `reply must state the recurring reading, got: "${r.response_message}"`;
      }
      return null;
    },
  },
  {
    name: 'one-off stays an event: "this Sunday" gym session is not a weekly activity',
    message: 'Mason has a gym session this Sunday at 8.30',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Mason'],
      schoolActivities: 'Mason: piano (Thursdays 16:00, all year)',
    },
    check: (r) => {
      if (r.intent === 'school_activity') return '"this Sunday" is one date - must not become a weekly activity';
      if (r.intent !== 'create_event' && r.intent !== 'school_event') {
        return `expected create_event/school_event, got ${r.intent}`;
      }
      const ev = r.calendar_event;
      if (!ev) return 'missing calendar_event payload';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) return `unresolved date: ${ev.date}`;
      if (new Date(ev.date + 'T12:00:00Z').getUTCDay() !== 0) return `expected a Sunday, got ${ev.date}`;
      return null;
    },
  },
  {
    name: 'activity remove: "Logan has quit football club" deletes the series (no skip_date)',
    message: 'Logan has quit football club, take it off his schedule',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn', 'Logan'] },
    check: (r) => {
      if (r.intent !== 'school_activity') return `expected school_activity, got ${r.intent}`;
      const sa = r.school_activity;
      if (!sa) return 'missing school_activity payload';
      if (sa.action !== 'remove') return `expected action "remove" (quit = whole series), got "${sa.action}"`;
      if (!/football/i.test(sa.activity || '')) return `wrong activity: "${sa.activity}"`;
      return null;
    },
  },

  // ── Phase-0 coverage batch (2026-07-10): reads, grounded answers,
  //    multi-action, notes, subscriptions — the intents users hit daily that
  //    had no golden case. The to-do read is the verbatim message from the
  //    2026-07-10 empty-response incident. ──
  {
    name: 'read: "Whats on my to do list?" is query_tasks with no side effects (real incident 2026-07-10)',
    message: 'Whats on my to do list?',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn'],
      tasks: [
        { id: 't1', title: 'Book MOT' },
        { id: 't2', title: 'Buy birthday card for Granny' },
      ],
    },
    check: (r) => {
      if (r.intent !== 'query_tasks') return `expected query_tasks, got ${r.intent}`;
      if (completions(r).length || adds(r).length) return 'a read must not add or complete tasks';
      return null;
    },
  },
  {
    name: 'read: "what\'s on the shopping list?" is query_list with no adds',
    message: "what's on the shopping list?",
    ctx: { sender: 'Lynn', memberNames: ['Grant', 'Lynn'] },
    check: (r) => {
      if (r.intent !== 'query_list') return `expected query_list, got ${r.intent}`;
      if (shoppingAdds(r).length) return 'a read must not add shopping items';
      return null;
    },
  },
  {
    name: 'read: "what\'s on this week?" is query_calendar with a date range',
    message: "what's on this week?",
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'] },
    check: (r) => {
      if (r.intent !== 'query_calendar') return `expected query_calendar, got ${r.intent}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.query_start || '')) return `missing/invalid query_start: ${r.query_start}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.query_end || '')) return `missing/invalid query_end: ${r.query_end}`;
      return null;
    },
  },
  {
    // Real failure 2026-07-11: "What time is masons tennis today" got a
    // whole-day dump because the topic was discarded at routing. The
    // classify path must carry the asked-about thing in query_topic so the
    // handler can filter to it (and admit it honestly when nothing matches).
    name: 'read: "What time is masons tennis today" carries query_topic',
    message: 'What time is masons tennis today',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn', 'Mason'] },
    check: (r) => {
      if (r.intent !== 'query_calendar') return `expected query_calendar, got ${r.intent}`;
      if (!/tennis/i.test(r.query_topic || '')) return `query_topic missing tennis: ${JSON.stringify({ query_topic: r.query_topic })}`;
      return null;
    },
  },
  {
    name: 'read: "what subscriptions do we have?" is subscription_list',
    message: 'what subscriptions do we have?',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'] },
    check: (r) => (r.intent !== 'subscription_list' ? `expected subscription_list, got ${r.intent}` : null),
  },
  {
    name: 'grounding: allergy question answers from FAMILY PREFERENCES (chips fix 2026-07-10)',
    message: 'Do we have any family allergies in the house?',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn'],
      preferences: [{ key: 'allergy', value: 'Gluten', member_name: null }],
    },
    check: (r) => {
      // chat and note_recall are both answer-in-response_message intents for
      // this — what matters is the GROUNDING: the saved allergy is surfaced.
      if (!['chat', 'note_recall'].includes(r.intent)) return `expected chat/note_recall, got ${r.intent}`;
      if (!/gluten/i.test(r.response_message || '')) return `answer doesn't mention the saved Gluten allergy: "${r.response_message}"`;
      return null;
    },
  },
  {
    name: 'recipe: "easy dinner recipe for tonight" carries a recipe_request',
    message: 'give me an easy dinner recipe for tonight',
    ctx: { sender: 'Lynn', memberNames: ['Grant', 'Lynn'] },
    check: (r) => {
      if (r.intent !== 'recipe') return `expected recipe, got ${r.intent}`;
      if (!r.recipe_request?.description) return 'missing recipe_request.description';
      return null;
    },
  },
  {
    name: 'multi-action: "add milk to the list and remind me to call the dentist" does BOTH',
    message: 'add milk to the shopping list and remind me to call the dentist',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (shoppingAdds(r).length < 1) return 'expected a shopping add (milk)';
      if (adds(r).length < 1) return 'expected a task add (call the dentist)';
      return null;
    },
  },
  {
    name: 'note_save: "remember the wifi password is hunter2" saves a note',
    message: 'remember the wifi password is hunter2',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'] },
    check: (r) => {
      if (r.intent !== 'note_save') return `expected note_save, got ${r.intent}`;
      if (!r.note?.key) return 'missing note.key';
      if (!/hunter2/i.test(r.note?.value || '')) return `note value lost the password: "${r.note?.value}"`;
      return null;
    },
  },
  {
    name: 'note_recall: "what\'s the wifi password?" answers from saved notes',
    message: "what's the wifi password?",
    ctx: {
      sender: 'Lynn',
      memberNames: ['Grant', 'Lynn'],
      notes: [{ key: 'wifi password', value: 'hunter2' }],
    },
    check: (r) => {
      if (r.intent !== 'note_recall') return `expected note_recall, got ${r.intent}`;
      if (!/hunter2/i.test(r.response_message || '')) return `answer doesn't contain the saved value: "${r.response_message}"`;
      return null;
    },
  },
  {
    name: 'subscription_add: "we pay £9.99 a month for Netflix" tracks the subscription',
    message: 'we pay £9.99 a month for Netflix',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'] },
    check: (r) => {
      if (r.intent !== 'subscription_add') return `expected subscription_add, got ${r.intent}`;
      if (!/netflix/i.test(r.subscription?.name || '')) return `wrong subscription name: "${r.subscription?.name}"`;
      return null;
    },
  },
  {
    name: 'update_event: "move my haircut to 4pm" grounds on the right event [N]',
    message: 'move my haircut to 4pm',
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
      if (r.intent !== 'update_event') return `expected update_event, got ${r.intent}`;
      if (Number(r.target?.target_id) !== 2) return `expected target.target_id 2 (haircut), got ${r.target?.target_id}`;
      if (!r.updates) return 'missing updates payload';
      return null;
    },
  },
  {
    name: 'weather: "will it rain tomorrow?" is a weather query',
    message: 'will it rain tomorrow?',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'] },
    check: (r) => (r.intent !== 'weather' ? `expected weather, got ${r.intent}` : null),
  },

  // ── Phase-3 batch (2026-07-11): multi-event + conditional wider context ──
  {
    name: 'multi-event: "swimming Tuesday 4pm and dentist Thursday 9am" extracts BOTH events',
    message: 'Add swimming Tuesday at 4pm and the dentist Thursday at 9am',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      const evts = [
        ...(r.calendar_event ? [r.calendar_event] : []),
        ...(Array.isArray(r.calendar_events) ? r.calendar_events : []),
      ];
      if (evts.length !== 2) return `expected 2 events, got ${evts.length} (${evts.map((e) => e.title).join(' | ')})`;
      const titles = evts.map((e) => (e.title || '').toLowerCase()).join(' ');
      if (!/swim/.test(titles) || !/dentist/.test(titles)) return `wrong titles: ${titles}`;
      if (adds(r).length) return 'events must not also become to-dos';
      return null;
    },
  },
  {
    name: 'meal grounding: "what\'s for dinner tomorrow?" answers from the MEAL PLAN context',
    message: "what's for dinner tomorrow?",
    ctx: {
      sender: 'Lynn',
      memberNames: ['Grant', 'Lynn'],
      mealPlan: [{ date: futureISO(1).slice(0, 10), category: 'dinner', meal_name: 'Spaghetti bolognese' }],
    },
    check: (r) => {
      if (!/spaghetti|bolognese/i.test(r.response_message || '')) {
        return `answer doesn't mention the planned meal: "${r.response_message}"`;
      }
      return null;
    },
  },
  {
    name: 'chore grounding: "has Henry done his chores today?" answers from TODAY\'S CHORES',
    message: 'has Henry done his chores today?',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Henry'],
      choresToday: [{ name: 'Henry', done: 1, total: 3, outstanding: ['Feed the dog', 'Tidy room'] }],
    },
    check: (r) => {
      const msg = r.response_message || '';
      // Grounding: the answer must reflect the real status (1 of 3 /
      // outstanding items), not a generic "I don't know".
      if (!/1 of 3|two (more|left)|feed the dog|tidy/i.test(msg)) {
        return `answer isn't grounded in today's chore status: "${msg}"`;
      }
      return null;
    },
  },
  {
    name: 'star grounding: "how many stars does Olivia have?" answers from STAR BALANCES',
    message: 'how many stars does Olivia have?',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn', 'Olivia'],
      starBalances: [{ name: 'Olivia', balance: 89 }, { name: 'Henry', balance: 42 }],
    },
    check: (r) => {
      if (!/89/.test(r.response_message || '')) {
        return `answer doesn't contain Olivia's balance (89): "${r.response_message}"`;
      }
      return null;
    },
  },

  // ── 2026-07-23: multi-day create carried only its first day (schema had no
  // end_date on creation - the model NARRATED "5 to 10 Sept" but stored one day).
  {
    name: 'multi-day create: "camping from 5-10 Sept" carries end_date',
    message: 'Add camping trip from 5-10 September',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent !== 'create_event') return `intent ${r.intent}`;
      const ev = r.calendar_event || (Array.isArray(r.calendar_events) ? r.calendar_events[0] : null);
      if (!ev) return 'no calendar_event';
      if (!/09-05$/.test(ev.date || '')) return `date ${ev.date}`;
      if (!/09-10$/.test(ev.end_date || '')) return `end_date ${ev.end_date} (range lost)`;
      return null;
    },
  },

  // ── 2026-08-14: "Dean in London from 1 to 6 Sept" - a verbless jotting
  // (no "add", no question) must classify as a multi-day CREATE. The router
  // used to swallow it as query_calendar; once it falls through, the full
  // classifier must not treat it as a question either.
  {
    name: 'verbless jotting: "Dean in London from 1 to 6 Sept" creates a multi-day event',
    message: 'Dean in London from 1 to 6 Sept',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent !== 'create_event') return `intent ${r.intent}`;
      const ev = r.calendar_event || (Array.isArray(r.calendar_events) ? r.calendar_events[0] : null);
      if (!ev) return 'no calendar_event';
      if (!/09-01$/.test(ev.date || '')) return `date ${ev.date}`;
      if (!/09-06$/.test(ev.end_date || '')) return `end_date ${ev.end_date} (range lost)`;
      if (!/dean/i.test(ev.title || '')) return `title ${ev.title}`;
      return null;
    },
  },

  // ── 2026-08-01: "apply for UK citizenship on 18 March 2027, remind 2 days
  // before" - the first pass claimed "added" with an EMPTY task list (77
  // output tokens); the honesty backstop caught it and the verbatim retry
  // worked. The handler now auto-retries once, but the model should get the
  // far-future task with a reminder offset right on the first pass.
  {
    name: 'far-future task with relative reminder: citizenship 18 Mar 2027, remind 2 days before',
    message: 'I need to apply for UK citizenship on 18 March 2027. Remind 2 days before.',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent !== 'add' && r.intent !== 'add_task') return `intent ${r.intent}`;
      const t = (r.tasks || [])[0];
      if (!t) return 'tasks[] empty - the exact live failure';
      if (!/citizenship/i.test(t.title || t.name || '')) return `title "${t.title || t.name}"`;
      if (!/2027-03-1[68]/.test(t.due_date || '')) return `due_date ${t.due_date}`;
      return null;
    },
  },

  // ── 2026-07-20: school_add intent (activation opener). The model must
  // carry the user's words into school_query and NEVER answer as if it
  // matched a school itself - the handler owns GIAS search + confirmation.
  {
    name: 'school_add: naming the kids\' school routes to school_add with the words preserved',
    message: 'The kids go to Ashfield Primary in Leeds',
    ctx: { sender: 'Louise', memberNames: ['Louise', 'Sofia', 'Max'] },
    check: (r) => {
      if (r.intent !== 'school_add') return `intent ${r.intent}`;
      if (!/ashfield/i.test(r.school_query || '')) return `school_query "${r.school_query}" lost the name`;
      if (!/leeds/i.test(r.school_query || '')) return `school_query "${r.school_query}" dropped the town`;
      return null;
    },
  },
  {
    name: 'school_add control: a one-off school trip stays school_event, not school_add',
    message: 'Jake has a school trip next Thursday',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Jake'] },
    check: (r) => {
      if (r.intent === 'school_add') return 'misrouted to school_add';
      if (!['school_event', 'create_event'].includes(r.intent)) return `intent ${r.intent}`;
      return null;
    },
  },

  // ── 2026-08-01: "add them to my meal plan" - the assistant claimed there
  // was NO meal plan feature (Meals is a main nav tab) because no meal-plan
  // write intent existed. Two named meals on two named days must route to
  // meal_plan_add with resolved dates, and NEVER to create_event.
  {
    name: 'meal_plan_add: two meals on two named days route to the meal plan, not the calendar',
    message: 'Put spaghetti bolognese on the meal plan for Tuesday and fish and chips on Friday',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent === 'create_event') return 'misrouted to create_event - meals are not calendar events';
      if (r.intent !== 'meal_plan_add') return `intent ${r.intent}`;
      const entries = r.meal_plan_entries || [];
      if (entries.length !== 2) return `${entries.length} entries (wanted 2)`;
      const spag = entries.find((e) => /bologn|spag/i.test(e.meal_name || ''));
      const fish = entries.find((e) => /fish/i.test(e.meal_name || ''));
      if (!spag || !fish) return `entries ${JSON.stringify(entries.map((e) => e.meal_name))}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(spag.date || '')) return `spag date ${spag.date}`;
      // Tuesday resolves to the NEXT Tuesday; both dates must land on the right weekday.
      const dow = (d) => new Date(`${d}T12:00:00Z`).getUTCDay();
      if (dow(spag.date) !== 2) return `spag bol on weekday ${dow(spag.date)} (wanted Tuesday)`;
      if (dow(fish.date) !== 5) return `fish & chips on weekday ${dow(fish.date)} (wanted Friday)`;
      return null;
    },
  },

  // ── 2026-08-13 capability-gap round: meals OFF the plan, bulk targeting,
  // and recurrence clearing - the three "known remaining gaps".
  {
    name: 'meal_plan_remove: taking a meal off the plan routes to the remove intent with a name target',
    message: 'Take spag bol off the meal plan, we are getting a takeaway instead',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [] },
    check: (r) => {
      if (r.intent !== 'meal_plan_remove') return `intent ${r.intent}`;
      const targets = r.meal_plan_targets || [];
      if (targets.length < 1) return 'no meal_plan_targets';
      if (!targets.some((t) => /bologn|spag/i.test(t.meal_name || ''))) return `targets ${JSON.stringify(targets)}`;
      return null;
    },
  },
  {
    name: 'bulk delete: "delete all the fixtures" sets target.all_matching',
    message: 'Delete all the football fixtures from the calendar',
    ctx: {
      sender: 'Grant',
      memberNames: ['Grant', 'Lynn'],
      tasks: [],
      calendarEvents: [
        { id: 'e1', title: 'Football fixture: U9 v Rovers', start_time: futureISO(2), all_day: false },
        { id: 'e2', title: 'Football fixture: U9 v Town', start_time: futureISO(9), all_day: false },
        { id: 'e3', title: 'Dentist', start_time: futureISO(4), all_day: false },
      ],
    },
    check: (r) => {
      if (r.intent !== 'delete_event') return `intent ${r.intent}`;
      if (r.target?.all_matching !== true) return `all_matching ${r.target?.all_matching}`;
      if (!/fixture|football/i.test(r.target?.title || '')) return `title ${r.target?.title}`;
      return null;
    },
  },
  {
    name: 'recurrence clearing: "stop it repeating" emits updates.recurrence none, not a delete',
    message: "Stop Jack's swimming lesson repeating every week, it's a one-off now",
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn', 'Jack'], tasks: [] },
    check: (r) => {
      if (r.intent === 'delete_event') return 'misrouted to delete_event - stopping a repeat is an update';
      if (r.intent !== 'update_event') return `intent ${r.intent}`;
      if (r.updates?.recurrence !== 'none') return `updates.recurrence ${r.updates?.recurrence}`;
      return null;
    },
  },
  {
    name: 'create_list: "holiday to-do list with baggage" is a named LIST, not a bare to-do (real transcript 2026-08-25)',
    message: 'Create a holiday to-do list for me and add baggage',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [], calendarEvents: [] },
    check: (r) => {
      if (r.intent !== 'create_list') return `intent ${r.intent} (want create_list)`;
      if (!/holiday/i.test(r.list?.name || '')) return `list.name ${JSON.stringify(r.list)}`;
      const items = (r.shopping_items || []).filter((i) => i.action === 'add');
      if (!items.some((i) => /baggage|luggage/i.test(i.item || ''))) return `items ${JSON.stringify(items)}`;
      return null;
    },
  },
  {
    name: 'list_name targeting: "add sunscreen to the holiday list" names the list',
    message: 'Add sunscreen to the holiday list',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [], calendarEvents: [] },
    check: (r) => {
      if (r.intent !== 'add' && r.intent !== 'create_list') return `intent ${r.intent}`;
      const item = (r.shopping_items || []).find((i) => /sunscreen/i.test(i.item || ''));
      if (!item) return `no sunscreen item: ${JSON.stringify(r.shopping_items)}`;
      if (!/holiday/i.test(item.list_name || r.list?.name || '')) return `list_name ${item.list_name}`;
      return null;
    },
  },
  {
    name: 'list_name guard: a plain "add milk to the shopping list" stays on the main list',
    message: 'Add milk to the shopping list',
    ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [], calendarEvents: [] },
    check: (r) => {
      if (r.intent !== 'add') return `intent ${r.intent}`;
      const item = (r.shopping_items || []).find((i) => /milk/i.test(i.item || ''));
      if (!item) return 'no milk item';
      if (item.list_name && !/shopping|default|grocer/i.test(item.list_name)) return `unexpected list_name ${item.list_name}`;
      return null;
    },
  },
];
