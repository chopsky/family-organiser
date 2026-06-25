
    const API = '/api/la-term-dates';
    const ADMIN_KEY = new URLSearchParams(location.search).get('key') || null;
    const state = { search: '', status: '', region: '', page: 1, pageSize: 25, total: 0 };
    const detailCache = {};
    let lastTail = '';
    let searchTimer = null;

    const $ = (id) => document.getElementById(id);

    /**
     * Tiny safe DOM builder. Children are appended as text nodes or elements -
     * data is NEVER parsed as HTML, so there's no XSS surface from API content.
     */
    function el(tag, props, ...kids) {
      const n = document.createElement(tag);
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          if (v == null || v === false) continue;
          if (k === 'class') n.className = v;
          else if (k === 'text') n.textContent = v;
          else if (k === 'hidden') n.hidden = !!v;
          else if (k === 'onclick') n.onclick = v;
          else n.setAttribute(k, v);
        }
      }
      for (const kid of kids.flat()) {
        if (kid == null || kid === false) continue;
        n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
      return n;
    }
    function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
    function setOnly(node, child) { clear(node); if (child) node.append(child); }

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
      const a = d.split('-').map(Number), b = end.split('-').map(Number);
      if (a[0] === b[0] && a[1] === b[1]) {
        const sdow = DOW[new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay()];
        return `${sdow} ${a[2]}–${fmtDate(end)}`;
      }
      return `${fmtDate(d)} – ${fmtDate(end)}`;
    }
    function fmtAgo(iso) {
      if (!iso) return 'not yet imported';
      const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
      if (days <= 0) return 'imported today';
      if (days === 1) return 'imported yesterday';
      if (days < 30) return `imported ${days} days ago`;
      const mo = Math.floor(days / 30);
      return `imported ${mo} month${mo > 1 ? 's' : ''} ago`;
    }

    const TYPE = {
      term_start: { cls: 't-term', lbl: 'Term starts' },
      term_end: { cls: 't-term', lbl: 'Term ends' },
      half_term_start: { cls: 't-half', lbl: 'Half term' },
      half_term_end: { cls: 't-half', lbl: 'Half term ends' },
      inset_day: { cls: 't-inset', lbl: 'INSET day' },
      bank_holiday: { cls: 't-bank', lbl: 'Closure' },
    };
    const BADGE = {
      ok: { cls: 'ok', lbl: 'Imported' }, partial: { cls: 'partial', lbl: 'Partial' },
      failed: { cls: 'failed', lbl: 'Needs attention' }, pending: { cls: 'pending', lbl: 'Not yet imported' },
    };

    // ── Stats ──────────────────────────────────────────────────────────────
    function chip(extraCls, label, num, filter) {
      const isStatic = filter === null;
      const btn = el('button', {
        class: `stat ${extraCls}${isStatic ? ' static' : ''}`,
        type: 'button',
        'aria-pressed': isStatic ? null : String(state.status === filter),
      },
        el('div', { class: 'num', text: typeof num === 'number' ? String(num) : num }),
        el('div', { class: 'lbl', text: label }),
      );
      if (!isStatic) btn.onclick = () => { state.status = state.status === filter ? '' : filter; state.page = 1; load(); renderStatsPressed(); };
      return btn;
    }
    function renderStatsPressed() {
      document.querySelectorAll('#stats .stat:not(.static)').forEach((b) => {
        const f = b.dataset.filter || '';
        b.setAttribute('aria-pressed', String(state.status === f));
      });
    }
    async function loadStats() {
      let s;
      try { s = await fetch(`${API}/stats`).then((r) => r.json()); } catch (e) { return; }
      lastTail = s.lastRun && s.lastRun.finished_at
        ? `last full import ${fmtAgo(s.lastRun.finished_at).replace('imported ', '')}`
        : 'no import has run yet';
      const chips = [
        chip('', 'All authorities', s.total, ''),
        chip('ok', 'Imported', s.ok, 'ok'),
        chip('attn', 'Need attention', s.failed + s.partial, 'attention'),
        chip('', 'Not yet done', s.pending, 'pending'),
        chip('', 'Dates stored', (s.dateCount || 0).toLocaleString('en-GB'), null),
      ];
      chips.forEach((c, i) => { if (i >= 1 && i <= 3) c.dataset.filter = ['ok', 'attention', 'pending'][i - 1]; });
      const box = $('stats'); clear(box); chips.forEach((c) => box.append(c));
      updateMetaTail();
    }

    // ── Authority list ─────────────────────────────────────────────────────
    function buildCard(a) {
      const b = BADGE[a.import_status] || BADGE.pending;
      const bits = [a.region, `${a.school_count} schools`, fmtAgo(a.last_imported_at)];
      if (a.date_count) bits.push(`${a.date_count} dates`);
      if (a.import_method === 'search') bits.push('via search');
      const body = el('div', { class: 'card-body', hidden: true });
      const head = el('button', { class: 'card-head', type: 'button', 'aria-expanded': 'false' },
        el('span', { class: 'card-title' },
          el('span', { class: 'name', text: a.name }),
          el('span', { class: 'sub', text: bits.join(' · ') }),
        ),
        el('span', { class: `badge ${b.cls}`, text: b.lbl }),
        el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }),
      );
      const li = el('li', { class: 'card', 'aria-expanded': 'false' }, head, body);
      li.dataset.slug = a.slug;
      head.onclick = () => toggleCard(li, head, body);
      return li;
    }

    function buildDetail(data, authority) {
      const frag = document.createDocumentFragment();
      if (authority.import_status === 'failed' || authority.import_status === 'partial') {
        frag.append(el('div', { class: 'err-box' },
          el('strong', { text: authority.import_status === 'failed' ? "Couldn't import: " : 'Heads up: ' }),
          authority.import_error || 'Unknown issue.',
        ));
      }
      if (ADMIN_KEY) {
        const btn = el('button', { class: 'retry', type: 'button', text: '↻ Re-import this authority' });
        btn.onclick = () => reimport(authority.slug, btn);
        frag.append(btn);
      }
      if (!data.academicYears.length) {
        frag.append(el('p', { class: 'src', style: 'margin-top:14px',
          text: `No dates stored yet${authority.import_status === 'pending' ? " — this authority hasn't been imported." : '.'}` }));
      }
      for (const yr of data.academicYears) {
        const tbody = el('tbody');
        for (const d of yr.dates) {
          const t = TYPE[d.event_type] || { cls: 't-inset', lbl: d.event_type };
          tbody.append(el('tr',
            null,
            el('td', { class: 'date-col', text: fmtRange(d.date, d.end_date) }),
            el('td', { class: 'label-col' }, d.label || t.lbl, el('span', { class: `type-tag ${t.cls}`, text: t.lbl })),
          ));
        }
        frag.append(el('div', { class: 'year-block' },
          el('h3', { text: yr.academic_year }),
          el('table', { class: 'dates' }, tbody),
        ));
      }
      if (authority.source_url) {
        frag.append(el('p', { class: 'src' }, authority.import_method === 'search' ? 'Source (found via web search): ' : 'Source: ',
          el('a', { href: authority.source_url, target: '_blank', rel: 'noopener noreferrer', text: authority.source_url })));
      }
      return frag;
    }

    async function toggleCard(li, head, body) {
      const open = li.getAttribute('aria-expanded') === 'true';
      if (open) {
        li.setAttribute('aria-expanded', 'false'); head.setAttribute('aria-expanded', 'false'); body.hidden = true; return;
      }
      li.setAttribute('aria-expanded', 'true'); head.setAttribute('aria-expanded', 'true'); body.hidden = false;
      const slug = li.dataset.slug;
      if (!detailCache[slug]) {
        setOnly(body, el('p', { class: 'src', style: 'margin-top:14px', text: 'Loading dates…' }));
        try { detailCache[slug] = await fetch(`${API}/authorities/${encodeURIComponent(slug)}`).then((r) => r.json()); }
        catch (e) { setOnly(body, el('div', { class: 'err-box', text: 'Could not load dates. Please try again.' })); return; }
      }
      const d = detailCache[slug];
      clear(body); body.append(buildDetail(d, d.authority));
    }

    async function reimport(slug, btn) {
      btn.disabled = true; btn.textContent = '↻ Re-importing… (this can take ~30s)';
      try {
        const res = await fetch(`${API}/import`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-key': ADMIN_KEY },
          body: JSON.stringify({ slug, key: ADMIN_KEY }),
        }).then((r) => r.json());
        delete detailCache[slug];
        btn.textContent = res.status === 'ok' ? '✓ Imported — refreshing…' : `Result: ${res.status || 'error'}${res.error ? ' — ' + res.error : ''}`;
        await loadStats();
        setTimeout(load, 800);
      } catch (e) { btn.disabled = false; btn.textContent = '↻ Re-import failed — try again'; }
    }

    // ── Load list ──────────────────────────────────────────────────────────
    function updateMetaTail() {
      const tail = $('metaTail');
      if (tail) tail.textContent = lastTail;
    }
    function setMeta(prefix) {
      const line = $('metaLine'); clear(line);
      if (prefix) line.append(prefix + ' · ');
      line.append(el('span', { id: 'metaTail', text: lastTail }));
    }

    async function load() {
      const list = $('list');
      clear(list);
      for (let i = 0; i < 6; i++) list.append(el('li', { class: 'skeleton' }));
      $('pager').hidden = true;

      const q = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
      if (state.search) q.set('search', state.search);
      if (state.status) q.set('status', state.status);
      if (state.region) q.set('region', state.region);

      let data;
      try { data = await fetch(`${API}/authorities?${q}`).then((r) => r.json()); }
      catch (e) {
        setOnly(list, el('div', { class: 'empty' }, el('div', { class: 'big', text: 'Something went wrong' }), 'Could not reach the directory. Please refresh.'));
        return;
      }

      state.total = data.total || 0;
      if (!data.rows || !data.rows.length) {
        setOnly(list, el('div', { class: 'empty' },
          el('div', { class: 'big', text: 'No authorities found' }),
          state.search ? `Nothing matches "${state.search}".` : 'Try clearing the filters.'));
        setMeta('');
        return;
      }

      clear(list);
      data.rows.forEach((a) => list.append(buildCard(a)));

      const from = (state.page - 1) * state.pageSize + 1;
      const to = Math.min(state.page * state.pageSize, state.total);
      setMeta(`Showing ${from}–${to} of ${state.total} authorities`);

      const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
      $('where').textContent = `Page ${state.page} of ${pages}`;
      $('prev').disabled = state.page <= 1;
      $('next').disabled = state.page >= pages;
      $('pager').hidden = false;
    }

    // ── Events ─────────────────────────────────────────────────────────────
    $('search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.search = e.target.value.trim(); state.page = 1; load(); }, 300);
    });
    $('region').addEventListener('change', (e) => { state.region = e.target.value; state.page = 1; load(); });
    $('prev').addEventListener('click', () => { if (state.page > 1) { state.page--; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    $('next').addEventListener('click', () => { state.page++; load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

    if (ADMIN_KEY) setOnly($('adminFlag'), el('span', { class: 'admin-flag', text: 'admin mode' }));
    loadStats();
    load();
  