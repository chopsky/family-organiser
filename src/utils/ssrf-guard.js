/**
 * SSRF guard for outbound fetches of user-supplied URLs (calendar feeds,
 * school iCal imports). Without this, an authenticated user could point a
 * "feed URL" at internal-only targets - cloud metadata (169.254.169.254),
 * localhost, or RFC1918 hosts - and have our server fetch them.
 *
 * The core defence is `safeLookup`: a DNS lookup that refuses to resolve to a
 * private/loopback/link-local/reserved address. Passed as the `lookup` option
 * to an http(s).Agent, it runs for EVERY connection - including redirect hops -
 * so it also closes DNS-rebinding (we connect to the exact IP we validated).
 */

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

/**
 * True when an IP literal is in a range we must never fetch from. Covers the
 * IPv4 private/loopback/link-local/CGNAT/reserved blocks and the IPv6
 * loopback/link-local/unique-local blocks (incl. IPv4-mapped IPv6).
 */
function isBlockedIp(ip) {
  if (!ip) return true;
  let addr = ip;
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) addr = mapped[1];

  const family = net.isIP(addr);
  if (family === 4) {
    const [a, b] = addr.split('.').map(Number);
    if (a === 0) return true;                       // 0.0.0.0/8 "this host"
    if (a === 10) return true;                      // 10.0.0.0/8
    if (a === 127) return true;                     // loopback
    if (a === 169 && b === 254) return true;        // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;        // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                      // 224.0.0.0/4 multicast + 240/4 reserved
    return false;
  }
  if (family === 6) {
    const lower = addr.toLowerCase();
    if (lower === '::1' || lower === '::') return true;     // loopback / unspecified
    if (lower.startsWith('fe8') || lower.startsWith('fe9')
      || lower.startsWith('fea') || lower.startsWith('feb')) return true; // fe80::/10 link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;    // fc00::/7 unique-local
    return false;
  }
  // Not a parseable IP literal - caller must resolve via safeLookup first.
  return true;
}

/**
 * Drop-in replacement for dns.lookup that rejects private targets. Validates
 * ALL resolved addresses, then connects to the first - so a hostname that
 * resolves to any blocked IP is refused, and there's no resolve-public /
 * connect-private rebinding window.
 */
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses || addresses.length === 0) {
      return callback(new Error(`SSRF guard: no DNS records for ${hostname}`));
    }
    for (const a of addresses) {
      if (isBlockedIp(a.address)) {
        return callback(new Error(`SSRF guard: ${hostname} resolves to blocked address ${a.address}`));
      }
    }
    const chosen = addresses[0];
    callback(null, chosen.address, chosen.family);
  });
}

/** Fresh http/https agents whose connections are validated by safeLookup. */
function ssrfSafeAgents() {
  return {
    httpAgent: new http.Agent({ lookup: safeLookup }),
    httpsAgent: new https.Agent({ lookup: safeLookup }),
  };
}

/**
 * Validate a URL before fetching: http(s) only, no embedded credentials, and
 * reject a literal private IP up front. Returns the parsed URL or throws.
 * (Hostname-based targets are caught at connect time by safeLookup.)
 */
function assertFetchableUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are allowed');
  }
  if (u.username || u.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }
  // Strip the brackets WHATWG keeps on IPv6 hostnames (e.g. "[::1]") so the
  // literal-IP check sees a parseable address. Literal IPs matter here because
  // Node's net.connect skips the agent's custom lookup for IP-literal hosts.
  const host = u.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (net.isIP(host) && isBlockedIp(host)) {
    throw new Error('Refusing to fetch a private/loopback address');
  }
  return u;
}

module.exports = { isBlockedIp, safeLookup, ssrfSafeAgents, assertFetchableUrl };
