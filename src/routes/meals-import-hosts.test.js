/**
 * Recipe URL import: the hosts we can't read are named, and the user is
 * pointed at the photo importer that does handle them.
 */
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'u1' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));
jest.mock('../db/queries', () => ({}));
jest.mock('../db/client', () => ({ supabaseAdmin: {} }));
jest.mock('../services/ai-client', () => ({ callWithFailover: jest.fn(), LONG_TIMEOUT_MS: 1000 }));
jest.mock('../services/ai', () => ({ parseJSON: jest.fn() }));
jest.mock('../services/cache', () => ({ invalidate: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../services/push', () => ({ sendToHousehold: jest.fn(), sendToUser: jest.fn() }));

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api', require('./meals'));

const post = (url) => request(app).post('/api/recipes/import-url').send({ url });

describe('recipe import from unreadable hosts', () => {
  test.each([
    ['https://www.instagram.com/p/abc123/', 'Instagram'],
    ['https://instagram.com/reel/xyz', 'Instagram'],
    ['https://www.tiktok.com/@cook/video/123', 'TikTok'],
    ['https://www.facebook.com/groups/1/posts/2/', 'Facebook'],
  ])('%s names the host and sends the user to photo import', async (url, name) => {
    const res = await post(url);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(name);
    expect(res.body.error).toMatch(/Import from photo/i);
    expect(res.body.use_photo_import).toBe(true);
  });

  test('a Pinterest pin is told to follow the pin to the source', async () => {
    const res = await post('https://www.pinterest.co.uk/pin/12345/');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Pinterest/);
    expect(res.body.error).toMatch(/original recipe/i);
  });

  test('an ordinary recipe site is NOT blocked by the guard', async () => {
    const res = await post('https://www.bbcgoodfood.com/recipes/lasagne');
    expect(res.body.use_photo_import).toBeUndefined();
    expect(res.body.error || '').not.toMatch(/Import from photo/i);
  });

  test('a malformed URL is not mistaken for a social host', async () => {
    const res = await post('not a url');
    expect(res.body.use_photo_import).toBeUndefined();
  });
});
