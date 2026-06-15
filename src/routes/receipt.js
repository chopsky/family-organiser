const { Router } = require('express');
const multer = require('multer');
const db = require('../db/queries');
const { scanReceipt, matchReceiptToList } = require('../services/ai');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

// Store uploads in memory (max 10 MB) - no disk writes needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted'));
    }
    cb(null, true);
  },
});

// Best-effort parse of the freeform date the scan returns into a YYYY-MM-DD.
// Returns null when it can't be parsed confidently (e.g. "11 Apr" with no
// year) so we don't persist a wrong date.
function parseReceiptDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * POST /api/receipt
 * Upload a receipt image (multipart/form-data, field name: "receipt").
 * Scans with Claude Vision, fuzzy-matches against the shopping list, checks
 * off matches, and PERSISTS the receipt + its lines so it shows up under
 * GET /api/receipts.
 *
 * Returns: { extracted, matches, checkedOff, unmatched, receiptId }
 */
router.post('/', requireAuth, requireHousehold, upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded. Use field name "receipt".' });
  }

  try {
    const [extracted, shoppingList] = await Promise.all([
      scanReceipt(req.file.buffer, req.file.mimetype, { householdId: req.householdId, userId: req.user.id }),
      db.getShoppingList(req.householdId),
    ]);

    if (!extracted.items?.length) {
      return res.json({
        extracted,
        matches: [],
        checkedOff: [],
        unmatched: [],
        message: 'No items found on the receipt.',
      });
    }

    const matchResult = await matchReceiptToList(extracted.items, shoppingList, { householdId: req.householdId, userId: req.user.id });

    // Complete matched items (confidence ≥ 0.7) in parallel
    const toCheckOff = (matchResult.matches || []).filter((m) => m.confidence >= 0.7);
    await Promise.all(toCheckOff.map((m) => db.completeShoppingItemById(m.list_item_id)));
    const checkedOff = toCheckOff.map((m) => ({
      id: m.list_item_id, name: m.list_item_name, confidence: m.confidence,
    }));

    // Correlate each extracted line to a high-confidence match (consuming each
    // match once) so we can persist which lines were matched. matched_count is
    // derived from these flags in createReceiptWithItems.
    const norm = (s) => (s || '').trim().toLowerCase();
    const remaining = toCheckOff.slice();
    const itemsForSave = extracted.items.map((it) => {
      const keys = [norm(it.normalised_name), norm(it.original_text)].filter(Boolean);
      const idx = remaining.findIndex((m) => keys.includes(norm(m.receipt_item)));
      let m = null;
      if (idx >= 0) { m = remaining[idx]; remaining.splice(idx, 1); }
      return {
        name: it.normalised_name || it.original_text || 'Item',
        original_text: it.original_text || null,
        price_text: it.price || null,
        matched: !!m,
        matched_list_item_id: m?.list_item_id || null,
        matched_list_item_name: m?.list_item_name || null,
        confidence: typeof m?.confidence === 'number' ? m.confidence : null,
      };
    });

    // Persistence is best-effort: a DB hiccup shouldn't fail the scan (the
    // user still gets their checked-off items and the extraction result).
    let receiptId = null;
    try {
      const saved = await db.createReceiptWithItems(req.householdId, req.user.id, {
        merchant: extracted.store_name || null,
        purchased_on: parseReceiptDate(extracted.date),
        total_text: extracted.total || null,
        items: itemsForSave,
      });
      receiptId = saved?.id || null;
    } catch (persistErr) {
      console.error('Failed to persist receipt:', persistErr.message);
    }

    return res.json({
      extracted,
      matches: matchResult.matches || [],
      checkedOff,
      unmatched: matchResult.unmatched_receipt_items || [],
      summary: matchResult.summary,
      receiptId,
    });
  } catch (err) {
    console.error('POST /api/receipt error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/receipts
 * List the household's saved receipts, newest first.
 */
router.get('/', requireAuth, requireHousehold, async (req, res) => {
  try {
    const receipts = await db.getReceipts(req.householdId);
    return res.json({ receipts });
  } catch (err) {
    console.error('GET /api/receipts error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/receipts/:id
 * A single receipt with its extracted lines (for the items / reconcile view).
 */
router.get('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    const receipt = await db.getReceiptById(req.householdId, req.params.id);
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    return res.json({ receipt });
  } catch (err) {
    console.error('GET /api/receipts/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/receipts/:id/items/:itemId
 * Reconcile one line: { matched: boolean, matched_list_item_id?, matched_list_item_name? }.
 * Recomputes the receipt's matched_count + status. Returns the refreshed receipt.
 */
router.patch('/:id/items/:itemId', requireAuth, requireHousehold, async (req, res) => {
  if (typeof req.body.matched !== 'boolean') {
    return res.status(400).json({ error: '"matched" (boolean) is required' });
  }
  try {
    const receipt = await db.setReceiptItemMatched(req.householdId, req.params.id, req.params.itemId, {
      matched: req.body.matched,
      matched_list_item_id: req.body.matched_list_item_id,
      matched_list_item_name: req.body.matched_list_item_name,
    });
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    return res.json({ receipt });
  } catch (err) {
    console.error('PATCH /api/receipts/:id/items/:itemId error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/receipts/:id
 * Permanently delete a saved receipt (and its lines, via cascade).
 */
router.delete('/:id', requireAuth, requireHousehold, async (req, res) => {
  try {
    await db.deleteReceipt(req.householdId, req.params.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/receipts/:id error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle multer errors (file too large, wrong type, etc.)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('image')) {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

module.exports = router;
