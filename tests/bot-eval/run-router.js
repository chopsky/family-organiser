/**
 * READ fast-path router eval runner (Phase 2 gate).
 *
 *   npm run eval:router
 *
 * Live Haiku calls (cheap: tiny prompt, 256 max tokens per case). The gate
 * before flipping BOT_ROUTER=1 in prod is 20/20 — a must-fall-through miss
 * means the router would have swallowed a mutation, which is the one thing
 * it must never do.
 */
require('dotenv').config({ override: true });
process.env.BOT_ROUTER = '1'; // the module self-gates; force it on for the eval
const { routeReadIntent } = require('../../src/services/intent-router');
const cases = require('./router-cases');

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('No ANTHROPIC_API_KEY - skipping router eval.');
    process.exit(0);
  }
  console.log(`Running ${cases.length} router case(s)...\n`);
  let pass = 0;
  const failures = [];
  for (const c of cases) {
    const routed = await routeReadIntent(c.message, { timezone: 'Europe/London' });
    const got = routed ? routed.route : null;
    const checkErr = got === c.expect && c.check && routed ? c.check(routed) : null;
    if (got === c.expect && !checkErr) {
      pass++;
      console.log(`  ✓ "${c.message}" → ${got === null ? 'fall-through' : got}`);
    } else if (checkErr) {
      failures.push(c);
      console.log(`  ✗ "${c.message}" → ${got} but ${checkErr}`);
    } else {
      failures.push(c);
      console.log(`  ✗ "${c.message}" → expected ${c.expect === null ? 'fall-through' : c.expect}, got ${got === null ? 'fall-through' : got}`);
    }
  }
  console.log(`\n${pass}/${cases.length} passed.`);
  process.exit(failures.length ? 1 : 0);
})();
