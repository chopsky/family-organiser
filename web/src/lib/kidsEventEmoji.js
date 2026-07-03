// Kids mode event icons: a stored kids_emoji override wins; otherwise derive
// one deterministically from the event's category/title keywords. Determinism
// matters — the same event must show the same emoji on every render and
// device, which makes this functionally equivalent to storing the derived
// value. Only surfaces in Kids mode.

const RULES = [
  // Specific sports first, so swimming isn't a football.
  [/swim/, '🏊'],
  [/tennis/, '🎾'],
  [/rugby/, '🏉'],
  [/cricket/, '🏏'],
  [/netball|basketball/, '🏀'],
  [/karate|judo|martial|taekwondo/, '🥋'],
  [/bike|cycling|scooter/, '🚲'],
  [/run(ning)?\b|park ?run|athletic/, '🏃'],
  [/football|soccer|gym\b|sport|match|training/, '⚽'],
  [/ballet|dance|recital|gymnastic/, '🩰'],
  [/choir|music|piano|guitar|violin|drum|band|orchestra/, '🎵'],
  [/art|craft|paint|drawing/, '🎨'],
  [/coding|code|robot|lego|chess/, '🤖'],
  [/birthday|bday/, '🎂'],
  [/party/, '🥳'],
  [/dinner|brunch|lunch|breakfast|meal|restaurant|nonna|grandparent|granny|grandma|grandpa/, '🍽️'],
  [/movie|cinema|film/, '🎬'],
  [/holiday|vacation|beach|camp(ing)?\b/, '🏖️'],
  [/trip|travel|flight|airport|train/, '✈️'],
  [/school|homework|read|pack|assembly|parents.? evening|term|inset/, '🎒'],
  [/dentist|doctor|gp\b|hospital|jab|vaccin|optician|orthodont/, '🩺'],
  [/hair|barber/, '💇'],
  [/shop|grocery|supermarket/, '🛒'],
  [/playdate|play date|sleepover|friend/, '🧸'],
  [/scout|cub|beaver|brownie|guide/, '🏕️'],
  [/church|synagogue|mosque|shul|hebrew/, '✨'],
  [/vet|dog|cat|pet/, '🐾'],
];

export function kidsEventEmoji(event) {
  if (event?.kids_emoji) return event.kids_emoji;
  const s = `${event?.title || ''}`.toLowerCase();
  if (event?.category === 'birthday') return '🎂';
  for (const [re, emoji] of RULES) {
    if (re.test(s)) return emoji;
  }
  // Neutral fallback when nothing matches - a generic date marker, not a
  // celebration (🎉 misread as "party" for plain appointments).
  return '🗓️';
}
