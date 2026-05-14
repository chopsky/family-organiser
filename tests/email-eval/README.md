# Email AI eval suite

A regression-test corpus for the inbound-email pipeline's two AI stages:

- `extractFromEmail` — classifies a forwarded email and pulls out structured data (shopping items, events, tasks).
- `matchReceiptToList` — fuzzy-matches receipt items against the household's shopping list.

This corpus exists because the prompts get tweaked often. Each tweak fixes a specific case but risks silently breaking a different one. Without an eval suite, we'd be flying blind. With it, every prompt change runs against the historical corpus and we see immediately whether we broke anything.

## Run it

```bash
npm run eval:emails                           # full suite
npm run eval:emails -- --only=tesco           # filter by name
npm run eval:emails -- --only=receipt-match   # filter by stage
npm run eval:emails -- --verbose              # print raw AI responses
```

Exits 0 if every fixture passes, 1 otherwise. Hook into pre-push or CI to gate prompt changes.

Each fixture makes real AI calls — ~$0.001–$0.005 per fixture, ~10–60s total runtime depending on suite size and provider speed. Don't run on every save; run before pushing prompt changes.

## Add a fixture from a real failure

When something goes wrong in production (you see it via the admin `/admin/inbound-emails` page, or a user reports it):

1. Decide which stage failed: classification/extraction (`extractFromEmail`) or matching (`matchReceiptToList`).
2. Create a new directory under `fixtures/extraction/` or `fixtures/receipt-match/`. Name it descriptively, e.g. `05-tesco-delivery-status-no-items`.
3. Write `input.json` with the email content (or receipt + list pair). **Anonymise**: replace real names, addresses, order numbers with safe placeholders. The AI needs realistic structure, not real PII.
4. Write `expected.json` describing what the AI *should* return. Only assert what matters for this case — the format below lets you be selective.
5. Run `npm run eval:emails -- --only=<your-fixture-name>` to confirm it fails as-is.
6. Tweak the prompt in `src/services/prompts.js` until it passes.
7. Run the full suite to confirm you didn't regress anything else.
8. Commit fixture + prompt change together.

## Fixture format

### Extraction (`fixtures/extraction/<name>/`)

`input.json` — what the inbound-email handler sees:

```json
{
  "subject": "Fwd: Your tesco.com order 12345",
  "text": "Hello Sam. Thank you for shopping at Tesco. Order placed. Order picked. ...",
  "members": ["Sam", "Alex"]
}
```

`expected.json` — what `extractFromEmail` should return. Every field is **optional** — only declare what you want to assert.

```json
{
  "description": "Order status update with no itemised body. Receipt, but no items.",
  "email_type": "receipt",
  "email_type_or": ["receipt", "delivery"],
  "shopping_items": {
    "exact_count": 0,
    "count_min": 0,
    "count_max": 0,
    "must_contain": ["milk", "eggs"],
    "must_not_contain": ["chocolate"]
  },
  "events": {
    "count_max": 0,
    "must_not_contain": ["tesco grocery", "tesco delivery"]
  },
  "tasks": {
    "count_min": 1
  }
}
```

Notes:
- `email_type` accepts either a string (exact match) or an array (any-of). The runner checks both forms via `email_type` being array-or-string.
- `must_contain` / `must_not_contain` run case-insensitive substring matches against the JSON-serialised value of each item/event/task. So a `must_not_contain: ["tesco delivery"]` on `events` catches a wrong event titled "Tesco Grocery Delivery".
- `exact_count` is strict; `count_min`/`count_max` give you a range when the precise count is non-deterministic.

### Receipt-match (`fixtures/receipt-match/<name>/`)

`input.json`:

```json
{
  "receiptItems": [
    {"normalised_name": "tesco 20% beef mince", "original_text": "Tesco 20% Beef Mince 500g"}
  ],
  "shoppingList": [
    {"id": "list-item-beef", "item": "beef mince"},
    {"id": "list-item-milk", "item": "skimmed milk"}
  ]
}
```

`expected.json`:

```json
{
  "description": "Brand-prefix receipt line should match the generic list entry.",
  "matches": [
    {
      "receipt_contains": "beef mince",
      "list_item_contains": "beef mince",
      "min_confidence": 0.7
    }
  ],
  "no_match_for": ["almond milk"]
}
```

Notes:
- `receipt_contains` and `list_item_contains` are case-insensitive substrings of the AI's `receipt_item` and `list_item_name` fields. You don't have to know the exact wording the AI will use — just the unmistakable part.
- `min_confidence` defaults to 0.7 (the threshold the inbound-email handler uses to actually check items off).
- `no_match_for`: receipt items that should NOT find any list match above confidence 0.6. Use this for cases like almond milk vs cow's milk that look superficially similar but are genuinely different products.

## What the current corpus covers

Each fixture is named with a numeric prefix + a short description of the case it pins down. As the suite grows, the prefixes become a rough order-of-arrival audit log.

If something's wrong in production and there's no fixture for it, the fix is **always**: add a fixture before changing the prompt. That's the whole point.
