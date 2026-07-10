# Bot classifier eval (golden set)

A small harness that runs real messages through the WhatsApp **classifier**
(`classify()` in `src/services/ai.js`) and asserts structural properties of
the result. It's our regression net for the bot's _intelligence_ — the
prompt + model behaviour that plain unit tests can't cover.

## Run it

```bash
npm run eval:bot                  # all cases
node tests/bot-eval/run.js euss   # only cases whose name matches "euss"
```

Each case = one LLM call. It uses the **same chain as production** — classify
is **Claude-primary** (Sonnet 5, `preferClaude`) with Gemini then GPT as
failover. To eval against the prod model, set `ANTHROPIC_API_KEY` in `.env`;
with only a Gemini/GPT key present it evals the failover models instead —
still useful, but mind the model difference.

> The runner loads `.env` with `override: true`, so the repo's keys win over
> any stale value already exported in your shell.

## What goes here vs. jest

- **Here (eval):** behaviours that depend on the model + prompt — intent
  classification, completion detection, date extraction, "don't invent a
  time", "don't act on trivial chat". Non-deterministic, costs API calls, so
  it is **not** part of jest/CI. Run it on demand before/after touching the
  classifier prompt.
- **jest unit tests:** deterministic logic — e.g. `completeTasksByName`
  over-matching (`src/db/completeTasksByName.test.js`), the conversation
  window (`src/db/getRecentWhatsAppTurns.test.js`). These run in CI.

## The discipline (non-negotiable)

1. **Every real-world misfire becomes a case the SAME DAY.** The bot did
   something silly on WhatsApp → reproduce it here with the same message +
   context, before (or alongside) the fix. Several cases carry the incident
   date they came from.
2. **Run before AND after any change to:** the classify prompt
   (`src/services/prompts.js`), the model/provider order or pipeline
   (`src/services/ai-client.js`, `src/services/ai.js`, schema, router), or
   the action-matching code in `src/bot/handlers.js`. A change that drops
   the pass count does not ship.

## Add a case every time the bot does something silly

That's how this stops being whack-a-mole. Open `cases.js` and add:

```js
{
  name: 'short description of the behaviour',
  message: 'what the user types',
  ctx: { sender: 'Grant', memberNames: ['Grant', 'Lynn'], tasks: [{ id, title }], /* … */ },
  check: (r) => (/* return null to pass, or a short failure string */),
}
```

Assert **structural** properties (intent, which action, `all_day`, item
count) — never exact wording, so cases stay stable across runs and models.

## Seeded cases

The initial set encodes the bugs we actually hit: short-title over-completion
("I called EUSS"), completion detection ("Mallorca dinner booked"), trivial
chat creating no actions ("Testing"), no invented time ("Sports day Friday"
→ all-day), no event without a date ("Elementor paid"), multi-item shopping,
and relay-to-member. The 2026-07-10 Phase-0 batch added everyday coverage:
the four READ intents, preference-grounded answers (allergy chips), recipe,
multi-action, notes save/recall, subscriptions, [N]-grounded event updates,
and weather.

## Baseline log

| Date | Cases | Result | Pipeline |
|---|---|---|---|
| 2026-07-02 | 21 | 21/21 (Sonnet 5) | v1 mega-prompt |
| 2026-07-10 | 37 | 37/37 (Sonnet 5) | v1 mega-prompt |
