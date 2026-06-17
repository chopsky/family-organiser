/**
 * Unit tests for getPublicPromoSummary - the no-auth lookup the signup page
 * uses to confirm a campaign code and show the real discount. The `stripe`
 * SDK is mocked so we drive promotionCodes.list directly.
 */
const mockPromos = { list: jest.fn() };
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  promotionCodes: mockPromos,
})));

const stripeService = require('./stripe');

beforeAll(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_x'; });
beforeEach(() => {
  jest.clearAllMocks();
  stripeService._resetForTests();
});

const future = Math.floor(Date.now() / 1000) + 86400;
const past = Math.floor(Date.now() / 1000) - 86400;

describe('getPublicPromoSummary', () => {
  test('returns the percentage for a live percent-off code', async () => {
    mockPromos.list.mockResolvedValue({
      data: [{ active: true, code: 'HILLELFEST', coupon: { percent_off: 25, valid: true } }],
    });
    const r = await stripeService.getPublicPromoSummary('hillelfest');
    expect(r).toEqual({ valid: true, code: 'HILLELFEST', percentOff: 25, amountOff: null, currency: null });
    // Only ever queries ACTIVE codes from Stripe.
    expect(mockPromos.list).toHaveBeenCalledWith(expect.objectContaining({ active: true, code: 'hillelfest' }));
  });

  test('returns an amount-off code with currency', async () => {
    mockPromos.list.mockResolvedValue({
      data: [{ active: true, code: 'TENOFF', coupon: { amount_off: 1000, currency: 'gbp', valid: true } }],
    });
    const r = await stripeService.getPublicPromoSummary('TENOFF');
    expect(r).toMatchObject({ valid: true, amountOff: 1000, currency: 'gbp', percentOff: null });
  });

  test('unknown code → { valid: false }', async () => {
    mockPromos.list.mockResolvedValue({ data: [] });
    expect(await stripeService.getPublicPromoSummary('NOPE')).toEqual({ valid: false });
  });

  test('empty / missing code short-circuits without calling Stripe', async () => {
    expect(await stripeService.getPublicPromoSummary('')).toEqual({ valid: false });
    expect(mockPromos.list).not.toHaveBeenCalled();
  });

  test('expired promotion code → invalid', async () => {
    mockPromos.list.mockResolvedValue({
      data: [{ active: true, code: 'OLD', expires_at: past, coupon: { percent_off: 25, valid: true } }],
    });
    expect(await stripeService.getPublicPromoSummary('OLD')).toEqual({ valid: false });
  });

  test('redemption cap reached → invalid', async () => {
    mockPromos.list.mockResolvedValue({
      data: [{ active: true, code: 'CAP', max_redemptions: 5, times_redeemed: 5, coupon: { percent_off: 25, valid: true } }],
    });
    expect(await stripeService.getPublicPromoSummary('CAP')).toEqual({ valid: false });
  });

  test('coupon no longer valid → invalid', async () => {
    mockPromos.list.mockResolvedValue({
      data: [{ active: true, code: 'DEAD', expires_at: future, coupon: { percent_off: 25, valid: false } }],
    });
    expect(await stripeService.getPublicPromoSummary('DEAD')).toEqual({ valid: false });
  });
});
