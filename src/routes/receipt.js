const { Router } = require('express');
const multer = require('multer');
const db = require('../db/queries');
const { scanReceipt, matchReceiptToList } = require('../services/ai');
const { requireAuth } = require('../middleware/auth');

const router = Router();

// Store uploads in memory (max 10 MB) — no disk writes needed
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

/**
 * POST /api/receipt
 * Upload a receipt image (multipart/form-data, field name: "receipt").
 * Scans with Claude Vision, fuzzy-matches against shopping list, checks off matches.
 *
 * Returns: { extracted, matches, checkedOff, unmatched }
 */
router.post('/', requireAuth, upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded. Use field name "receipt".' });
  }

  try {
    const extracted = await scanReceipt(req.file.buffer, req.file.mimetype);

    if (!extracted.items?.length) {
      return res.json({
        extracted,
        matches: [],
        checkedOff: [],
        unmatched: [],
        message: 'No items found on the receipt.',
      });
    }

    const shoppingList = await db.getShoppingList(req.householdId);
    const matchResult = await matchReceiptToList(extracted.items, shoppingList);

    // Complete matched items (confidence ≥ 0.7)
    const checkedOff = [];
    for (const match of matchResult.matches || []) {
      if (match.confidence >= 0.7) {
        await db.completeShoppingItemById(match.list_item_id);
        checkedOff.push({ id: match.list_item_id, name: match.list_item_name, confidence: match.confidence });
      }
    }

    return res.json({
      extracted,
      matches: matchResult.matches || [],
      checkedOff,
      unmatched: matchResult.unmatched_receipt_items || [],
      summary: matchResult.summary,
    });
  } catch (err) {
    console.error('POST /api/receipt error:', err);
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
