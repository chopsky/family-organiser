/**
 * getWhatsAppDeliveryStats: status breakdown + undelivered rate + failed
 * messages resolved to the linked member (the block/churn proxy).
 */
// queries.js creates a Supabase client at load; stub it so the module loads
// without env. The function under test takes its `db` as an argument anyway.
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));
const ROWS = [
  { twilio_sid: 'a', to_phone: '+447700900001', message_type: 'freeform', status: 'delivered', error_code: null, sent_at: '2026-07-20T06:00:00Z' },
  { twilio_sid: 'b', to_phone: '+447700900001', message_type: 'freeform', status: 'delivered', error_code: null, sent_at: '2026-07-20T06:00:01Z' },
  { twilio_sid: 'c', to_phone: '+447700900002', message_type: 'template', status: 'undelivered', error_code: 63024, sent_at: '2026-07-20T06:00:02Z' },
  { twilio_sid: 'd', to_phone: '+447700900003', message_type: 'freeform', status: 'failed', error_code: 63016, sent_at: '2026-07-20T06:00:03Z' },
  { twilio_sid: 'e', to_phone: '+447700900004', message_type: 'freeform', status: 'sent', error_code: null, sent_at: '2026-07-20T06:00:04Z' },
];

function fakeDb() {
  return {
    from(table) {
      if (table === 'whatsapp_delivery_log') {
        const q = { gte: () => q, limit: () => Promise.resolve({ data: ROWS, error: null }) };
        return { select: () => q };
      }
      if (table === 'users') {
        return { select: () => ({ in: () => Promise.resolve({
          data: [
            { name: 'Priya', whatsapp_phone: '+447700900002' },
            { name: 'Sam', whatsapp_phone: '+447700900003' },
          ],
        }) }) };
      }
      throw new Error('unexpected table ' + table);
    },
  };
}

const { getWhatsAppDeliveryStats } = require('./queries');

test('aggregates status, computes undelivered rate, resolves failed→member', async () => {
  const r = await getWhatsAppDeliveryStats({ days: 30 }, fakeDb());
  expect(r.total).toBe(5);
  expect(r.byStatus).toEqual({ delivered: 2, undelivered: 1, failed: 1, sent: 1 });
  // 2 bad of 5 = 40%
  expect(r.undeliveredRate).toBe(40);
  // both bad messages resolved to their linked member, newest first
  expect(r.problems).toHaveLength(2);
  const names = r.problems.map((p) => p.name).sort();
  expect(names).toEqual(['Priya', 'Sam']);
  const priya = r.problems.find((p) => p.name === 'Priya');
  expect(priya.status).toBe('undelivered');
  expect(priya.error_code).toBe(63024);
  expect(priya.phone).toMatch(/…$/); // masked
});

test('missing table degrades to an empty shape, never throws', async () => {
  const brokenDb = { from: () => ({ select: () => ({ gte: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'relation does not exist' } }) }) }) }) };
  const r = await getWhatsAppDeliveryStats({ days: 30 }, brokenDb);
  expect(r).toEqual({ total: 0, byStatus: {}, undeliveredRate: 0, problems: [] });
});
