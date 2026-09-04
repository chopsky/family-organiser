/**
 * Feedback channels - the vocabulary shared by the delete-account modal,
 * the day-3 "what made you sign up?" email and the weekly digest.
 *
 * Keys are what gets stored; labels are what the person saw. The web
 * duplicates the labels (web/src/lib/feedbackReasons.js) because it renders
 * them before any request is made - keep the two lists in step.
 *
 * One-tap email answers ride on a signed JWT, the same mechanism as the
 * unsubscribe link (services/unsubscribe-token.js) and signed with the same
 * secret under a different audience, so a pasted unsubscribe token can't
 * record an answer and vice versa.
 */

const jwt = require('jsonwebtoken');

const SIGNUP_REASONS = {
  calendar:   'The shared family calendar',
  whatsapp:   'The WhatsApp assistant',
  term_dates: 'School term dates',
  meals:      'Meal planning',
  kids:       'Chores, stars and kids mode',
};

const EXIT_REASONS = {
  not_what_hoped:    "It didn't do what I hoped",
  too_much_setup:    'Too much effort to set up',
  family_didnt_join: "The rest of the family didn't use it",
  forgot:            'I forgot it was there',
  found_better:      'I found something else that worked better',
  other:             'Something else',
};

const TOKEN_SECRET = process.env.UNSUBSCRIBE_TOKEN_SECRET;
const ISSUER = 'housemait';
const AUDIENCE = 'feedback';
const EXPIRY = '60d';

function requireSecret() {
  if (!TOKEN_SECRET) {
    throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not set - cannot sign feedback links.');
  }
}

function signAnswerToken(userId, householdId) {
  requireSecret();
  if (!userId) throw new Error('user id is required');
  return jwt.sign({ uid: userId, hid: householdId || null }, TOKEN_SECRET, {
    issuer: ISSUER, audience: AUDIENCE, expiresIn: EXPIRY,
  });
}

function verifyAnswerToken(token) {
  requireSecret();
  if (!token) throw new Error('token is required');
  const payload = jwt.verify(token, TOKEN_SECRET, { issuer: ISSUER, audience: AUDIENCE });
  if (!payload.uid) throw new Error('token payload is missing user id');
  return { userId: payload.uid, householdId: payload.hid || null };
}

/** The one-tap links for the day-3 email: [{ key, label, url }]. */
function signupReasonLinks(userId, householdId, apiUrl) {
  const base = apiUrl || process.env.API_URL || process.env.WEB_URL || 'http://localhost:3000';
  const token = encodeURIComponent(signAnswerToken(userId, householdId));
  return Object.entries(SIGNUP_REASONS).map(([key, label]) => ({
    key, label, url: `${base}/api/feedback/why?token=${token}&a=${key}`,
  }));
}

module.exports = { SIGNUP_REASONS, EXIT_REASONS, signAnswerToken, verifyAnswerToken, signupReasonLinks };
