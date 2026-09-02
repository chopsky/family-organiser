/* global document, window, fetch, location, URLSearchParams */
/**
 * Directory index - progressive enhancement over the server-rendered page.
 *
 * Everything crawlable (council links grouped A-Z, letter rail, region cards,
 * the "coming up" card) arrives in the HTML. This script only adds behaviour:
 *
 *   query    - ONE search string shared by the hero search, the directory
 *              filter and the "Popular" chips; filters the council list,
 *              drives the count label, letter-rail enablement and empty state.
 *   country  - All | England | Wales (the segmented control).
 *   faq      - one accordion item open at a time.
 *   postcode - a full UK postcode in the search resolves via postcodes.io to
 *              the council that sets the dates (upper tier wins).
 *
 * Header dropdowns and the mobile menu are native <details> elements: the
 * shared NAV_JS (server-injected) closes them on outside click and opens the
 * desktop ones on hover, so nothing here touches them.
 *
 * Operator extra (invisible to the public): with ?key=<LA_IMPORT_KEY> in the
 * URL, each council link gains a small re-import button wired to the existing
 * key-gated POST /api/la-term-dates/import.
 */
(function () {
  var API = '/api/la-term-dates';
  var params = new URLSearchParams(location.search);
  var ADMIN_KEY = params.get('key') || null;

  var q = '';
  var region = 'All';

  var heroForm = document.getElementById('heroSearch');
  var heroInput = document.getElementById('search');
  var filterInput = document.getElementById('filterInput');
  var segsEl = document.getElementById('segs');
  var countEl = document.getElementById('countLine');
  var railEl = document.getElementById('letterNav');
  var emptyEl = document.getElementById('emptyState');
  var emptyQueryEl = document.getElementById('emptyQuery');
  var clearEl = document.getElementById('clearFilters');
  var groupsEl = document.getElementById('councilGroups');
  var directoryEl = document.getElementById('directory');
  if (!groupsEl) return;

  var cards = Array.prototype.slice.call(groupsEl.querySelectorAll('.ccard'));
  var groups = Array.prototype.slice.call(groupsEl.querySelectorAll('.lgroup'));
  var railLinks = railEl ? Array.prototype.slice.call(railEl.querySelectorAll('a')) : [];
  var total = cards.length;
  var defaultCount = countEl ? countEl.textContent : '';

  function scrollToDirectory() {
    if (!directoryEl) return;
    var hdr = document.querySelector('.hdr');
    var offset = hdr ? hdr.getBoundingClientRect().height : 68;
    var top = directoryEl.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top: top, behavior: 'smooth' });
  }

  function syncInputs() {
    if (heroInput && heroInput.value !== q) heroInput.value = q;
    if (filterInput && filterInput.value !== q) filterInput.value = q;
  }

  function apply() {
    var query = q.trim().toLowerCase();
    var shown = 0;
    var present = {};

    cards.forEach(function (card) {
      var matches =
        (region === 'All' || card.getAttribute('data-region') === region) &&
        (!query || (card.getAttribute('data-name') || '').indexOf(query) !== -1);
      card.hidden = !matches;
      if (matches) {
        shown++;
        present[(card.getAttribute('data-name') || '').charAt(0).toUpperCase()] = true;
      }
    });

    groups.forEach(function (g) {
      g.hidden = !g.querySelector('.ccard:not([hidden])');
    });

    railLinks.forEach(function (a) {
      var L = a.getAttribute('data-letter');
      var on = !!present[L];
      a.classList.toggle('off', !on);
      a.setAttribute('aria-disabled', on ? 'false' : 'true');
    });

    if (countEl) {
      countEl.textContent = (query || region !== 'All')
        ? shown + ' of ' + total + ' councils match'
        : defaultCount;
    }
    if (emptyQueryEl) emptyQueryEl.textContent = q.trim();
    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

  function setQuery(v) {
    q = v;
    syncInputs();
    if (POSTCODE_RE.test(q.trim())) lookupPostcode(q.trim());
    else { postcodeSeq++; apply(); }
  }

  // ── Postcode lookup ──────────────────────────────────────────────────────
  // Parents often don't know which authority sets their dates (county vs
  // borough, metropolitan vs district). If the search looks like a full UK
  // postcode, resolve it via postcodes.io (free, no key) and filter to that
  // council. Education is set by the UPPER tier, so admin_county wins over
  // admin_district when present. Fails soft: any error just leaves the normal
  // name search in charge.
  var POSTCODE_RE = /^[A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2}$/i;
  var postcodeSeq = 0;

  function normName(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function lookupPostcode(pc) {
    var seq = ++postcodeSeq;
    if (countEl) countEl.textContent = 'Looking up ' + pc.toUpperCase() + '…';
    fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(pc.replace(/\s+/g, '')))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (seq !== postcodeSeq) return; // a newer keystroke superseded this lookup
        var d = res && res.result;
        if (!d) {
          apply();
          if (countEl) countEl.textContent = pc.toUpperCase() + " doesn't look like a live UK postcode — try the council name instead.";
          return;
        }
        var candidates = [d.admin_county, d.admin_district].filter(Boolean).map(normName);
        var match = null;
        cards.forEach(function (card) {
          var name = normName(card.getAttribute('data-name'));
          if (!match && candidates.some(function (c) { return c === name || c.indexOf(name) === 0 || name.indexOf(c) === 0; })) match = card;
        });
        if (!match) {
          apply();
          if (countEl) countEl.textContent = 'No council page matched ' + pc.toUpperCase() + ' — try searching by council name.';
          return;
        }
        cards.forEach(function (card) { card.hidden = card !== match; });
        groups.forEach(function (g) { g.hidden = !g.querySelector('.ccard:not([hidden])'); });
        railLinks.forEach(function (a) {
          var on = a.getAttribute('data-letter') === (match.getAttribute('data-name') || '').charAt(0).toUpperCase();
          a.classList.toggle('off', !on);
        });
        if (countEl) countEl.textContent = 'Your council for ' + pc.toUpperCase() + ': ' + (match.querySelector('.cname') || match).textContent.trim();
        if (emptyEl) emptyEl.hidden = true;
      })
      .catch(function () { if (seq === postcodeSeq) apply(); });
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  [heroInput, filterInput].forEach(function (el) {
    if (!el) return;
    el.addEventListener('input', function (e) { setQuery(e.target.value); });
  });

  if (heroForm) {
    heroForm.addEventListener('submit', function (e) {
      e.preventDefault();
      setQuery(heroInput ? heroInput.value : q);
      scrollToDirectory();
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-pick]'), function (chip) {
    chip.addEventListener('click', function () {
      setQuery(chip.getAttribute('data-pick') || '');
      scrollToDirectory();
    });
  });

  if (segsEl) {
    Array.prototype.forEach.call(segsEl.querySelectorAll('button[data-region]'), function (btn) {
      btn.addEventListener('click', function () {
        region = btn.getAttribute('data-region');
        Array.prototype.forEach.call(segsEl.querySelectorAll('button[data-region]'), function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        apply();
      });
    });
  }

  if (clearEl) {
    clearEl.addEventListener('click', function () {
      region = 'All';
      if (segsEl) {
        Array.prototype.forEach.call(segsEl.querySelectorAll('button[data-region]'), function (b) {
          b.setAttribute('aria-pressed', String(b.getAttribute('data-region') === 'All'));
        });
      }
      setQuery('');
    });
  }

  // A no-JS submit of the hero form lands here with ?q=… - honour it.
  var initialQ = params.get('q');
  if (initialQ) setQuery(initialQ);

  // FAQ accordion: native <details>, one open at a time.
  var faqItems = Array.prototype.slice.call(document.querySelectorAll('#faqList .faq-item'));
  faqItems.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (!item.open) return;
      faqItems.forEach(function (other) { if (other !== item) other.open = false; });
    });
  });

  // Mobile menu: a <details> deliberately NOT tagged .navdrop, so the shared
  // hover-open behaviour never fires on a narrow hover-capable window (where
  // hovering the burger would open the panel and the click would then close
  // it again). Close it on outside click and after picking a link.
  var mob = document.querySelector('details.mob');
  if (mob) {
    Array.prototype.forEach.call(mob.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () { mob.open = false; });
    });
  }

  // ── Operator re-import (admin key only) ─────────────────────────────────
  if (ADMIN_KEY) {
    cards.forEach(function (card) {
      var slug = (card.getAttribute('href') || '').split('/').pop();
      if (!slug) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '↻';
      btn.title = 'Re-import ' + slug;
      btn.style.cssText = 'border:0;background:transparent;color:#6C3DD9;font-size:14px;cursor:pointer;padding:0 4px';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        btn.textContent = '…';
        fetch(API + '/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-import-key': ADMIN_KEY },
          body: JSON.stringify({ slug: slug, key: ADMIN_KEY }),
        })
          .then(function (r) { return r.json(); })
          .then(function (res) { btn.textContent = res.status === 'ok' ? '✓' : '✗'; btn.title = JSON.stringify(res); })
          .catch(function () { btn.textContent = '✗'; });
      });
      card.appendChild(btn);
    });
  }
})();
