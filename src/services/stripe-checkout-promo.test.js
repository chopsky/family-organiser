/**
 * Unit tests for campaign-promo pre-apply: getPromotionCodeByString + the
 * createCheckoutSession discounts-vs-allow_promotion_codes branch. Stripe SDK
 * is mocked so we assert the params we send.
 */
const mockPromosList = jest.fn();
const mockSessionsCreate = jest.fn();
const mockPricesList = jest.fn();
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  promotionCodes: { list: mockPromosList },
  checkout: { sessions: { create: mockSessionsCreate } },
  prices: { list: mockPricesList },
})));

const stripeService = require('./stripe');

beforeAll(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_x'; });
beforeEach(() => {
  jest.clearAllMocks();
  stripeService._resetForTests();
  mockPricesList.mockResolvedValue({ data: [{ id: 'price_annual_gbp', lookup_key: 'annual_gbp' }] });
  mockSessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://stripe/checkout' });
});

describe('getPromotionCodeByString', () => {
  test('returns the active promo by code', async () => {
    mockPromosList.mockResolvedValue({ data: [{ id: 'promo_1', code: 'HILLELFEST', active: true }] });
    const r = await stripeService.getPromotionCodeByString('HILLELFEST');
    expect(mockPromosList).toHaveBeenCalledWith({ code: 'HILLELFEST', active: true, limit: 1 });
    expect(r.id).toBe('promo_1');
  });

  test('returns null when none found', async () => {
    mockPromosList.mockResolvedValue({ data: [] });
    expect(await stripeService.getPromotionCodeByString('NOPE')).toBeNull();
  });

  test('returns null and skips Stripe for empty input', async () => {
    expect(await stripeService.getPromotionCodeByString('')).toBeNull();
    expect(mockPromosList).not.toHaveBeenCalled();
  });
});

describe('createCheckoutSession promo pre-apply', () => {
  const base = { plan: 'annual', currency: 'gbp', householdId: 'h1', customerEmail: 'a@b.com', successUrl: 's', cancelUrl: 'c' };

  test('with promoCodeId → discounts set, allow_promotion_codes omitted', async () => {
    await stripeService.createCheckoutSession({ ...base, promoCodeId: 'promo_1' });
    const arg = mockSessionsCreate.mock.calls[0][0];
    expect(arg.discounts).toEqual([{ promotion_code: 'promo_1' }]);
    expect(arg.allow_promotion_codes).toBeUndefined();
  });

  test('without promoCodeId → allow_promotion_codes true, no discounts', async () => {
    await stripeService.createCheckoutSession(base);
    const arg = mockSessionsCreate.mock.calls[0][0];
    expect(arg.allow_promotion_codes).toBe(true);
    expect(arg.discounts).toBeUndefined();
  });
});
