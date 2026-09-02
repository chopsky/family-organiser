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
const fines = require('../services/termTimeFines');

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
    // Outbound CTA clicks. GA runs cookieless here (consent denied, no
    // banner), so these arrive as aggregate event counts rather than user
    // journeys - enough to compare pages and give signup_source a
    // denominator. The authoritative conversion number stays server-side.
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href*="housemait.com"]') : null;
      if (!a || typeof window.gtag !== 'function') return;
      var href = a.getAttribute('href') || '';
      if (href.indexOf('/school-term-dates') !== -1) return;
      var m = href.match(/[?&]src=([a-z0-9-]+)/i);
      window.gtag('event', 'termdates_cta_click', {
        link_url: href,
        cta_source: m ? m[1] : 'untagged',
        cta_label: (a.textContent || '').trim().slice(0, 40),
        page_path: location.pathname
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
  // pagead2/doubleclick are the Google Ads conversion + remarketing endpoints.
  // The Ads tag arrives automatically through the GA4 <-> Google Ads account
  // link, and without these it is silently blocked on exactly the pages the
  // term-dates ad campaign pays to land on.
  "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
  "object-src 'none'",
  `script-src 'self' https://www.googletagmanager.com 'sha256-${GA_INLINE_HASH}' 'sha256-${NAV_JS_HASH}'`,
  "script-src-attr 'none'",
  "style-src 'self' https: 'unsafe-inline'",
  // postcodes.io powers the index's find-my-council postcode lookup.
  "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://api.postcodes.io https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net",
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
        <a href="/school-term-dates/term-time-holiday-fines">Term-time fines</a>
        <a href="/school-term-dates/about-this-data">About this data</a>
        <a href="/school-term-dates/data">Download the data</a>
      </nav>
      <nav class="guides" aria-label="Compare term dates by region">
        <a href="/school-term-dates/north-east">North East</a>
        <a href="/school-term-dates/north-west">North West</a>
        <a href="/school-term-dates/yorkshire-and-the-humber">Yorkshire and the Humber</a>
        <a href="/school-term-dates/east-midlands">East Midlands</a>
        <a href="/school-term-dates/west-midlands">West Midlands</a>
        <a href="/school-term-dates/east-of-england">East of England</a>
        <a href="/school-term-dates/london">London</a>
        <a href="/school-term-dates/south-east">South East</a>
        <a href="/school-term-dates/south-west">South West</a>
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


/**
 * "Schools in this area" - open GIAS schools for the council, NAMES ONLY.
 *
 * Why names but never dates: parents search their school's name far more than
 * their council's, and this is how they find the right calendar. School names
 * are public record (GIAS/DfE publish them, as does every rival site); what
 * stays out is any school-specific calendar, which is the thing schools may
 * keep to themselves. So this section publishes nothing a school hasn't, and
 * it points every visitor at the COUNCIL's dates with the academy caveat
 * attached.
 */
const SCHOOL_PHASE_ORDER = ['Primary', 'Secondary', 'All-through', 'Nursery', '16 plus'];
function buildSchoolsSection(authority, schools) {
  if (!schools.length) return '';
  const groups = new Map();
  for (const s of schools) {
    const phase = SCHOOL_PHASE_ORDER.includes(s.phase) ? s.phase : 'Other';
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase).push(s.name);
  }
  const order = SCHOOL_PHASE_ORDER.filter((p) => groups.has(p)).concat(groups.has('Other') ? ['Other'] : []);
  const blocks = order.map((phase) => {
    const names = groups.get(phase);
    const label = phase === '16 plus' ? 'Sixth form and 16+' : phase === 'Other' ? 'Special schools and other settings' : `${phase} schools`;
    return `<h3>${esc(label)} <span class="cnt">${names.length}</span></h3><p class="slist">${names.map(esc).join(' &middot; ')}</p>`;
  }).join('');
  return `
    <details class="schools">
      <summary>Schools in ${esc(authority.name)} <span class="cnt">${schools.length}</span></summary>
      <div class="prose">
        <p>These are the ${schools.length} open state schools in ${esc(authority.name)}, from the Department for Education's register. The dates above are the council's, which formally apply to community and voluntary-controlled schools; academies, free schools and foundation schools set their own, usually within a day or two. We don't publish individual schools' calendars - check your school's own website for its dates and INSET days.</p>
        ${blocks}
      </div>
    </details>`;
}

/** The redesigned per-council page (design handoff: Council Term Dates). */
function detailPage({ title, description, canonicalPath, h1, sub, years, contentHtml = '', nearbyHtml = '', schoolsHtml = '', jsonLd, faqLd = null, slugForCta = '', authority = null }) {
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
  <link rel="stylesheet" href="/school-term-dates/site.css?v=11" />
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
        <p class="trial">Free for 14 days · no card needed</p>
      </div>
      <a class="btn-white" href="https://housemait.com/gb?src=termdates${slugForCta ? `&amp;la=${esc(slugForCta)}` : ''}">Try Housemait free</a>
    </div>
    ${contentHtml}${schoolsHtml}${nearbyHtml}${FOOTER_HTML}
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
  const fixed = [['bank-holidays', 'Bank holidays'], [FINES_SLUG, 'Term-time fines'], ['about-this-data', 'About this data'], ['data', 'Download the data']]
    .filter(([slug]) => slug !== exceptSlug)
    .map(([slug, label]) => `<a href="/school-term-dates/${slug}">${label}</a>`)
    .join('');
  return `<h2>More term-date guides</h2><div class="guides-strip">${links}${fixed}</div><div class="guides-strip" style="margin-top:8px">${hubs}</div>`;
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
  <link rel="stylesheet" href="/school-term-dates/site.css?v=11" />
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
  <link rel="stylesheet" href="/school-term-dates/site.css?v=11" />
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
  'north-east': { name: 'North East England', label: 'all 12 authorities', kind: 'region', membersBy: 'slugs', slugs: ['county-durham', 'darlington', 'gateshead', 'hartlepool', 'middlesbrough', 'newcastle-upon-tyne', 'north-tyneside', 'northumberland', 'redcar-and-cleveland', 'south-tyneside', 'stockton-on-tees', 'sunderland'] },
  'north-west': { name: 'North West England', label: 'all 24 authorities', kind: 'region', membersBy: 'slugs', slugs: ['blackburn-with-darwen', 'blackpool', 'bolton', 'bury', 'cheshire-east', 'cheshire-west-and-chester', 'cumberland', 'westmorland-and-furness', 'halton', 'knowsley', 'lancashire', 'liverpool', 'manchester', 'oldham', 'rochdale', 'salford', 'sefton', 'st-helens', 'stockport', 'tameside', 'trafford', 'warrington', 'wigan', 'wirral'] },
  'yorkshire-and-the-humber': { name: 'Yorkshire and the Humber', label: 'all 15 authorities', kind: 'region', membersBy: 'slugs', slugs: ['barnsley', 'bradford', 'calderdale', 'doncaster', 'east-riding-of-yorkshire', 'kingston-upon-hull-city-of', 'kirklees', 'leeds', 'north-east-lincolnshire', 'north-lincolnshire', 'north-yorkshire', 'rotherham', 'sheffield', 'wakefield', 'york'] },
  'east-midlands': { name: 'East Midlands', label: 'all 10 authorities', kind: 'region', membersBy: 'slugs', slugs: ['derby', 'derbyshire', 'leicester', 'leicestershire', 'lincolnshire', 'north-northamptonshire', 'west-northamptonshire', 'nottingham', 'nottinghamshire', 'rutland'] },
  'west-midlands': { name: 'West Midlands', label: 'all 14 authorities', kind: 'region', membersBy: 'slugs', slugs: ['birmingham', 'coventry', 'dudley', 'herefordshire-county-of', 'sandwell', 'shropshire', 'solihull', 'staffordshire', 'stoke-on-trent', 'telford-and-wrekin', 'walsall', 'warwickshire', 'wolverhampton', 'worcestershire'] },
  'east-of-england': { name: 'East of England', label: 'all 11 authorities', kind: 'region', membersBy: 'slugs', slugs: ['bedford', 'cambridgeshire', 'central-bedfordshire', 'essex', 'hertfordshire', 'luton', 'norfolk', 'peterborough', 'southend-on-sea', 'suffolk', 'thurrock'] },
  'london': { name: 'London', label: 'all 32 boroughs', kind: 'region', membersBy: 'slugs', slugs: ['barking-and-dagenham', 'barnet', 'bexley', 'brent', 'bromley', 'camden', 'croydon', 'ealing', 'enfield', 'greenwich', 'hackney', 'hammersmith-and-fulham', 'haringey', 'harrow', 'havering', 'hillingdon', 'hounslow', 'islington', 'kensington-and-chelsea', 'kingston-upon-thames', 'lambeth', 'lewisham', 'merton', 'newham', 'redbridge', 'richmond-upon-thames', 'southwark', 'sutton', 'tower-hamlets', 'waltham-forest', 'wandsworth', 'westminster'] },
  'south-east': { name: 'South East England', label: 'all 19 authorities', kind: 'region', membersBy: 'slugs', slugs: ['bracknell-forest', 'brighton-and-hove', 'buckinghamshire', 'east-sussex', 'hampshire', 'isle-of-wight', 'kent', 'medway', 'milton-keynes', 'oxfordshire', 'portsmouth', 'reading', 'slough', 'southampton', 'surrey', 'west-berkshire', 'west-sussex', 'windsor-and-maidenhead', 'wokingham'] },
  'south-west': { name: 'South West England', label: 'all 15 authorities', kind: 'region', membersBy: 'slugs', slugs: ['bath-and-north-east-somerset', 'bournemouth-christchurch-and-poole', 'bristol-city-of', 'cornwall', 'devon', 'dorset', 'gloucestershire', 'isles-of-scilly', 'north-somerset', 'plymouth', 'somerset', 'south-gloucestershire', 'swindon', 'torbay', 'wiltshire'] },
  wales: { name: 'Wales', label: 'all 22 Welsh authorities', kind: 'region', membersBy: 'region', region: 'Wales', note: 'Wales publishes a national approved calendar (gov.wales), so most authorities align - but the spring half term falls a week earlier than in most of England, which matters for cross-border families and holiday pricing.' },
};
const HUB_SLUGS = Object.keys(HUB_DEFS);
// Every hub is an ONS region: exactly one per council, no overlaps.
const REGION_SLUGS = HUB_SLUGS.slice();

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
  <link rel="stylesheet" href="/school-term-dates/site.css?v=11" />
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
  <link rel="stylesheet" href="/school-term-dates/site.css?v=11" />
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


// ── Term-time holiday fines ─────────────────────────────────────────────────
// The one question every term-dates visitor with a holiday in mind actually
// has, answered against THEIR council's calendar: how many school days would
// the trip cover, does that meet the national penalty-notice threshold, and
// what would the notices add up to per parent per child. Pure HTML GET form,
// server-rendered result (no new inline script, CSP untouched). Result pages
// carry a canonical to the bare URL so query-string variants consolidate
// there instead of competing (no noindex: Google treats noindex + a canonical
// elsewhere as conflicting signals).

const FINES_SLUG = 'term-time-holiday-fines';
const gbp = (n) => `£${Number(n).toLocaleString('en-GB')}`;
const plural = (n, one, many) => (n === 1 ? one : (many || `${one}s`));

const FINES_CSS = `
    .calc, .result { background: #fff; border-radius: 16px; box-shadow: 0 2px 8px rgba(107,63,160,0.06); padding: 20px; margin: 18px 0 8px; }
    .calc .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
    .calc .f-council { grid-column: 1 / -1; }
    .calc label { display: block; font-size: 13px; font-weight: 500; color: #2D2A33; margin-bottom: 6px; }
    .calc select, .calc input { width: 100%; height: 48px; border: 1.5px solid #E8E5EC; border-radius: 10px; background: #FBF8F3; padding: 0 14px; font-size: 15px; font-family: inherit; color: #2D2A33; }
    .calc select:focus, .calc input:focus { outline: none; border-color: #6B3FA0; box-shadow: 0 0 0 3px #F3EDFC; }
    .calc .actions { margin-top: 16px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
    .calc button { height: 48px; padding: 0 22px; border: 0; border-radius: 12px; background: #6B3FA0; color: #fff; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
    .calc button:hover { background: #5A3488; }
    .calc button:focus-visible { outline: 3px solid #F3EDFC; outline-offset: 1px; }
    .calc .hint { font-size: 12.5px; color: #6B6774; }
    .result { border-left: 4px solid #6B3FA0; margin-top: 14px; }
    .result.fine { border-left-color: #E8724A; }
    .result.clear { border-left-color: #7DAE82; }
    .result.err { border-left-color: #E0A458; }
    .result h2 { margin: 0 0 6px; font-size: 24px; }
    .result .headline { font-size: 17px; font-weight: 600; color: #2D2A33; margin: 0 0 10px; }
    .result p { font-size: 15px; color: #4A4552; margin: 0 0 10px; max-width: 78ch; }
    .result p.small { font-size: 13px; color: #6B6774; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
    .chips span { font-size: 12px; font-weight: 600; border-radius: 8px; padding: 3px 9px; background: #F3EDFC; color: #6B3FA0; }
    .chips span.warm { background: #FDF0EB; color: #B5502D; }
    .chips span.soft { background: #EDF5EE; color: #3E7444; }
    .chips span.grey { background: #F1EFF4; color: #6B6774; }
    .money { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 12px 0 14px; }
    .money div { background: #FBF8F3; border-radius: 12px; padding: 12px 14px; }
    .money .amt { font-family: 'Recoleta', Georgia, serif; font-size: 26px; color: #6B3FA0; line-height: 1.1; }
    .money .lab { font-size: 12px; color: #6B6774; margin-top: 4px; }
    .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 14px; }
    .rules .gcard h3 { font-family: 'Recoleta', Georgia, serif; font-weight: 400; font-size: 21px; color: #6B3FA0; margin: 0 0 8px; }
    .rules .gcard p { font-size: 14px; color: #4A4552; margin: 0 0 8px; }
    .rules .gcard p:last-child { margin-bottom: 0; }
    .gcards.stats { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
    .gcard.stat .amt { font-family: 'Recoleta', Georgia, serif; font-size: 30px; color: #6B3FA0; line-height: 1.1; }
    .gcard.stat .lab { font-size: 13px; color: #4A4552; margin-top: 6px; }
    .src { font-size: 12.5px; color: #6B6774; line-height: 1.7; }
    .src a { color: #6B3FA0; }
    @media print { .calc { display: none; } }`;

const FINES_ERRORS = {
  missing: 'Choose a council and both dates, then check again.',
  invalid_dates: 'Those dates don\'t look right. Use the date pickers, or type them as YYYY-MM-DD.',
  reversed: 'The last day is before the first day. Swap them round.',
  too_long: `That's more than ${fines.MAX_RANGE_DAYS} days. This tool is for holidays, not long absences: talk to the school directly.`,
  unresolved: 'We can\'t read this council\'s term structure well enough to count school days. Its own page shows every published date.',
  unknown_council: 'We don\'t have term dates for that council yet.',
};

/**
 * Resolve the GET form into an outcome. Null when the form hasn't been used;
 * { error } for anything we can't count; the full result otherwise. Fetches
 * fail open where the page can still be useful without them (bank holidays).
 */
async function computeFinesOutcome(form) {
  const one = (v) => (Array.isArray(v) ? v[0] : (v == null ? '' : String(v))).trim();
  const council = one(form.council); const from = one(form.from); const to = one(form.to);
  if (!council && !from && !to) return null;
  if (!council || !from || !to) return { error: 'missing' };
  if (!/^[a-z0-9-]+$/.test(council)) return { error: 'unknown_council' };
  const authority = await laDb.getAuthorityBySlug(council);
  if (!authority || !isListable(authority)) return { error: 'unknown_council' };
  const rows = await laDb.getEntriesForLA(authority.id);
  let bankHolidayDates = []; let bankApplied = true;
  try {
    bankHolidayDates = (await fetchBankHolidaysEnglandWales()).map((e) => e.date);
  } catch (err) {
    bankApplied = false;
    console.error('[term-dates-ssr] fines: bank holidays unavailable:', err.message);
  }
  const absence = fines.classifyAbsence({ fromIso: from, toIso: to, rows, bankHolidayDates });
  if (!absence.ok) return { error: absence.reason, authority };
  const country = fines.countryOf(authority);
  // Same defaults as the form renders (2 parents, 1 child), so a shared link
  // without those params prices what the select boxes show.
  const money = fines.estimateFines({ country, parents: one(form.parents) || 2, children: one(form.children) || 1 });
  return {
    ok: true, authority, country, absence, money, bankApplied,
    threshold: fines.meetsThreshold(country, absence.sessions),
    nearest: fines.nearestBreak({ fromIso: from, toIso: to, rows }),
    from, to,
  };
}

function finesResultHtml(o) {
  if (!o) return '';
  if (o.error) {
    const councilLink = o.authority ? ` <a href="/school-term-dates/${esc(o.authority.slug)}">${esc(o.authority.name)} term dates →</a>` : '';
    return `<div class="result err" id="result"><h2>We couldn't check that</h2><p>${esc(FINES_ERRORS[o.error] || FINES_ERRORS.missing)}${councilLink}</p></div>`;
  }
  const { authority, country, absence, money, threshold, nearest } = o;
  const r = money.rules;
  const n = absence.schoolDays;
  const k = absence.byKind;
  const cls = n === 0 ? 'clear' : (threshold ? 'fine' : '');
  const chips = [
    `<span class="${n ? 'warm' : 'soft'}">${n} school ${plural(n, 'day')}</span>`,
    k.holiday ? `<span class="soft">${k.holiday} school holiday</span>` : '',
    k.closure ? `<span class="soft">${k.closure} INSET/closure</span>` : '',
    k.bankHoliday ? `<span class="soft">${k.bankHoliday} bank holiday</span>` : '',
    k.weekend ? `<span class="grey">${k.weekend} weekend</span>` : '',
    k.unknown ? `<span class="grey">${k.unknown} not yet published</span>` : '',
  ].filter(Boolean);
  // A breakdown only earns its row when there is something to break down.
  const chipsHtml = chips.length > 1 ? `<div class="chips">${chips.join('')}</div>` : '';

  let verdict;
  if (n === 0) {
    verdict = `<p>These dates fall entirely outside ${esc(authority.name)}'s school days, so there is nothing to authorise and nothing to fine. Enjoy it.</p>`;
  } else if (country === 'England') {
    verdict = threshold
      ? `<p><strong>Meets the national threshold.</strong> ${absence.sessions} sessions of unauthorised absence is at or over the ${r.thresholdSessions} sessions (${r.thresholdSessions / 2} school days) in a rolling ${r.thresholdWeeks} school weeks at which a school must consider a penalty notice. If the school doesn't authorise the trip, expect one.</p>`
      : `<p><strong>Below the national threshold on its own.</strong> ${absence.sessions} of the ${r.thresholdSessions} sessions in a rolling ${r.thresholdWeeks} school weeks at which a penalty notice must be considered. Any other unauthorised absence in that window counts towards it, and the school can still refuse to authorise the days.</p>`;
  } else {
    verdict = absence.sessions >= 10
      ? `<p><strong>Wales sets no single national trigger,</strong> but ${absence.sessions} sessions is at or over the 10-session (5 school day) line several Welsh councils now use to issue a notice for a term-time holiday. Check ${esc(authority.name)}'s code of conduct.</p>`
      : `<p><strong>Wales sets no single national trigger.</strong> ${absence.sessions} sessions is below the 10-session (5 school day) line several Welsh councils now use, but each council's code of conduct decides, and the school decides whether the days are authorised. Check ${esc(authority.name)}'s code.</p>`;
  }

  const who = `${money.parents} ${plural(money.parents, 'parent')} and ${money.children} ${plural(money.children, 'child', 'children')}`;
  let moneyHtml = '';
  if (n > 0) {
    const cells = [
      `<div><div class="amt">${gbp(money.firstEarlyTotal)}</div><div class="lab">${gbp(r.firstEarly)} per notice, paid within ${r.earlyDays} days</div></div>`,
      `<div><div class="amt">${gbp(money.firstLateTotal)}</div><div class="lab">${gbp(r.firstLate)} per notice, paid within ${r.lateDays} days</div></div>`,
    ];
    if (money.secondTotal != null) cells.push(`<div><div class="amt">${gbp(money.secondTotal)}</div><div class="lab">second notice for the same child within ${r.repeatWindowYears} years, no reduced rate</div></div>`);
    moneyHtml = `<p>Notices are issued <strong>per parent, per child</strong>. For ${who} that is ${money.notices} ${plural(money.notices, 'notice')}:</p><div class="money">${cells.join('')}</div>`
      + (country === 'England'
        ? `<p class="small">Unpaid after ${r.lateDays} days, the council must prosecute or withdraw the notice; there is no appeal. A third time within ${r.repeatWindowYears} years no notice is issued at all; the council takes other action instead, which often means prosecution: a court fine of up to £1,000 (up to £2,500 for the aggravated offence) and a criminal conviction.</p>`
        : '<p class="small">Unpaid notices can lead to prosecution under the Education Act 1996.</p>');
  }

  let nearestHtml = '';
  if (n > 0 && nearest) {
    const away = nearest.distanceDays === 0
      ? 'and your dates already overlap it'
      : `${nearest.distanceDays} ${plural(nearest.distanceDays, 'day')} from your dates`;
    nearestHtml = `<p><strong>The legal alternative:</strong> ${esc(authority.name)}'s nearest school holiday is ${esc(nearest.name)}, ${esc(fmtDate(nearest.firstOff))} to ${esc(fmtDate(nearest.lastOff))} (${nearest.weekdays} weekdays), ${away}. <a href="/school-term-dates/${esc(authority.slug)}">Every ${esc(authority.name)} holiday →</a></p>`;
  }

  const notes = [];
  if (!absence.coveredByCalendar) notes.push(`${esc(authority.name)} hasn't published dates for ${k.unknown} of these ${plural(k.unknown, 'day')} yet, so they aren't counted.`);
  if (!o.bankApplied) notes.push('Bank holidays could not be checked just now, so any that fall in these dates are counted as school days.');
  notes.push(`Counted against ${esc(authority.name)}'s published council calendar${authority.last_imported_at ? `, checked ${esc(fmtDate(authority.last_imported_at.slice(0, 10)))}` : ''}. Academies and individual schools set their own INSET days and can differ, and only the school decides whether an absence is authorised. This is an estimate of the national framework, not legal advice.`);

  return `<div class="result ${cls}" id="result">
      <h2>${esc(fmtRange(o.from, o.to))}</h2>
      <p class="headline">${n} school ${plural(n, 'day')} (${absence.sessions} ${plural(absence.sessions, 'session')}) in ${esc(authority.name)}</p>
      ${chipsHtml}
      ${verdict}${moneyHtml}${nearestHtml}
      <p class="small">${notes.join(' ')}</p>
    </div>`;
}

/**
 * The rules as prose. Amounts and thresholds come from termTimeFines.RULES so
 * the calculator and the copy cannot drift apart. Every figure below was
 * checked against its primary source on 2026-09-02 (DfE statutory guidance,
 * July 2026 edition; SI 2024/210; s444 Education Act 1996; DfE "Parental
 * responsibility measures 2024/25"; Welsh Government 2013 guidance; gov.scot
 * IEI Part 1, March 2026; NI Department of Education, December 2025).
 */
function finesProse(defs) {
  const E = fines.RULES.England; const W = fines.RULES.Wales;
  const stat = (n, lab) => `<div class="gcard stat"><div class="amt">${esc(n)}</div><div class="lab">${lab}</div></div>`;
  return `
    <h2>The rules in England</h2>
    <div class="rules">
      <div class="gcard"><h3>How much</h3>
        <p>A penalty notice is <strong>${gbp(E.firstEarly)}</strong> if paid within ${E.earlyDays} days of receiving it; after that it is <strong>${gbp(E.firstLate)}</strong>, and the deadline for paying is ${E.lateDays} days. Still unpaid after ${E.lateDays} days, the council must either prosecute for the original offence or withdraw the notice. There is no right of appeal against a notice.</p>
        <p>The amounts went up from £60 and £120 on 19 August 2024, when the national framework in the Department for Education's statutory guidance <em>Working together to improve school attendance</em> and the Education (Penalty Notices) (England) (Amendment) Regulations 2024 came into force.</p></div>
      <div class="gcard"><h3>Per parent, per child</h3>
        <p>A notice can go to each parent liable for the absence, for each child. Two parents taking two children out is four notices: ${gbp(E.firstEarly * 4)} paid promptly, ${gbp(E.firstLate * 4)} if not.</p>
        <p>"Parent" in the Education Act means anyone with parental responsibility or day-to-day care of the child, so step-parents and partners can be fined too. Notices should normally go to the parent or parents who allowed the absence.</p></div>
      <div class="gcard"><h3>Second and third time</h3>
        <p>A second notice to the same parent for the same child within ${E.repeatWindowYears} years is <strong>${gbp(E.second)}</strong>, with no reduced rate for paying early.</p>
        <p>A third time within ${E.repeatWindowYears} years, no notice can be issued at all. The guidance says alternative action should be taken instead, which will often include considering prosecution but may be another legal intervention, such as a parenting order or an education supervision order. GOV.UK puts it more bluntly: you will not be fined but may be taken to court.</p></div>
      <div class="gcard"><h3>The threshold</h3>
        <p>State-funded schools must consider a penalty notice once a child has <strong>${E.thresholdSessions} sessions</strong> of unauthorised absence in a rolling period of ${E.thresholdWeeks} school weeks (a school week being any week with at least one session). A session is a morning or an afternoon, so that is ${E.thresholdSessions / 2} school days. They don't have to be consecutive, they don't have to be for the same trip, the window can span terms and school years, and late marks after the register closes count.</p>
        <p>Reaching the threshold means the school must consider a notice case by case, not that one is automatic. Below it, the days still count towards the total for the rest of the window.</p></div>
      <div class="gcard"><h3>Who decides</h3>
        <p>Only the school can authorise absence, and a term-time holiday can be authorised only under the <strong>exceptional circumstances</strong> rule in the 2024 registration regulations: asked for in advance, by a parent the child normally lives with, and judged exceptional by the school. The DfE says it generally does not consider a need or desire for a holiday to be exceptional, and the July 2026 edition of the guidance says each request should be considered individually, with no blanket policy either way. If leave is refused and you go anyway, the absence is unauthorised and everything above applies.</p></div>
      <div class="gcard"><h3>If it reaches court</h3>
        <p>Prosecution is under section 444 of the Education Act 1996. The basic offence carries a fine of up to £1,000; the aggravated offence, where a parent knows the child isn't attending and fails to act, up to £2,500, a community order or up to three months in prison. Either is a criminal conviction in the magistrates' court, though only the aggravated offence is a recordable offence that shows on DBS checks. In 2017 the Supreme Court ruled in the Isle of Wight case that attending "regularly" means attending in line with the school's rules, so a high attendance percentage is no defence.</p></div>
    </div>

    <h2>The rules in Wales</h2>
    <div class="rules">
      <div class="gcard"><h3>How much</h3>
        <p>A fixed penalty notice is <strong>${gbp(W.firstEarly)}</strong> if paid within ${W.earlyDays} days of receiving it, rising to <strong>${gbp(W.firstLate)}</strong> if paid within ${W.lateDays} days, under the Education (Penalty Notices) (Wales) Regulations 2013. Also per parent, per child. Unpaid after ${W.lateDays} days, the council must prosecute or withdraw the notice.</p>
        <p>Some council websites quote England's 21- and 28-day windows. The Welsh regulations and Welsh Government guidance say ${W.earlyDays} and ${W.lateDays}.</p></div>
      <div class="gcard"><h3>Who decides</h3>
        <p>There is no national threshold in Wales. Each council publishes a code of conduct setting when it issues notices. Headteachers have discretion to authorise up to 10 school days of term-time holiday a year, with more than that only in exceptional circumstances, and the Welsh Government's long-standing position (a 2014 statement, still reflected in its 2026 draft attendance guidance) is that notices are for regular unauthorised absence rather than a single holiday in itself. Councils are moving, though: from September 2026 several, including Monmouthshire and Bridgend, issue notices once an unauthorised holiday reaches 10 sessions, or 5 school days. Check your council's code. Wales publishes no national count of notices issued.</p></div>
    </div>

    <h2>Scotland and Northern Ireland</h2>
    <div class="rules">
      <div class="gcard"><h3>Scotland</h3>
        <p>No penalty notices. Under the Education (Scotland) Act 1980 a council can require a parent to explain an absence and then make an attendance order; breaching that order can end in court, with a fine of up to £1,000, up to a month in prison, or both. Scotland's new attendance guidance (March 2026) says term-time holidays should be authorised only in exceptional circumstances linked to a parent's work, and recorded as unauthorised otherwise. Unauthorised holidays made up 1.1% of all school openings in 2024/25, the highest since records began in 2009/10.</p></div>
      <div class="gcard"><h3>Northern Ireland</h3>
        <p>No fixed penalty system either, as the Department of Education itself puts it. Schools may record a holiday as unauthorised; persistent cases go to the Education Authority's Education Welfare Service, and prosecution, with a court fine of up to £1,000 per child, is a last resort. A consultation on a new attendance strategy closed in March 2026 and did not propose fines.</p></div>
    </div>

    <h2>How many parents are fined?</h2>
    <p class="sub">England, 2024/25 school year, the first full year of the ${gbp(E.firstEarly)}/${gbp(E.firstLate)} framework. Department for Education, <em>Parental responsibility measures</em>, published 29 January 2026.</p>
    <div class="gcards stats">
      ${stat('492,800', 'penalty notices issued, up 1% on 487,300 the year before and from 398,800 in 2022/23')}
      ${stat('459,300', 'of them for unauthorised family holidays: 93% of all notices, up 4% year on year')}
      ${stat('353,857', `paid within ${E.earlyDays} days, mostly at the ${gbp(E.firstEarly)} first-notice rate; a further 26,057 paid in days 22 to 28 (underlying data)`)}
      ${stat('28,909', 'prosecutions for non-payment, about 6% of notices; 35,089 notices were withdrawn')}
      ${stat('9,972', `second notices at the flat ${gbp(E.second)} rate; 148 prosecutions because the two-in-three-years limit had been reached`)}
      ${stat('10.3%', 'of enrolments received a notice in Yorkshire and the Humber, the highest regional rate; London was lowest at 3.6%')}
    </div>
    <div class="prose"><p>Holidays are a small share of missed school and a very large share of fines: the Education Policy Institute found family holidays accounted for 7.1% of all absence but 93% of penalty notices in 2024/25.</p></div>

    <h2>Has anything changed for ${esc(defs.ayLabel)}?</h2>
    <div class="prose">
      <p>No. Checked on 2 September 2026: the most recent penalty-notice regulations for England are still the August 2024 ones. The statutory guidance was re-issued on 9 July 2026 with technical clarifications, and its amounts, three-year limit and ten-session threshold are unchanged. The Children's Wellbeing and Schools Act 2026, which received Royal Assent in April 2026, does not touch penalty notices; its attendance changes concern school attendance orders and are not yet in force. In April 2026 the Government told Parliament it has no plans to scrap fines or prosecutions, having rejected a petition for ten fine-free term-time days in December 2024.</p>
      <p>Wales: no change to the 2013 amounts was found, though several councils tightened their codes for September 2026 (see above). We re-check this page each term.</p>
    </div>`;
}

function finesPage({ authorities, defs, form, outcome }) {
  const canonical = `${CANONICAL_BASE}/${FINES_SLUG}`;
  const E = fines.RULES.England;
  const title = `Term-Time Holiday Fines ${defs.y1}/${defs.y2}: How Much, Per Child, and When | Housemait`;
  const description = `Check how many school days a term-time holiday would cover in your council's ${defs.ayLabel} calendar, whether it meets the ${E.thresholdSessions}-session threshold, and what the ${gbp(E.firstEarly)} to ${gbp(E.firstLate)} penalty notices add up to per parent per child.`;
  const one = (v) => esc((Array.isArray(v) ? v[0] : (v == null ? '' : String(v))).trim());
  const sel = (a, b) => (String(a) === String(b) ? ' selected' : '');

  const eng = authorities.filter((a) => a.region !== 'Wales');
  const wal = authorities.filter((a) => a.region === 'Wales');
  const opt = (a) => `<option value="${esc(a.slug)}"${sel(a.slug, one(form.council))}>${esc(a.name)}</option>`;
  const options = `<option value="">Choose your council…</option>`
    + `<optgroup label="England">${eng.map(opt).join('')}</optgroup>`
    + (wal.length ? `<optgroup label="Wales">${wal.map(opt).join('')}</optgroup>` : '');
  // Echo the CLAMPED counts so the selects always show what was priced.
  const counts = fines.clampCounts({ parents: one(form.parents) || 2, children: one(form.children) || 1 });
  const children = String(counts.children);
  const parents = String(counts.parents);

  const faq = [
    { q: 'How much is the fine for taking a child out of school in England?', a: `${gbp(E.firstEarly)} per parent per child if paid within ${E.earlyDays} days, otherwise ${gbp(E.firstLate)}, with ${E.lateDays} days to pay. A second notice for the same child within ${E.repeatWindowYears} years is ${gbp(E.second)} with no reduced rate, and a third time brings other action, usually prosecution, rather than another notice.` },
    { q: 'Is the fine per child or per family?', a: `Per parent, per child. Two parents and two children means four separate notices, so ${gbp(E.firstEarly * 4)} paid promptly or ${gbp(E.firstLate * 4)} if not. Anyone with parental responsibility or care of the child counts as a parent, and notices normally go to whoever allowed the absence.` },
    { q: 'Is the fine per day?', a: 'No. A penalty notice is a fixed amount however long the absence, so a five-day trip and a ten-day trip cost the same per notice. What changes with length is whether the ten-session threshold is met, and how much of the rolling ten-week allowance the trip uses up.' },
    { q: 'How many days can I take my child out of school before I am fined?', a: `In England a school must consider a penalty notice once a child has ${E.thresholdSessions} sessions (${E.thresholdSessions / 2} school days) of unauthorised absence within a rolling period of ${E.thresholdWeeks} school weeks. Fewer days can still be refused, still count towards the threshold, and some councils act below it. Wales has no national threshold; each council sets its own code.` },
    { q: 'Can the headteacher authorise a term-time holiday?', a: 'Only in exceptional circumstances, requested in advance by a parent the child lives with. The DfE says it generally does not consider a need or desire for a holiday exceptional, and schools must judge each request individually rather than run a blanket policy either way. If leave is refused and the child is taken out anyway, the absence is unauthorised.' },
    { q: 'Do weekends, bank holidays and INSET days count?', a: 'No. Only sessions when the school is open to pupils count, so a trip that straddles a half term, a bank holiday or an INSET day covers fewer school days than its length suggests. The checker on this page works that out from the council calendar.' },
    { q: 'What happens if I refuse to pay?', a: `After ${E.lateDays} days the council must either prosecute you for the original offence or withdraw the notice. There is no appeal against a notice itself. In court the basic offence carries a fine of up to £1,000 and the aggravated offence up to £2,500, a community order or up to three months in prison. Either is a criminal conviction, though only the aggravated offence is recordable and shows on DBS checks. In 2024/25 there were 28,909 prosecutions for non-payment in England.` },
    { q: 'Do private schools fine parents for term-time holidays?', a: 'No. Penalty notices can only be used for pupils at state-funded schools (maintained schools, academies, pupil referral units and alternative provision), so independent schools are outside the scheme. Parents of independent-school pupils are still subject to the section 444 offence and can be prosecuted.' },
    { q: 'Are the fines the same in Wales?', a: `No. Wales uses fixed penalty notices of ${gbp(fines.RULES.Wales.firstEarly)} within ${fines.RULES.Wales.earlyDays} days rising to ${gbp(fines.RULES.Wales.firstLate)} within ${fines.RULES.Wales.lateDays} days, with each council's code of conduct deciding when they are issued. Headteachers can authorise up to 10 school days of holiday a year, and several councils now fine once an unauthorised holiday reaches 10 sessions.` },
    { q: 'Do Scotland and Northern Ireland fine parents for term-time holidays?', a: 'No. Neither has a penalty-notice system. A holiday is recorded as unauthorised absence, persistent cases can be escalated through attendance orders or the Education Welfare Service, and only a court can fine, up to £1,000, as a last resort.' },
  ];
  const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  const crumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'UK School Term Dates', item: `${CANONICAL_BASE}/` },
    { '@type': 'ListItem', position: 2, name: 'Term-time holiday fines', item: canonical },
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
  <link rel="stylesheet" href="/school-term-dates/site.css?v=11" />
  <style>${SEASONAL_CSS}${FINES_CSS}</style>${GA_SNIPPET}
  <script>${NAV_JS}</script>
</head>
<body>
  <div class="wrap">${HEADER_HTML}${navBar('dates', FINES_SLUG)}
    <h1>Term-time holiday fines: what you'd actually pay</h1>
    <p class="sub">Pick your council and the dates you have in mind. We count the school days the trip really covers, using the council's own ${defs.ayLabel} calendar, then set that against the penalty-notice rules for England and Wales.</p>
    <form class="calc" method="get" action="/school-term-dates/${FINES_SLUG}#result" aria-label="Check a term-time holiday">
      <div class="grid">
        <div class="f-council"><label for="council">Council</label><select id="council" name="council" required>${options}</select></div>
        <div><label for="from">First day away</label><input id="from" name="from" type="date" required value="${one(form.from)}" /></div>
        <div><label for="to">Last day away</label><input id="to" name="to" type="date" required value="${one(form.to)}" /></div>
        <div><label for="children">Children at school</label><select id="children" name="children">${[1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}"${sel(n, children)}>${n}</option>`).join('')}</select></div>
        <div><label for="parents">Parents</label><select id="parents" name="parents">${[1, 2].map((n) => `<option value="${n}"${sel(n, parents)}>${n}</option>`).join('')}</select></div>
      </div>
      <div class="actions"><button type="submit">Check my dates</button><span class="hint">Nothing is stored. The answer is worked out from the council calendar on this site.</span></div>
    </form>
    ${finesResultHtml(outcome)}
    ${finesProse(defs)}
    <h2>Common questions</h2>
    <div class="prose">${faq.map((f) => `<p><strong>${esc(f.q)}</strong><br/>${esc(f.a)}</p>`).join('')}</div>
    <h2>Sources</h2>
    <p class="src">England: <a href="https://www.gov.uk/school-attendance-absence/legal-action-to-enforce-school-attendance" rel="noopener">GOV.UK, legal action to enforce school attendance</a> · <a href="https://www.gov.uk/government/publications/working-together-to-improve-school-attendance" rel="noopener">DfE, Working together to improve school attendance (statutory guidance, July 2026 edition)</a> · <a href="https://www.legislation.gov.uk/uksi/2024/210/made" rel="noopener">Education (Penalty Notices) (England) (Amendment) Regulations 2024</a> · <a href="https://www.legislation.gov.uk/uksi/2024/208/regulation/11/made" rel="noopener">School Attendance (Pupil Registration) (England) Regulations 2024, reg 11</a> · <a href="https://www.legislation.gov.uk/ukpga/1996/56/section/444" rel="noopener">Education Act 1996, ss444 to 444B</a> · <a href="https://explore-education-statistics.service.gov.uk/find-statistics/parental-responsibility-measures/2024-25" rel="noopener">DfE, Parental responsibility measures 2024/25</a> · <a href="https://epi.org.uk/publications-and-research/the-postcode-lottery-of-absence-fines/" rel="noopener">Education Policy Institute, April 2026</a>. Wales: <a href="https://www.legislation.gov.uk/wsi/2013/1983/made" rel="noopener">Education (Penalty Notices) (Wales) Regulations 2013</a> · <a href="https://www.gov.wales/sites/default/files/publications/2018-03/guidance-on-penalty-notices-for-regular-non-attendance-at-school.pdf" rel="noopener">Welsh Government guidance on penalty notices</a> · <a href="https://www.gov.wales/written-statement-clarification-school-attendance-regulations-wales-relating-holidays-term-time-and" rel="noopener">Welsh Government written statement on term-time holidays (2014)</a> · <a href="https://research.senedd.wales/research-articles/pupil-absence-for-holidays-during-school-term-time/" rel="noopener">Senedd Research, pupil absence for holidays during term time</a>. Scotland: <a href="https://www.gov.scot/publications/included-engaged-involved-part-1-improving-attendance-scotlands-schools/" rel="noopener">Included, Engaged and Involved Part 1 (March 2026)</a> · <a href="https://www.legislation.gov.uk/ukpga/1980/44/section/43" rel="noopener">Education (Scotland) Act 1980, ss35 to 43</a>. Northern Ireland: <a href="https://www.nidirect.gov.uk/articles/school-attendance-and-absence" rel="noopener">nidirect, school attendance and absence</a> · <a href="https://www.education-ni.gov.uk/sites/default/files/2025-12/ATTENDANCE%20MATTERS-CONSULTATION.pdf" rel="noopener">Department of Education NI, Attendance Matters consultation (December 2025)</a>. Council calendars from each authority's published term dates. Always confirm with your school.</p>
    ${guidesStrip(FINES_SLUG)}
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
    + `<a href="/school-term-dates/bank-holidays"${curLink('bank-holidays')}>Bank holidays</a>`
    + `<a href="/school-term-dates/${FINES_SLUG}"${curLink(FINES_SLUG)}>Term-time fines</a>`;
  const regionLinks = REGION_SLUGS.map((s) => `<a href="/school-term-dates/${s}"${curLink(s)}>${esc(HUB_DEFS[s].name)}</a>`).join('');
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



// ── Open data ───────────────────────────────────────────────────────────────
// The whole directory as one CSV/JSON download, plus a page documenting the
// existing JSON API. Published so other people can build on it: that earns
// links from data directories, civic-tech projects and journalists without
// any outreach, and it is the honest end-point of a dataset assembled from
// public council calendars.

const DATA_LICENCE = 'CC BY 4.0';

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flat rows: one line per dated entry, joined to its council. */
function buildDataRows(authorities, entries) {
  const byId = new Map(authorities.map((a) => [a.id, a]));
  return entries
    .map((e) => {
      const la = byId.get(e.la_id);
      if (!la) return null;
      return {
        council: la.name,
        council_slug: la.slug,
        country: la.region || '',
        academic_year: e.academic_year,
        event_type: e.event_type,
        start_date: e.date,
        end_date: e.end_date || '',
        label: e.label || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.council.localeCompare(b.council)
      || a.academic_year.localeCompare(b.academic_year)
      || a.start_date.localeCompare(b.start_date));
}

const DATA_COLS = ['council', 'council_slug', 'country', 'academic_year', 'event_type', 'start_date', 'end_date', 'label'];

function dataPage(stats, rowCount) {
  const canonical = `${CANONICAL_BASE}/data`;
  const title = 'Download UK School Term Dates Data (CSV, JSON, API) | Housemait';
  const description = `Free, open data: term dates for all ${stats ? stats.total : 176} local education authorities in England and Wales, as CSV, JSON or a public API. ${DATA_LICENCE}.`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'UK School Term & Holiday Dates',
    description: 'Term and holiday dates for every local education authority in England and Wales, compiled from each council\'s own published calendar and rebuilt monthly.',
    url: canonical,
    license: 'https://creativecommons.org/licenses/by/4.0/',
    isAccessibleForFree: true,
    creator: { '@type': 'Organization', name: 'Housemait', url: 'https://housemait.com' },
    spatialCoverage: 'England and Wales',
    distribution: [
      { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${CANONICAL_BASE}/term-dates.csv` },
      { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${CANONICAL_BASE}/term-dates.json` },
    ],
  };
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
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
  <link rel="stylesheet" href="/school-term-dates/site.css?v=11" />
  <style>${SEASONAL_CSS}
    .dl { display: flex; flex-wrap: wrap; gap: 12px; margin: 18px 0 6px; }
    .dl a { display: inline-flex; flex-direction: column; gap: 2px; background: #fff; border: 1.5px solid #E8E5EC; border-radius: 14px; padding: 14px 20px; text-decoration: none; min-width: 190px; }
    .dl a:hover { border-color: #6B3FA0; }
    .dl .fmt { font-weight: 600; font-size: 15px; color: #6B3FA0; }
    .dl .meta { font-size: 12.5px; color: #6B6774; }
    code { background: #F3EDFC; color: #4A2C73; border-radius: 6px; padding: 1px 6px; font-size: 13.5px; }
    pre { background: #2D2A33; color: #F3EDFC; border-radius: 12px; padding: 14px 16px; overflow-x: auto; font-size: 12.5px; line-height: 1.5; }
  </style>${GA_SNIPPET}
  <script>${NAV_JS}</script>
</head>
<body>
  <div class="wrap">${HEADER_HTML}${navBar('about')}
    <h1>Download the data</h1>
    <p class="sub">Term dates for every local education authority in England and Wales, free to download and free to build on.</p>
    <div class="prose">
      <p>This is the same dataset behind every page on this site: <strong>${stats ? stats.total : 176} councils</strong>, <strong>${rowCount} dated entries</strong>, compiled from each council's own published calendar and rebuilt monthly. It is released under <strong>${esc(DATA_LICENCE)}</strong> - use it commercially or otherwise, just credit Housemait and link back.</p>
    </div>
    <div class="dl">
      <a href="/school-term-dates/term-dates.csv"><span class="fmt">CSV &darr;</span><span class="meta">${rowCount} rows, one per date</span></a>
      <a href="/school-term-dates/term-dates.json"><span class="fmt">JSON &darr;</span><span class="meta">same rows, machine-readable</span></a>
    </div>
    <h2>Columns</h2>
    <div class="prose">
      <p><code>council</code> the authority's GIAS name &middot; <code>council_slug</code> its page on this site &middot; <code>country</code> England or Wales &middot; <code>academic_year</code> e.g. 2026-2027 &middot; <code>event_type</code> term_start, term_end, half_term_start, bank_holiday or inset_day &middot; <code>start_date</code> and <code>end_date</code> ISO dates (end_date is blank for single days) &middot; <code>label</code> the council's own wording.</p>
    </div>
    <h2>API</h2>
    <div class="prose">
      <p>No key, no signup, JSON over HTTPS. Please cache responses rather than polling - the underlying data changes monthly at most.</p>
    </div>
    <pre>GET https://api.housemait.com/api/la-term-dates/stats
GET https://api.housemait.com/api/la-term-dates/authorities
GET https://api.housemait.com/api/la-term-dates/authorities/barnet</pre>
    <div class="prose">
      <p>Each council also publishes a calendar file at <code>/school-term-dates/&lt;council&gt;/term-dates.ics</code>, which imports into Google Calendar, Apple Calendar or Outlook.</p>
      <h2>What you should know before using it</h2>
      <p>Council dates formally apply to community and voluntary-controlled schools. Academies, free schools and foundation schools set their own, usually within a day or two. INSET days are chosen school by school and are mostly not in council calendars. Councils publish the same week in different notations - some list the holiday week, others the break-up and return days - so derive spans from term structure rather than comparing labels across councils.</p>
      <p>Corrections are welcome: <a href="mailto:hello@housemait.com">hello@housemait.com</a>. More on method and provenance on the <a href="/school-term-dates/about-this-data">About this data</a> page.</p>
    </div>
    ${guidesStrip(null)}
    ${FOOTER_HTML}
  </div>
</body>
</html>`;
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

// The four metropolitan-county pages that briefly existed (Greater Manchester,
// Merseyside, West/South Yorkshire) were retired in favour of one clean ONS
// region per council. Redirect rather than 404 - they were indexed, however
// briefly, and their councils all live in the target region.
const RETIRED_HUBS = {
  'greater-manchester': 'north-west',
  merseyside: 'north-west',
  'west-yorkshire': 'yorkshire-and-the-humber',
  'south-yorkshire': 'yorkshire-and-the-humber',
};
for (const [from, to] of Object.entries(RETIRED_HUBS)) {
  router.get(`/${from}`, (req, res) => res.redirect(301, `/school-term-dates/${to}`));
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

router.get(`/${FINES_SLUG}`, async (req, res, next) => {
  try {
    const defs = seasonalDefs();
    const authorities = (await laDb.listAllAuthorities()).filter(isListable)
      .sort((a, b) => a.name.localeCompare(b.name));
    const form = req.query || {};
    const outcome = await computeFinesOutcome(form);
    // A fail-open answer (bank holidays unreachable) is knowingly incomplete;
    // never let the CDN pin it for an hour.
    const cache = outcome && outcome.ok && !outcome.bankApplied ? 'no-store' : CACHE_HEADER;
    res.set('Cache-Control', cache).type('html').send(finesPage({ authorities, defs, form, outcome }));
  } catch (err) {
    console.error('[term-dates-ssr] fines page failed:', err.message);
    next();
  }
});

router.get('/data', async (req, res, next) => {
  try {
    let stats = null;
    try { stats = await laDb.getStats(); } catch { stats = null; }
    const authorities = (await laDb.listAllAuthorities()).filter(isListable);
    const rows = buildDataRows(authorities, await laDb.listAllEntries());
    res.set('Cache-Control', CACHE_HEADER).type('html').send(dataPage(stats, rows.length));
  } catch (err) {
    console.error('[term-dates-ssr] data page failed:', err.message);
    next();
  }
});

router.get(['/term-dates.csv', '/term-dates.json'], async (req, res, next) => {
  try {
    const authorities = (await laDb.listAllAuthorities()).filter(isListable);
    const rows = buildDataRows(authorities, await laDb.listAllEntries());
    if (!rows.length) return next();
    const wantsCsv = req.path.endsWith('.csv');
    res.set('Cache-Control', CACHE_HEADER)
      .set('Access-Control-Allow-Origin', '*') // open data: usable from any page
      .set('Content-Disposition', `attachment; filename="uk-school-term-dates.${wantsCsv ? 'csv' : 'json'}"`);
    if (wantsCsv) {
      const lines = [DATA_COLS.join(',')].concat(rows.map((r) => DATA_COLS.map((c) => csvCell(r[c])).join(',')));
      return res.type('text/csv; charset=utf-8').send(lines.join('\n') + '\n');
    }
    return res.type('application/json').send(JSON.stringify({
      licence: DATA_LICENCE,
      source: 'https://housemait.com/school-term-dates/',
      generated_at: new Date().toISOString(),
      councils: authorities.length,
      rows: rows.length,
      data: rows,
    }));
  } catch (err) {
    console.error('[term-dates-ssr] data export failed:', err.message);
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
      `${CANONICAL_BASE}/${FINES_SLUG}`,
      `${CANONICAL_BASE}/about-this-data`,
      `${CANONICAL_BASE}/data`,
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
    // GIAS schools for the area. Fail-open like the mesh: the dates are the
    // page's job, the school list is a finding aid.
    let schools = [];
    try {
      schools = await laDb.listSchoolsForAuthorityName(authority.name);
    } catch (err) {
      console.error('[term-dates-ssr] schools fetch failed:', err.message);
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
      schoolsHtml: buildSchoolsSection(authority, schools),
      nearbyHtml: buildNearbyHtml(authority, allLive),
      jsonLd: breadcrumbLd(`${authority.name} school term dates`, `/${authority.slug}`),
      faqLd: content.faqLd,
    }));
  } catch (err) {
    console.error('[term-dates-ssr] council page failed:', err.message);
    next();
  }
});

// Exported for tests only - lets the suite assert regional coverage without
// duplicating the mapping.
router.__testables = { HUB_DEFS, REGION_SLUGS, SEASONAL_SLUGS, FINES_SLUG };

module.exports = router;
