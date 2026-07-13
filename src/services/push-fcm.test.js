/**
 * FCM (Android) delivery path in push.js: platform routing, message shape,
 * data stringification, and dead-token pruning. The module reads env at
 * require time, so FIREBASE_SERVICE_ACCOUNT is set (with a real throwaway
 * RSA key - the OAuth JWT is genuinely signed) before push.js loads; the
 * network layer is a mocked global fetch.
 */
jest.mock('../db/queries', () => ({
  unregisterDeviceToken: jest.fn(() => Promise.resolve()),
  getActiveDeviceTokens: jest.fn(),
  getNotificationPreferences: jest.fn(() => Promise.resolve(null)),
  getHouseholdDeviceTokens: jest.fn(),
}));

const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'housemait-test',
  client_email: 'fcm-test@housemait-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
});
delete process.env.APN_KEY_ID; // APNs stays unconfigured in this suite

const db = require('../db/queries');
const push = require('./push');

function mockFetch(fcmResponses) {
  let call = 0;
  global.fetch = jest.fn(async (url) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: true, json: async () => ({ access_token: 'test-access-token' }) };
    }
    const r = fcmResponses[Math.min(call++, fcmResponses.length - 1)];
    return { ok: r.ok, status: r.status || (r.ok ? 200 : 500), text: async () => r.text || '', json: async () => ({}) };
  });
}

beforeEach(() => jest.clearAllMocks());

describe('FCM delivery', () => {
  test('android tokens route via FCM; iOS tokens fail gracefully with APNs unconfigured', async () => {
    mockFetch([{ ok: true }]);
    const res = await push.sendPushNotification(
      [{ token: 'android-tok-1', platform: 'android' }, { token: 'ios-tok-1', platform: 'ios' }],
      { title: 'Hi', body: 'There' },
    );
    expect(res).toEqual({ sent: 1, failed: 1 }); // android sent, ios has no APNs here
    const sendCall = global.fetch.mock.calls.find(([u]) => String(u).includes('fcm.googleapis.com'));
    expect(sendCall[0]).toBe('https://fcm.googleapis.com/v1/projects/housemait-test/messages:send');
    const { message } = JSON.parse(sendCall[1].body);
    expect(message.token).toBe('android-tok-1');
    expect(message.notification).toEqual({ title: 'Hi', body: 'There' });
    expect(message.android.priority).toBe('HIGH');
  });

  test('data payload values are stringified (FCM rejects non-strings)', async () => {
    mockFetch([{ ok: true }]);
    await push.sendPushNotification(
      [{ token: 'android-tok-1', platform: 'android' }],
      { title: 'T', body: 'B', data: { count: 3, kind: 'note', meta: { a: 1 } } },
    );
    const sendCall = global.fetch.mock.calls.find(([u]) => String(u).includes('fcm.googleapis.com'));
    const { message } = JSON.parse(sendCall[1].body);
    expect(message.data).toEqual({ count: '3', kind: 'note', meta: '{"a":1}' });
  });

  test('UNREGISTERED responses prune the dead token', async () => {
    mockFetch([{ ok: false, status: 404, text: '{"error":{"status":"UNREGISTERED"}}' }]);
    const res = await push.sendPushNotification(
      [{ token: 'gone-token', platform: 'android' }],
      { title: 'T', body: 'B' },
    );
    expect(res).toEqual({ sent: 0, failed: 1 });
    expect(db.unregisterDeviceToken).toHaveBeenCalledWith('gone-token');
  });

  test('sendToUser passes platform through from device_tokens rows', async () => {
    mockFetch([{ ok: true }]);
    db.getActiveDeviceTokens.mockResolvedValue([
      { token: 'android-tok-9', platform: 'android' },
    ]);
    const res = await push.sendToUser('u1', { title: 'T', body: 'B' });
    expect(res.sent).toBe(1);
    const sendCall = global.fetch.mock.calls.find(([u]) => String(u).includes('fcm.googleapis.com'));
    expect(JSON.parse(sendCall[1].body).message.token).toBe('android-tok-9');
  });

  test('legacy bare-string tokens still behave as iOS (backward compat)', async () => {
    mockFetch([{ ok: true }]);
    const res = await push.sendPushNotification(['bare-ios-token'], { title: 'T', body: 'B' });
    // APNs unconfigured in this suite → counted failed, and FCM never touched.
    expect(res).toEqual({ sent: 0, failed: 1 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
