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

/**
 * Drop entries belonging to academic years that have ENTIRELY finished -
 * once a year's last date is behind us (e.g. 2025-26 after 20 Jul 2026),
 * nobody is looking for it and leading the page with it reads as stale.
 * A year survives while any of its dates is today or later.
 */
function withoutFinishedYears(entries) {
  const today = new Date().toISOString().slice(0, 10);
  const lastByYear = {};
  for (const e of entries) {
    const last = e.end_date || e.date;
    if (!lastByYear[e.academic_year] || last > lastByYear[e.academic_year]) lastByYear[e.academic_year] = last;
  }
  const live = entries.filter((e) => lastByYear[e.academic_year] >= today);
  // Never filter down to nothing: a council whose data is all historic should
  // still show what it has rather than an empty page.
  return live.length ? live : entries;
}

// ── Design-system helpers (ported from the handoff prototype's script) ──────

const DAY_MS = 86400000;
const isoMs = (s) => { const [y, m, d] = (s || '').split('-').map(Number); return Date.UTC(y, m - 1, d); };

/** Range format with same-month compression: "Mon 26 – Fri 30 Oct 2026". */
function frShort(d, e) {
  if (!e || e === d) return fmtDate(d);
  const a = d.split('-').map(Number), b = e.split('-').map(Number);
  if (a[0] === b[0] && a[1] === b[1]) {
    const sd = new Date(Date.UTC(a[0], a[1] - 1, a[2]));
    return `${DOW[sd.getUTCDay()]} ${a[2]} – ${fmtDate(e)}`;
  }
  return `${fmtDate(d)} – ${fmtDate(e)}`;
}
const monthLabelOf = (s) => { const [y, m] = (s || '').split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

/**
 * Map a stored entry to the design's event kind (start/end/half/break/bank/
 * inset). The importer types every holiday range as half_term_start, so the
 * half-term vs holiday split falls back to label keywords, then span (a half
 * term is ≤6 weekdays; Christmas/Easter/summer are longer).
 */
function kindOf(e) {
  if (e.event_type === 'term_start') return 'start';
  if (e.event_type === 'term_end') return 'end';
  if (e.event_type === 'inset_day') return 'inset';
  const multi = e.end_date && e.end_date !== e.date;
  if (e.event_type === 'bank_holiday') return multi ? 'break' : 'bank';
  const lbl = (e.label || '').toLowerCase();
  if (/half\s*-?\s*term/.test(lbl)) return 'half';
  if (/christmas|xmas|easter|summer|winter|spring break/.test(lbl)) return 'break';
  if (!multi) return 'half';
  return weekdaysIn(e.date, e.end_date) <= 6 ? 'half' : 'break';
}

// Pill text + tint/text colours per kind (design TAG map; INSET reuses the
// coral holiday pair - the prototype has no INSET example, but INSET means
// school closed to pupils, which is the coral family).
const TAG = {
  start: ['Term starts', '#F3EDFC', '#6B3FA0'],
  end: ['Term ends', '#F3EDFC', '#6B3FA0'],
  half: ['Half term', '#FBF1DE', '#936314'],
  break: ['Holiday', '#FDF0EB', '#B8431F'],
  bank: ['Bank holiday', '#FDF0EB', '#B8431F'],
  inset: ['INSET day', '#FDF0EB', '#B8431F'],
};
const STRIP_COL = { term: '#E7DDF3', half: '#E0A458', break: '#E8724A', bank: '#E8724A', inset: '#E8724A' };

/** One academic-year card: heading + legend, proportional strip, event rows. */
function buildYearCard({ year, dates }) {
  const rows = dates.map((e) => {
    const k = kindOf(e);
    const multi = e.end_date && e.end_date !== e.date;
    return `<div class="row"><span class="when">${esc(frShort(e.date, e.end_date))}</span><span class="lbl">${esc(e.label || TYPE_LABEL[e.event_type] || e.event_type)}<span class="pill" style="background:${TAG[k][1]};color:${TAG[k][2]}">${TAG[k][0]}</span></span><span class="wdays">${multi ? `${weekdaysIn(e.date, e.end_date)} weekdays` : ''}</span></div>`;
  }).join('');

  // Year-at-a-glance strip: term time in lilac, breaks proportional to their
  // calendar days. Needs both a term_start and a term_end to anchor the span
  // (123 councils carry autumn-only next years - those get rows, no strip).
  const starts = dates.filter((e) => e.event_type === 'term_start');
  const ends = dates.filter((e) => e.event_type === 'term_end');
  let stripHtml = '';
  if (starts.length && ends.length) {
    const s0 = isoMs(starts[0].date);
    const s1 = isoMs(ends[ends.length - 1].date);
    const total = (s1 - s0) / DAY_MS;
    if (total > 30) {
      const brs = dates
        .filter((e) => !['term_start', 'term_end', 'half_term_end'].includes(e.event_type))
        .map((e) => ({ s: isoMs(e.date), e: isoMs(e.end_date || e.date), k: kindOf(e), label: e.label || TYPE_LABEL[e.event_type], d: e.date, de: e.end_date }))
        .filter((b) => b.s <= s1 && b.e >= s0)
        .sort((a, b) => a.s - b.s);
      const segs = [];
      let cur = s0;
      for (const b of brs) {
        const bs = Math.max(b.s, cur);
        const be = Math.min(b.e, s1);
        if (be < bs) continue; // swallowed by a previous range
        if (bs > cur) segs.push({ days: (bs - cur) / DAY_MS, k: 'term', title: 'Term time' });
        segs.push({ days: (be - bs) / DAY_MS + 1, k: b.k, title: `${b.label} · ${frShort(b.d, b.de)}` });
        cur = be + DAY_MS;
      }
      if (s1 > cur) segs.push({ days: (s1 - cur) / DAY_MS, k: 'term', title: 'Term time' });
      stripHtml = `
      <div class="strip">${segs.map((g) => `<div style="width:${(g.days / total * 100).toFixed(3)}%;min-width:${g.k === 'term' ? '0' : '3px'};background:${STRIP_COL[g.k] || STRIP_COL.term}" title="${esc(g.title)}"></div>`).join('')}</div>
      <div class="months"><span>${esc(monthLabelOf(starts[0].date))}</span><span>${esc(monthLabelOf(ends[ends.length - 1].date))}</span></div>`;
    }
  }

  return `
    <section class="yearcard">
      <div class="yearhead">
        <h2>${esc(year)}</h2>
        <div class="legend">
          <span><span class="sq" style="background:#E7DDF3"></span>Term time</span>
          <span><span class="sq" style="background:#E0A458"></span>Half term</span>
          <span><span class="sq" style="background:#E8724A"></span>Holiday</span>
        </div>
      </div>${stripHtml}
      <div class="rows">${rows}</div>
    </section>`;
}

/**
 * "Next up" countdown card: first event whose end is today or later, with a
 * "Now" state while inside a holiday. Friendly phrasing per the design:
 * term starts read "Back to school", term ends "School breaks up".
 */
function buildCountdown(authority, years) {
  const flat = [];
  years.forEach(({ dates }) => dates.forEach((e) => flat.push(e)));
  flat.sort((a, b) => isoMs(a.date) - isoMs(b.date));
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let ev = null, thenEv = null;
  for (let i = 0; i < flat.length; i++) {
    if (isoMs(flat[i].end_date || flat[i].date) >= today) { ev = flat[i]; thenEv = flat[i + 1] || null; break; }
  }
  if (!ev) return '';
  const k = kindOf(ev);
  const friendly = k === 'start' ? 'Back to school' : k === 'end' ? 'School breaks up' : (ev.label || TYPE_LABEL[ev.event_type]);
  let big, unit, sub;
  if (isoMs(ev.date) <= today) {
    big = 'Now'; unit = '';
    sub = `On now · ends ${fmtDate(ev.end_date || ev.date)}`;
  } else {
    const n = Math.round((isoMs(ev.date) - today) / DAY_MS);
    big = String(n);
    unit = n === 1 ? 'day away' : 'days away';
    sub = n === 1 ? `${fmtDate(ev.date)} · tomorrow` : fmtDate(ev.date);
  }
  const thenLine = thenEv ? `Then: ${thenEv.label || TYPE_LABEL[thenEv.event_type]} · ${frShort(thenEv.date, thenEv.end_date)}` : '';
  return `
    <div class="nextcard">
      <div class="nc-left">
        <div class="nc-eyebrow">Next up in ${esc(authority.name)}</div>
        <div class="nc-title">${esc(friendly)}</div>
        <div class="nc-sub">${esc(sub)}</div>
        ${thenLine ? `<div class="nc-then">${esc(thenLine)}</div>` : ''}
      </div>
      <div class="nc-stat">
        <div class="nc-big">${esc(big)}</div>
        ${unit ? `<div class="nc-unit">${esc(unit)}</div>` : ''}
      </div>
    </div>`;
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

// ── .ics download: the council's dates as an importable calendar snapshot ──
// Deliberately a STATIC file, not a live webcal feed: the page's upsell line
// is "changes added later won't reach this download - Housemait keeps them
// updated", and that stays honest only if the file really is a snapshot.

const icsEscape = (t) => String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 folds lines at 75 octets; our lines are short but council labels
// aren't under our control, so fold defensively.
function icsFold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 74) return line;
  const parts = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + 74, bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // don't split UTF-8
    parts.push(bytes.slice(start, end).toString('utf8'));
    start = end;
  }
  return parts.join('\r\n ');
}

const icsDate = (iso) => iso.replace(/-/g, '');
function icsDayAfter(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function buildIcs(authority, entries) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const pageUrl = `${CANONICAL_BASE}/${authority.slug}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Housemait//School Term Dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(`${authority.name} school term dates`)}`,
    'X-WR-TIMEZONE:Europe/London',
  ];
  for (const e of entries) {
    if (!e.date) continue;
    const label = e.label || TYPE_LABEL[e.event_type] || e.event_type;
    lines.push(
      'BEGIN:VEVENT',
      // Stable per (council, type, date): re-downloading upgrades events
      // in place instead of duplicating them.
      `UID:${authority.slug}-${e.event_type}-${e.date}@housemait.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(e.date)}`,
      `DTEND;VALUE=DATE:${icsDayAfter(e.end_date || e.date)}`,
      `SUMMARY:${icsEscape(`${label} — ${authority.name} schools`)}`,
      `DESCRIPTION:${icsEscape(`${authority.name} council's published calendar, via ${pageUrl}. This download is a snapshot - dates added or changed later won't appear in it.`)}`,
      `URL:${pageUrl}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** Shared header row + footer used by index (static) and council pages. */
const HEADER_HTML = `
    <div class="topbar">
      <a href="https://housemait.com" aria-label="Housemait — family organiser app" style="display:inline-flex"><img src="/school-term-dates/housemait-logo.svg" alt="Housemait" /></a>
      <a class="btn-try" href="https://housemait.com/signup?src=termdates">Try Housemait free</a>
    </div>`;

const FOOTER_HTML = `
    <footer class="site-footer">
      <a href="https://housemait.com" aria-label="Housemait — family organiser app" style="display:inline-flex"><img src="/school-term-dates/housemait-logo.svg" alt="Housemait" /></a>
      <p class="tag">Housemait is the family organiser app for busy households — a shared family calendar with school term dates built in, plus meal plans, shopping lists, tasks and a WhatsApp assistant.</p>
      <nav>
        <a href="https://housemait.com">Family organiser app</a>
        <a href="https://housemait.com/signup?src=termdates">Try Housemait free</a>
        <a href="https://housemait.com/support">Support</a>
        <a href="https://housemait.com/privacy">Privacy</a>
        <a href="https://housemait.com/terms">Terms</a>
      </nav>
      <p class="copy">© ${new Date().getFullYear()} Housemait. Term dates are sourced from official council calendars — always confirm with your school.</p>
    </footer>`;

/** The redesigned per-council page (design handoff: Council Term Dates). */
function detailPage({ title, description, canonicalPath, h1, sub, years, contentHtml = '', jsonLd, faqLd = null, slugForCta = '', authority = null }) {
  const yearBlocks = years.map(buildYearCard).join('');
  const countdownHtml = authority ? buildCountdown(authority, years) : '';
  const srcDomain = authority && authority.source_url
    ? authority.source_url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    : '';
  const sourceHtml = srcDomain
    ? `<p class="srcline">Source: <a href="${esc(authority.source_url)}" target="_blank" rel="nofollow noopener noreferrer">${esc(srcDomain)}</a> · re-checked monthly</p>`
    : '';

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
    @font-face { font-family: 'Recoleta'; src: url('/school-term-dates/fonts/Recoleta-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
    @font-face { font-family: 'Recoleta'; src: url('/school-term-dates/fonts/Recoleta-Medium.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #FBF8F3; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; color: #2D2A33; line-height: 1.6; -webkit-font-smoothing: antialiased; }
    a { color: #6B3FA0; }
    a:hover { color: #54317E; }
    .wrap { max-width: 880px; margin: 0 auto; padding: 26px 20px 72px; }

    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 30px; }
    .topbar img { height: 26px; width: auto; display: block; }
    .btn-try { display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border-radius: 10px; background: #6B3FA0; color: #FFFFFF; font-size: 13.5px; font-weight: 600; text-decoration: none; }
    .btn-try:hover { background: #5A3488; color: #FFFFFF; }

    .crumb { font-size: 13.5px; font-weight: 600; text-decoration: none; }
    h1 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: clamp(32px, 5.5vw, 46px); line-height: 1.08; letter-spacing: -0.02em; color: #6B3FA0; margin: 12px 0 8px; }
    .sub { color: #6B6774; font-size: 15.5px; margin: 0; max-width: 62ch; }

    .nextcard { display: flex; align-items: center; gap: 22px; background: #FFFFFF; border: 1px solid #E8E5EC; border-radius: 18px; padding: 20px 24px; box-shadow: 0 4px 16px rgba(107,63,160,0.08); margin: 24px 0 4px; flex-wrap: wrap; }
    .nc-left { flex: 1; min-width: 230px; }
    .nc-eyebrow { font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #E8724A; }
    .nc-title { font-family: 'Recoleta', Georgia, serif; font-size: 29px; color: #2D2A33; line-height: 1.15; margin-top: 4px; }
    .nc-sub { font-size: 14px; color: #6B6774; margin-top: 4px; }
    .nc-then { font-size: 13px; color: #6B6774; margin-top: 10px; }
    .nc-stat { text-align: center; background: #F3EDFC; border-radius: 14px; padding: 14px 22px; min-width: 92px; }
    .nc-big { font-family: 'Recoleta', Georgia, serif; font-size: 42px; line-height: 1; color: #6B3FA0; }
    .nc-unit { font-size: 12px; font-weight: 600; color: #6B3FA0; margin-top: 5px; }

    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 18px 0 8px; }
    .btn-ics { display: inline-flex; align-items: center; height: 46px; padding: 0 20px; border-radius: 12px; background: #6B3FA0; color: #FFFFFF; font-weight: 600; font-size: 14px; text-decoration: none; }
    .btn-ics:hover { background: #5A3488; color: #FFFFFF; }
    .btn-wa { display: inline-flex; align-items: center; height: 46px; padding: 0 20px; border-radius: 12px; border: 1.5px solid #6B3FA0; background: #FFFFFF; color: #6B3FA0; font-weight: 600; font-size: 14px; text-decoration: none; }
    .btn-wa:hover { background: #F3EDFC; color: #6B3FA0; }
    .ics-note { font-size: 12.5px; color: #6B6774; max-width: 64ch; margin: 0 0 6px; }

    .yearcard { background: #FFFFFF; border: 1px solid #E8E5EC; border-radius: 18px; padding: 22px 24px 14px; margin-top: 18px; box-shadow: 0 2px 8px rgba(107,63,160,0.06); }
    .yearhead { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px 18px; }
    .yearhead h2 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 26px; color: #6B3FA0; margin: 0; letter-spacing: -0.01em; }
    .legend { display: flex; gap: 14px; font-size: 11.5px; color: #6B6774; align-items: center; flex-wrap: wrap; }
    .legend > span { display: inline-flex; align-items: center; gap: 5px; }
    .legend .sq { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
    .strip { display: flex; height: 30px; border-radius: 9px; overflow: hidden; margin: 14px 0 5px; border: 1px solid #E8E5EC; }
    .months { display: flex; justify-content: space-between; font-size: 11px; color: #9B96A4; margin-bottom: 4px; }
    .rows { margin-top: 10px; }
    .row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 14px; padding: 9px 0; border-bottom: 1px solid #F0EDF3; }
    .row:last-child { border-bottom: none; }
    .row .when { width: 205px; flex-shrink: 0; font-weight: 600; font-size: 14px; }
    .row .lbl { flex: 1; min-width: 200px; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .row .pill { display: inline-block; font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 8px; white-space: nowrap; }
    .row .wdays { font-size: 12.5px; color: #6B6774; }

    .srcline { font-size: 12.5px; color: #6B6774; margin: 14px 0 0; }

    .ctaband { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; background: #6B3FA0; border-radius: 20px; padding: 28px 30px; margin-top: 36px; }
    .ctaband > div { flex: 1; min-width: 260px; }
    .ctaband h2 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 26px; color: #FFFFFF; margin: 0 0 6px; letter-spacing: -0.01em; }
    .ctaband p { font-size: 14.5px; color: rgba(255,255,255,0.85); margin: 0; max-width: 56ch; }
    .ctaband .btn-white { display: inline-flex; align-items: center; height: 48px; padding: 0 22px; border-radius: 12px; background: #FFFFFF; color: #6B3FA0; font-weight: 600; font-size: 14.5px; text-decoration: none; white-space: nowrap; }
    .ctaband .btn-white:hover { background: #F3EDFC; color: #6B3FA0; }

    .prose { margin-top: 40px; max-width: 68ch; }
    .prose h2 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 26px; color: #6B3FA0; margin: 0 0 10px; letter-spacing: -0.01em; }
    .prose h2:not(:first-child) { margin-top: 30px; }
    .prose h3 { font-size: 16px; font-weight: 600; color: #2D2A33; margin: 20px 0 4px; }
    .prose p { font-size: 14.5px; color: #4A4552; margin: 0 0 10px; }

    .site-footer { margin-top: 48px; padding-top: 28px; border-top: 1px solid #E8E5EC; }
    .site-footer img { display: block; height: 26px; width: auto; margin-bottom: 12px; }
    .site-footer .tag { font-size: 13.5px; color: #6B6774; max-width: 62ch; margin: 0 0 10px; }
    .site-footer nav { font-size: 13px; margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 6px 18px; }
    .site-footer nav a { font-weight: 600; text-decoration: none; }
    .site-footer .copy { font-size: 12px; color: #6B6774; margin: 0; }
  </style>
</head>
<body>
  <div class="wrap">${HEADER_HTML}
    <a class="crumb" href="/school-term-dates/">← All UK school term dates</a>
    <h1>${esc(h1)}</h1>
    <p class="sub">${esc(sub)}</p>
    ${countdownHtml}
    ${slugForCta ? `
    <div class="actions">
      <a class="btn-ics" href="/school-term-dates/${esc(slugForCta)}/term-dates.ics" download>Add to your calendar</a>
      <a class="btn-wa" href="https://wa.me/?text=${encodeURIComponent(`${h1} - ${CANONICAL_BASE}/${slugForCta}`)}" target="_blank" rel="noopener">Share on WhatsApp</a>
    </div>
    <p class="ics-note">The download is a snapshot — INSET days and changes added later won't reach your calendar. <a href="https://housemait.com/signup?src=termdates-ics">Housemait keeps them updated automatically</a>.</p>` : ''}
    ${yearBlocks || '<p class="sub" style="margin-top:24px">No term dates published yet.</p>'}
    ${sourceHtml}
    <div class="ctaband">
      <div>
        <h2>Get these dates on your family calendar</h2>
        <p>Housemait puts term dates, INSET days, school events and after-school activities on a shared family calendar — with reminders that pause in the holidays.</p>
      </div>
      <a class="btn-white" href="https://housemait.com/signup?src=termdates${slugForCta ? `&amp;la=${esc(slugForCta)}` : ''}">Try Housemait free</a>
    </div>
    ${contentHtml}${FOOTER_HTML}
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
    const authorities = (await laDb.listAllAuthorities())
      .filter((a) => ['ok', 'partial'].includes(a.import_status));

    // Group by first letter for the letter-headed grid + jump nav.
    const byLetter = new Map();
    for (const a of authorities) {
      const L = a.name[0].toUpperCase();
      if (!byLetter.has(L)) byLetter.set(L, []);
      byLetter.get(L).push(a);
    }
    const letters = [...byLetter.keys()];
    const lettersHtml = letters
      .map((L) => `<a href="#letter-${L}">${L}</a>`)
      .join('');
    const gridHtml = letters.map((L) => `
      <section class="letterSec" data-letter="${L}">
        <div class="letterHead" id="letter-${L}"><h2>${L}</h2><div class="rule"></div></div>
        <div class="cgrid">
          ${byLetter.get(L).map((a) => `<a class="ccard" data-name="${esc(a.name.toLowerCase())}" data-region="${esc(a.region || 'England')}" href="/school-term-dates/${esc(a.slug)}"><span class="cname">${esc(a.name)}</span><span class="csub">${esc(a.region || 'England')} · term dates &amp; holidays</span></a>`).join('\n          ')}
        </div>
      </section>`).join('');
    const countText = `${authorities.length} councils, A to Z — click one for its term dates`;

    // Server-inject the crawlable content; app.js only shows/hides it.
    const injected = html
      .replace('<!--SSR:COUNT-->', esc(countText))
      .replace('<!--SSR:LETTERS-->', lettersHtml)
      .replace('<!--SSR:GRID-->', gridHtml);
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
router.get('/:slug/term-dates.ics', async (req, res, next) => {
  try {
    if (!SLUG_RE.test(req.params.slug)) return next();
    const authority = await laDb.getAuthorityBySlug(req.params.slug);
    if (!authority || !['ok', 'partial'].includes(authority.import_status)) return next();
    const entries = withoutFinishedYears(await laDb.getEntriesForLA(authority.id));
    if (!entries.length) return next();
    res
      .set('Cache-Control', CACHE_HEADER)
      .set('Content-Disposition', `attachment; filename="${authority.slug}-term-dates.ics"`)
      .type('text/calendar; charset=utf-8')
      .send(buildIcs(authority, entries));
  } catch (err) {
    console.error('[term-dates-ssr] ics failed:', err.message);
    next();
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    if (!SLUG_RE.test(req.params.slug)) return next();
    const authority = await laDb.getAuthorityBySlug(req.params.slug);
    if (!authority || !['ok', 'partial'].includes(authority.import_status)) return next();
    const entries = withoutFinishedYears(await laDb.getEntriesForLA(authority.id));
    const years = groupByYear(entries);
    const content = buildCouncilContent(authority, years);
    const yearsLabel = years.map((y) => y.year).join(' and ');
    const title = `${authority.name} School Term Dates${yearsLabel ? ` ${yearsLabel}` : ''} & Holidays | Housemait`;
    const description = `Official ${authority.name} school term dates${yearsLabel ? ` for ${yearsLabel}` : ''} — term starts and ends, half terms and holidays, sourced from the council's own published calendar and refreshed monthly.`;
    res.set('Cache-Control', CACHE_HEADER).type('html').send(detailPage({
      title,
      description,
      canonicalPath: `/${authority.slug}`,
      slugForCta: authority.slug,
      authority,
      h1: `${authority.name} school term dates`,
      sub: `Council-published term and holiday dates for schools in ${authority.name}${authority.region ? ` (${authority.region})` : ''}. Academies and independents may differ — check with your school.`,
      years,
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
