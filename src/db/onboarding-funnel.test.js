/**
 * computeOnboardingFunnel: the pure aggregation behind the admin
 * "Onboarding steps" panel. Reach = distinct devices whose furthest
 * ENTERED spine step is this one or later; skips count separately.
 */
jest.mock('../db/client', () => ({ supabase: {}, supabaseAdmin: {} }));

const { computeOnboardingFunnel } = require('./queries');

const enter = (anon, step) => ({ anon_id: anon, step, action: 'enter' });

test('furthest entered step defines reach, monotonically down the spine', () => {
  const events = [
    // a: got all the way to done
    enter('a', 'pains'), enter('a', 'shape'), enter('a', 'signup'), enter('a', 'done'),
    // b: quit on house (the classic "name your house" abandon)
    enter('b', 'pains'), enter('b', 'plan'), enter('b', 'house'),
    // c: bounced off the first step
    enter('c', 'pains'),
  ];
  const { starts, steps } = computeOnboardingFunnel(events);
  expect(starts).toBe(3);
  const by = Object.fromEntries(steps.map((s) => [s.step, s.reached]));
  expect(by.pains).toBe(3);
  expect(by.house).toBe(2); // a passed it, b died on it, c never got there
  expect(by.signup).toBe(1);
  expect(by.done).toBe(1);
});

test('re-entering earlier steps (back, resume) never lowers reach', () => {
  const events = [
    enter('a', 'pains'), enter('a', 'cals'),
    { anon_id: 'a', step: 'shape', action: 'back' },
    enter('a', 'shape'), enter('a', 'pains'), // walked back, re-shown
  ];
  const { steps } = computeOnboardingFunnel(events);
  expect(steps.find((s) => s.step === 'cals').reached).toBe(1);
});

test('skips are counted per step without affecting reach', () => {
  const events = [
    enter('a', 'pains'), enter('a', 'cals'),
    { anon_id: 'a', step: 'cals', action: 'skip' },
    enter('a', 'ask'),
    { anon_id: 'b', step: 'cals', action: 'skip' }, // skip without enter still counts
  ];
  const { steps } = computeOnboardingFunnel(events);
  const cals = steps.find((s) => s.step === 'cals');
  expect(cals.skipped).toBe(2);
  expect(cals.reached).toBe(1);
});

test('off-spine steps (splash, login, invitecode) and empty input are harmless', () => {
  expect(computeOnboardingFunnel([])).toEqual(expect.objectContaining({ starts: 0 }));
  expect(computeOnboardingFunnel(null).starts).toBe(0);
  const { starts, steps } = computeOnboardingFunnel([
    enter('a', 'splash'), enter('a', 'invitecode'), enter('a', 'login'),
  ]);
  // Opened the app, joined via code or logged in - never on the founder spine.
  expect(starts).toBe(0);
  expect(steps.every((s) => s.reached === 0)).toBe(true);
});
