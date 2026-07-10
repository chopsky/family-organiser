/**
 * WhatsApp classifier golden-set eval runner.
 *
 *   node scripts/eval/run.js            # run all cases
 *   node scripts/eval/run.js euss       # run cases whose name matches "euss"
 *
 * Calls the REAL classifier (one LLM call per case) and scores structural
 * assertions. Non-deterministic + costs API calls, so it is NOT part of
 * jest/CI - run it on demand before/after touching the classifier prompt or
 * the action-matching code.
 *
 * Provider: uses the same chain as production — classify is CLAUDE-primary
 * (preferClaude, Sonnet 5) with Gemini then GPT as failover. To eval against
 * the prod model, set ANTHROPIC_API_KEY locally; with only a Gemini/GPT key
 * present it falls over to those - still a useful signal on prompt behaviour,
 * but mind the model difference.
 */
// override:true so the repo's .env keys win over any stale/placeholder
// values already exported in the shell (dotenv does NOT override existing
// process.env by default - a common "why won't my key work" gotcha).
require('dotenv').config({ override: true });
const { classify } = require('../../src/services/ai');
const cases = require('./cases');

function hasAnyAiKey() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY ||
            process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

async function runCase(c) {
  const result = await classify(
    c.message,
    c.ctx.memberNames || [],
    c.ctx.notes || [],
    {
      sender: c.ctx.sender,
      tasks: c.ctx.tasks || [],
      calendarEvents: c.ctx.calendarEvents || [],
      history: c.ctx.history || [],
      preferences: c.ctx.preferences || [],
      timezone: c.ctx.timezone || 'Europe/London',
      householdId: null,
      userId: null,
    },
  );
  return { result, err: c.check(result) };
}

(async () => {
  if (!hasAnyAiKey()) {
    console.log('No AI key set (GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY) - skipping eval.');
    process.exit(0);
  }
  const filter = (process.argv[2] || '').toLowerCase();
  const selected = filter ? cases.filter((c) => c.name.toLowerCase().includes(filter)) : cases;
  console.log(`Running ${selected.length} eval case(s)...\n`);

  let pass = 0;
  const failures = [];
  for (const c of selected) {
    try {
      const { result, err } = await runCase(c);
      if (err) {
        failures.push({ name: c.name, err, result });
        console.log(`  ✗ ${c.name}\n      ${err}`);
      } else {
        pass++;
        console.log(`  ✓ ${c.name}`);
      }
    } catch (e) {
      failures.push({ name: c.name, err: `threw: ${e.message}` });
      console.log(`  ✗ ${c.name}\n      threw: ${e.message}`);
    }
  }

  console.log(`\n${pass}/${selected.length} passed.`);
  if (failures.length) {
    console.log('\nFailing results (for debugging):');
    for (const f of failures) {
      console.log(`\n— ${f.name}`);
      if (f.result) console.log(JSON.stringify({ intent: f.result.intent, tasks: f.result.tasks, calendar_event: f.result.calendar_event, shopping_items: f.result.shopping_items }, null, 2));
    }
    process.exit(1);
  }
  process.exit(0);
})();
