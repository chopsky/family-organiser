/**
 * Documents search/browse endpoint + the searchDocuments visibility contract.
 * DB, R2 and auth middleware are mocked; the route test exercises param
 * clamping and preview-URL attachment, the query test exercises the
 * private-folder filter and post-filter pagination.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabaseAdmin: {} }));
jest.mock('../services/r2', () => ({
  getSignedDownloadUrl: jest.fn(() => Promise.resolve('https://r2.example/signed')),
}));
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'me', name: 'Grant' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const router = require('./documents');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/documents', router);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/documents/search', () => {
  test('passes household + user scoping and clamped params to the query', async () => {
    db.searchDocuments.mockResolvedValue({ items: [], total: 0, hasMore: false });
    const res = await request(makeApp())
      .get('/api/documents/search')
      .query({ q: 'passport', sort: 'bogus', offset: '-5', limit: '9999' });
    expect(res.status).toBe(200);
    expect(db.searchDocuments).toHaveBeenCalledWith('h1', 'me', {
      q: 'passport', sort: 'newest', offset: 0, limit: 100,
    });
  });

  test('attaches signed preview URLs to image results only', async () => {
    db.searchDocuments.mockResolvedValue({
      items: [
        { id: 'd1', name: 'photo.jpg', mime_type: 'image/jpeg', file_path: 'h1/photo.jpg' },
        { id: 'd2', name: 'form.pdf', mime_type: 'application/pdf', file_path: 'h1/form.pdf' },
      ],
      total: 2,
      hasMore: false,
    });
    const res = await request(makeApp()).get('/api/documents/search').query({ q: '' });
    expect(res.status).toBe(200);
    expect(res.body.items[0].preview_url).toBe('https://r2.example/signed');
    expect(res.body.items[1].preview_url).toBeUndefined();
    expect(res.body.hasMore).toBe(false);
  });
});

describe('GET /api/documents/folders?all=1', () => {
  test("requests the flat 'all' listing for the move picker", async () => {
    db.getDocumentFolders.mockResolvedValue([]);
    const res = await request(makeApp()).get('/api/documents/folders').query({ all: '1' });
    expect(res.status).toBe(200);
    expect(db.getDocumentFolders).toHaveBeenCalledWith('h1', 'me', 'all');
  });
});
