/**
 * School term-date extraction — shared service.
 *
 * Lifted out of src/routes/schools.js so it can be reused outside the routes
 * layer (the WhatsApp bot imports term dates from a pasted/uploaded calendar
 * via the same extractor). Behaviour is unchanged; schools.js now imports
 * these from here.
 *
 * Depends only on services (ai-client, termDateValidator) — no route/express
 * coupling.
 */

const tls = require('node:tls');
const https = require('node:https');
const http = require('node:http');
const pdfParse = require('pdf-parse');
const { callWithFailover, REASONING_TIMEOUT_MS } = require('./ai-client');
const { validateTermDates } = require('./termDateValidator');
const { assertFetchableUrl } = require('../utils/ssrf-guard');

const VALID_EVENT_TYPES = new Set([
  'term_start', 'term_end',
  'half_term_start', 'half_term_end',
  'inset_day', 'bank_holiday',
]);

// Headers for fetching term-date pages. Councils and schools routinely sit
// behind WAFs (Cloudflare etc.) that 403 anything advertising itself as a bot,
// so we present as a normal browser. (e.g. leicestershire.gov.uk: 403 to a
// "SchoolDatesBot" UA, 200 to this one.) Shared by the LA import and the
// website/PDF import so both behave the same.
// A full "real Chrome navigation" header set, not just a UA. Councils behind
// the lighter WAF rules (block on missing Sec-Fetch-*/sec-ch-ua, not just UA)
// let these through where a bare UA gets a 403. We deliberately do NOT set
// Accept-Encoding: undici then stops auto-decompressing and response.text()
// would return raw gzip/br bytes.
const TERM_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': '"Google Chrome";v="126", "Chromium";v="126", "Not?A_Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'Cache-Control': 'max-age=0',
};

// Bot-protection (WAF) challenge pages return HTTP 200 with a tiny body that is
// the challenge, not the content - so they slip past the !response.ok check and
// get mis-reported downstream as "JS-rendered / scanned". Detect the common
// ones (Incapsula/Imperva, Cloudflare, Akamai) so the caller gets an accurate
// "blocked by bot protection" reason instead.
const WAF_MARKERS = [
  'Incapsula incident',
  'Request unsuccessful',
  '_Incapsula_Resource',
  'Attention Required! | Cloudflare',
  'cf-browser-verification',
  'Just a moment...',
  'Checking your browser before',
  'Please enable JavaScript and cookies',
  'Access Denied',
  'Reference #', // Akama-style "Access Denied / Reference #..."
];
function looksLikeWafChallenge(rawHtml) {
  if (!rawHtml) return false;
  const head = rawHtml.slice(0, 4000);
  return WAF_MARKERS.some((m) => head.includes(m)) && rawHtml.length < 6000;
}

/**
 * Shared AI extractor used by /import-website/preview, /import-pdf/preview, and
 * the WhatsApp bot. Takes already-extracted plain text (HTML strip / pdfParse /
 * document-extract), runs the country-aware AI prompt, parses the lenient JSON,
 * normalises, validates, and returns the shape the preview UI expects:
 *   { ok, status, body: { dates: [...], source_url, source_text_preview } }
 */
async function extractTermDatesPreview({ pageText, country, currentAY, nextAY, householdId, userId, sourceLabel }) {
  if (!pageText || pageText.length < 50) {
    return {
      ok: false,
      status: 400,
      body: { error: 'The source has very little text content. The PDF might be a scanned image, or the page might be JavaScript-rendered. Try downloading the term-dates PDF and uploading it directly.' },
    };
  }

  const promptByCountry = {
    ZA: {
      intro: `You are an expert at extracting South African school term dates from website or PDF content. South African schools run on the calendar year (January–December) with four terms. From 2026, a unified national calendar applies to every public school. Extract ALL term dates you can find - for both ${currentAY} and ${nextAY} if available.

The source may label terms as "Term 1", "Term 2" or as "FIRST TERM", "SECOND TERM", "THIRD TERM", "FOURTH TERM" - treat both labelings identically.

CRITICAL: South African schools do NOT have "half-terms" (that's UK terminology). DO NOT emit half_term_start or half_term_end events. South Africa's school year is four discrete terms with breaks BETWEEN terms, not WITHIN them. Anything labelled as a "break" inside a term is either (a) a named religious / public holiday, or (b) a brief multi-day school closure - both go in as bank_holiday with end_date if multi-day.

Use only these event_types for SA:
• term_start, term_end - for term boundaries
• bank_holiday - for everything else: public holidays, religious holidays (Chanukah, Pesach, Rosh Hashanah, Yom Kippur, Sukkot, Shavuot, etc.), any "BREAK" inside a term. Use end_date for multi-day entries.`,
      lookFor: [
        'Dates in any common format ("3 January 2026", "03/01/2026", "2026-01-03")',
        'Term boundaries - when "FIRST TERM" / "TERM 1" says e.g. "Wednesday 14 January - Friday 27 March", emit one term_start and one term_end',
        'Named religious holidays (Chanukah, Pesach, Rosh Hashanah, Yom Kippur, Sukkot, Shavuot, etc.) → bank_holiday, with end_date if multi-day',
        'South African public holidays (Human Rights Day, Freedom Day, Workers Day, Youth Day, Heritage Day, Day of Reconciliation, etc.) → bank_holiday',
        'Any "BREAK" entries within a term (e.g. "PESACH BREAK") → bank_holiday with end_date',
      ],
      ayFormat: `"${currentAY}" or "${nextAY}"`,
      userIntro: 'Extract all school term dates and closures from this South African school year planner. Emit one JSON entry per date you find - terms, holidays, and closures all go into the same array. Do not emit half_term_start or half_term_end events:',
    },
    GB: {
      intro: `You are an expert at extracting UK school term dates and closures from website or PDF content. Be EXHAUSTIVE: extract EVERY individual dated entry you can find - for both the ${currentAY} academic year and the ${nextAY} academic year if available. Emit one entry per dated line. Do not summarise, group, or skip any closure.

Faith schools (Jewish, Muslim, Christian and others) list MANY religious festival closures - you MUST extract every single one. Common Jewish-school closures include Rosh Hashanah, Yom Kippur, Succot / Sukkot, Shemini Atzeret, Simchat Torah, Chanukah / Hanukkah, Purim, Pesach / Passover and Shavuot; spellings vary - treat every named festival as a closure. Each named festival closure is a bank_holiday; use end_date for multi-day spans (e.g. "Saturday 26th & Sunday 27th September ... Succot" → one bank_holiday from the 26th to the 27th).`,
      lookFor: [
        'Dates in any UK format (e.g. "3rd September 2025", "3 Sep 2025", "03/09/2025")',
        'Term names (Autumn, Spring, Summer) - emit a term_start and a term_end for each',
        'Half term breaks',
        'INSET / training / staff days',
        'Bank holidays',
        'EVERY named religious / festival closure and any "School Closed - X" day - one bank_holiday entry each, with end_date for multi-day ranges. A label (e.g. "Succot") may sit on a SEPARATE line from its date - associate them by proximity and still extract it.',
        'A row that says "early close ... <festival>" is still that festival\'s closure - extract the festival as a bank_holiday.',
      ],
      ayFormat: `"${currentAY}" or "${nextAY}"`,
      userIntro: 'Extract EVERY school term date and closure from this UK school calendar - terms, half terms, INSET days, bank holidays AND every religious/festival closure. Do not skip any:',
    },
  };
  const cfg = promptByCountry[country] || promptByCountry.GB;

  const { text } = await callWithFailover({
    system: `${cfg.intro}

Look carefully for:
${cfg.lookFor.map((line) => `- ${line}`).join('\n')}

Return ONLY a valid JSON array with no other text:
[
  {"event_type": "term_start", "date": "YYYY-MM-DD", "label": "Description", "academic_year": "YYYY-YYYY", "source_quote": "the exact snippet from the source text containing this date"},
  {"event_type": "half_term_start", "date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "label": "Description", "academic_year": "YYYY-YYYY", "source_quote": "..."},
  ...
]

Valid event_types: term_start, term_end, half_term_start, half_term_end, inset_day, bank_holiday
For half terms / mid-term breaks, use half_term_start with an end_date spanning the break.
For school-specific closures (religious holidays etc), use bank_holiday with a descriptive label.
Include the academic_year field (${cfg.ayFormat}) for each entry.

BE EXHAUSTIVE. Go line by line through the source and emit an entry for EVERY individual dated closure - it is far better to include a borderline one than to miss it (the user can delete extras, but cannot recover a date you skipped). Multi-day closures ("Saturday 26th & Sunday 27th September") become ONE entry with a date and an end_date.

DO skip only RECURRING WEEKLY patterns that have no single calendar date - e.g. "Shabbat closing - Fridays in November", "Fridays in Summer term school closes at 2.30pm". Those are weekly rules, not dated closures. Everything with a specific date stays in.

CRITICAL - source_quote field:
- For every entry, include a "source_quote" field with the EXACT substring from the source text (10–80 characters) that contains this date.
- Copy verbatim - do not paraphrase, reformat, or invent text.
- If a weekday name appears next to the date in the source (e.g. "Monday 6 January"), include it. This helps us spot off-by-one mistakes.
- If you genuinely cannot find a clean snippet for an entry, set source_quote to null.

If you genuinely cannot find any term dates in the content, return an empty array [].
Do NOT wrap in markdown code fences.`,
    messages: [{ role: 'user', content: `${cfg.userIntro}\n\n${pageText}` }],
    timeoutMs: REASONING_TIMEOUT_MS,
    maxTokens: 8192,
    responseFormat: 'json',
    useThinking: true,
    preferClaude: true,
    feature: 'school_website_extraction',
    householdId,
    userId,
  });

  let dates;
  try {
    let cleaned = text
      .replace(/```(?:json)?\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      cleaned = cleaned.substring(firstBracket, lastBracket + 1);
    }
    dates = JSON.parse(cleaned);
  } catch {
    console.error('[import-term-dates] AI response could not be parsed:', text.substring(0, 2000));
    return {
      ok: false,
      status: 500,
      body: { error: 'The source was read but the AI could not extract structured dates from it. Try a different file or add dates manually.' },
    };
  }

  if (!Array.isArray(dates) || dates.length === 0) {
    return {
      ok: true,
      status: 200,
      body: {
        dates: [],
        source_url: sourceLabel || null,
        source_text_preview: '',
        message: 'No term dates found. Try a different source or add dates manually.',
      },
    };
  }

  const normalised = dates
    .filter((d) => d && typeof d === 'object')
    .map((d) => ({ ...d, academic_year: d.academic_year || currentAY }));
  const validated = validateTermDates(normalised, pageText);

  return {
    ok: true,
    status: 200,
    body: {
      dates: validated,
      source_url: sourceLabel || null,
      source_text_preview: pageText.substring(0, 800),
    },
  };
}

/**
 * AIA chain completion.
 *
 * Some servers - commonly UK council *.gov.uk sites - are misconfigured to send
 * ONLY their leaf certificate and omit the intermediate CA cert, so a strict TLS
 * client can't build a chain to a trusted root (Node: UNABLE_TO_VERIFY_LEAF_
 * SIGNATURE, "unable to verify the first certificate"). Browsers paper over this
 * by fetching the missing intermediate from the leaf's AIA extension; we do the
 * same and retry with the chain completed. Verification stays ON for the data
 * fetch, so this never trusts a cert that doesn't ultimately chain to a real
 * root - it only supplies the intermediate the server forgot to send.
 */

// Read the leaf cert's "CA Issuers" (AIA) URL. The handshake skips verification
// PURELY to inspect the presented certificate - no application data is read from
// this socket (closed immediately); the real fetch re-validates the full chain.
function getAiaIssuerUrl(host) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const socket = tls.connect(
      { host, servername: host, port: 443, rejectUnauthorized: false, timeout: 8000 },
      () => {
        const cert = socket.getPeerCertificate(true);
        socket.end();
        const uris = cert && cert.infoAccess && cert.infoAccess['CA Issuers - URI'];
        done(Array.isArray(uris) && uris.length ? uris[0] : null);
      },
    );
    socket.on('error', () => done(null));
    socket.on('timeout', () => { socket.destroy(); done(null); });
  });
}

// Minimal GET → { status, headers, body:Buffer }, following a few redirects.
// `ca`, when given, replaces the trust store for the request.
function rawGet(targetUrl, { headers = {}, ca, redirectsLeft = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      u,
      { method: 'GET', headers, servername: u.hostname, timeout: 15000, ...(ca ? { ca } : {}) },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(rawGet(new URL(res.headers.location, targetUrl).toString(), { headers, ca, redirectsLeft: redirectsLeft - 1 }));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function derToPem(buf) {
  if (buf.toString('latin1').includes('-----BEGIN CERTIFICATE-----')) return buf.toString('latin1');
  const b64 = buf.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

// On an incomplete-chain failure: fetch the missing intermediate via AIA and
// retry with the completed chain (verification ON). Returns a fetch Response, or
// null if completion isn't possible. The AIA URL is SSRF-guarded - it comes from
// a cert presented over an UNVERIFIED handshake, so a hostile server could
// otherwise point it at an internal address.
async function fetchWithAiaCompletion(targetUrl, headers) {
  const aiaUrl = await getAiaIssuerUrl(new URL(targetUrl).hostname);
  if (!aiaUrl) return null;
  try { assertFetchableUrl(aiaUrl); } catch { return null; }

  let intermediatePem;
  try {
    const r = await rawGet(aiaUrl, { headers: { 'User-Agent': headers['User-Agent'] || 'Mozilla/5.0' }, redirectsLeft: 0 });
    if (r.status !== 200 || !r.body || !r.body.length) return null;
    intermediatePem = derToPem(r.body);
  } catch {
    return null;
  }

  // Trust = default roots + the fetched intermediate. A forged intermediate is
  // useless: the chain must still terminate at a genuine trusted root.
  const res = await rawGet(targetUrl, { headers, ca: [...tls.rootCertificates, intermediatePem] });
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': res.headers['content-type'] || 'text/html' },
  });
}

/**
 * Fetch a term-dates web page (or PDF) and return its plain text, ready for
 * extractTermDatesPreview. Mirrors the fetch/strip/pdfParse pipeline in the
 * /import-website route, but is reusable and SSRF-guarded - important here
 * because the "import from local authority" flow feeds in a URL chosen by a
 * web search, not a human. Throws an Error with a user-facing message on any
 * failure (bad URL, HTTP error, empty/scanned PDF) so the caller can surface it.
 */
async function fetchTermDatesPageText(url) {
  const trimmed = (url || '').trim();
  // SSRF guard: http(s) only, no credentials, no literal private IPs.
  assertFetchableUrl(trimmed);

  const looksLikePdfUrl = /\.pdf(\?|#|$)/i.test(trimmed);
  let response;
  try {
    response = await fetch(trimmed, { headers: TERM_FETCH_HEADERS });
  } catch (err) {
    // Incomplete TLS chain (server omitted the intermediate)? Complete it via
    // AIA - the way browsers do - and retry with verification still on. Any
    // other error (or a failed completion) rethrows the original message.
    if (err && err.cause && err.cause.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      response = await fetchWithAiaCompletion(trimmed, TERM_FETCH_HEADERS).catch(() => null);
    }
    if (!response) throw new Error(`Could not reach that page: ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(`That page returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (looksLikePdfUrl || contentType.includes('application/pdf')) {
    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    const pdfData = await pdfParse(pdfBuffer);
    const text = (pdfData.text || '').trim().substring(0, 16000);
    if (text.length < 50) {
      throw new Error('The PDF appears to be a scanned image with no readable text.');
    }
    return text;
  }

  const rawHtml = await response.text();
  if (looksLikeWafChallenge(rawHtml)) {
    throw new Error('That page is protected by bot-detection (a WAF challenge page was returned instead of the content).');
  }
  // Strip HTML but preserve table/list structure so dates stay on their own
  // lines for the extractor (identical treatment to the website-import route).
  const text = rawHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim()
    .substring(0, 12000);
  if (text.length < 50) {
    throw new Error('That page had very little readable text. The dates may be in a PDF or image.');
  }
  return text;
}

/**
 * Compute current + next academic-year strings for the household's country.
 * UK uses Sept-Aug, SA uses calendar-year.
 */
function academicYearsForCountry(country) {
  const now = new Date();
  if (country === 'ZA') {
    return {
      currentAY: String(now.getFullYear()),
      nextAY: String(now.getFullYear() + 1),
    };
  }
  const currentAY = now.getMonth() >= 8
    ? `${now.getFullYear()}-${now.getFullYear() + 1}`
    : `${now.getFullYear() - 1}-${now.getFullYear()}`;
  const nextAY = `${parseInt(currentAY.split('-')[1])}-${parseInt(currentAY.split('-')[1]) + 1}`;
  return { currentAY, nextAY };
}

module.exports = { extractTermDatesPreview, fetchTermDatesPageText, academicYearsForCountry, VALID_EVENT_TYPES, TERM_FETCH_HEADERS };
