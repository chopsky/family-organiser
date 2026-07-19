/**
 * Capture openers - the day 1-3 WhatsApp questions that get a new
 * household's real life INTO Housemait.
 *
 * Why this exists (funnel data, 2026-07-19): new signups arrive with EMPTY
 * households - 0 of the last 14 connected a calendar, so every morning brief
 * would read "Nothing scheduled". The activation sequence therefore captures
 * first and briefs second: each opener is one thumb-sized question chosen
 * from a pool by ELIGIBILITY (household state), not a fixed script.
 *
 * Rules:
 *   - One opener per day, max three total, only within ~5 days of linking.
 *   - A kid-flavoured question requires a CONFIRMED child
 *     (dependent_kind === 'child'); outbound messages assume nothing.
 *     Pets never trigger the school question.
 *   - Every opener ends in a question a thumb can answer; the replies route
 *     through existing handlers (school_add flow, classify, photo path).
 *   - The pool drains as the household fills in - adding a kid on day 10
 *     doesn't re-open the window (linked <5 days), but a re-run of the
 *     sequence isn't the goal; the brief takes over once content exists.
 */

// Ordered by value: first eligible unsent opener wins.
const OPENERS = [
  {
    key: 'school',
    // Confirmed children, and no school linked yet anywhere in the household.
    eligible: ({ children, schools }) => children.length > 0 && schools.length === 0,
    compose: ({ children, firstName }) => {
      const kids = children.map((c) => c.name).filter(Boolean);
      const who = kids.length === 1 ? kids[0] : kids.length === 2 ? `${kids[0]} and ${kids[1]}` : 'the kids';
      return `Morning ${firstName}! Quick one while I think of it - which school ${kids.length === 1 ? 'does' : 'do'} ${who} go to?\n\nFor most schools I can pull the term dates and holidays straight onto your family calendar. And if theirs publishes its own, I'll grab them from a photo, a link to their website, or the PDF. 🏫`;
    },
    // The reply is a bare school name - arm the deterministic answer path.
    armsSchoolAnswer: true,
  },
  {
    key: 'activities',
    // School sorted; capture the weekly clubs next.
    eligible: ({ children, schools, activities }) => children.length > 0 && schools.length > 0 && activities.length === 0,
    compose: ({ children, firstName }) => {
      const name = children[0]?.name || 'the kids';
      const doVerb = children.length === 1 ? `Does ${name}` : 'Do the kids';
      return `Morning ${firstName}! ${doVerb} do any regular clubs or activities - football, swimming, dance?\n\nTell me the days and times (e.g. "${name} does football Tuesdays 4:30pm") and I'll put them on the family calendar and mention them in your morning brief on the day. ⚽`;
    },
  },
  {
    key: 'week',
    // Universal - works for every household, kid-neutral by design.
    eligible: () => true,
    compose: ({ firstName }) =>
      `Morning ${firstName}! Let's get your week off your chest and onto your calendar. 📅\n\nWhat's coming up? Appointments, plans, things you mustn't forget - tell me in one message and I'll sort them into the right places.`,
  },
  {
    key: 'staples',
    eligible: () => true,
    compose: ({ firstName }) =>
      `${firstName}, quick one: what's always in your weekly shop? 🛒\n\nTell me once - "milk, bread, eggs, coffee" - and I'll start your shopping list. From then on, just text me whenever something runs out.`,
  },
  {
    key: 'tricks',
    // The still-silent nudge: only for users who've never really messaged.
    eligible: ({ engaged }) => !engaged,
    compose: ({ firstName }) =>
      `${firstName}, a little secret: most families use me without opening the app at all. Three things to try right now:\n\n🛒 Text "milk, eggs, bin bags" - instant shopping list\n🎙️ Send a voice note - "remind me about the MOT next month"\n📸 Snap the school letter on the fridge - dates sorted\n\nTry one - I'm quick, promise. And if you'd rather I didn't message first, just reply "stop".`,
  },
];

const MAX_OPENERS = 3;
const SEQUENCE_WINDOW_DAYS = 5;
// The pairing flow itself produces an inbound message ("Link 482913"), so
// last-inbound within a few minutes of linking is NOT engagement.
const ENGAGEMENT_GRACE_MS = 15 * 60 * 1000;

function isEngaged(user) {
  if (!user?.whatsapp_last_inbound_at || !user?.whatsapp_linked_at) return false;
  const inbound = new Date(user.whatsapp_last_inbound_at).getTime();
  const linked = new Date(user.whatsapp_linked_at).getTime();
  if (!Number.isFinite(inbound) || !Number.isFinite(linked)) return false;
  return inbound - linked > ENGAGEMENT_GRACE_MS;
}

function withinSequenceWindow(user, nowMs = Date.now()) {
  const linked = new Date(user?.whatsapp_linked_at || 0).getTime();
  if (!Number.isFinite(linked) || !linked) return false;
  return nowMs - linked < SEQUENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Pick the next opener for a user, or null.
 *
 * @param {Object} p
 * @param {Object} p.user        users row (whatsapp_* columns present)
 * @param {Array}  p.members     household members
 * @param {Array}  p.schools     household_schools rows
 * @param {Array}  p.activities  weekly activities rows
 * @param {string[]} p.sentKeys  opener keys already sent to this user
 */
function pickNextOpener({ user, members, schools, activities, sentKeys }) {
  if (!withinSequenceWindow(user)) return null;
  const sent = new Set(sentKeys || []);
  if (sent.size >= MAX_OPENERS) return null;

  const children = (members || []).filter(
    // Outbound certainty rule: only explicit children. Legacy rows without
    // dependent_kind (pre-migration) are excluded here even though in-app
    // surfaces treat them as kids - a wrong "which school does the dog go
    // to?" costs more than a skipped question.
    (m) => m.member_type === 'dependent' && m.dependent_kind === 'child'
  );
  const ctx = {
    children,
    schools: schools || [],
    activities: activities || [],
    engaged: isEngaged(user),
    firstName: (user.name || 'there').trim().split(/\s+/)[0] || 'there',
  };
  for (const opener of OPENERS) {
    if (sent.has(opener.key)) continue;
    if (!opener.eligible(ctx)) continue;
    return { key: opener.key, message: opener.compose(ctx), armsSchoolAnswer: !!opener.armsSchoolAnswer };
  }
  return null;
}

module.exports = { pickNextOpener, isEngaged, withinSequenceWindow, OPENERS, MAX_OPENERS };
