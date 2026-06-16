const dns = require('dns');
jest.mock('dns');
const { isBlockedIp, assertFetchableUrl, safeLookup } = require('./ssrf-guard');

describe('isBlockedIp', () => {
  it('blocks IPv4 loopback / private / link-local / CGNAT / reserved', () => {
    for (const ip of [
      '127.0.0.1', '127.0.0.53', '0.0.0.0',
      '10.0.0.5', '10.255.255.255',
      '172.16.0.1', '172.31.255.255',
      '192.168.0.1', '192.168.1.50',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',      // CGNAT
      '224.0.0.1', '240.0.0.1',
    ]) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it('allows ordinary public IPv4 addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1']) {
      expect(isBlockedIp(ip)).toBe(false);
    }
  });

  it('blocks IPv6 loopback / link-local / unique-local and mapped IPv4', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254']) {
      expect(isBlockedIp(ip)).toBe(true);
    }
  });

  it('allows public IPv6 and mapped public IPv4', () => {
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIp('::ffff:8.8.8.8')).toBe(false);
  });

  it('treats missing / non-IP input as blocked (must be resolved first)', () => {
    expect(isBlockedIp('')).toBe(true);
    expect(isBlockedIp(null)).toBe(true);
    expect(isBlockedIp('not-an-ip')).toBe(true);
  });
});

describe('assertFetchableUrl', () => {
  it('accepts ordinary http(s) URLs', () => {
    expect(() => assertFetchableUrl('https://calendar.google.com/feed.ics')).not.toThrow();
    expect(() => assertFetchableUrl('http://school.example.co.uk/terms.ics')).not.toThrow();
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(/http/i);
    expect(() => assertFetchableUrl('gopher://x/')).toThrow(/http/i);
    expect(() => assertFetchableUrl('ftp://x/')).toThrow(/http/i);
  });

  it('rejects URLs with embedded credentials', () => {
    expect(() => assertFetchableUrl('https://user:pass@evil.example.com/')).toThrow(/credential/i);
  });

  it('rejects literal private / loopback / metadata IPs up front', () => {
    expect(() => assertFetchableUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/private|loopback/i);
    expect(() => assertFetchableUrl('http://127.0.0.1:8080/')).toThrow(/private|loopback/i);
    expect(() => assertFetchableUrl('http://10.0.0.5/')).toThrow(/private|loopback/i);
    expect(() => assertFetchableUrl('http://[::1]/')).toThrow(/private|loopback/i);
  });

  it('rejects malformed URLs', () => {
    expect(() => assertFetchableUrl('not a url')).toThrow(/invalid/i);
  });
});

describe('safeLookup all-option contract', () => {
  afterEach(() => jest.clearAllMocks());

  // Node's autoSelectFamily (Happy-Eyeballs, default-on in Node >= 20) calls
  // the agent's lookup with all:true and expects the full [{address, family}]
  // array. Returning a single address there made Node read addresses[0].address
  // as undefined → "Invalid IP address: undefined", which broke external-feed
  // subscribes to dual-stack hosts (iCloud, Google, Outlook).
  it('returns the full array when called with { all: true }', (done) => {
    dns.lookup.mockImplementation((host, opts, cb) => cb(null, [
      { address: '17.253.144.10', family: 4 },
      { address: '2620:149:af0::10', family: 6 },
    ]));
    safeLookup('p161-caldav.icloud.com', { all: true }, (err, addresses) => {
      expect(err).toBeNull();
      expect(Array.isArray(addresses)).toBe(true);
      expect(addresses).toEqual([
        { address: '17.253.144.10', family: 4 },
        { address: '2620:149:af0::10', family: 6 },
      ]);
      done();
    });
  });

  it('returns a single address + family when all is not requested', (done) => {
    dns.lookup.mockImplementation((host, opts, cb) => cb(null, [{ address: '17.253.144.10', family: 4 }]));
    safeLookup('example.com', {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe('17.253.144.10');
      expect(family).toBe(4);
      done();
    });
  });

  it('still rejects a private resolution even under all:true (no rebinding)', (done) => {
    dns.lookup.mockImplementation((host, opts, cb) => cb(null, [
      { address: '17.253.144.10', family: 4 },
      { address: '10.0.0.5', family: 4 }, // one blocked address poisons the set
    ]));
    safeLookup('rebind.evil', { all: true }, (err, addresses) => {
      expect(err).toBeTruthy();
      expect(err.message).toMatch(/blocked address 10\.0\.0\.5/);
      expect(addresses).toBeUndefined();
      done();
    });
  });

  it('surfaces "no DNS records" for an empty resolution', (done) => {
    dns.lookup.mockImplementation((host, opts, cb) => cb(null, []));
    safeLookup('void.example', { all: true }, (err) => {
      expect(err).toBeTruthy();
      expect(err.message).toMatch(/no DNS records/);
      done();
    });
  });
});
