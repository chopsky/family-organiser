/**
 * Route tests for the Kids mode big-days endpoint: the countdown list must
 * assemble school holidays (term dates), member birthdays and parent-pinned
 * events, sorted by date, future-only, with pinned events flagged big.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
jest.mock('../services/r2');
jest.mock('../services/push');
jest.mock('../middleware/auth', () => ({
  requireAuth: (req, _res, next) => { req.user = { id: 'me' }; next(); },
  requireHousehold: (req, _res, next) => { req.householdId = 'h1'; next(); },
}));

const express = require('express');
const request = require('supertest');
const db = require('../db/queries');
const r2 = require('../services/r2');
const push = require('../services/push');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/kids', require('./kids'));
  return a;
}

// Dates relative to "today" so the tests don't rot.
const iso = (daysAhead) => {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

beforeEach(() => {
  jest.clearAllMocks();
  db.getHouseholdById.mockResolvedValue({ id: 'h1', timezone: 'Europe/London' });
  db.getHouseholdMembers.mockResolvedValue([]);
  db.getHouseholdSchools.mockResolvedValue([]);
  db.getTermDatesBySchoolIds.mockResolvedValue([]);
  db.getKidsCountdownEvents.mockResolvedValue([]);
  db.getKidNotesForHousehold.mockResolvedValue([]);
  r2.uploadFile.mockResolvedValue();
  r2.deleteFile.mockResolvedValue();
  r2.getSignedDownloadUrl.mockResolvedValue('https://signed.example/note.png');
  push.sendToHousehold.mockResolvedValue({ sent: 1, failed: 0 });
});

describe('GET /api/kids/big-days', () => {
  test('merges pinned events, school holidays and birthdays, sorted by date', async () => {
    db.getKidsCountdownEvents.mockResolvedValue([
      { id: 'e1', title: 'Summer holiday!', start_time: `${iso(40)}T00:00:00Z`, all_day: true, kids_emoji: '🏖️' },
    ]);
    db.getHouseholdSchools.mockResolvedValue([{ id: 's1' }]);
    db.getTermDatesBySchoolIds.mockResolvedValue([
      { event_type: 'half_term_start', date: iso(10), label: 'Half term' },
      { event_type: 'term_start', date: iso(12), label: 'Term starts' }, // back-to-school days count too
      { event_type: 'term_end', date: iso(60), label: null },
    ]);
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'k1', name: 'Logan', birthday: `2018-${iso(20).slice(5)}` },
      { id: 'g1', name: 'Grant', birthday: null },
    ]);

    const res = await request(app()).get('/api/kids/big-days');
    expect(res.status).toBe(200);
    const days = res.body.bigDays;
    expect(days.map((d) => d.title)).toEqual(['Half term', 'Term starts', "Logan's birthday", 'Summer holiday!', 'School holidays!']);
    expect(days.map((d) => d.date)).toEqual([iso(10), iso(12), iso(20), iso(40), iso(60)]);
    // Only the parent-pinned event is a hero candidate.
    expect(days.filter((d) => d.big).map((d) => d.title)).toEqual(['Summer holiday!']);
    // The stored kids_emoji override rides along; term_end falls back to its label default.
    expect(days.find((d) => d.title === 'Summer holiday!').emoji).toBe('🏖️');
    expect(days.find((d) => d.title === "Logan's birthday").emoji).toBe('🎂');
  });

  test('past birthdays roll over to next year and stay inside the window', async () => {
    db.getHouseholdMembers.mockResolvedValue([
      { id: 'k1', name: 'Ella', birthday: `2019-${iso(-30).slice(5)}` }, // a month ago → ~11 months away → outside 180d
      { id: 'k2', name: 'Sam', birthday: `2020-${iso(5).slice(5)}` },
    ]);
    const res = await request(app()).get('/api/kids/big-days');
    expect(res.status).toBe(200);
    expect(res.body.bigDays.map((d) => d.title)).toEqual(["Sam's birthday"]);
  });

  test('degrades to an empty list when the sources fail', async () => {
    db.getHouseholdSchools.mockRejectedValue(new Error('db down'));
    db.getKidsCountdownEvents.mockRejectedValue(new Error('db down'));
    const res = await request(app()).get('/api/kids/big-days');
    expect(res.status).toBe(200);
    expect(res.body.bigDays).toEqual([]);
  });
});

// Kids' daily notes: draw/write once a day; parents react; the reaction
// goes back to the kid. These pin the route contract: PNG-only uploads,
// dependent-only authors, signed URLs on reads, reaction allowlist.
describe('kids notes', () => {
  // Smallest possible valid-magic PNG payload for upload tests.
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);
  const kid = { id: 'k1', name: 'Olivia', member_type: 'dependent' };
  const parent = { id: 'me', name: 'Sarah', member_type: 'account' };

  beforeEach(() => {
    db.getHouseholdMembers.mockResolvedValue([parent, kid]);
    db.getKidNoteForChildDate.mockResolvedValue(null); // no note yet today
    db.createKidNote.mockImplementation(async (hh, childId, date, fields) => ({
      id: 'n1', household_id: hh, child_id: childId, note_date: date, reactions: {}, ...fields,
    }));
  });

  test('GET /notes returns signed image URLs, the child name, and hides the storage key', async () => {
    db.getKidNotesForHousehold.mockResolvedValue([
      { id: 'n1', child_id: 'k1', note_date: '2026-07-06', image_path: 'h1/kid-notes/k1/a.png', text_note: null, reactions: { me: '❤️' } },
      { id: 'n2', child_id: 'k1', note_date: '2026-07-05', image_path: null, text_note: 'hi mum', reactions: {} },
    ]);
    const res = await request(app()).get('/api/kids/notes?limit=5');
    expect(res.status).toBe(200);
    expect(db.getKidNotesForHousehold).toHaveBeenCalledWith('h1', { childId: null, limit: 5 });
    expect(res.body.notes[0].image_url).toBe('https://signed.example/note.png');
    expect(res.body.notes[0].image_path).toBeUndefined();
    expect(res.body.notes[0].child_name).toBe('Olivia');
    expect(res.body.notes[1].image_url).toBeNull();
  });

  test('POST /notes uploads the drawing to R2 and pushes to the whole household', async () => {
    const res = await request(app())
      .post('/api/kids/notes')
      .field('child_id', 'k1')
      .field('text', 'love you')
      .attach('image', png, 'note.png');
    expect(res.status).toBe(201);
    const [key, buf, mime] = r2.uploadFile.mock.calls[0];
    expect(key).toMatch(/^h1\/kid-notes\/k1\/[0-9a-f-]+\.png$/);
    expect(buf.equals(png)).toBe(true);
    expect(mime).toBe('image/png');
    expect(db.createKidNote).toHaveBeenCalledWith('h1', 'k1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), {
      image_path: key,
      text_note: 'love you',
    });
    // excludeUserId null: the kid's device runs on a parent account and
    // that parent should still get the note on their own phone.
    expect(push.sendToHousehold).toHaveBeenCalledWith('h1', null, expect.objectContaining({
      title: '💌 A note from Olivia',
      category: 'family_activity',
    }));
    expect(res.body.note.image_url).toBe('https://signed.example/note.png');
    // Notes live in the Kids' Notes archive, not Documents.
    expect(db.createDocument).not.toHaveBeenCalled();
    // Only the note image is uploaded - no second Documents copy.
    expect(r2.uploadFile).toHaveBeenCalledTimes(1);
  });

  test('POST /notes accepts a text-only note without touching R2', async () => {
    const res = await request(app()).post('/api/kids/notes').field('child_id', 'k1').field('text', 'hi dad');
    expect(res.status).toBe(201);
    expect(r2.uploadFile).not.toHaveBeenCalled();
    expect(db.createKidNote).toHaveBeenCalledWith('h1', 'k1', expect.any(String), { image_path: null, text_note: 'hi dad' });
  });

  test('POST /notes allows only one note per child per day (409 on the second)', async () => {
    db.getKidNoteForChildDate.mockResolvedValue({ id: 'n1', child_id: 'k1' }); // already sent today
    const res = await request(app()).post('/api/kids/notes').field('child_id', 'k1').field('text', 'again');
    expect(res.status).toBe(409);
    expect(db.createKidNote).not.toHaveBeenCalled();
  });

  test('POST /notes races: a duplicate insert surfaces as 409, not a 500', async () => {
    db.createKidNote.mockRejectedValue(Object.assign(new Error('dupe'), { code: 'KID_NOTE_DUPLICATE' }));
    const res = await request(app()).post('/api/kids/notes').field('child_id', 'k1').field('text', 'racy');
    expect(res.status).toBe(409);
  });

  test('POST /notes rejects empty notes, non-PNG files and non-dependent authors', async () => {
    expect((await request(app()).post('/api/kids/notes').field('child_id', 'k1')).status).toBe(400);
    expect((await request(app()).post('/api/kids/notes').field('child_id', 'k1').attach('image', Buffer.from('GIF89a'), 'x.png')).status).toBe(415);
    expect((await request(app()).post('/api/kids/notes').field('child_id', 'me').field('text', 'hi')).status).toBe(404);
    expect(db.createKidNote).not.toHaveBeenCalled();
  });

  test('DELETE /notes/:id removes the note and cleans the drawing out of R2', async () => {
    db.deleteKidNote.mockResolvedValue({ id: 'n1', child_id: 'k1', image_path: 'h1/kid-notes/k1/a.png' });
    const res = await request(app()).delete('/api/kids/notes/n1');
    expect(res.status).toBe(200);
    expect(db.deleteKidNote).toHaveBeenCalledWith('n1', 'h1');
    expect(r2.deleteFile).toHaveBeenCalledWith('h1/kid-notes/k1/a.png');
  });

  test('DELETE /notes/:id: text-only notes skip R2; unknown ids 404', async () => {
    db.deleteKidNote.mockResolvedValue({ id: 'n2', child_id: 'k1', image_path: null });
    expect((await request(app()).delete('/api/kids/notes/n2')).status).toBe(200);
    expect(r2.deleteFile).not.toHaveBeenCalled();

    db.deleteKidNote.mockResolvedValue(null);
    expect((await request(app()).delete('/api/kids/notes/nope')).status).toBe(404);
  });

  test('POST /notes/:id/reactions stores the reacting user and rejects unknown emoji', async () => {
    db.setKidNoteReaction.mockResolvedValue({ id: 'n1', child_id: 'k1', image_path: null, reactions: { me: '🌟' } });
    const res = await request(app()).post('/api/kids/notes/n1/reactions').send({ emoji: '🌟' });
    expect(res.status).toBe(200);
    expect(db.setKidNoteReaction).toHaveBeenCalledWith('n1', 'h1', 'me', '🌟');
    expect(res.body.note.reactions).toEqual({ me: '🌟' });

    expect((await request(app()).post('/api/kids/notes/n1/reactions').send({ emoji: '💩' })).status).toBe(400);
    db.setKidNoteReaction.mockResolvedValue(null);
    expect((await request(app()).post('/api/kids/notes/n1/reactions').send({ emoji: '🌟' })).status).toBe(404);
  });
});
