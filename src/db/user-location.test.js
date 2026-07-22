/**
 * updateUserLocation persists a member's shared device location for the morning
 * brief, stamping location_updated_at - and tolerates that column being
 * unmigrated (PGRST204) by retrying with just the coords.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const { updateUserLocation } = require('./queries');

function fakeDb(updateResults) {
  const calls = [];
  const q = () => {
    const chain = {
      update(row) { calls.push(row); this._row = row; return chain; },
      eq() { return Promise.resolve(updateResults.shift()); },
    };
    return chain;
  };
  return { calls, from: () => q() };
}

test('writes latitude, longitude and a location_updated_at timestamp', async () => {
  const db = fakeDb([{ error: null }]);
  await updateUserLocation('u1', 51.5, -0.12, db);
  expect(db.calls).toHaveLength(1);
  expect(db.calls[0]).toMatchObject({ latitude: 51.5, longitude: -0.12 });
  expect(db.calls[0].location_updated_at).toBeTruthy();
});

test('retries without the timestamp when the column is unmigrated (PGRST204)', async () => {
  const db = fakeDb([{ error: { code: 'PGRST204' } }, { error: null }]);
  await updateUserLocation('u1', 40, -74, db);
  expect(db.calls).toHaveLength(2);
  expect(db.calls[1]).toEqual({ latitude: 40, longitude: -74 }); // no timestamp on retry
});

test('ignores missing id or non-finite coords', async () => {
  const db = fakeDb([]);
  await updateUserLocation(null, 1, 2, db);
  await updateUserLocation('u1', NaN, 2, db);
  await updateUserLocation('u1', 1, undefined, db);
  expect(db.calls).toHaveLength(0);
});
