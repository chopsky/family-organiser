/**
 * Tests for the receipts router: the save-on-scan persistence wiring and the
 * list / detail / reconcile / delete endpoints. The DB layer, AI services and
 * auth middleware are mocked so the test exercises the route logic (correlating
 * matched lines, IDOR-safe 404s, validation) without a real DB or model.
 */
jest.mock('../db/queries', () => ({
  getShoppingList: jest.fn(),
  completeShoppingItemById: jest.fn(),
  createReceiptWithItems: jest.fn(),
  getReceipts: jest.fn(),
  getReceiptById: jest.fn(),
  setReceiptItemMatched: jest.fn(),
  deleteReceipt: jest.fn(),
  setReceiptStatus: jest.fn(),
}));
jest.mock('../services/ai', () => ({ scanReceipt: jest.fn(), matchReceiptToList: jest.fn() }));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1', name: 'Test' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const ai = require('../services/ai');
const router = require('./receipt');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/receipts', router);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/receipts', () => {
  it('returns the household receipts list', async () => {
    db.getReceipts.mockResolvedValue([{ id: 'R1', merchant: 'Tesco' }]);
    const res = await request(makeApp()).get('/api/receipts');
    expect(res.status).toBe(200);
    expect(res.body.receipts).toEqual([{ id: 'R1', merchant: 'Tesco' }]);
    expect(db.getReceipts).toHaveBeenCalledWith('h1');
  });
});

describe('GET /api/receipts/:id', () => {
  it('404s when the receipt is not the household\'s', async () => {
    db.getReceiptById.mockResolvedValue(null);
    const res = await request(makeApp()).get('/api/receipts/R9');
    expect(res.status).toBe(404);
  });

  it('returns the receipt with items', async () => {
    db.getReceiptById.mockResolvedValue({ id: 'R1', items: [{ id: 'I1' }] });
    const res = await request(makeApp()).get('/api/receipts/R1');
    expect(res.status).toBe(200);
    expect(res.body.receipt.items).toHaveLength(1);
    expect(db.getReceiptById).toHaveBeenCalledWith('h1', 'R1');
  });
});

describe('PATCH /api/receipts/:id/items/:itemId', () => {
  it('rejects a non-boolean matched', async () => {
    const res = await request(makeApp()).patch('/api/receipts/R1/items/I1').send({ matched: 'yes' });
    expect(res.status).toBe(400);
    expect(db.setReceiptItemMatched).not.toHaveBeenCalled();
  });

  it('404s when the receipt is not the household\'s', async () => {
    db.setReceiptItemMatched.mockResolvedValue(null);
    const res = await request(makeApp()).patch('/api/receipts/R9/items/I1').send({ matched: true });
    expect(res.status).toBe(404);
  });

  it('reconciles a line and returns the refreshed receipt', async () => {
    db.setReceiptItemMatched.mockResolvedValue({ id: 'R1', matched_count: 1, status: 'review' });
    const res = await request(makeApp())
      .patch('/api/receipts/R1/items/I1')
      .send({ matched: true, matched_list_item_name: 'Milk' });
    expect(res.status).toBe(200);
    expect(res.body.receipt.matched_count).toBe(1);
    expect(db.setReceiptItemMatched).toHaveBeenCalledWith('h1', 'R1', 'I1', {
      matched: true, matched_list_item_id: undefined, matched_list_item_name: 'Milk',
    });
  });
});

describe('DELETE /api/receipts/:id', () => {
  it('deletes and returns success', async () => {
    db.deleteReceipt.mockResolvedValue(undefined);
    const res = await request(makeApp()).delete('/api/receipts/R1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(db.deleteReceipt).toHaveBeenCalledWith('h1', 'R1');
  });
});

describe('PATCH /api/receipts/:id (status)', () => {
  it('rejects an invalid status', async () => {
    const res = await request(makeApp()).patch('/api/receipts/R1').send({ status: 'nope' });
    expect(res.status).toBe(400);
    expect(db.setReceiptStatus).not.toHaveBeenCalled();
  });

  it('files a receipt for records', async () => {
    db.setReceiptStatus.mockResolvedValue({ id: 'R1', status: 'filed' });
    const res = await request(makeApp()).patch('/api/receipts/R1').send({ status: 'filed' });
    expect(res.status).toBe(200);
    expect(res.body.receipt.status).toBe('filed');
    expect(db.setReceiptStatus).toHaveBeenCalledWith('h1', 'R1', 'filed');
  });

  it('404s when the receipt is not the household\'s', async () => {
    db.setReceiptStatus.mockResolvedValue(null);
    const res = await request(makeApp()).patch('/api/receipts/R9').send({ status: 'filed' });
    expect(res.status).toBe(404);
  });
});

describe('parseReceiptDate', () => {
  const p = router.parseReceiptDate;
  it('parses UK day-first numeric dates', () => {
    expect(p('22/05/2025')).toBe('2025-05-22');
    expect(p('22-05-2025')).toBe('2025-05-22');
    expect(p('22.05.2025')).toBe('2025-05-22');
    expect(p('22/05/25')).toBe('2025-05-22');
  });
  it('parses ISO and named-month dates', () => {
    expect(p('2025-05-22')).toBe('2025-05-22');
    expect(p('22 May 2025')).toBe('2025-05-22');
  });
  it('tolerates US month-first when unambiguous', () => {
    expect(p('5/22/2025')).toBe('2025-05-22');
  });
  it('returns null for junk or missing input', () => {
    expect(p('')).toBeNull();
    expect(p(null)).toBeNull();
    expect(p('not a date')).toBeNull();
  });
});

describe('POST /api/receipts (scan persists)', () => {
  it('checks off matches and saves the receipt with per-line matched flags', async () => {
    ai.scanReceipt.mockResolvedValue({
      store_name: 'Tesco',
      date: '2026-06-10',
      total: '£24.85',
      items: [
        { normalised_name: 'milk', original_text: 'TESCO MILK 2PT', price: '£1.20' },
        { normalised_name: 'eggs', original_text: 'FREE RANGE EGGS', price: '£2.00' },
      ],
    });
    db.getShoppingList.mockResolvedValue([{ id: 'L1', name: 'Milk' }]);
    ai.matchReceiptToList.mockResolvedValue({
      matches: [{ receipt_item: 'milk', list_item_id: 'L1', list_item_name: 'Milk', confidence: 0.92 }],
      unmatched_receipt_items: ['eggs'],
      summary: '1 matched',
    });
    db.completeShoppingItemById.mockResolvedValue(undefined);
    db.createReceiptWithItems.mockResolvedValue({ id: 'R1' });

    const res = await request(makeApp())
      .post('/api/receipts')
      .attach('receipt', Buffer.from('fakeimage'), { filename: 'r.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.receiptId).toBe('R1');
    expect(res.body.checkedOff).toEqual([{ id: 'L1', name: 'Milk', confidence: 0.92 }]);
    expect(db.completeShoppingItemById).toHaveBeenCalledWith('L1');

    // Persisted with the matched line flagged + the unmatched one not.
    expect(db.createReceiptWithItems).toHaveBeenCalledTimes(1);
    const [, , payload] = db.createReceiptWithItems.mock.calls[0];
    expect(payload.merchant).toBe('Tesco');
    expect(payload.total_text).toBe('£24.85');
    expect(payload.purchased_on).toBe('2026-06-10');
    expect(payload.items).toHaveLength(2);
    const milk = payload.items.find((i) => i.name === 'milk');
    const eggs = payload.items.find((i) => i.name === 'eggs');
    expect(milk).toMatchObject({ matched: true, matched_list_item_id: 'L1', confidence: 0.92 });
    expect(eggs).toMatchObject({ matched: false, matched_list_item_id: null });
  });

  it('does not persist when no items are extracted', async () => {
    ai.scanReceipt.mockResolvedValue({ items: [] });
    db.getShoppingList.mockResolvedValue([]);
    const res = await request(makeApp())
      .post('/api/receipts')
      .attach('receipt', Buffer.from('x'), { filename: 'r.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(db.createReceiptWithItems).not.toHaveBeenCalled();
  });
});
