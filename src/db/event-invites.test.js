/**
 * Party-loop queries: invite links + public RSVPs. The invariants that matter:
 * one link per event (shared twice must not split the roster), the address is
 * withheld from the public payload (revealed only post-RSVP by the route),
 * expired/revoked links die cleanly, RSVPs upsert by family name, and the
 * host rollups count only families who said yes.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const {
  createOrGetEventInviteLink,
  getEventInviteByToken,
  upsertEventRsvp,
  revokeEventInviteLink,
  getEventRsvps,
} = require('./queries');

/**
 * Minimal supabase-shaped fake. Results are queued per `${table}.${op}` and
 * handed out in order; insert/update payloads are captured for assertions.
 */
function fakeDb(queues) {
  const calls = { insert: [], update: [] };
  const next = (key) => {
    const q = queues[key];
    if (!q || !q.length) throw new Error(`fakeDb: unexpected ${key}`);
    return q.shift();
  };
  return {
    calls,
    from(table) {
      const builder = (op) => {
        const resolve = () => Promise.resolve(next(`${table}.${op}`));
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          in: () => chain,
          ilike: () => chain,
          order: () => resolve(),
          limit: () => resolve(),
          single: () => resolve(),
          then: (fn, rej) => resolve().then(fn, rej),
        };
        return chain;
      };
      return {
        select: () => builder('select'),
        insert: (row) => { calls.insert.push({ table, row }); return builder('insert'); },
        update: (row) => { calls.update.push({ table, row }); return builder('update'); },
      };
    },
  };
}

describe('createOrGetEventInviteLink', () => {
  test('returns the existing live link instead of minting a second one', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: [{ id: 'l1', token: 'tok-existing' }] }],
    });
    const link = await createOrGetEventInviteLink(
      { eventId: 'e1', householdId: 'h1', createdBy: 'u1' }, db,
    );
    expect(link.token).toBe('tok-existing');
    expect(db.calls.insert).toHaveLength(0);
  });

  test('creates a link with an unguessable token and event-end + 7d expiry', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: [] }],
      'calendar_events.select': [{ data: { id: 'e1', household_id: 'h1', start_time: '2026-08-01T13:00:00Z', end_time: '2026-08-01T15:00:00Z' } }],
      'event_invite_links.insert': [{ data: { id: 'l2', token: 'whatever' } }],
    });
    await createOrGetEventInviteLink({ eventId: 'e1', householdId: 'h1', createdBy: 'u1' }, db);
    const { row } = db.calls.insert[0];
    expect(row.token.length).toBeGreaterThanOrEqual(20); // 128-bit base64url
    expect(row.expires_at).toBe('2026-08-08T15:00:00.000Z');
    expect(row.created_by).toBe('u1');
  });

  test('rejects an event from a different household', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: [] }],
      'calendar_events.select': [{ data: { id: 'e1', household_id: 'OTHER', end_time: '2026-08-01T15:00:00Z' } }],
    });
    await expect(
      createOrGetEventInviteLink({ eventId: 'e1', householdId: 'h1' }, db),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });
});

describe('getEventInviteByToken', () => {
  const liveLink = { id: 'l1', event_id: 'e1', household_id: 'h1', token: 't', expires_at: '2999-01-01T00:00:00Z', revoked_at: null, view_count: 4, created_by: 'u1' };
  const liveEvent = { id: 'e1', title: "Olivia's 7th Birthday", start_time: '2026-08-01T13:00:00Z', end_time: '2026-08-01T15:00:00Z', all_day: false, location: '12 Oak Lane, Guildford', deleted_at: null };

  test('unknown token → null', async () => {
    const db = fakeDb({ 'event_invite_links.select': [{ data: null, error: { code: 'PGRST116' } }] });
    expect(await getEventInviteByToken('nope', {}, db)).toBeNull();
  });

  test('revoked link → null', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: { ...liveLink, revoked_at: '2026-07-01T00:00:00Z' } }],
    });
    expect(await getEventInviteByToken('t', {}, db)).toBeNull();
  });

  test('expired link → { expired: true }', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: { ...liveLink, expires_at: '2020-01-01T00:00:00Z' } }],
    });
    expect(await getEventInviteByToken('t', {}, db)).toEqual({ expired: true });
  });

  test('deleted event → null', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: liveLink }],
      'calendar_events.select': [{ data: { ...liveEvent, deleted_at: '2026-07-01T00:00:00Z' } }],
    });
    expect(await getEventInviteByToken('t', {}, db)).toBeNull();
  });

  test('live link: address withheld from the event payload, revealed separately; view bumped', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: liveLink }],
      'calendar_events.select': [{ data: liveEvent }],
      'users.select': [{ data: { name: 'Sarah Bennett' } }],
      'event_invite_links.update': [{ data: null }],
    });
    const r = await getEventInviteByToken('t', {}, db);
    expect(r.event.title).toBe("Olivia's 7th Birthday");
    expect(r.event.location).toBeUndefined();
    expect(r.event.hasLocation).toBe(true);
    expect(r.location).toBe('12 Oak Lane, Guildford'); // for the route's post-RSVP reveal only
    expect(r.hostFirstName).toBe('Sarah');
    expect(db.calls.update[0].row).toEqual({ view_count: 5 });
  });

  test('bumpView:false leaves the opens counter alone', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: liveLink }],
      'calendar_events.select': [{ data: liveEvent }],
      'users.select': [{ data: { name: 'Sarah Bennett' } }],
    });
    await getEventInviteByToken('t', { bumpView: false }, db);
    expect(db.calls.update).toHaveLength(0);
  });
});

describe('upsertEventRsvp', () => {
  test('strips markup, clamps counts, inserts a fresh family', async () => {
    const db = fakeDb({
      'event_rsvps.select': [{ data: [] }],
      'event_rsvps.insert': [{ data: { id: 'r1', status: 'yes' } }],
    });
    const { updated } = await upsertEventRsvp({
      inviteLinkId: 'l1',
      familyName: '<b>The Smiths</b>',
      status: 'yes',
      kidsCount: 99,
      adultsCount: -3,
      dietaryNotes: 'Nut allergy <script>x</script>',
    }, db);
    expect(updated).toBe(false);
    const { row } = db.calls.insert[0];
    expect(row.family_name).toBe('The Smiths');
    expect(row.kids_count).toBe(20);
    expect(row.adults_count).toBe(0);
    expect(row.dietary_notes).toBe('Nut allergy x');
  });

  test('same family name (case-insensitive) updates in place', async () => {
    const db = fakeDb({
      'event_rsvps.select': [{ data: [{ id: 'r9', family_name: 'the smiths' }] }],
      'event_rsvps.update': [{ data: { id: 'r9', status: 'no' } }],
    });
    const { updated } = await upsertEventRsvp({
      inviteLinkId: 'l1', familyName: 'The Smiths', status: 'no',
    }, db);
    expect(updated).toBe(true);
    expect(db.calls.update[0].row.status).toBe('no');
    expect(db.calls.update[0].row.updated_at).toBeTruthy();
  });

  test('a name is required', async () => {
    const db = fakeDb({});
    await expect(
      upsertEventRsvp({ inviteLinkId: 'l1', familyName: '  ', status: 'yes' }, db),
    ).rejects.toMatchObject({ code: 'NAME_REQUIRED' });
  });
});

describe('getEventRsvps', () => {
  test('rolls up going/declined, headcounts, and the allergy list from yes-families only', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: [{ id: 'l1', token: 't', expires_at: null, revoked_at: null, view_count: 12 }] }],
      'event_rsvps.select': [{
        data: [
          { family_name: 'The Smiths', status: 'yes', kids_count: 2, adults_count: 1, dietary_notes: 'Nut allergy', user_id: null, created_at: '2026-07-01T10:00:00Z' },
          { family_name: 'The Patels', status: 'yes', kids_count: 1, adults_count: 2, dietary_notes: null, user_id: null, created_at: '2026-07-01T11:00:00Z' },
          { family_name: 'The Joneses', status: 'no', kids_count: 3, adults_count: 2, dietary_notes: 'Vegan', user_id: null, created_at: '2026-07-01T12:00:00Z' },
        ],
      }],
    });
    const r = await getEventRsvps('e1', 'h1', db);
    expect(r).toMatchObject({ hasLink: true, viewCount: 12, going: 2, declined: 1, kids: 3, adults: 3 });
    expect(r.dietary).toEqual([{ family: 'The Smiths', note: 'Nut allergy' }]);
    expect(r.rsvps).toHaveLength(3);
  });

  test('no links (or table not migrated yet) → calm empty shape', async () => {
    const r = await getEventRsvps('e1', 'h1', fakeDb({}));
    expect(r).toEqual({ hasLink: false, going: 0, declined: 0, kids: 0, adults: 0, dietary: [], rsvps: [] });
  });

  test('link rotation keeps the roster: RSVPs merge across revoked links, latest reply per family wins', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{
        data: [
          { id: 'l-old', token: 'old', revoked_at: '2026-07-10T00:00:00Z', view_count: 8 },
          { id: 'l-new', token: 'fresh', revoked_at: null, view_count: 3 },
        ],
      }],
      'event_rsvps.select': [{
        data: [
          // The Smiths said yes on the old link, then no on the new one - one row, the no wins.
          { family_name: 'The Smiths', status: 'yes', kids_count: 2, adults_count: 1, dietary_notes: null, created_at: '2026-07-09T10:00:00Z', updated_at: null },
          { family_name: 'the smiths', status: 'no', kids_count: 0, adults_count: 0, dietary_notes: null, created_at: '2026-07-11T10:00:00Z', updated_at: null },
          { family_name: 'The Patels', status: 'yes', kids_count: 1, adults_count: 2, dietary_notes: null, created_at: '2026-07-09T11:00:00Z', updated_at: null },
        ],
      }],
    });
    const r = await getEventRsvps('e1', 'h1', db);
    expect(r.hasLink).toBe(true);
    expect(r.token).toBe('fresh');       // only the LIVE link is shareable
    expect(r.viewCount).toBe(11);        // opens sum across links
    expect(r.rsvps).toHaveLength(2);     // Smiths deduped
    expect(r).toMatchObject({ going: 1, declined: 1, kids: 1, adults: 2 });
  });

  test('all links revoked → roster survives with hasLink false', async () => {
    const db = fakeDb({
      'event_invite_links.select': [{ data: [{ id: 'l1', token: 't', revoked_at: '2026-07-10T00:00:00Z', view_count: 5 }] }],
      'event_rsvps.select': [{ data: [{ family_name: 'The Patels', status: 'yes', kids_count: 1, adults_count: 2, dietary_notes: null, created_at: '2026-07-09T11:00:00Z', updated_at: null }] }],
    });
    const r = await getEventRsvps('e1', 'h1', db);
    expect(r.hasLink).toBe(false);
    expect(r.token).toBeUndefined();
    expect(r.going).toBe(1);
    expect(r.rsvps).toHaveLength(1);
  });
});

describe('revokeEventInviteLink', () => {
  test('stamps revoked_at on the live link', async () => {
    const db = fakeDb({ 'event_invite_links.update': [{ data: [{ id: 'l1' }] }] });
    expect(await revokeEventInviteLink('e1', 'h1', db)).toBe(true);
    expect(db.calls.update[0].row.revoked_at).toBeTruthy();
  });

  test('no live link (or missing table) → false, never a throw', async () => {
    expect(await revokeEventInviteLink('e1', 'h1', fakeDb({}))).toBe(false);
  });
});
