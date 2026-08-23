# The bot's reply ladder: deterministic → tiny model → full classifier

How an inbound WhatsApp message gets handled, and the rules for extending it.
Written 2026-08-23 after the "Half hour" padel transcript; the evidence and
reasoning live in the message-log analysis from that session.

## The ladder

1. **Deterministic pre-classifiers** (regex + in-memory pending state, ~0ms).
   Undo, brief opt-in/out, trivial greetings, and replies to a question the
   bot just asked (reminder lead times, duplicate confirms, birthday repeats).
2. **Tiny model** (Haiku, forced schema, 3s cap, ~$0.001/call).
   `reminder-extract.js`: verdicts a reply to a pending question as
   `answer` / `decline` / `unrelated`, extracts offsets/times, and splits off
   a compound reply's second request (`remainder`).
3. **Full classifier** (Sonnet, ~25k cached input tokens, ~5s).
   Everything open-ended.

Measured (2026-08-23): median turn latency 345ms deterministic vs 5,414ms
through the classifier; ~7% of inbound traffic resolves at rung 1.

## Why rung 1 exists (it is NOT cost)

The savings are ~£2/month - irrelevant. The real reasons:

- **Latency**: conversational follow-ups ("Yes", "2 hours") need chat-speed
  replies; 5s reads as broken.
- **State binding**: a reply to "how long before?" must attach to the exact
  item the question was about. Rung 1 holds the itemId; the classifier has
  to re-derive the target from fuzzy titles, which is where the 2026-07-16
  phantom-update misroute came from.
- **Guarantees**: "stop briefs" (messaging opt-out - compliance) and "undo"
  must work 100.0% of the time, not 99% of samples.
- **Testability**: rung 1 is pinned by exact unit tests; model behaviour is
  sampled and drifts.

## The rules (learned the hard way)

1. **Pending state makes rung 2 mandatory.** When the bot has asked a
   question and every deterministic parse shrugs at the reply, the tiny
   model ALWAYS gets one look before the message may leak to the classifier.
   The old keyword gate was the bug class: "Half hour" became a phantom
   update; "A week before and also..." errored out; "No thanks" became a
   created event. Verdicts: `answer` (act on it), `decline` (settle the
   question deterministically), `unrelated` (re-arm the pending target,
   fall through).
2. **Never grow regexes to chase phrasing variety.** Rung 1's vocabulary
   covers the common fast path; the tail belongs to rung 2. A regex that
   half-matches is worse than one that misses ("half hour before" matched
   "hour before" and silently saved a wrong reminder).
3. **Wordy parseable replies still get a rung-2 look** (remainder only), so
   a second request riding along with the answer isn't silently dropped.
4. **Fail open downward.** A rung-2 failure (timeout, malformed output)
   returns null and the old heuristics apply; a remainder failure never
   costs the saved answer its confirmation.
5. **Confirmations state outcomes** ("Done - I'll remind you 30 minutes
   before Padel (8:30 pm)"), never abstractions ("I've updated the
   details"). No undo hint on actions the undo stores don't capture.
6. **Watch the leak radar.** `getPendingReplyLeaks` (surfaced in
   /admin/analytics as "Bot reply leaks") pairs every pending-flow question
   with the user's next message and lists the ones that didn't resolve
   deterministically. Scan `said` for answers the parsers missed - that's
   how the next "half hour" gets found before a user screenshot does. When
   a new pending flow ships, add its ask-pattern to `PENDING_ASK_PATTERNS`
   in queries.js.
