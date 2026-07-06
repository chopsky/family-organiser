/**
 * Kids mode endpoints.
 *
 * GET /api/kids/big-days — the "counting down to…" list for the kids'
 * calendar (My Days). Sourced from real household data, per the Kids design
 * spec's production notes:
 *   - school holidays from the imported term dates (term_end = holidays
 *     start, half_term_start, bank_holiday)
 *   - member birthdays (users.birthday → next occurrence)
 *   - events a parent pinned with the kids_countdown toggle
 * Pinned events are flagged `big` (they win the hero slot); otherwise the
 * client uses the nearest future day. Everything is capped to the next
 * ~180 days so September holidays don't crowd out next week's sports day.
 */
const { Router } = require('express');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db/queries');
const r2 = require('../services/r2');
const push = require('../services/push');
const { requireAuth, requireHousehold } = require('../middleware/auth');

const router = Router();

const WINDOW_DAYS = 180;
const ymd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// Next occurrence (this year or next) of a birthday, as YYYY-MM-DD.
function nextBirthday(birthday, todayStr) {
  const m = String(birthday || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(todayStr.slice(0, 4));
  const thisYear = `${year}-${m[1]}-${m[2]}`;
  return thisYear >= todayStr ? thisYear : `${year + 1}-${m[1]}-${m[2]}`;
}

// All school-sourced big days carry the school emoji - a "School Closed"
// day isn't a celebration, and 🎉 is reserved for actual celebrations.
// Every imported term-date type is a day kids count down to: holidays
// starting (term_end / half_term_start), days off (bank_holiday /
// inset_day) AND going back to school (term_start / half_term_end).
const HOLIDAY_TYPES = {
  term_start: { emoji: '🏫', fallback: 'Back to school!' },
  term_end: { emoji: '🏫', fallback: 'School holidays!' },
  half_term_start: { emoji: '🏫', fallback: 'Half term!' },
  half_term_end: { emoji: '🏫', fallback: 'Back to school!' },
  inset_day: { emoji: '🏫', fallback: 'Day off school!' },
  bank_holiday: { emoji: '🏫', fallback: 'Day off school!' },
};

router.get('/big-days', requireAuth, requireHousehold, async (req, res) => {
  try {
    let tz = 'Europe/London';
    try { tz = (await db.getHouseholdById(req.householdId))?.timezone || tz; } catch { /* default */ }
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const horizon = new Date(`${todayStr}T00:00:00`);
    horizon.setDate(horizon.getDate() + WINDOW_DAYS);
    const horizonStr = ymd(horizon);

    const [members, schools, pinned] = await Promise.all([
      db.getHouseholdMembers(req.householdId),
      db.getHouseholdSchools(req.householdId).catch(() => []),
      db.getKidsCountdownEvents(req.householdId, `${todayStr}T00:00:00Z`).catch(() => []),
    ]);
    const termDates = schools.length
      ? await db.getTermDatesBySchoolIds(schools.map((s) => s.id)).catch(() => [])
      : [];

    const days = [];

    // Parent-pinned countdown events — always hero candidates.
    for (const e of pinned) {
      const date = String(e.start_time).slice(0, 10);
      if (date > horizonStr) continue;
      days.push({ date, emoji: e.kids_emoji || null, title: e.title, big: true, source: 'pinned' });
    }

    // School holidays from the term-dates import.
    for (const t of termDates) {
      const kind = HOLIDAY_TYPES[t.event_type];
      if (!kind) continue;
      if (!t.date || t.date < todayStr || t.date > horizonStr) continue;
      days.push({ date: t.date, emoji: kind.emoji, title: t.label || kind.fallback, big: false, source: 'school' });
    }

    // Member birthdays.
    for (const m of members) {
      const date = nextBirthday(m.birthday, todayStr);
      if (!date || date > horizonStr) continue;
      days.push({ date, emoji: '🎂', title: `${m.name}'s birthday`, big: false, source: 'birthday' });
    }

    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return res.json({ today: todayStr, bigDays: days.slice(0, 12) });
  } catch (err) {
    console.error('GET /api/kids/big-days error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Kids' daily notes — once a day a child draws/writes a note for their
// parents. One note per (child, day); re-sending replaces it and clears
// reactions. Parents react with an emoji (POST /notes/:id/reactions) and
// the kid sees the reactions on their "sent" screen - closing that loop
// is the feature. Child Mode devices run on a parent's auth token, so
// requireAuth+requireHousehold cover both directions.
// ---------------------------------------------------------------------------

// Canvas PNGs from a phone-sized drawing area are well under 1 MB;
// 5 MB leaves room for high-DPI tablets without inviting abuse.
const noteUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const REACTION_EMOJI = ['❤️', '😍', '🌟', '😂', '🥰', '👏'];

// The drawing comes straight off our own <canvas> as image/png, so the
// guard is a magic-byte check rather than the full attachment allowlist.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function householdChild(householdId, childId) {
  const members = await db.getHouseholdMembers(householdId);
  return members.find((m) => m.id === childId && m.member_type === 'dependent') || null;
}

async function noteWithUrl(note) {
  return {
    ...note,
    image_url: note.image_path ? await r2.getSignedDownloadUrl(note.image_path).catch(() => null) : null,
    image_path: undefined,
  };
}

// GET /api/kids/notes?child_id=&limit= — newest first for the household
// (dashboard card), or one child's archive (Kids Mode sent state).
router.get('/notes', requireAuth, requireHousehold, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 60);
    const childId = req.query.child_id || null;
    const notes = await db.getKidNotesForHousehold(req.householdId, { childId, limit });
    return res.json({ notes: await Promise.all(notes.map(noteWithUrl)) });
  } catch (err) {
    console.error('GET /api/kids/notes error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kids/notes — multipart: optional `image` (PNG drawing) +
// child_id + optional text. Needs at least one of drawing/text.
router.post('/notes', requireAuth, requireHousehold, noteUpload.single('image'), async (req, res) => {
  try {
    const { child_id } = req.body || {};
    const text = String(req.body?.text || '').trim().slice(0, 500) || null;
    if (!child_id) return res.status(400).json({ error: 'child_id is required' });
    if (!req.file && !text) return res.status(400).json({ error: 'A drawing or a message is required' });
    if (req.file && !req.file.buffer.subarray(0, 4).equals(PNG_MAGIC)) {
      return res.status(415).json({ error: 'The drawing must be a PNG image' });
    }

    const child = await householdChild(req.householdId, child_id);
    if (!child) return res.status(404).json({ error: 'Child not found' });

    let tz = 'Europe/London';
    try { tz = (await db.getHouseholdById(req.householdId))?.timezone || tz; } catch { /* default */ }
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    let imagePath = null;
    if (req.file) {
      imagePath = `${req.householdId}/kid-notes/${child_id}/${crypto.randomUUID()}.png`;
      await r2.uploadFile(imagePath, req.file.buffer, 'image/png');
    }

    const note = await db.upsertKidNote(req.householdId, child_id, todayStr, {
      image_path: imagePath,
      text_note: text,
    });

    // Everyone's devices, sender included - the "sender" here is whichever
    // parent account the kid's device is signed into, and that parent
    // still wants the note on their own phone.
    push.sendToHousehold(req.householdId, null, {
      title: `💌 A note from ${child.name}`,
      body: text || 'They drew you a picture. Come and see!',
      data: { type: 'kid_note', noteId: note.id },
      category: 'family_activity',
    }).catch(() => {});

    return res.status(201).json({ note: await noteWithUrl(note) });
  } catch (err) {
    console.error('POST /api/kids/notes error:', err);
    return res.status(500).json({ error: 'Could not send the note.' });
  }
});

// POST /api/kids/notes/:id/reactions {emoji} — one per reacting user;
// reacting again swaps the emoji.
router.post('/notes/:id/reactions', requireAuth, requireHousehold, async (req, res) => {
  try {
    const emoji = String(req.body?.emoji || '');
    if (!REACTION_EMOJI.includes(emoji)) return res.status(400).json({ error: 'Unknown reaction' });
    const note = await db.setKidNoteReaction(req.params.id, req.householdId, req.user.id, emoji);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    return res.json({ note: await noteWithUrl(note) });
  } catch (err) {
    console.error('POST /api/kids/notes/:id/reactions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
