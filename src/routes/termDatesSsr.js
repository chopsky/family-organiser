/**
 * SEO layer for the public term-dates directory at /school-term-dates.
 *
 * The directory is a client-side JS app - a crawler fetching it saw an empty
 * shell, and none of the per-council/per-school data had a URL. This router
 * adds the server-rendered surface Google actually indexes:
 *
 *   GET /                 the app's index.html with the full A-Z council list
 *                         server-injected into #list (app.js replaces it on
 *                         load - progressive enhancement, crawlers see links)
 *   GET /:slug            per-council page (real HTML dates tables)
 *   GET /schools/:slug    per-school page (the parent-seeded directory)
 *   GET /sitemap.xml      index + every council + every school
 *
 * Canonical host is the APEX (housemait.com/school-term-dates/... via the
 * Vercel proxy) - every page emits a canonical link there so the Railway
 * host's copy never competes. Pages are cacheable (s-maxage) so the CDN
 * absorbs crawl traffic.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const laDb = require('../db/laTermDates');

const CANONICAL_BASE = 'https://housemait.com/school-term-dates';
const INDEX_HTML = path.join(__dirname, '..', '..', 'public', 'la-term-dates', 'index.html');
const CACHE_HEADER = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtDate(d) {
  const [y, m, day] = (d || '').split('-').map(Number);
  if (!y) return d || '';
  const dt = new Date(Date.UTC(y, m - 1, day));
  return `${DOW[dt.getUTCDay()]} ${day} ${MONTHS[m - 1]} ${y}`;
}
function fmtRange(d, end) {
  if (!end || end === d) return fmtDate(d);
  return `${fmtDate(d)} – ${fmtDate(end)}`;
}
const TYPE_LABEL = {
  term_start: 'Term starts', term_end: 'Term ends', half_term_start: 'Half term',
  half_term_end: 'Half term ends', inset_day: 'INSET day', bank_holiday: 'Closure',
};

function groupByYear(entries) {
  const by = {};
  for (const e of entries) (by[e.academic_year] ||= []).push(e);
  return Object.keys(by).sort().map((year) => ({ year, dates: by[year] }));
}

// ── SEO content: unique per-council copy computed from the council's own dates ──
// The date tables alone read as "thin content"; this section gives every page
// real prose. Nothing here is boilerplate-with-a-name-swapped: the answers are
// the council's actual dates, so two councils only read the same if their
// calendars genuinely are the same.

function weekdaysIn(start, end) {
  if (!start) return 0;
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end || start}T00:00:00Z`);
  let n = 0;
  for (; d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

const monthOf = (iso) => Number((iso || '').split('-')[1] || 0);
const yearOf = (iso) => Number((iso || '').split('-')[0] || 0);

/**
 * Pull the recognisable moments out of one academic year's entries. The
 * importer types every holiday range as half_term_start, so ranges are
 * classified by month, not by type or council-specific label.
 */
function extractFacts(dates) {
  const ranges = dates.filter((d) => d.event_type === 'half_term_start');
  const inMonths = (months, minSpan = 0) =>
    ranges.find((r) => months.includes(monthOf(r.date)) && weekdaysIn(r.date, r.end_date) >= minSpan) || null;
  const autumnStart = dates.find((d) => d.event_type === 'term_start' && [8, 9].includes(monthOf(d.date))) || null;
  const summerEnd = [...dates].reverse().find((d) => d.event_type === 'term_end' && [6, 7].includes(monthOf(d.date))) || null;
  return {
    autumnStart,
    octHalf: inMonths([10]),
    christmas: inMonths([12]),
    febHalf: inMonths([2]),
    easter: inMonths([3, 4], 5),
    mayHalf: inMonths([5, 6]),
    summerEnd,
    insetCount: dates.filter((d) => d.event_type === 'inset_day').length,
    holidayWeekdays: ranges.reduce((n, r) => n + weekdaysIn(r.date, r.end_date), 0),
  };
}

/**
 * Build the About + FAQ section for a council page.
 *
 * Two data realities shape this (verified across all 170 imported councils):
 * councils publish the next year PIECEMEAL - 123 of them currently have only
 * autumn 2026 in their latest year while the previous year is complete - and
 * a dozen type the summer holiday itself as a range, which turns a naive
 * "holiday weekdays" sum into numbers like 69. So each question independently
 * uses the MOST RECENT year that actually has its fact, seasonal questions
 * are dropped once the holiday is more than a month in the past (no stale
 * "Christmas 2025" filler), and the weekday stat only renders when it lands
 * in a plausible 10-40 range.
 */
function buildCouncilContent(authority, years) {
  if (!years.length) return { contentHtml: '', faqLd: null };
  const name = authority.name;
  const today = new Date().toISOString().slice(0, 10);
  const graceCutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const factsByYear = years.map(({ year, dates }) => ({ year, f: extractFacts(dates) }));

  // Most recent year that has this fact; seasonal facts must not be long past.
  const pick = (key, seasonal = true) => {
    for (let i = factsByYear.length - 1; i >= 0; i--) {
      const fact = factsByYear[i].f[key];
      if (!fact) continue;
      if (seasonal && (fact.end_date || fact.date) < graceCutoff) continue;
      return { fact, year: factsByYear[i].year };
    }
    return null;
  };

  const autumn = pick('autumnStart', false);
  const oct = pick('octHalf');
  const christmas = pick('christmas');
  const feb = pick('febHalf');
  const easter = pick('easter');
  const mayHalf = pick('mayHalf');
  const summer = pick('summerEnd', false);
  const yrOfFact = (p2) => (p2 ? yearOf(p2.fact.date) : null);

  // Intro anchors on the most recent COMPLETE year (has both ends), so a
  // council mid-way through publishing next year doesn't produce a one-line year.
  const completeYear = [...factsByYear].reverse().find(({ f }) => f.autumnStart && f.summerEnd) || null;

  const intro = [];
  if (authority.school_count) {
    intro.push(`${esc(name)} is home to around ${authority.school_count} state schools. The council sets term dates for the community and voluntary-controlled schools among them, and most academies keep to the same calendar so that families with children at different schools stay roughly in sync.`);
  } else {
    intro.push(`${esc(name)} council publishes these dates for its community and voluntary-controlled schools, and most academies in the area keep to the same calendar.`);
  }
  if (completeYear) {
    const f = completeYear.f;
    intro.push(`In the ${esc(completeYear.year)} school year, pupils return on ${esc(fmtDate(f.autumnStart.date))} and the year ends on ${esc(fmtDate(f.summerEnd.date))}.`);
    if (f.holidayWeekdays >= 10 && f.holidayWeekdays <= 40) {
      intro.push(`Between those two dates sit around ${f.holidayWeekdays} weekdays of school holidays — half terms, Christmas and Easter — before the summer break even starts. Each one is a week where clubs pause, routines change and childcare needs a plan.`);
    }
  }
  intro.push(`The tables above come from ${esc(name)}'s own published calendar and are refreshed monthly.`);

  const faqs = [];
  if (autumn && (autumn.fact.date >= graceCutoff || !completeYear || autumn.year === completeYear.year)) {
    faqs.push([
      `When do ${name} schools go back in September ${yrOfFact(autumn)}?`,
      `Most ${name} schools start the ${autumn.year} autumn term on ${fmtDate(autumn.fact.date)}. Some schools stagger the first day or two for new starters, and a school's own INSET days can push its return back — check the start-of-term letter before planning that first week.`,
    ]);
  }
  if (oct) {
    faqs.push([
      `When is October half term in ${name} in ${yrOfFact(oct)}?`,
      `October half term in ${name} runs ${fmtRange(oct.fact.date, oct.fact.end_date)} — ${weekdaysIn(oct.fact.date, oct.fact.end_date)} weekdays to plan for.`,
    ]);
  }
  if (christmas) {
    faqs.push([
      `When do ${name} schools break up for Christmas ${yrOfFact(christmas)}?`,
      `The Christmas holiday in ${name} runs ${fmtRange(christmas.fact.date, christmas.fact.end_date)}. The final school day before it often finishes early — worth checking your school's newsletter before booking anything for that afternoon.`,
    ]);
  }
  if (feb) {
    faqs.push([
      `When is February half term in ${name} in ${yrOfFact(feb)}?`,
      `February half term in ${name} runs ${fmtRange(feb.fact.date, feb.fact.end_date)}.`,
    ]);
  }
  if (easter) {
    faqs.push([
      `When are the Easter school holidays in ${name} in ${yrOfFact(easter)}?`,
      `The Easter holidays in ${name} run ${fmtRange(easter.fact.date, easter.fact.end_date)}. Bear in mind Easter itself moves each year, so neighbouring councils sometimes place this break a week apart.`,
    ]);
  }
  if (summer) {
    const sameYearMay = mayHalf && mayHalf.year === summer.year ? mayHalf : null;
    faqs.push([
      `When do ${name} schools break up for summer in ${yrOfFact(summer)}?`,
      `The ${summer.year} school year in ${name} ends on ${fmtDate(summer.fact.date)}${sameYearMay ? `, with the late-spring half term falling ${fmtRange(sameYearMay.fact.date, sameYearMay.fact.end_date)}` : ''}.`,
    ]);
  }
  faqs.push([
    `Do academies and free schools in ${name} follow these dates?`,
    `Not automatically — councils only fix term dates for community and voluntary-controlled schools, while academies, free schools and foundation schools set their own. In practice most stay within a day or two of the ${name} calendar, because mismatched dates make life hard for staff and families alike. Treat your own school's published dates as the final word.`,
  ]);
  const latestInset = factsByYear[factsByYear.length - 1];
  faqs.push([
    `What are INSET days, and are they in this calendar?`,
    `Every state school in England and Wales takes five INSET days a year — staff-training days when pupils stay at home. They're chosen school by school, not by the council, so council calendars ${latestInset.f.insetCount ? `list only some of them (${latestInset.f.insetCount} appear${latestInset.f.insetCount === 1 ? 's' : ''} here for ${latestInset.year})` : `rarely include them, this one included`}. Schools confirm their own INSET days in newsletters, usually termly — they're exactly the kind of date that slips through the cracks, and exactly what Housemait keeps on the family calendar for you.`,
  ]);

  const contentHtml = `
    <section class="prose">
      <h2>About ${esc(name)} school term dates</h2>
      <p>${intro.join(' ')}</p>
      <h2>${esc(name)} term dates: common questions</h2>
      ${faqs.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('\n      ')}
    </section>`;

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
  return { contentHtml, faqLd };
}

/** Shared shell for the per-entity pages - same brand vocabulary as the app. */
function detailPage({ title, description, canonicalPath, h1, sub, years, extraHtml = '', contentHtml = '', jsonLd, faqLd = null, slugForCta = '' }) {
  const yearBlocks = years.map(({ year, dates }) => `
    <section>
      <h2>${esc(year)}</h2>
      <table><tbody>
        ${dates.map((d) => `<tr><td class="d">${esc(fmtRange(d.date, d.end_date))}</td><td>${esc(d.label || TYPE_LABEL[d.event_type] || d.event_type)}</td></tr>`).join('')}
      </tbody></table>
    </section>`).join('');

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${CANONICAL_BASE}${canonicalPath}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${CANONICAL_BASE}${canonicalPath}" />
  <meta property="og:image" content="https://housemait.com/school-term-dates/og-share.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="https://housemait.com/school-term-dates/og-share.png" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  ${faqLd ? `<script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ''}
  <style>
    @font-face { font-family: 'Recoleta'; src: url('/school-term-dates/fonts/Recoleta-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #FBF8F3; color: #2D2A33; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 80px; }
    a { color: #6B3FA0; }
    .crumb { font-size: 13px; margin-bottom: 18px; }
    h1 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: clamp(30px, 5vw, 42px); line-height: 1.1; color: #6B3FA0; margin: 0 0 6px; }
    .sub { color: #6B6774; font-size: 15px; margin: 0 0 26px; }
    h2 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 24px; color: #6B3FA0; margin: 28px 0 8px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; }
    td { padding: 9px 14px; border-bottom: 1px solid #E8E5EC; font-size: 14.5px; }
    tr:last-child td { border-bottom: none; }
    td.d { white-space: nowrap; font-weight: 600; width: 190px; }
    .cta { margin-top: 36px; background: #fff; border: 1.5px solid #E8E5EC; border-radius: 16px; padding: 20px; }
    .cta a.btn { display: inline-block; margin-top: 10px; background: #6B3FA0; color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; padding: 11px 20px; border-radius: 12px; }
    .src { font-size: 12.5px; color: #6B6774; margin-top: 16px; word-break: break-all; }
    .prose { margin-top: 34px; }
    .prose h3 { font-size: 16px; font-weight: 600; margin: 20px 0 4px; }
    .prose p { font-size: 14.5px; color: #4A4552; margin: 0 0 8px; }
    .site-footer { margin-top: 48px; padding-top: 28px; border-top: 1px solid #E8E5EC; }
    .site-footer img { display: block; height: 26px; width: auto; margin-bottom: 12px; }
    .site-footer .tag { font-size: 13.5px; color: #6B6774; max-width: 62ch; margin: 0 0 10px; }
    .site-footer nav { font-size: 13px; margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 6px 18px; }
    .site-footer nav a { color: #6B3FA0; text-decoration: none; font-weight: 600; }
    .site-footer nav a:hover { text-decoration: underline; }
    .site-footer .copy { font-size: 12px; color: #6B6774; margin: 0; }

    @media (max-width: 520px) { td.d { width: auto; } }
  </style>
</head>
<body>
  <div class="wrap">
    <nav class="crumb"><a href="/school-term-dates/">← All UK school term dates</a></nav>
    <h1>${esc(h1)}</h1>
    <p class="sub">${esc(sub)}</p>
    ${yearBlocks || '<p class="sub">No term dates published yet.</p>'}
    ${extraHtml}
    ${contentHtml}
    <div class="cta">
      <strong>Get these dates on your family calendar.</strong>
      <p class="sub" style="margin:6px 0 0">Housemait puts term dates, school events and after-school activities on a shared family calendar — with reminders that pause in the holidays.</p>
      <a class="btn" href="https://housemait.com/signup?src=termdates${slugForCta ? `&amp;la=${esc(slugForCta)}` : ''}">Try Housemait free</a>
    </div>
    <footer class="site-footer">
      <a href="https://housemait.com" aria-label="Housemait - family organiser app">
        <img src="/school-term-dates/housemait-logo.svg" alt="Housemait" width="160" height="26" loading="lazy" />
      </a>
      <p class="tag">Housemait is the family organiser app for busy households — a shared family calendar with
        school term dates built in, plus meal plans, shopping lists, tasks and a WhatsApp assistant.</p>
      <nav>
        <a href="https://housemait.com">Family organiser app</a>
        <a href="https://housemait.com/signup?src=termdates">Try Housemait free</a>
        <a href="https://housemait.com/support">Support</a>
        <a href="https://housemait.com/privacy">Privacy</a>
        <a href="https://housemait.com/terms">Terms</a>
      </nav>
      <p class="copy">© ${new Date().getFullYear()} Housemait. Term dates are sourced from official council calendars — always confirm with your school.</p>
    </footer>
  </div>
</body>
</html>`;
}

function breadcrumbLd(name, pathSuffix) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'UK School Term Dates', item: `${CANONICAL_BASE}/` },
      { '@type': 'ListItem', position: 2, name, item: `${CANONICAL_BASE}${pathSuffix}` },
    ],
  };
}

// ── Index: app shell with the council list server-injected ─────────────────
router.get('/', async (req, res, next) => {
  try {
    const html = fs.readFileSync(INDEX_HTML, 'utf-8');
    const authorities = await laDb.listAllAuthorities();
    const items = authorities
      .filter((a) => ['ok', 'partial'].includes(a.import_status))
      .map((a) => `<li class="card" data-name="${esc(a.name.toLowerCase())}" data-region="${esc(a.region || '')}"><a class="card-head" style="text-decoration:none" href="/school-term-dates/${esc(a.slug)}"><span class="card-title"><span class="name">${esc(a.name)}</span><span class="sub">${esc(a.region ? `${a.region} · ` : '')}term dates, half terms &amp; INSET days</span></span><span class="chev" aria-hidden="true">›</span></a></li>`)
      .join('');
    // Server-inject the crawlable list; app.js replaces it on load.
    const injected = html.replace(
      '<ul class="list" id="list" aria-live="polite"></ul>',
      `<ul class="list" id="list" aria-live="polite">${items}</ul>`,
    );
    res.set('Cache-Control', CACHE_HEADER).type('html').send(injected);
  } catch (err) {
    console.error('[term-dates-ssr] index failed:', err.message);
    next(); // fall through to plain static
  }
});

// ── Sitemap ────────────────────────────────────────────────────────────────
router.get('/sitemap.xml', async (req, res) => {
  try {
    const authorities = await laDb.listAllAuthorities();
    // Councils only. School records are deliberately NOT public: parents seed
    // them from calendars some schools keep gated (a real security concern
    // for e.g. Jewish schools) - they live in-app only.
    const urls = [
      `${CANONICAL_BASE}/`,
      ...authorities.filter((a) => ['ok', 'partial'].includes(a.import_status)).map((a) => `${CANONICAL_BASE}/${a.slug}`),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>`;
    res.set('Cache-Control', CACHE_HEADER).type('application/xml').send(xml);
  } catch (err) {
    console.error('[term-dates-ssr] sitemap failed:', err.message);
    res.status(500).type('text/plain').send('sitemap unavailable');
  }
});

// Slug shape gate: dotted names (app.js, sitemap.xml requests that fell
// through, fonts) and anything else non-sluggy skips to the static layer.
// Express 5 dropped inline route regexes, hence the in-handler check.
const SLUG_RE = /^[a-z0-9-]+$/;

// ── School pages: WITHDRAWN from the public site ───────────────────────────
// Parent-seeded school records stay in-app only: some schools deliberately
// gate their calendars (a real security concern, e.g. Jewish schools), and a
// public page would republish what the school chose not to. 410 + noindex
// tells Google to drop the previously-indexed URLs fast.
router.get('/schools/:slug', (req, res) => {
  res.set('X-Robots-Tag', 'noindex')
    .status(410)
    .type('html')
    .send('<!DOCTYPE html><html lang="en-GB"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>Page removed</title></head><body style="font-family:sans-serif;padding:40px"><p>School term-date pages are no longer public. Parents can access their school\'s dates inside the <a href="https://housemait.com">Housemait</a> app.</p><p><a href="/school-term-dates/">Browse council term dates →</a></p></body></html>');
});

// ── Per-council page ───────────────────────────────────────────────────────
router.get('/:slug', async (req, res, next) => {
  try {
    if (!SLUG_RE.test(req.params.slug)) return next();
    const authority = await laDb.getAuthorityBySlug(req.params.slug);
    if (!authority || !['ok', 'partial'].includes(authority.import_status)) return next();
    const entries = await laDb.getEntriesForLA(authority.id);
    const years = groupByYear(entries);
    const content = buildCouncilContent(authority, years);
    const yearsLabel = years.map((y) => y.year).join(' and ');
    const title = `${authority.name} School Term Dates${yearsLabel ? ` ${yearsLabel}` : ''} & Holidays | Housemait`;
    const description = `Official ${authority.name} school term dates${yearsLabel ? ` for ${yearsLabel}` : ''} — term starts and ends, half terms and holidays, sourced from the council's own published calendar and refreshed monthly.`;
    const srcHtml = authority.source_url
      ? `<p class="src">Source: <a href="${esc(authority.source_url)}" rel="nofollow noopener" target="_blank">${esc(authority.source_url)}</a></p>`
      : '';
    res.set('Cache-Control', CACHE_HEADER).type('html').send(detailPage({
      title,
      description,
      canonicalPath: `/${authority.slug}`,
      slugForCta: authority.slug,
      h1: `${authority.name} school term dates`,
      sub: `Council-published term and holiday dates for schools in ${authority.name}${authority.region ? ` (${authority.region})` : ''}. Academies and independents may differ — check with your school.`,
      years,
      extraHtml: srcHtml,
      contentHtml: content.contentHtml,
      jsonLd: breadcrumbLd(`${authority.name} school term dates`, `/${authority.slug}`),
      faqLd: content.faqLd,
    }));
  } catch (err) {
    console.error('[term-dates-ssr] council page failed:', err.message);
    next();
  }
});

module.exports = router;
