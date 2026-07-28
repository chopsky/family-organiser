/**
 * The night-before offer rides a user's FIRST morning brief.
 *
 * It used to be armed at pairing time in an in-memory Map with a 5-minute TTL.
 * A deploy wiped every pending offer, and five minutes is no time at all to
 * answer a question about tomorrow evening - evening_brief was true for
 * exactly zero users. Now it goes out after the brief they've just read, and
 * the state lives on the user row.
 *
 * The rules worth pinning: once ever, never to someone who already has it on,
 * never on the evening brief itself, and never in a way that can make the
 * brief look like it failed.
 */
jest.mock('../db/queries');
jest.mock('../db/client', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../services/whatsapp', () => ({ sendMessage: jest.fn(async () => ({ sid: 'SM1' })) }));
jest.mock('../bot/handlers', () => ({ EVENING_BRIEF_OFFER_MESSAGE: 'want the night before too?' }));

const db = require('../db/queries');
const whatsapp = require('../services/whatsapp');
const { offerEveningBriefOnce } = require('./reminders');

const MEMBER = { id: 'u1', name: 'Priya', whatsapp_phone: '+447700900000' };

beforeEach(() => {
  jest.clearAllMocks();
  db.getNotificationPreferences.mockResolvedValue(null);
  db.hasEveningBriefOfferBeenSent.mockResolvedValue(false);
  db.stampEveningBriefOfferSent.mockResolvedValue();
});

it('offers after a first morning brief, and records that it asked', async () => {
  await offerEveningBriefOnce(MEMBER, 'morning');

  expect(whatsapp.sendMessage).toHaveBeenCalledWith('+447700900000', 'want the night before too?');
  expect(db.stampEveningBriefOfferSent).toHaveBeenCalledWith('u1');
});

it('never asks twice', async () => {
  db.hasEveningBriefOfferBeenSent.mockResolvedValue(true);

  await offerEveningBriefOnce(MEMBER, 'morning');

  expect(whatsapp.sendMessage).not.toHaveBeenCalled();
});

it('never asks someone who already has the evening brief on', async () => {
  db.getNotificationPreferences.mockResolvedValue({ evening_brief: true });

  await offerEveningBriefOnce(MEMBER, 'morning');

  expect(whatsapp.sendMessage).not.toHaveBeenCalled();
});

it('never rides the evening brief itself', async () => {
  await offerEveningBriefOnce(MEMBER, 'evening');

  expect(whatsapp.sendMessage).not.toHaveBeenCalled();
});

it('does not burn the one chance to ask when the send fails', async () => {
  // Stamp only after a successful send: a Twilio blip must not cost this user
  // the offer permanently.
  whatsapp.sendMessage.mockRejectedValue(new Error('Twilio 500'));
  jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(offerEveningBriefOnce(MEMBER, 'morning')).resolves.toBeUndefined();

  expect(db.stampEveningBriefOfferSent).not.toHaveBeenCalled();
  console.error.mockRestore();
});

it('swallows a failing preferences lookup rather than failing the brief', async () => {
  db.getNotificationPreferences.mockRejectedValue(new Error('supabase down'));
  jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(offerEveningBriefOnce(MEMBER, 'morning')).resolves.toBeUndefined();

  expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  console.error.mockRestore();
});

it('skips a member with no WhatsApp number', async () => {
  await offerEveningBriefOnce({ id: 'u2', name: 'Sam' }, 'morning');

  expect(whatsapp.sendMessage).not.toHaveBeenCalled();
});
