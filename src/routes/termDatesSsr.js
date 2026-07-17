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
const schoolDirDb = require('../db/schoolDirectory');

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

/** Shared shell for the per-entity pages - same brand vocabulary as the app. */
function detailPage({ title, description, canonicalPath, h1, sub, years, extraHtml = '', jsonLd }) {
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
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
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
    <div class="cta">
      <strong>Get these dates on your family calendar.</strong>
      <p class="sub" style="margin:6px 0 0">Housemait puts term dates, school events and after-school activities on a shared family calendar — with reminders that pause in the holidays.</p>
      <a class="btn" href="https://housemait.com/gb">Try Housemait free</a>
    </div>
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
      .map((a) => `<li class="card"><a class="card-head" style="text-decoration:none" href="/school-term-dates/${esc(a.slug)}"><span class="card-title"><span class="name">${esc(a.name)}</span><span class="sub">School term dates ${esc(a.name)}</span></span></a></li>`)
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
    const schools = await schoolDirDb.listDirectorySchools({ pageSize: 100 }).catch(() => ({ rows: [] }));
    const urls = [
      `${CANONICAL_BASE}/`,
      ...authorities.filter((a) => ['ok', 'partial'].includes(a.import_status)).map((a) => `${CANONICAL_BASE}/${a.slug}`),
      ...schools.rows.filter((s) => s.status === 'ok').map((s) => `${CANONICAL_BASE}/schools/${s.slug}`),
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

// ── Per-school page (before /:slug so "schools" isn't eaten by it) ─────────
router.get('/schools/:slug', async (req, res, next) => {
  try {
    if (!SLUG_RE.test(req.params.slug)) return next();
    const school = await schoolDirDb.getDirectorySchoolBySlug(req.params.slug);
    if (!school || school.status !== 'ok') return next();
    const entries = await schoolDirDb.getDirectorySchoolDates(school.id);
    const years = groupByYear(entries);
    const yearsLabel = years.map((y) => y.year).join(' and ');
    const families = (school.adopted_count || 0) + 1;
    const title = `${school.name} Term Dates${yearsLabel ? ` ${yearsLabel}` : ''} | Housemait`;
    const description = `Term dates and holidays for ${school.name}${school.postcode ? ` (${school.postcode})` : ''}${yearsLabel ? ` for ${yearsLabel}` : ''} — imported from the school's own published calendar and checked automatically. Used by ${families} Housemait famil${families === 1 ? 'y' : 'ies'}.`;
    res.set('Cache-Control', CACHE_HEADER).type('html').send(detailPage({
      title,
      description,
      canonicalPath: `/schools/${school.slug}`,
      h1: `${school.name} term dates`,
      sub: `${school.postcode ? `${school.postcode} · ` : ''}Imported from the school's published calendar · used by ${families} famil${families === 1 ? 'y' : 'ies'} on Housemait`,
      years,
      jsonLd: breadcrumbLd(`${school.name} term dates`, `/schools/${school.slug}`),
    }));
  } catch (err) {
    console.error('[term-dates-ssr] school page failed:', err.message);
    next();
  }
});

// ── Per-council page ───────────────────────────────────────────────────────
router.get('/:slug', async (req, res, next) => {
  try {
    if (!SLUG_RE.test(req.params.slug)) return next();
    const authority = await laDb.getAuthorityBySlug(req.params.slug);
    if (!authority || !['ok', 'partial'].includes(authority.import_status)) return next();
    const entries = await laDb.getEntriesForLA(authority.id);
    const years = groupByYear(entries);
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
      h1: `${authority.name} school term dates`,
      sub: `Council-published term and holiday dates for schools in ${authority.name}${authority.region ? ` (${authority.region})` : ''}. Academies and independents may differ — check with your school.`,
      years,
      extraHtml: srcHtml,
      jsonLd: breadcrumbLd(`${authority.name} school term dates`, `/${authority.slug}`),
    }));
  } catch (err) {
    console.error('[term-dates-ssr] council page failed:', err.message);
    next();
  }
});

module.exports = router;
