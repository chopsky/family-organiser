// Prepare a household row for the client: strip the Child Mode PIN hash (never
// leak it) and surface only a derived `child_mode_pin_set` boolean. Used by
// EVERY endpoint that returns a household (auth login, GET /api/household, …) so
// the flag the UI keys off is always present - otherwise a fresh login shows no
// PIN set and asks the user to set it again.
function publicHousehold(row) {
  if (!row) return row;
  const { child_mode_pin_hash, ...rest } = row;
  rest.child_mode_pin_set = !!child_mode_pin_hash;
  return rest;
}

module.exports = { publicHousehold };
