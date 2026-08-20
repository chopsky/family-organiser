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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const laDb = require('../db/laTermDates');
const { academicYearsForCountry } = require('../services/term-date-extract');
const { summariseSeason } = require('../services/termDatesSeasonal');
const { fetchBankHolidaysEnglandWales, classifyBankHolidays } = require('../services/bankHolidays');

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
/**
 * Should this council appear on the public site?
 *
 * Deliberately keyed on DATA, not on import health. import_status records
 * whether the LAST refresh succeeded, which is a different question: a
 * council whose page started 403ing (Enfield, Richmond, Calderdale,
 * Blackpool, Blackburn with Darwen - all found 2026-08-19) flips to 'failed'
 * while still holding a complete, current calendar imported weeks earlier.
 * Gating the site on status silently 404'd five councils that had perfectly
 * good dates, breaking inbound links and de-indexing the pages. Stale data is
 * a separate concern, handled by the weekly freshness audit
 * (services/laTermDatesFreshness.js) and by withoutFinishedYears() below.
 */
function isListable(authority) {
  return (authority?.date_count || 0) > 0;
}

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

/**
 * Barking & Dagenham (uniquely, so far) publishes a PER-SCHOOL INSET table on
 * its council page - 42 of the dataset's 151 INSET rows are B&D's, each
 * naming the schools it applies to. Council-wide surfaces must not treat
 * those as borough-wide: they get their own collapsed section, stay out of
 * the .ics download, the countdown card and the year strip.
 *
 * Detection keys on proper-noun school names in the label ("Godwin Primary",
 * "The Warren School"), NOT on punctuation - other councils' generic labels
 * include dashed forms like "INSET Day - designated for all LEA Maintained
 * Schools" ("Schools" plural fails the singular \b match) and "Non-pupil
 * day - All schools", which must stay council-wide.
 */
const SCHOOL_NAME_RE = /\b[A-Z][A-Za-z'.-]+ (School|Primary|Academy|Infants?|Juniors?|College)\b/;
function isSchoolScopedInset(e) {
  if (e.event_type !== 'inset_day') return false;
  const label = e.label || '';
  return SCHOOL_NAME_RE.test(label) || /all schools except/i.test(label);
}

/** One academic-year card: heading + legend, proportional strip, event rows. */
function buildYearCard({ year, dates: allDates }) {
  const dates = allDates.filter((e) => !isSchoolScopedInset(e));
  const perSchool = allDates.filter(isSchoolScopedInset);
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
      <div class="rows">${rows}</div>${perSchool.length ? `
      <details class="perschool">
        <summary>Per-school INSET days (${perSchool.length}) — each applies only to the schools named</summary>
        <p class="ps-note">Published by the council for ${esc(year)}. Most councils don't publish these at all — your own school's newsletter is always the final word.</p>
        <div class="rows">${perSchool.map((e) => `<div class="row"><span class="when">${esc(frShort(e.date, e.end_date))}</span><span class="lbl">${esc(e.label || 'INSET day')}<span class="pill" style="background:#FDF0EB;color:#B8431F">INSET day</span></span><span class="wdays"></span></div>`).join('')}</div>
      </details>` : ''}
    </section>`;
}

/**
 * "Next up" countdown card: first event whose end is today or later, with a
 * "Now" state while inside a holiday. Friendly phrasing per the design:
 * term starts read "Back to school", term ends "School breaks up".
 */
function buildCountdown(authority, years) {
  const flat = [];
  years.forEach(({ dates }) => dates.forEach((e) => { if (!isSchoolScopedInset(e)) flat.push(e); }));
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
    insetCount: dates.filter((d) => d.event_type === 'inset_day' && !isSchoolScopedInset(d)).length,
    schoolInsetCount: dates.filter(isSchoolScopedInset).length,
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
    `Every state school in England and Wales takes five INSET days a year — staff-training days when pupils stay at home. They're chosen school by school, not by the council, so council calendars ${latestInset.f.schoolInsetCount ? `rarely list them — but ${name} is a rare exception: the council publishes each school's own INSET days, and ${latestInset.f.schoolInsetCount} school-specific dates for ${latestInset.year} are listed in their own section on this page` : latestInset.f.insetCount ? `list only some of them (${latestInset.f.insetCount} appear${latestInset.f.insetCount === 1 ? 's' : ''} here for ${latestInset.year})` : `rarely include them, this one included`}. Schools confirm their own INSET days in newsletters, usually termly — they're exactly the kind of date that slips through the cracks, and exactly what Housemait keeps on the family calendar for you.`,
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
    if (isSchoolScopedInset(e)) continue; // school-specific rows would spam most families' calendars
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

/**
 * "Nearby councils" cross-links: a cyclic window of six same-region
 * siblings (alphabetical, wrapping past Z), topped up from the full A–Z
 * list when a region is small. The cyclic window is the point: every
 * council page RECEIVES ~6 in-links as well as giving 6, instead of a
 * whole region piling its links onto the alphabetical head. Before this,
 * each of the ~176 council pages had exactly one internal in-link (the
 * index list), which is why Search Console parked 173 of them in
 * "Discovered – currently not indexed" — a mesh gives Google a crawl
 * path into every page from any entry point.
 */
function buildNearbyHtml(authority, allLive) {
  const others = allLive.filter((a) => a.slug !== authority.slug);
  if (!others.length) return '';
  const pick = [];
  const takeCyclic = (list) => {
    if (!list.length) return;
    let start = list.findIndex((a) => a.name.localeCompare(authority.name) > 0);
    if (start === -1) start = 0;
    for (let k = 0; k < list.length && pick.length < 6; k++) {
      const cand = list[(start + k) % list.length];
      if (!pick.some((p) => p.slug === cand.slug)) pick.push(cand);
    }
  };
  takeCyclic(others.filter((a) => a.region && a.region === authority.region));
  if (pick.length < 6) takeCyclic(others);
  if (!pick.length) return '';
  // A council that belongs to a region hub leads its mesh with the
  // whole-region comparison - the link a borough visitor actually wants.
  const hubSlug = hubForAuthority(authority);
  const hubLink = hubSlug
    ? `<a href="/school-term-dates/${hubSlug}"><strong>${esc(HUB_DEFS[hubSlug].name)}: ${esc(HUB_DEFS[hubSlug].label)} compared →</strong></a>`
    : '';
  return `
    <nav class="nearby" aria-label="More council term dates">
      <h2>More UK council term dates</h2>
      <div class="nearby-grid">
        ${hubLink}${pick.map((a) => `<a href="/school-term-dates/${esc(a.slug)}">${esc(a.name)}</a>`).join('\n        ')}
      </div>
      <p class="nearby-all"><a href="/school-term-dates/">Browse all UK councils →</a></p>
    </nav>`;
}

/**
 * Google Analytics — same GA4 property as housemait.com (page paths keep the
 * microsite separable in reports). Consent Mode v2 with every signal denied
 * and NO consent banner here, so GA only ever sends cookieless, anonymised
 * pings (traffic shape, no _ga cookies, no client ID) — the compliant
 * static-site counterpart of the main app's banner-gated setup in
 * web/index.html. The inline body is a separate constant so its CSP hash
 * below is always computed from exactly what ships.
 */
const GA_INLINE_JS = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied'
    });
    gtag('js', new Date());
    gtag('config', 'G-RY1QCM5JBG', { anonymize_ip: true });
  `;
const GA_SNIPPET = `
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-RY1QCM5JBG"></script>
  <script>${GA_INLINE_JS}</script>`;
const GA_INLINE_HASH = crypto.createHash('sha256').update(GA_INLINE_JS).digest('base64');

// Closes any open nav dropdown on an outside click. Native <details> never
// closes itself, so two open panels stack absurdly. Registered on document
// so it is safe to include in <head>; its sha256 joins the CSP alongside the
// GA snippet's - a new inline script silently no-ops under script-src 'self'.
const NAV_JS = `
    document.addEventListener('click', function (e) {
      document.querySelectorAll('details.navdrop[open]').forEach(function (d) {
        if (!d.contains(e.target)) d.removeAttribute('open');
      });
    });
    document.addEventListener('DOMContentLoaded', function () {
      if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      document.querySelectorAll('details.navdrop').forEach(function (d) {
        d.addEventListener('mouseenter', function () { d.open = true; });
        d.addEventListener('mouseleave', function () { d.open = false; });
      });
    });
  `;
const NAV_JS_HASH = crypto.createHash('sha256').update(NAV_JS).digest('base64');


// The app-wide helmet CSP is script-src 'self', which would silently kill
// both the gtag loader and the inline snippet — so these routes replace it
// with the same policy plus exactly what GA needs: the loader origin, the
// hash of our one inline script, and the ping/pixel endpoints.
const CSP_HEADER = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' https: data:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
  "object-src 'none'",
  `script-src 'self' https://www.googletagmanager.com 'sha256-${GA_INLINE_HASH}' 'sha256-${NAV_JS_HASH}'`,
  "script-src-attr 'none'",
  "style-src 'self' https: 'unsafe-inline'",
  // postcodes.io powers the index's find-my-council postcode lookup.
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://api.postcodes.io",
  'upgrade-insecure-requests',
].join(';');

/** Shared header row + footer used by index (static) and council pages. */
const HEADER_HTML = `
    <div class="topbar">
      <a class="brand" href="/school-term-dates/" aria-label="School term dates home"><img src="/school-term-dates/housemait-logo.svg" alt="Housemait" /></a>
      <a class="btn-try" href="https://housemait.com/gb?src=termdates">Try Housemait free</a>
    </div>`;

const FOOTER_HTML = `
    <footer class="site-footer">
      <a href="https://housemait.com" aria-label="Housemait — family organiser app" style="display:inline-flex"><img src="/school-term-dates/housemait-logo.svg" alt="Housemait" /></a>
      <p class="tag">Housemait is the family organiser app for busy households — a shared family calendar with school term dates built in, plus meal plans, shopping lists, tasks and a WhatsApp assistant.</p>
      <nav class="guides">
        <a href="/school-term-dates/when-do-schools-go-back">When do schools go back?</a>
        <a href="/school-term-dates/october-half-term">October half term</a>
        <a href="/school-term-dates/february-half-term">February half term</a>
        <a href="/school-term-dates/easter-holidays">Easter holidays</a>
        <a href="/school-term-dates/summer-holidays">Summer holidays</a>
        <a href="/school-term-dates/bank-holidays">Bank holidays</a>
        <a href="/school-term-dates/about-this-data">About this data</a>
      </nav>
      <nav class="guides" aria-label="Compare term dates by region">
        <a href="/school-term-dates/london">London</a>
        <a href="/school-term-dates/greater-manchester">Greater Manchester</a>
        <a href="/school-term-dates/west-midlands">West Midlands</a>
        <a href="/school-term-dates/merseyside">Merseyside</a>
        <a href="/school-term-dates/west-yorkshire">West Yorkshire</a>
        <a href="/school-term-dates/south-yorkshire">South Yorkshire</a>
        <a href="/school-term-dates/north-east">North East</a>
        <a href="/school-term-dates/wales">Wales</a>
      </nav>
      <nav>
        <a href="https://housemait.com">Family organiser app</a>
        <a href="https://housemait.com/gb?src=termdates">Try Housemait free</a>
        <a href="https://housemait.com/support">Support</a>
        <a href="https://housemait.com/privacy">Privacy</a>
        <a href="https://housemait.com/terms">Terms</a>
      </nav>
      <p class="copy">© ${new Date().getFullYear()} Housemait. Term dates are sourced from official council calendars — always confirm with your school.</p>
    </footer>`;

/** The redesigned per-council page (design handoff: Council Term Dates). */
function detailPage({ title, description, canonicalPath, h1, sub, years, contentHtml = '', nearbyHtml = '', jsonLd, faqLd = null, slugForCta = '', authority = null }) {
  const yearBlocks = years.map(buildYearCard).join('');
  const countdownHtml = authority ? buildCountdown(authority, years) : '';
  const srcDomain = authority && authority.source_url
    ? authority.source_url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    : '';
  // The strongest trust signal the page carries: the actual date we last
  // read the council's own calendar, not just a promise of a cadence.
  const checkedOn = authority && authority.last_imported_at
    ? fmtDate(String(authority.last_imported_at).slice(0, 10)).replace(/^\w+ /, '')
    : null;
  const sourceHtml = srcDomain
    ? `<p class="srcline">Source: <a href="${esc(authority.source_url)}" target="_blank" rel="nofollow noopener noreferrer">${esc(srcDomain)}</a>${checkedOn ? ` · checked ${esc(checkedOn)}` : ''} · re-checked monthly</p>`
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
  <link rel="stylesheet" href="/school-term-dates/site.css?v=5" />
  <style>


    .crumb { font-size: 13.5px; font-weight: 600; text-decoration: none; }

    .nextcard { display: flex; align-items: center; gap: 22px; background: #FFFFFF; border: 1px solid #E8E5EC; border-radius: 18px; padding: 20px 24px; box-shadow: 0 4px 16px rgba(107,63,160,0.08); margin: 24px 0 4px; flex-wrap: wrap; }
    .nc-left { flex: 1; min-width: 230px; }
    .nc-eyebrow { font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #E8724A; }
    .nc-title { font-family: 'Recoleta', Georgia, serif; font-size: 29px; color: #2D2A33; line-height: 1.15; margin-top: 4px; }
    .nc-sub { font-size: 14px; color: #6B6774; margin-top: 4px; }
    .nc-then { font-size: 13px; color: #6B6774; margin-top: 10px; }
    .nc-stat { text-align: center; background: #F3EDFC; border-radius: 14px; padding: 14px 22px; min-width: 92px; }
    .nc-big { font-family: 'Recoleta', Georgia, serif; font-size: 42px; line-height: 1; color: #6B3FA0; }
    .nc-unit { font-size: 12px; font-weight: 600; color: #6B3FA0; margin-top: 5px; }

    .nearby { margin-top: 34px; }
    .nearby h2 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 24px; color: #2D2A33; margin: 0 0 12px; }
    .nearby-grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .nearby-grid a { display: inline-flex; padding: 9px 14px; border-radius: 999px; background: #FFFFFF; border: 1px solid #E8E5EC; font-size: 13.5px; font-weight: 600; color: #6B3FA0; text-decoration: none; }
    .nearby-grid a:hover { border-color: #6B3FA0; }
    .nearby-all { margin: 12px 0 0; font-size: 13.5px; }
    .nearby-all a { color: #6B3FA0; font-weight: 600; text-decoration: none; }
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

    .perschool { margin-top: 14px; border-top: 1px dashed #E8E5EC; padding-top: 12px; }
    .perschool summary { cursor: pointer; font-size: 13.5px; font-weight: 600; color: #6B6774; }
    .perschool summary:hover { color: #6B3FA0; }
    .perschool .ps-note { font-size: 12.5px; color: #6B6774; margin: 10px 0 4px; }
    .srcline { font-size: 12.5px; color: #6B6774; margin: 14px 0 0; }

    .ctaband { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; background: #6B3FA0; border-radius: 20px; padding: 28px 30px; margin-top: 36px; }
    .ctaband > div { flex: 1; min-width: 260px; }
    .ctaband h2 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 26px; color: #FFFFFF; margin: 0 0 6px; letter-spacing: -0.01em; }
    .ctaband p { font-size: 14.5px; color: rgba(255,255,255,0.85); margin: 0; max-width: 56ch; }
    .ctaband p.trial { font-weight: 600; color: #FFFFFF; margin-top: 8px; font-size: 13.5px; }
    .ctaband .btn-white { display: inline-flex; align-items: center; height: 48px; padding: 0 22px; border-radius: 12px; background: #FFFFFF; color: #6B3FA0; font-weight: 600; font-size: 14.5px; text-decoration: none; white-space: nowrap; }
    .ctaband .btn-white:hover { background: #F3EDFC; color: #6B3FA0; }

    .prose { margin-top: 40px; max-width: 68ch; }
    .prose h2 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 26px; color: #6B3FA0; margin: 0 0 10px; letter-spacing: -0.01em; }
    .prose h2:not(:first-child) { margin-top: 30px; }
    .prose h3 { font-size: 16px; font-weight: 600; color: #2D2A33; margin: 20px 0 4px; }
    .prose p { font-size: 14.5px; color: #4A4552; margin: 0 0 10px; }

    @media print {
      .topbar .btn-try, .crumb, .actions, .ctaband, .nearby, .prose, .site-footer { display: none !important; }
      .yearcard { box-shadow: none; border: 1px solid #ccc; break-inside: avoid; }
      .srcline { margin-top: 16px; }
    }
  </style>${GA_SNIPPET}
  <script>${NAV_JS}</script>
</head>
<body>
  <div class="wrap">${HEADER_HTML}${navBar('councils')}
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
        <h2>The term dates are the easy bit</h2>
        <p>Housemait runs the whole school year for the whole household: term dates and INSET days on a calendar
          everyone shares, party invites photographed straight into the diary on WhatsApp, clubs that pause
          themselves for half term — plus meals, shopping lists and chores the kids actually do.</p>
        <p class="trial">Free for 30 days · no card needed</p>
      </div>
      <a class="btn-white" href="https://housemait.com/gb?src=termdates${slugForCta ? `&amp;la=${esc(slugForCta)}` : ''}">Try Housemait free</a>
    </div>
    ${contentHtml}${nearbyHtml}${FOOTER_HTML}
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


// ── Seasonal guide pages ─────────────────────────────────────────────────────
// Evergreen URLs (/october-half-term, not /october-half-term-2026) so link
// equity accumulates year over year; titles and content carry the year and
// roll automatically with the academic calendar, using the importer's season
// logic (May-Aug looks at the NEXT academic year - families plan September).

const SEASONAL_SLUGS = ['when-do-schools-go-back', 'october-half-term', 'february-half-term', 'easter-holidays', 'summer-holidays'];

function seasonalDefs() {
  const { currentAY, nextAY } = academicYearsForCountry('GB');
  const month = new Date().getUTCMonth(); // 4..7 = May..Aug
  const ay = month >= 4 && month <= 7 ? nextAY : currentAY;
  const y1 = parseInt(ay, 10);
  const y2 = y1 + 1;
  const ayLabel = `${y1}/${String(y2).slice(2)}`;
  return {
    ay, y1, y2, ayLabel,
    pages: {
      'when-do-schools-go-back': {
        cfg: { ay, mode: 'start', from: `${y1}-08-10`, to: `${y1}-09-30` },
        title: `When Do Schools Go Back in September ${y1}? Every UK Council | Housemait`,
        description: `The first day of the ${ayLabel} school year for all 176 councils in England and Wales, from each council's own published calendar.`,
        h1: `When do schools go back in September ${y1}?`,
        navLabel: 'When do schools go back?',
        sub: `The first day of the ${ayLabel} school year, council by council, taken from each council's own published calendar.`,
        noun: 'first day back',
      },
      'october-half-term': {
        cfg: { ay, mode: 'break', from: `${y1}-10-01`, to: `${y1}-11-15` },
        title: `October Half Term ${y1} Dates for Every UK Council | Housemait`,
        description: `October ${y1} half-term dates for all 176 councils in England and Wales - including the councils taking a different week from everyone else.`,
        h1: `October half term ${y1}`,
        navLabel: 'October half term',
        sub: 'The autumn half-term week for every council in England and Wales - and it is not the same week everywhere.',
        noun: 'October half term',
      },
      'february-half-term': {
        cfg: { ay, mode: 'break', from: `${y2}-01-25`, to: `${y2}-03-05` },
        title: `February Half Term ${y2} Dates for Every UK Council | Housemait`,
        description: `February ${y2} half-term (spring half-term) dates for all 176 councils in England and Wales, including the England-Wales split.`,
        h1: `February half term ${y2}`,
        navLabel: 'February half term',
        sub: 'The spring half-term week for every council in England and Wales. Wales takes a different week from most of England.',
        noun: 'February half term',
      },
      'easter-holidays': {
        cfg: { ay, mode: 'break', from: `${y2}-03-01`, to: `${y2}-05-05` },
        title: `Easter School Holidays ${y2} for Every UK Council | Housemait`,
        description: `Easter ${y2} school holiday dates for all 176 councils in England and Wales, from each council's own published calendar.`,
        h1: `Easter school holidays ${y2}`,
        navLabel: 'Easter holidays',
        sub: 'When schools break up for Easter and go back, for every council in England and Wales.',
        noun: 'Easter holidays',
      },
      'summer-holidays': {
        cfg: { ay, mode: 'end', from: `${y2}-06-01`, to: `${y2}-08-15` },
        title: `When Do Schools Break Up for Summer ${y2}? Every UK Council | Housemait`,
        description: `The last day of the ${ayLabel} school year for all 176 councils in England and Wales - break-up dates vary by up to three weeks.`,
        h1: `When do schools break up for summer ${y2}?`,
        navLabel: 'Summer holidays',
        sub: `The last day of the ${ayLabel} school year, council by council. The spread is wider than most families expect.`,
        noun: 'summer break-up',
      },
    },
  };
}

const fmtNoDow = (iso) => fmtDate(iso).replace(/^\w+ /, '');
const seasonalRange = (g) => (g.last && g.last !== g.first ? `${fmtDate(g.first)} to ${fmtDate(g.last)}` : fmtDate(g.first));

/** Data-driven intro + FAQ for a seasonal page - only states what the data shows. */
function seasonalNarrative(def, defs, result) {
  const total = result.perCouncil.length;
  if (!total) return { intro: '', faq: [] };
  const big = result.groups[0];
  const spreadFirst = result.perCouncil.reduce((m, c) => (c.first < m.first ? c : m), result.perCouncil[0]);
  const spreadLast = result.perCouncil.reduce((m, c) => (c.first > m.first ? c : m), result.perCouncil[0]);
  const nameFew = (councils, cap = 3) => councils.slice(0, cap).map((c) => c.name).join(', ') + (councils.length > cap ? ` and ${councils.length - cap} more` : '');
  const earlyGroup = result.perCouncil.filter((c) => c.first === spreadFirst.first);
  const lateGroup = result.perCouncil.filter((c) => c.first === spreadLast.first);

  // Only call out the ends of the spread when they genuinely differ from the
  // common date - "the latest is X (145 councils)" reads absurd when X IS the
  // common date.
  const callouts = [];
  if (spreadFirst.first !== big.first) callouts.push(`the earliest is <strong>${esc(fmtNoDow(spreadFirst.first))}</strong> (${esc(nameFew(earlyGroup))})`);
  if (spreadLast.first !== big.first) callouts.push(`the latest <strong>${esc(fmtNoDow(spreadLast.first))}</strong> (${esc(nameFew(lateGroup))})`);
  const spreadLine = callouts.length ? ` But it is not universal: ${callouts.join(' and ')}.` : '';
  const intro = `<p>The most common ${esc(def.noun)} for ${esc(defs.ayLabel)} is <strong>${esc(seasonalRange(big))}</strong>, shared by ${big.count} of the ${total} councils with confirmed dates.${spreadLine} Council dates formally apply to community and voluntary-controlled schools - academies and free schools set their own, usually close by. Always confirm with your own school.</p>`;

  const faq = [
    { q: `When is ${def.noun} ${def.cfg.mode === 'start' || def.cfg.mode === 'break' ? 'for most councils' : 'for most schools'} in ${defs.ayLabel}?`,
      a: `For most of England and Wales, ${seasonalRange(big)} - that is the date ${big.count} of ${total} councils publish. The full council-by-council list is on this page, each linking to that council's own calendar.` },
    { q: 'Why do neighbouring councils have different dates?',
      a: 'Each local authority consults on and sets its own calendar. Most follow a common pattern, but councils can and do move weeks - which is why families near a council boundary should check the right council, not the nearest one.' },
    { q: 'Do academies and free schools follow these dates?',
      a: 'Not automatically. Council term dates formally apply to community and voluntary-controlled schools; academies, free schools and foundation schools set their own, though most stay within a day or two of the council calendar. Your school’s own published dates are the final word.' },
  ];
  return { intro, faq };
}


const SEASONAL_CSS = `
    /* Page-specific extras only - the shared system lives in site.css. */`;

function guidesStrip(exceptSlug) {
  const defs = seasonalDefs();
  const links = SEASONAL_SLUGS.filter((s) => s !== exceptSlug)
    .map((s) => `<a href="/school-term-dates/${s}">${esc(defs.pages[s].navLabel)}</a>`)
    .join('');
  const hubs = HUB_SLUGS.map((s) => `<a href="/school-term-dates/${s}">${esc(HUB_DEFS[s].name)}</a>`).join('');
  return `<h2>More term-date guides</h2><div class="guides-strip">${links}<a href="/school-term-dates/bank-holidays">Bank holidays</a><a href="/school-term-dates/about-this-data">About this data</a></div><div class="guides-strip" style="margin-top:8px">${hubs}</div>`;
}

function seasonalPage(slug, result) {
  const defs = seasonalDefs();
  const def = defs.pages[slug];
  const { intro, faq } = seasonalNarrative(def, defs, result);
  const canonical = `${CANONICAL_BASE}/${slug}`;

  const cards = result.groups.map((g) => {
    const sample = g.councils.slice(0, 4).map((c) => c.name).join(', ');
    const more = g.councils.length > 4 ? ` +${g.councils.length - 4} more` : '';
    return `<div class="gcard"><div class="when">${esc(seasonalRange(g))}</div><span class="count">${g.count} council${g.count === 1 ? '' : 's'}</span><div class="who">${esc(sample)}${esc(more)}</div></div>`;
  }).join('');

  const tableRows = result.perCouncil.map((c) =>
    `<tr><td><a href="/school-term-dates/${esc(c.slug)}">${esc(c.name)}</a></td><td>${esc(seasonalRange(c))}</td></tr>`).join('\n');

  const unresolvedHtml = result.unresolved.length
    ? `<p class="note">We could not derive the ${esc(def.noun)} from the published structure for ${result.unresolved.map((u) => `<a href="/school-term-dates/${esc(u.slug)}">${esc(u.name)}</a>`).join(', ')} - check those councils' own pages via the links.</p>`
    : '';

  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'UK School Term Dates', item: `${CANONICAL_BASE}/` },
    { '@type': 'ListItem', position: 2, name: def.h1, item: canonical },
  ] };

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(def.title)}</title>
  <meta name="description" content="${esc(def.description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:title" content="${esc(def.title)}" />
  <meta property="og:description" content="${esc(def.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${CANONICAL_BASE}/og-share.png" />
  <script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
  <script type="application/ld+json">${JSON.stringify(faqLd)}</script>
  <link rel="stylesheet" href="/school-term-dates/site.css?v=5" />
  <style>${SEASONAL_CSS}</style>${GA_SNIPPET}
  <script>${NAV_JS}</script>
</head>
<body>
  <div class="wrap">${HEADER_HTML}${navBar('dates', slug)}
    <h1>${esc(def.h1)}</h1>
    <p class="sub">${esc(def.sub)}</p>
    <div class="prose">${intro}</div>
    <h2>At a glance</h2>
    <div class="gcards">${cards}</div>
    <h2>Every council</h2>
    <div class="tableWrap"><table><thead><tr><th>Council</th><th>${esc(def.noun)}</th></tr></thead><tbody>
${tableRows}
    </tbody></table></div>
    ${unresolvedHtml}
    <h2>Common questions</h2>
    <div class="prose">${faq.map((f) => `<p><strong>${esc(f.q)}</strong><br/>${esc(f.a)}</p>`).join('')}</div>
    ${guidesStrip(slug)}
    ${FOOTER_HTML}
  </div>
</body>
</html>`;
}

function aboutPage(stats) {
  const canonical = `${CANONICAL_BASE}/about-this-data`;
  const title = 'About This Term-Dates Data | Housemait';
  const lastRun = stats && stats.lastRun && stats.lastRun.started_at ? fmtNoDow(String(stats.lastRun.started_at).slice(0, 10)) : null;
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="Where Housemait's UK school term-dates directory comes from: every council's own published calendar, re-checked monthly, with honest caveats." />
  <link rel="canonical" href="${esc(canonical)}" />
  <link rel="stylesheet" href="/school-term-dates/site.css?v=5" />
  <style>${SEASONAL_CSS}</style>${GA_SNIPPET}
  <script>${NAV_JS}</script>
</head>
<body>
  <div class="wrap">${HEADER_HTML}${navBar('about')}
    <h1>About this data</h1>
    <p class="sub">What this directory is, where every date comes from, and what you should still double-check.</p>
    <div class="prose">
      <h2>Where the dates come from</h2>
      <p>Every date in this directory is taken from the relevant council's own published term-dates calendar - the page or PDF the council itself maintains. Each council page here links to that source at the bottom and shows the date we last checked it. Nothing is estimated, crowd-sourced or copied from other aggregator sites.</p>
      <p>The directory currently covers <strong>${stats ? stats.total : 176} local education authorities</strong> across England and Wales${stats ? `, tracking <strong>${stats.dateCount} dated entries</strong>` : ''}. It is rebuilt monthly${lastRun ? ` (most recent refresh: ${esc(lastRun)})` : ''}, and a separate weekly audit checks that every council's stored calendar still runs into the current school year.</p>
      <h2>What to double-check</h2>
      <p>Council term dates formally apply to community and voluntary-controlled schools. Academies, free schools and foundation schools set their own calendars - most stay within a day or two of the council's, but not all. A few councils also publish named exceptions for individual schools; where they do, we keep those out of the council-wide summary.</p>
      <p>Every state school also takes five INSET days a year, chosen school by school - so they rarely appear in council calendars, this one included. Your school's own published dates are always the final word.</p>
      <h2>Why Scotland and Northern Ireland are not listed</h2>
      <p>Scotland and Northern Ireland set school holidays through separate systems, so their dates are not part of this directory yet.</p>
      <h2>Spotted an error?</h2>
      <p>If a date here disagrees with your council's own page, we want to know: email <a href="mailto:hello@housemait.com">hello@housemait.com</a> with the council name and we will re-check it against the source.</p>
      <h2>Who builds this</h2>
      <p>This directory is built and maintained by <a href="https://housemait.com">Housemait</a>, a family organiser app for UK households. It is free to use, free to link to, and has no signup wall - the same data powers the term-dates features inside the app.</p>
    </div>
    ${guidesStrip(null)}
    ${FOOTER_HTML}
  </div>
</body>
</html>`;
}


// ── Region hub pages ─────────────────────────────────────────────────────────
// Metro-area comparison tables ("all 32 London boroughs side by side"). The
// groupings are hand-defined by slug (the DB's region column only splits
// England/Wales) and were validated against la_directory before shipping;
// resolution is defensive anyway - an unknown slug is skipped, never invented.

const HUB_DEFS = {
  london: {
    name: 'London', label: 'all 32 boroughs', membersBy: 'slugs',
    slugs: ['barking-and-dagenham', 'barnet', 'bexley', 'brent', 'bromley', 'camden', 'croydon', 'ealing', 'enfield', 'greenwich', 'hackney', 'hammersmith-and-fulham', 'haringey', 'harrow', 'havering', 'hillingdon', 'hounslow', 'islington', 'kensington-and-chelsea', 'kingston-upon-thames', 'lambeth', 'lewisham', 'merton', 'newham', 'redbridge', 'richmond-upon-thames', 'southwark', 'sutton', 'tower-hamlets', 'waltham-forest', 'wandsworth', 'westminster'],
  },
  'greater-manchester': {
    name: 'Greater Manchester', label: 'all ten boroughs', membersBy: 'slugs',
    slugs: ['manchester', 'salford', 'stockport', 'tameside', 'oldham', 'rochdale', 'bury', 'bolton', 'wigan', 'trafford'],
  },
  'west-midlands': {
    name: 'West Midlands', label: 'the seven metropolitan boroughs', membersBy: 'slugs',
    slugs: ['birmingham', 'coventry', 'dudley', 'sandwell', 'solihull', 'walsall', 'wolverhampton'],
  },
  merseyside: {
    name: 'Merseyside', label: 'all five boroughs', membersBy: 'slugs',
    slugs: ['liverpool', 'wirral', 'sefton', 'knowsley', 'st-helens'],
  },
  'west-yorkshire': {
    name: 'West Yorkshire', label: 'all five districts', membersBy: 'slugs',
    slugs: ['leeds', 'bradford', 'kirklees', 'calderdale', 'wakefield'],
  },
  'south-yorkshire': {
    name: 'South Yorkshire', label: 'all four districts', membersBy: 'slugs',
    slugs: ['sheffield', 'barnsley', 'doncaster', 'rotherham'],
  },
  'north-east': {
    name: 'North East England', label: 'Tyne and Wear, Northumberland and Durham', membersBy: 'slugs',
    slugs: ['newcastle-upon-tyne', 'gateshead', 'north-tyneside', 'south-tyneside', 'sunderland', 'northumberland', 'county-durham'],
  },
  wales: {
    name: 'Wales', label: 'all 22 Welsh authorities', membersBy: 'region', region: 'Wales',
    note: 'Wales publishes a national approved calendar (gov.wales), so most authorities align - but the spring half term falls a week earlier than in most of England, which matters for cross-border families and holiday pricing.',
  },
};
const HUB_SLUGS = Object.keys(HUB_DEFS);

// slug -> its hub, for the contextual "compare the whole region" link on
// council pages. Region-membership hubs (Wales) resolve at request time.
const SLUG_TO_HUB = {};
for (const [hubSlug, def] of Object.entries(HUB_DEFS)) {
  (def.slugs || []).forEach((s) => { SLUG_TO_HUB[s] = hubSlug; });
}
function hubForAuthority(authority) {
  if (authority.region === 'Wales') return 'wales';
  return SLUG_TO_HUB[authority.slug] || null;
}

function hubMembers(def, authorities) {
  if (def.membersBy === 'region') return authorities.filter((a) => a.region === def.region);
  const wanted = new Set(def.slugs);
  return authorities.filter((a) => wanted.has(a.slug));
}

function hubPage(hubSlug, members, entries) {
  const def = HUB_DEFS[hubSlug];
  const defs = seasonalDefs();
  const canonical = `${CANONICAL_BASE}/${hubSlug}`;

  // One seasonal question per comparison column, restricted to the members.
  const cols = [
    { key: 'start', heading: 'First day back', cfg: defs.pages['when-do-schools-go-back'].cfg },
    { key: 'oct', heading: 'October half term', cfg: defs.pages['october-half-term'].cfg },
    { key: 'feb', heading: 'February half term', cfg: defs.pages['february-half-term'].cfg },
    { key: 'summer', heading: 'Summer break-up', cfg: defs.pages['summer-holidays'].cfg },
  ];
  const byCol = {};
  for (const col of cols) {
    const r = summariseSeason(members, entries, col.cfg);
    byCol[col.key] = new Map(r.perCouncil.map((c) => [c.slug, c]));
  }

  const rows = [...members].sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
    const cells = cols.map((col) => {
      const v = byCol[col.key].get(m.slug);
      return `<td>${v ? esc(seasonalRange(v)) : '&mdash;'}</td>`;
    }).join('');
    return `<tr><td><a href="/school-term-dates/${esc(m.slug)}">${esc(m.name)}</a></td>${cells}</tr>`;
  }).join('\n');

  // Data-driven intro: does the area agree on the start date?
  const starts = members.map((m) => byCol.start.get(m.slug)).filter(Boolean);
  const startDates = [...new Set(starts.map((s) => s.first))].sort();
  let aligned = '';
  if (starts.length && startDates.length === 1) {
    aligned = `All ${starts.length} go back on <strong>${esc(fmtDate(startDates[0]))}</strong>.`;
  } else if (starts.length) {
    const spread = startDates.map((d) => {
      const who = starts.filter((s) => s.first === d);
      return `<strong>${esc(fmtNoDow(d))}</strong> (${who.length === 1 ? esc(who[0].name) : `${who.length} councils`})`;
    }).join(', ');
    aligned = `They do not all go back on the same day: ${spread}.`;
  }

  const title = `${def.name} School Term Dates ${defs.ayLabel}: ${def.label.charAt(0).toUpperCase() + def.label.slice(1)} Compared | Housemait`;
  const description = `Term dates for ${def.label} in ${def.name} for ${defs.ayLabel}, side by side: first day back, half terms and summer break-up, from each council's own calendar.`;
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'UK School Term Dates', item: `${CANONICAL_BASE}/` },
    { '@type': 'ListItem', position: 2, name: `${def.name} term dates`, item: canonical },
  ] };

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${CANONICAL_BASE}/og-share.png" />
  <script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
  <link rel="stylesheet" href="/school-term-dates/site.css?v=5" />
  <style>${SEASONAL_CSS}</style>${GA_SNIPPET}
  <script>${NAV_JS}</script>
</head>
<body>
  <div class="wrap">${HEADER_HTML}${navBar('regions', hubSlug)}
    <h1>${esc(def.name)} school term dates</h1>
    <p class="sub">The ${esc(defs.ayLabel)} school year for ${esc(def.label)}, compared in one table - from each council's own published calendar.</p>
    <div class="prose"><p>${aligned}${def.note ? ` ${esc(def.note)}` : ''} Council dates formally apply to community and voluntary-controlled schools - academies and free schools set their own, usually close by. Click any council for its full calendar, source link and free add-to-phone download.</p></div>
    <div class="tableWrap"><table><thead><tr><th>Council</th>${cols.map((c) => `<th>${esc(c.heading)}</th>`).join('')}</tr></thead><tbody>
${rows}
    </tbody></table></div>
    <p class="note">A dash means that answer could not be derived from the council's published structure - check the council's own page via its link.</p>
    ${guidesStrip(null)}
    ${FOOTER_HTML}
  </div>
</body>
</html>`;
}


// ── Bank holidays × the school year ─────────────────────────────────────────
// GOV.UK's official England & Wales list, annotated with the question parents
// actually have: does this bank holiday fall in term time (an extra day off
// school) or inside a school break (children are off anyway)?

function bankHolidayPage(annotated, defs) {
  const canonical = `${CANONICAL_BASE}/bank-holidays`;
  const title = `Bank Holidays ${defs.y1}/${defs.y2} and the School Year (England & Wales) | Housemait`;
  const description = `Every England and Wales bank holiday to summer ${defs.y2}, with the answer schools never spell out: is it an extra day off school, or are children on holiday anyway?`;

  const badge = {
    'extra-day': ['Extra day off school', '#EDF5EE', '#3E7444'],
    'already-off': ['Schools already closed', '#F3EDFC', '#6B3FA0'],
    mixed: ['Depends on your council', '#FBF1DE', '#936314'],
  };
  const rows = annotated.map((h) => {
    const [label, bg, fg] = badge[h.verdict];
    const resolved = h.counts.termTime + h.counts.off;
    let detail = '';
    if (h.verdict === 'extra-day') {
      detail = `Falls in term time for ${h.counts.termTime} of ${resolved} councils — schools close for the bank holiday, so it's a genuine extra day off.`;
      if (h.exceptions.length) detail += ` Already on holiday anyway in ${h.exceptions.map((x) => `<a href="/school-term-dates/${esc(x.slug)}">${esc(x.name)}</a>`).join(', ')}.`;
    } else if (h.verdict === 'already-off') {
      detail = `Falls inside the school holidays for ${h.counts.off} of ${resolved} councils — children are off anyway, so no extra day.`;
      if (h.exceptions.length) detail += ` The exception${h.exceptions.length > 1 ? 's' : ''}: term time in ${h.exceptions.map((x) => `<a href="/school-term-dates/${esc(x.slug)}">${esc(x.name)}</a>`).join(', ')}, where it IS an extra day off.`;
    } else {
      detail = `Genuinely split: term time for ${h.counts.termTime} councils, inside school holidays for ${h.counts.off}. Check your council's page.`;
    }
    return `<div class="gcard bh"><div class="when">${esc(fmtDate(h.date))}</div><div class="bh-title">${esc(h.title)}</div><span class="count" style="background:${bg};color:${fg}">${esc(label)}</span><div class="who">${detail}</div></div>`;
  }).join('');

  const faq = [
    { q: 'Do schools close on bank holidays?', a: 'Yes - state schools in England and Wales close on bank holidays. Whether that means an extra day off depends on the calendar: a bank holiday in term time adds a day off, while one that falls inside half term or the summer break changes nothing, because children are off anyway.' },
    { q: `Which bank holidays give children an extra day off in ${defs.ayLabel}?`, a: 'Typically the early May bank holiday is the only one that falls squarely in term time for most councils - the spring bank holiday usually sits inside the late-May half term, Good Friday and Easter Monday inside the Easter break, and the August and Christmas holidays inside school holidays. The list above shows the picture council by council.' },
    { q: 'Are bank holidays the same across the UK?', a: 'England and Wales share one list (shown here). Scotland and Northern Ireland have their own, with differences such as 2 January and St Patrick’s Day.' },
  ];
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'UK School Term Dates', item: `${CANONICAL_BASE}/` },
    { '@type': 'ListItem', position: 2, name: 'Bank holidays and the school year', item: canonical },
  ] };

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${CANONICAL_BASE}/og-share.png" />
  <script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
  <script type="application/ld+json">${JSON.stringify(faqLd)}</script>
  <link rel="stylesheet" href="/school-term-dates/site.css?v=5" />
  <style>${SEASONAL_CSS}
    .bh { max-width: 640px; }
    .bh .bh-title { font-family: 'Recoleta', Georgia, serif; font-size: 20px; color: #6B3FA0; margin-top: 2px; }
    .gcards.one-col { grid-template-columns: 1fr; }
  </style>${GA_SNIPPET}
  <script>${NAV_JS}</script>
</head>
<body>
  <div class="wrap">${HEADER_HTML}${navBar('dates', 'bank-holidays')}
    <h1>Bank holidays and the school year</h1>
    <p class="sub">Every England &amp; Wales bank holiday to summer ${defs.y2} - and whether it's a genuine extra day off school, or falls when children are on holiday anyway. Dates from GOV.UK; school calendars from each council's own published dates.</p>
    <div class="gcards one-col">${rows}</div>
    <h2>Common questions</h2>
    <div class="prose">${faq.map((f) => `<p><strong>${esc(f.q)}</strong><br/>${esc(f.a)}</p>`).join('')}</div>
    ${guidesStrip(null)}
    ${FOOTER_HTML}
  </div>
</body>
</html>`;
}


// ── Site navigation ─────────────────────────────────────────────────────────
// One slim bar on every page: All councils · Key dates ▾ · Regions ▾ · About.
// The dropdowns are native <details> disclosures - no JS, keyboard and mobile
// friendly - grouping what used to be a 15-pill blob into its two natural
// families. Active page gets the plum-light pill (the app's nav convention).

function navBar(active, activeSlug) {
  const defs = seasonalDefs();
  const cur = (k) => (active === k ? ' aria-current="page"' : '');
  const curLink = (s) => (activeSlug === s ? ' aria-current="page"' : '');
  const dateLinks = SEASONAL_SLUGS.map((s) => `<a href="/school-term-dates/${s}"${curLink(s)}>${esc(defs.pages[s].navLabel)}</a>`).join('')
    + `<a href="/school-term-dates/bank-holidays"${curLink('bank-holidays')}>Bank holidays</a>`;
  const regionLinks = HUB_SLUGS.map((s) => `<a href="/school-term-dates/${s}"${curLink(s)}>${esc(HUB_DEFS[s].name)}</a>`).join('');
  return `
    <nav class="sitenav" aria-label="Term dates sections">
      <a href="/school-term-dates/"${cur('councils')}><span class="lbl-full">All councils</span><span class="lbl-short">Councils</span></a>
      <details class="navdrop"${active === 'dates' ? ' data-active="1"' : ''}>
        <summary>Key dates</summary>
        <div class="panel">${dateLinks}</div>
      </details>
      <details class="navdrop"${active === 'regions' ? ' data-active="1"' : ''}>
        <summary>Regions</summary>
        <div class="panel">${regionLinks}</div>
      </details>
      <a href="/school-term-dates/about-this-data"${cur('about')}>About</a>
    </nav>`;
}


// GA-aware CSP for every term-dates response (harmless on .ics/xml).
router.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP_HEADER);
  next();
});

// ── Index: app shell with the council list server-injected ─────────────────
router.get('/', async (req, res, next) => {
  try {
    const html = fs.readFileSync(INDEX_HTML, 'utf-8');
    const authorities = (await laDb.listAllAuthorities()).filter(isListable);

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
      .replace('<!--SSR:GRID-->', gridHtml)
      .replace('</head>', `${GA_SNIPPET}\n  <script>${NAV_JS}</script>\n</head>`);
    res.set('Cache-Control', CACHE_HEADER).type('html').send(injected);
  } catch (err) {
    console.error('[term-dates-ssr] index failed:', err.message);
    next(); // fall through to plain static
  }
});

// ── Seasonal guides + about ─────────────────────────────────────────────────
// Registered before /:slug so these literal paths are never treated as
// council lookups.
for (const seasonalSlug of SEASONAL_SLUGS) {
  router.get(`/${seasonalSlug}`, async (req, res, next) => {
    try {
      const defs = seasonalDefs();
      const authorities = (await laDb.listAllAuthorities()).filter(isListable);
      const entries = await laDb.listAllEntries();
      const result = summariseSeason(authorities, entries, defs.pages[seasonalSlug].cfg);
      if (!result.perCouncil.length) return next(); // nothing derivable: 404 beats an empty page
      res.set('Cache-Control', CACHE_HEADER).type('html').send(seasonalPage(seasonalSlug, result));
    } catch (err) {
      console.error(`[term-dates-ssr] ${seasonalSlug} failed:`, err.message);
      next();
    }
  });
}

for (const hubSlug of HUB_SLUGS) {
  router.get(`/${hubSlug}`, async (req, res, next) => {
    try {
      const authorities = (await laDb.listAllAuthorities()).filter(isListable);
      const members = hubMembers(HUB_DEFS[hubSlug], authorities);
      if (!members.length) return next();
      const entries = await laDb.listAllEntries();
      res.set('Cache-Control', CACHE_HEADER).type('html').send(hubPage(hubSlug, members, entries));
    } catch (err) {
      console.error(`[term-dates-ssr] hub ${hubSlug} failed:`, err.message);
      next();
    }
  });
}

router.get('/bank-holidays', async (req, res, next) => {
  try {
    const defs = seasonalDefs();
    const [events, authorities, entries] = await Promise.all([
      fetchBankHolidaysEnglandWales(),
      laDb.listAllAuthorities().then((a) => a.filter(isListable)),
      laDb.listAllEntries(),
    ]);
    const fromIso = new Date().toISOString().slice(0, 10);
    const annotated = classifyBankHolidays(authorities, entries, events, { fromIso, untilIso: `${defs.y2}-08-31` });
    if (!annotated.length) return next();
    res.set('Cache-Control', CACHE_HEADER).type('html').send(bankHolidayPage(annotated, defs));
  } catch (err) {
    console.error('[term-dates-ssr] bank-holidays failed:', err.message);
    next();
  }
});

router.get('/about-this-data', async (req, res, next) => {
  try {
    let stats = null;
    try { stats = await laDb.getStats(); } catch { stats = null; } // page renders without stats
    res.set('Cache-Control', CACHE_HEADER).type('html').send(aboutPage(stats));
  } catch (err) {
    console.error('[term-dates-ssr] about failed:', err.message);
    next();
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
      ...SEASONAL_SLUGS.map((s) => `${CANONICAL_BASE}/${s}`),
      ...HUB_SLUGS.map((s) => `${CANONICAL_BASE}/${s}`),
      `${CANONICAL_BASE}/bank-holidays`,
      `${CANONICAL_BASE}/about-this-data`,
      ...authorities.filter(isListable).map((a) => `${CANONICAL_BASE}/${a.slug}`),
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
    if (!authority || !isListable(authority)) return next();
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
    if (!authority || !isListable(authority)) return next();
    const entries = withoutFinishedYears(await laDb.getEntriesForLA(authority.id));
    const years = groupByYear(entries);
    const content = buildCouncilContent(authority, years);
    // Live siblings for the cross-link mesh (same isListable filter as the
    // index + sitemap, so we never link to a 404). Fail-open: the page must
    // render even if the sibling fetch breaks — the mesh is a garnish.
    let allLive = [];
    try {
      allLive = (await laDb.listAllAuthorities() || []).filter(isListable);
    } catch (err) {
      console.error('[term-dates-ssr] nearby fetch failed:', err.message);
    }
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
      nearbyHtml: buildNearbyHtml(authority, allLive),
      jsonLd: breadcrumbLd(`${authority.name} school term dates`, `/${authority.slug}`),
      faqLd: content.faqLd,
    }));
  } catch (err) {
    console.error('[term-dates-ssr] council page failed:', err.message);
    next();
  }
});

module.exports = router;
