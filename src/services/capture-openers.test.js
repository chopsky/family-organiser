/**
 * Capture-opener picker tests: the eligibility matrix that decides which
 * day 1-3 activation question a household actually gets.
 */
const { pickNextOpener, isEngaged, withinSequenceWindow, MAX_OPENERS } = require('./capture-openers');

const HOUR = 60 * 60 * 1000;
const linkedUser = (over = {}) => ({
  id: 'u1', name: 'Louise Smith',
  whatsapp_linked_at: new Date(Date.now() - 20 * HOUR).toISOString(),
  whatsapp_last_inbound_at: new Date(Date.now() - 20 * HOUR).toISOString(), // pairing message only
  ...over,
});
const child = (name) => ({ id: name, name, member_type: 'dependent', dependent_kind: 'child' });
const pet = (name) => ({ id: name, name, member_type: 'dependent', dependent_kind: 'pet' });

describe('pickNextOpener eligibility', () => {
  test('kids + no school → the school question, personalised, arming the answer path', () => {
    const o = pickNextOpener({ user: linkedUser(), members: [child('Sofia'), child('Max')], schools: [], activities: [], sentKeys: [] });
    expect(o.key).toBe('school');
    expect(o.message).toMatch(/Sofia and Max/);
    expect(o.message).toMatch(/photo, a link.*or the PDF|photo, a link/i);
    expect(o.armsSchoolAnswer).toBe(true);
  });

  test('kids + school set → activities question', () => {
    const o = pickNextOpener({ user: linkedUser(), members: [child('Aarav')], schools: [{ id: 's1' }], activities: [], sentKeys: [] });
    expect(o.key).toBe('activities');
    expect(o.message).toMatch(/Aarav/);
  });

  test('no kids → universal what\'s-on question, no kid words', () => {
    const o = pickNextOpener({ user: linkedUser(), members: [], schools: [], activities: [], sentKeys: [] });
    expect(o.key).toBe('week');
    expect(o.message).not.toMatch(/kids|school/i);
  });

  test('pets are NOT children: pet-only household gets the universal opener', () => {
    const o = pickNextOpener({ user: linkedUser(), members: [pet('Luna')], schools: [], activities: [], sentKeys: [] });
    expect(o.key).toBe('week');
  });

  test('legacy dependents without dependent_kind are excluded from OUTBOUND kid questions', () => {
    const legacy = { id: 'x', name: 'Arthur', member_type: 'dependent' }; // no kind - can't be sure
    const o = pickNextOpener({ user: linkedUser(), members: [legacy], schools: [], activities: [], sentKeys: [] });
    expect(o.key).toBe('week');
  });

  test('pool drains: sent keys are skipped, cap stops the sequence', () => {
    const args = { user: linkedUser(), members: [child('Sofia')], schools: [], activities: [] };
    expect(pickNextOpener({ ...args, sentKeys: ['school'] }).key).toBe('week');
    expect(pickNextOpener({ ...args, sentKeys: ['school', 'week'] }).key).toBe('staples');
    expect(pickNextOpener({ ...args, sentKeys: ['school', 'week', 'staples'] })).toBeNull(); // MAX_OPENERS
    expect(MAX_OPENERS).toBe(3);
  });

  test('tricks nudge only goes to never-engaged users', () => {
    const silent = linkedUser();
    const engaged = linkedUser({ whatsapp_last_inbound_at: new Date(Date.now() - 1 * HOUR).toISOString() });
    // Drain the two universal openers so tricks is next in line.
    const drained = ['week', 'staples'];
    expect(pickNextOpener({ user: silent, members: [], schools: [], activities: [], sentKeys: drained }).key).toBe('tricks');
    expect(pickNextOpener({ user: engaged, members: [], schools: [], activities: [], sentKeys: drained })).toBeNull();
  });

  test('sequence window: nothing after 5 days from linking', () => {
    const old = linkedUser({ whatsapp_linked_at: new Date(Date.now() - 6 * 24 * HOUR).toISOString() });
    expect(pickNextOpener({ user: old, members: [child('Sofia')], schools: [], activities: [], sentKeys: [] })).toBeNull();
    expect(withinSequenceWindow(old)).toBe(false);
  });
});

describe('isEngaged', () => {
  test('the pairing inbound message does not count as engagement', () => {
    const linkedAt = Date.now() - 20 * HOUR;
    expect(isEngaged({
      whatsapp_linked_at: new Date(linkedAt).toISOString(),
      whatsapp_last_inbound_at: new Date(linkedAt + 2 * 60 * 1000).toISOString(), // 2 min after
    })).toBe(false);
  });
  test('a message well after linking does', () => {
    const linkedAt = Date.now() - 20 * HOUR;
    expect(isEngaged({
      whatsapp_linked_at: new Date(linkedAt).toISOString(),
      whatsapp_last_inbound_at: new Date(linkedAt + 3 * HOUR).toISOString(),
    })).toBe(true);
  });
  test('never messaged → not engaged', () => {
    expect(isEngaged({ whatsapp_linked_at: new Date().toISOString(), whatsapp_last_inbound_at: null })).toBe(false);
  });
});
