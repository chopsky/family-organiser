/**
 * Unit tests for the Stripe discount-code builder. The `stripe` SDK is mocked,
 * so we assert the coupon + promotion-code params we send - the logic I can't
 * exercise against the live Stripe account from here.
 */
const mockCoupons = { create: jest.fn() };
const mockPromos = { create: jest.fn() };
const mockPrices = { list: jest.fn() };
jest.mock('stripe', () => jest.fn().mockImplementation(() => ({
  coupons: mockCoupons,
  promotionCodes: mockPromos,
  prices: mockPrices,
})));

const stripeService = require('./stripe');

beforeAll(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_x'; });
beforeEach(() => {
  jest.clearAllMocks();
  stripeService._resetForTests();
  mockCoupons.create.mockResolvedValue({ id: 'coupon_1' });
  mockPromos.create.mockResolvedValue({ id: 'promo_1', code: 'SAVE25' });
  mockPrices.list.mockResolvedValue({ data: [] });
});

describe('createDiscountCode', () => {
  test('percent + once, no plan restriction', async () => {
    const r = await stripeService.createDiscountCode({ code: 'SAVE25', percentOff: 25, duration: 'once', appliesTo: 'any' });
    expect(mockCoupons.create).toHaveBeenCalledWith(expect.objectContaining({ percent_off: 25, duration: 'once', name: 'SAVE25' }));
    expect(mockCoupons.create.mock.calls[0][0].applies_to).toBeUndefined();
    expect(mockPromos.create).toHaveBeenCalledWith(expect.objectContaining({ coupon: 'coupon_1', code: 'SAVE25' }));
    expect(r.restrictedToPlan).toBeNull();
    expect(r.sharedProductWarning).toBe(false);
  });

  test('repeating adds duration_in_months', async () => {
    await stripeService.createDiscountCode({ code: 'X', percentOff: 50, duration: 'repeating', durationInMonths: 3, appliesTo: 'any' });
    expect(mockCoupons.create).toHaveBeenCalledWith(expect.objectContaining({ duration: 'repeating', duration_in_months: 3 }));
  });

  test('max_redemptions + expiry flow through to the promotion code', async () => {
    await stripeService.createDiscountCode({ code: 'X', percentOff: 10, duration: 'once', appliesTo: 'any', maxRedemptions: 100, expiresAt: '2026-12-31T23:59:59Z' });
    const args = mockPromos.create.mock.calls[0][0];
    expect(args.max_redemptions).toBe(100);
    expect(typeof args.expires_at).toBe('number'); // unix seconds
  });

  test('annual-only restricts to the annual product when separable', async () => {
    mockPrices.list
      .mockResolvedValueOnce({ data: [{ product: { id: 'P_ANNUAL' } }] })   // annual lookup
      .mockResolvedValueOnce({ data: [{ product: { id: 'P_MONTHLY' } }] }); // monthly lookup
    const r = await stripeService.createDiscountCode({ code: 'FREEYEAR', percentOff: 100, duration: 'once', appliesTo: 'annual' });
    expect(mockCoupons.create).toHaveBeenCalledWith(expect.objectContaining({ applies_to: { products: ['P_ANNUAL'] } }));
    expect(r.restrictedToPlan).toBe('annual');
    expect(r.sharedProductWarning).toBe(false);
  });

  test('shared annual/monthly product → no restriction + warning', async () => {
    mockPrices.list
      .mockResolvedValueOnce({ data: [{ product: { id: 'P_SHARED' } }] })  // annual
      .mockResolvedValueOnce({ data: [{ product: { id: 'P_SHARED' } }] }); // monthly
    const r = await stripeService.createDiscountCode({ code: 'X', percentOff: 100, duration: 'once', appliesTo: 'annual' });
    expect(mockCoupons.create.mock.calls[0][0].applies_to).toBeUndefined();
    expect(r.sharedProductWarning).toBe(true);
    expect(r.restrictedToPlan).toBeNull();
  });
});
