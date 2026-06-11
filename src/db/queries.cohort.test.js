/**
 * Unit tests for the channel-cohort classification + conversion/retention math
 * (computeChannelCohorts). Pure function, so we only stub ./client to let
 * queries.js import.
 */
jest.mock('./client', () => ({ supabaseAdmin: {}, supabase: {} }));

const { computeChannelCohorts } = require('./queries');

describe('computeChannelCohorts', () => {
  test('classifies households and computes conversion + retention per cohort', () => {
    const households = [
      { id: 'A', subscription_status: 'active' },    // app
      { id: 'B', subscription_status: 'expired' },   // whatsapp only
      { id: 'C', subscription_status: 'active' },     // whatsapp only
      { id: 'D', subscription_status: 'trialing' },   // web only
      { id: 'E', subscription_status: 'cancelled' },  // app
    ];
    const members = [
      { id: 'u1', household_id: 'A', whatsapp_linked: true },  // app household also uses WhatsApp
      { id: 'u2', household_id: 'B', whatsapp_linked: true },
      { id: 'u3', household_id: 'C', whatsapp_linked: true },
      { id: 'u4', household_id: 'D', whatsapp_linked: false },
      { id: 'u5', household_id: 'E', whatsapp_linked: false },
    ];
    const appUserIds = new Set(['u1', 'u5']); // households A and E installed the app

    const c = computeChannelCohorts({ households, members, appUserIds });

    expect(c.app.total).toBe(2);
    expect(c.whatsapp_only.total).toBe(2);
    expect(c.web_only.total).toBe(1);

    // app: A active + E cancelled → conversion 1/2, retention 1/2
    expect(c.app.active).toBe(1);
    expect(c.app.cancelled).toBe(1);
    expect(c.app.conversionPct).toBe(50);
    expect(c.app.retentionPct).toBe(50);

    // whatsapp_only: B expired + C active → conversion 1/2, retention 1/1
    expect(c.whatsapp_only.active).toBe(1);
    expect(c.whatsapp_only.expired).toBe(1);
    expect(c.whatsapp_only.conversionPct).toBe(50);
    expect(c.whatsapp_only.retentionPct).toBe(100);

    // web_only: only D (trialing) → nothing resolved → null rates
    expect(c.web_only.trialing).toBe(1);
    expect(c.web_only.resolved).toBe(0);
    expect(c.web_only.conversionPct).toBeNull();
    expect(c.web_only.retentionPct).toBeNull();
  });

  test('app classification wins even when the household also uses WhatsApp', () => {
    const c = computeChannelCohorts({
      households: [{ id: 'A', subscription_status: 'active' }],
      members: [{ id: 'u1', household_id: 'A', whatsapp_linked: true }],
      appUserIds: new Set(['u1']),
    });
    expect(c.app.total).toBe(1);
    expect(c.whatsapp_only.total).toBe(0);
  });

  test('handles empty input without dividing by zero', () => {
    const c = computeChannelCohorts({ households: [], members: [], appUserIds: new Set() });
    expect(c.app.total).toBe(0);
    expect(c.whatsapp_only.conversionPct).toBeNull();
    expect(c.web_only.retentionPct).toBeNull();
  });

  test('accepts a plain array for appUserIds', () => {
    const c = computeChannelCohorts({
      households: [{ id: 'A', subscription_status: 'active' }],
      members: [{ id: 'u1', household_id: 'A', whatsapp_linked: false }],
      appUserIds: ['u1'],
    });
    expect(c.app.total).toBe(1);
  });
});
