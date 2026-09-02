const { socialLoginRefusal } = require('./social-login-guard');

describe('socialLoginRefusal', () => {
  const base = { user: null, invite: null, intent: 'login', provider: 'apple', email: 'x@privaterelay.appleid.com' };

  test('existing account always logs in', () => {
    expect(socialLoginRefusal({ ...base, user: { id: 'u1' } })).toBeNull();
  });

  test('pending invite still auto-joins from the login screen', () => {
    expect(socialLoginRefusal({ ...base, invite: { id: 'inv1' } })).toBeNull();
  });

  test('sign-up screen keeps creating accounts', () => {
    expect(socialLoginRefusal({ ...base, intent: 'signup' })).toBeNull();
    expect(socialLoginRefusal({ ...base, intent: undefined })).toBeNull();
  });

  test('login screen + unknown Apple relay email -> hidden-email message', () => {
    const msg = socialLoginRefusal(base);
    expect(msg).toMatch(/Apple hid your real email/);
    expect(msg).toMatch(/create a new home/);
    expect(msg).not.toMatch(/—/); // house style: no em dashes in copy
  });

  test('login screen + unknown Google email -> provider-named message', () => {
    const msg = socialLoginRefusal({ ...base, provider: 'google', email: 'someone@gmail.com' });
    expect(msg).toMatch(/No Housemait account uses that Google email/);
    expect(msg).not.toMatch(/—/);
  });

  test('login screen + unknown real Apple email (not relayed) -> generic Apple message', () => {
    const msg = socialLoginRefusal({ ...base, email: 'someone@icloud.com' });
    expect(msg).toMatch(/that Apple email/);
  });
});
