/**
 * Directory index - progressive enhancement over the server-rendered grid.
 *
 * The full letter-grouped council grid arrives in the HTML (crawlable links);
 * this script adds live search + the All/England/Wales segmented filter by
 * showing/hiding the server-rendered cards. State: { q, region } - both
 * filters combine (AND), exactly as in the design prototype.
 *
 * Operator extra (invisible to the public): with ?key=<LA_IMPORT_KEY> in the
 * URL, each council card gains a small re-import button wired to the existing
 * key-gated POST /api/la-term-dates/import.
 */
(function () {
  var API = '/api/la-term-dates';
  var ADMIN_KEY = new URLSearchParams(location.search).get('key') || null;

  var q = '';
  var region = 'All';

  var searchEl = document.getElementById('search');
  var segsEl = document.getElementById('segs');
  var countEl = document.getElementById('countLine');
  var lettersEl = document.getElementById('letterNav');
  var emptyEl = document.getElementById('emptyState');
  var dirEl = document.getElementById('directory');
  if (!dirEl) return;

  var cards = Array.prototype.slice.call(dirEl.querySelectorAll('.ccard'));
  var sections = Array.prototype.slice.call(dirEl.querySelectorAll('.letterSec'));
  var total = cards.length;
  var defaultCount = countEl ? countEl.textContent : '';

  function apply() {
    var query = q.trim().toLowerCase();
    var shown = 0;

    cards.forEach(function (card) {
      var matches =
        (region === 'All' || card.getAttribute('data-region') === region) &&
        (!query || (card.getAttribute('data-name') || '').indexOf(query) !== -1);
      card.hidden = !matches;
      if (matches) shown++;
    });

    sections.forEach(function (sec) {
      var any = sec.querySelector('.ccard:not([hidden])');
      sec.hidden = !any;
    });

    if (countEl) {
      countEl.textContent = (query || region !== 'All')
        ? 'Showing ' + shown + ' of ' + total + ' councils'
        : defaultCount;
    }
    if (lettersEl) lettersEl.hidden = !!query;
    if (emptyEl) emptyEl.hidden = shown !== 0;
  }

  if (searchEl) {
    searchEl.addEventListener('input', function (e) {
      q = e.target.value;
      apply();
    });
  }

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

  // ── Operator re-import (admin key only) ─────────────────────────────────
  if (ADMIN_KEY) {
    cards.forEach(function (card) {
      var slug = (card.getAttribute('href') || '').split('/').pop();
      if (!slug) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '↻';
      btn.title = 'Re-import ' + slug;
      btn.style.cssText = 'position:absolute;top:8px;right:10px;border:0;background:transparent;color:#6B3FA0;font-size:14px;cursor:pointer;padding:4px';
      card.style.position = 'relative';
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
