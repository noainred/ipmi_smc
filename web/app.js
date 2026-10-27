/*
 * SMC BMC PoC 화면(바닐라 JS, 빌드 없음).
 * ⚠ BMC 응답은 신뢰하지 않는 입력이다 — 화면에 넣을 때 innerHTML 을 쓰지 않고 h() 로 textContent 만 쓴다.
 * ⚠ CSP 가 인라인 style 속성을 막는다 — 스타일은 클래스 또는 el.style.<prop> 로만.
 * 내보내기 판(window.__POC_EXPORT__)에서는 같은 화면을 읽기 전용으로 보여 준다.
 */
(() => {
  'use strict';

  const EXPORT = window.__POC_EXPORT__ || null;
  const TOKEN = (document.querySelector('meta[name="poc-token"]') || {}).content || '';

  // ── 표 · 배지 정의 ─────────────────────────────────────────────────────────
  const ST = {
    ok: ['지원', 'b-ok'], partial: ['부분', 'b-partial'], empty: ['0건', 'b-muted'], absent: ['없음 404', 'b-muted'],
    license: ['라이선스 추정', 'b-license'], forbidden: ['권한 403', 'b-bad'], auth: ['인증 실패', 'b-bad'], error: ['오류', 'b-bad'], skip: ['건너뜀', 'b-skip'],
  };
  const ST_RANK = { ok: 0, partial: 1, license: 2, empty: 3, absent: 4, forbidden: 5, error: 6, auth: 7, skip: 8 };
  const VD = { break: ['깨짐', 'b-bad'], check: ['확인', 'b-partial'], ok: ['정상', 'b-ok'], info: ['정보', 'b-info'], unknown: ['미확인', 'b-muted'] };
  const VD_RANK = { break: 0, check: 1, unknown: 2, info: 3, ok: 4 };
  const ROLE = { smc: ['Supermicro', 'chip-smc'], dell: ['Dell 기준선', 'chip-dell'], other: ['기타', 'chip-other'] };
  const SEG = [
    ['ok', '지원', '#22c55e'], ['partial', '부분', '#f59e0b'], ['license', '라이선스 추정', '#c084fc'],
    ['none', '없음·0건', '#5d6b85'], ['bad', '권한·오류·인증', '#f87171'], ['skip', '건너뜀', '#2b3650'],
  ];
  const TABS = [
    ['servers', '서버 · 실행'], ['matrix', '비교 매트릭스'], ['gaps', 'The.DVC 수정 지점'], ['ipmi', 'IPMI 대조'], ['info', '수집 정보'], ['explore', '전체 탐색'],
  ];

  // ── 상태 ──────────────────────────────────────────────────────────────────
  const S = {
    tab: 'servers', env: null, servers: [], compare: null, results: new Map(), job: null, selected: new Set(),
    form: null, formMsg: null, probe: null, showDellExpect: true, matrixFilter: 'all', pick: {}, explore: { q: '', sel: '', body: null, err: '' },
    verbose: false, runOpts: { crawl: true, ipmi: true, crawlMax: 2000 }, busy: false, error: '',
  };

  // ── DOM 도우미 ────────────────────────────────────────────────────────────
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    add(el, kids);
    return el;
  }
  function add(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  const badge = (status, map = ST, extra) => { const m = map[status] || [String(status || '—'), 'b-muted']; return h('span', { class: `badge ${m[1]}` }, extra || m[0]); };
  const roleChip = (role) => { const m = ROLE[role] || ROLE.other; return h('span', { class: `chip ${m[1]}` }, m[0]); };
  const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}초` : `${Math.floor(ms / 60000)}분 ${Math.round((ms % 60000) / 1000)}초`);
  const fmtTime = (iso) => { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const dash = (v) => (v == null || v === '' ? '—' : v);

  // ── API ──────────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    if (EXPORT) return exportApi(method, path);
    const res = await fetch(path, { method, headers: { 'X-PoC-Token': TOKEN, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { j = { error: text.slice(0, 200) }; }
    if (!res.ok) throw new Error((j && j.error) || `HTTP ${res.status}`);
    return j;
  }
  function exportApi(method, path) {
    if (path === '/api/servers') return EXPORT.servers;
    if (path === '/api/compare') return EXPORT.compare;
    if (path === '/api/env') return null;
    if (path === '/api/runs/current') return null;
    const m = /^\/api\/results\/([0-9a-f]{12})$/.exec(path);
    if (m) { if (EXPORT.results[m[1]]) return EXPORT.results[m[1]]; throw new Error('실행 결과가 없습니다'); }
    throw new Error('내보내기 판에서는 쓸 수 없는 기능입니다(원문은 raw 폴더 참고)');
  }

  async function loadServers() { S.servers = await api('GET', '/api/servers'); }
  async function loadCompare() { S.compare = await api('GET', '/api/compare'); }
  async function loadResult(id, force) {
    if (!id) return null;
    if (!force && S.results.has(id)) return S.results.get(id);
    try { const r = await api('GET', `/api/results/${id}`); S.results.set(id, r); return r; } catch { S.results.set(id, null); return null; }
  }
  async function refreshAll() {
    try {
      await Promise.all([loadServers(), loadCompare()]);
      S.results.clear();
      S.error = '';
    } catch (e) { S.error = String(e.message || e); }
  }

  // ── 라우팅 ────────────────────────────────────────────────────────────────
  function readHash() {
    const t = (location.hash || '').replace(/^#/, '');
    S.tab = TABS.some((x) => x[0] === t) ? t : (EXPORT ? 'matrix' : 'servers');
  }
  window.addEventListener('hashchange', () => { readHash(); render(); });

  function renderTabs() {
    const nav = document.getElementById('tabs');
    nav.replaceChildren(...TABS.filter(([k]) => !(EXPORT && k === 'servers')).map(([k, label]) => h('a', { class: 'tab', href: `#${k}`, 'aria-current': S.tab === k ? 'page' : null }, label)));
    const sub = document.getElementById('brand-sub');
    sub.textContent = EXPORT ? `내보내기 · ${fmtTime(EXPORT.exportedAt)}` : (S.env ? `${S.env.tool.version} · ${location.host}` : location.host);
  }

  function render() {
    renderTabs();
    const main = document.getElementById('main');
    const view = { servers: viewServers, matrix: viewMatrix, gaps: viewGaps, ipmi: viewIpmi, info: viewInfo, explore: viewExplore }[S.tab] || viewServers;
    const nodes = [];
    if (S.error) nodes.push(h('div', { class: 'note note-bad' }, S.error));
    if (EXPORT) nodes.push(h('div', { class: 'note note-info' }, `내보내기 판(읽기 전용) — ${fmtTime(EXPORT.exportedAt)} 에 만든 파일입니다. 원본 응답 본문은 넣지 않았습니다(PoC 의 out/<서버>/<실행>/raw 폴더 참고).`));
    // replaceChildren 은 null 을 'null' 글자로 넣는다 — 빈 조각은 걸러 낸다.
    main.replaceChildren(...[...nodes, ...[view()].flat(Infinity)].filter((x) => x != null && x !== false));
  }

  // 결과가 필요한 탭은 비동기로 받아 온 뒤 다시 그린다.
  function needResult(id, then) {
    if (!id) return null;
    if (S.results.has(id)) return S.results.get(id);
    loadResult(id).then(() => { if (then) then(); else render(); });
    return undefined;
  }

  // ── 정렬 표 ───────────────────────────────────────────────────────────────
  /**
   * columns: [{ key, label, render?(row)->node|string, value?(row)->정렬값, num?, mono? }]
   * 제목을 누르면 정렬(오름 → 내림 → 원래 순서). null·'—' 는 항상 뒤로.
   */
  function sortTable({ columns, rows, empty = '항목 없음', limit = 500, onRow = null, groupBy = null, minWidth = null, caption = null }) {
    const state = { key: null, dir: 1, all: false };
    const wrap = h('div', { class: 'tbl-wrap' });
    const draw = () => {
      let list = rows.slice();
      if (state.key) {
        const col = columns.find((c) => c.key === state.key);
        const val = (r) => { const v = col.value ? col.value(r) : r[col.key]; return v == null || v === '' || v === '—' ? null : v; };
        list.sort((a, b) => {
          const va = val(a); const vb = val(b);
          if (va == null && vb == null) return 0;
          if (va == null) return 1;
          if (vb == null) return -1;
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * state.dir;
          return String(va).localeCompare(String(vb), 'ko', { numeric: true }) * state.dir;
        });
      }
      const shown = state.all ? list : list.slice(0, limit);
      const thead = h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', 'aria-sort': state.key === c.key ? (state.dir > 0 ? 'ascending' : 'descending') : null },
        c.nosort ? h('span', { class: 'th-static' }, c.label) : h('button', { type: 'button', onclick: () => { if (state.key !== c.key) { state.key = c.key; state.dir = 1; } else if (state.dir === 1) state.dir = -1; else { state.key = null; } draw(); } },
          c.label, state.key === c.key ? h('span', { class: 'arrow', 'aria-hidden': 'true' }, state.dir > 0 ? '▲' : '▼') : null)))));
      const trs = [];
      let lastGroup = null;
      for (const r of shown) {
        if (groupBy && !state.key) {
          const g = groupBy(r);
          if (g !== lastGroup) { trs.push(h('tr', { class: 'group' }, h('td', { colspan: String(columns.length) }, g))); lastGroup = g; }
        }
        const tr = h('tr', { class: onRow ? 'clickable' : null, onclick: onRow ? () => onRow(r) : null },
          columns.map((c) => h('td', { class: [c.num ? 'num' : '', c.mono ? 'mono' : ''].filter(Boolean).join(' ') || null }, c.render ? c.render(r) : dash(r[c.key]))));
        trs.push(tr);
      }
      if (!rows.length) trs.push(h('tr', null, h('td', { colspan: String(columns.length), class: 'empty' }, empty)));
      const table = h('table', { class: 'tbl' }, caption ? h('caption', { class: 'dim small' }, caption) : null, thead, h('tbody', null, trs));
      if (minWidth) table.style.minWidth = `${minWidth}px`;
      const more = list.length > shown.length ? h('div', { class: 'more' }, `${list.length - shown.length}개 더 있음 `, h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { state.all = true; draw(); } }, '모두 보기')) : null;
      wrap.replaceChildren(table, ...(more ? [more] : []));
    };
    draw();
    return wrap;
  }

  // ── 공통 조각 ─────────────────────────────────────────────────────────────
  function stackBar(counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const segs = SEG.filter(([k]) => counts[k]);
    const bar = h('div', { class: 'stack', 'aria-hidden': 'true' }, segs.map(([k, , color]) => { const s = h('span'); s.style.width = `${(counts[k] / total) * 100}%`; s.style.background = color; s.style.height = '100%'; s.style.display = 'block'; return s; }));
    const legend = h('div', { class: 'legend' }, segs.map(([k, label, color]) => { const i = h('i'); i.style.background = color; return h('span', null, i, `${label} ${counts[k]}`); }));
    return [bar, legend];
  }
  function groupCounts(c) {
    return { ok: c.ok || 0, partial: c.partial || 0, license: c.license || 0, none: (c.absent || 0) + (c.empty || 0), bad: (c.forbidden || 0) + (c.error || 0) + (c.auth || 0), skip: c.skip || 0 };
  }
  function serverPicker(key, filter) {
    const list = (S.servers || []).filter((s) => s.last && (!filter || filter(s)));
    if (!list.length) return { el: null, id: null };
    if (!S.pick[key] || !list.some((s) => s.id === S.pick[key])) S.pick[key] = (list.find((s) => s.role !== 'dell') || list[0]).id;
    const el = h('div', { class: 'pills', role: 'group', 'aria-label': '대상 서버' }, list.map((s) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(S.pick[key] === s.id), onclick: () => { S.pick[key] = s.id; render(); } }, `${s.name} · ${(ROLE[s.role] || ROLE.other)[0]}`)));
    return { el, id: S.pick[key] };
  }
  function noResults() {
    return h('div', { class: 'panel' }, h('div', { class: 'empty' }, EXPORT ? '실행 결과가 없습니다.' : '아직 실행 결과가 없습니다 — ', EXPORT ? null : h('a', { href: '#servers' }, '서버 · 실행'), EXPORT ? null : ' 탭에서 서버를 등록하고 실행하세요.'));
  }
  function jsonBlock(obj) { return h('pre', { class: 'json' }, JSON.stringify(obj, null, 2)); }
  function kvGrid(pairs) {
    return h('div', { class: 'kv-grid' }, pairs.filter(([, v]) => v !== undefined).map(([k, v]) => h('div', { class: 'kv' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, dash(v)))));
  }

  // ════════════════════════════════════════════════════════════════════════
  // ① 서버 · 실행
  // ════════════════════════════════════════════════════════════════════════
  const emptyForm = () => ({ id: null, name: '', role: 'smc', host: '', port: '', username: '', password: '', insecure: true, note: '', ipmi: { enabled: true, sameCreds: true, username: '', password: '', cipher: '' }, hasPassword: false });

  function viewServers() {
    if (!S.form) S.form = emptyForm();
    const running = S.job && S.job.status === 'running';
    const out = [];
    out.push(h('div', { class: 'section-title' }, h('h1', null, '서버 등록 · 테스트 실행'), h('span', { class: 'dim small' }, 'Supermicro 대상과 Dell 기준선을 함께 등록하면 같은 항목으로 비교합니다')));
    out.push(envNote());
    out.push(h('div', { class: 'row' }, h('div', { class: 'grow' }, serverTable(running)), h('div', { class: 'side' }, serverForm())));
    out.push(h('section', { class: 'panel', id: 'job-panel', 'aria-label': '실행 진행' }, jobPanel()));
    out.push(h('div', { class: 'note note-info' }, '읽기 전용 — Redfish 는 GET 과 세션 생성·삭제만, IPMI 는 읽기 명령만 보냅니다. 401(인증 거부)을 받으면 그 서버에는 더 보내지 않습니다(BMC 계정 잠금 방지). 가능하면 BMC 에 읽기 전용(Operator·ReadOnly) 계정을 만들어 쓰세요.'));
    return out;
  }

  function envNote() {
    const e = S.env;
    if (!e) return null;
    const ipmi = e.ipmitool?.path ? `${e.ipmitool.version || 'ipmitool'} (${e.ipmitool.path})` : 'ipmitool 없음 — IPMI 단계는 건너뜁니다(macOS: brew install ipmitool)';
    return h('div', { class: `note ${e.ipmitool?.path ? 'note-info' : 'note-warn'}` }, h('span', null, `Node ${e.node} · ${e.platform}/${e.arch} · ${ipmi} · 결과 폴더 ${e.outDir}`));
  }

  function lastCell(s) {
    if (!s.last) return h('span', { class: 'dim' }, '미실행');
    const sm = s.last.summary || {};
    const c = sm.counts || {};
    if (sm.fatal) return h('span', null, badge('error'), h('span', { class: 'sub' }, sm.fatal));
    if (sm.authFailed) return h('span', null, badge('auth'), h('span', { class: 'sub' }, fmtTime(s.last.finishedAt)));
    return h('span', null, h('span', null, `지원 ${c.ok || 0}/${sm.total || 0}`), sm.assumptions && s.role !== 'dell' ? h('span', { class: 'sub' }, `The.DVC 깨짐 ${sm.assumptions.break || 0} · 확인 ${sm.assumptions.check || 0}`) : null, h('span', { class: 'sub' }, fmtTime(s.last.finishedAt)));
  }

  function serverTable(running) {
    const allSel = S.servers.length && S.servers.every((s) => S.selected.has(s.id));
    const table = sortTable({
      rows: S.servers,
      empty: '등록된 서버가 없습니다 — 오른쪽에서 서버를 등록하세요',
      minWidth: 760,
      columns: [
        { key: '_sel', label: '선택', nosort: true, render: (s) => h('input', { type: 'checkbox', 'aria-label': `${s.name} 선택`, checked: S.selected.has(s.id), onclick: (ev) => ev.stopPropagation(), onchange: (ev) => { if (ev.target.checked) S.selected.add(s.id); else S.selected.delete(s.id); render(); } }) },
        { key: 'name', label: '이름', render: (s) => h('span', null, h('strong', null, s.name), h('span', { class: 'sub' }, s.last?.summary?.model || s.note || '')) },
        { key: 'role', label: '역할', render: (s) => roleChip(s.role) },
        { key: 'host', label: 'BMC 주소', mono: true, render: (s) => `${s.host}${s.port ? `:${s.port}` : ''}` },
        { key: 'username', label: '계정', mono: true },
        { key: 'ipmi', label: 'IPMI', value: (s) => (s.ipmi.enabled ? 1 : 0), render: (s) => (s.ipmi.enabled ? (s.ipmi.sameCreds ? '사용' : '사용(별도 계정)') : '끔') },
        { key: 'last', label: '마지막 실행', value: (s) => s.last?.finishedAt || null, render: lastCell },
        { key: '_act', label: '동작', nosort: true, render: (s) => h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn btn-sm', disabled: running, onclick: (ev) => { ev.stopPropagation(); startRun([s.id]); } }, '실행'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: (ev) => { ev.stopPropagation(); editServer(s); } }, '수정'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', disabled: running, onclick: (ev) => { ev.stopPropagation(); deleteServer(s); } }, '삭제')) },
      ],
    });
    const o = S.runOpts;
    return h('section', { class: 'panel', 'aria-label': '등록된 서버' },
      h('div', { class: 'panel-head' },
        h('div', null, h('h2', null, `등록된 서버 ${S.servers.length}`), h('div', { class: 'dim small' }, '체크한 서버를 차례로 실행합니다(동시에 한 대씩)')),
        h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn btn-sm', disabled: !S.servers.length, onclick: () => { if (allSel) S.selected.clear(); else S.servers.forEach((s) => S.selected.add(s.id)); render(); } }, allSel ? '선택 해제' : '전체 선택'),
          h('button', { type: 'button', class: 'btn btn-primary', disabled: running || !S.selected.size, onclick: () => startRun([...S.selected]) }, `선택한 서버 실행 (${S.selected.size})`))),
      h('div', { class: 'panel-body' },
        h('div', { class: 'form-row' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.crawl, onchange: (e) => { o.crawl = e.target.checked; } }), '전체 Redfish 탐색(최대한 많은 자원)'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.ipmi, onchange: (e) => { o.ipmi = e.target.checked; } }), 'IPMI(ipmitool) 실행'),
          h('label', { class: 'check' }, '탐색 상한', h('input', { class: 'input', type: 'number', min: '50', max: '20000', step: '50', value: String(o.crawlMax), 'aria-label': '탐색 자원 상한', style: { width: '96px', height: '28px' }, onchange: (e) => { o.crawlMax = Number(e.target.value) || 2000; } }), '개'))),
      table);
  }

  function serverForm() {
    const f = S.form;
    const edit = !!f.id;
    const set = (k) => (e) => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; };
    const setI = (k) => (e) => { f.ipmi[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (k === 'sameCreds') render(); };
    const field = (id, label, input) => h('div', { class: 'field' }, h('label', { for: id }, label), input);
    const msg = S.formMsg ? h('div', { class: `note ${S.formMsg.bad ? 'note-bad' : 'note-info'}`, role: 'status' }, S.formMsg.text) : null;
    const probe = S.probe ? h('div', { class: `note ${S.probe.ok ? 'note-info' : 'note-bad'}`, role: 'status' },
      S.probe.ok ? `응답 HTTP ${S.probe.status} · ${S.probe.vendorLabel}${S.probe.evidence ? ` (${S.probe.evidence})` : ''}${S.probe.redfishVersion ? ` · Redfish ${S.probe.redfishVersion}` : ''} · ${fmtMs(S.probe.ms)}${S.probe.tlsNote ? ` · ${S.probe.tlsNote}` : ''}` : `접속 실패: ${S.probe.error || S.probe.message || ''}`) : null;
    return h('section', { class: 'panel', 'aria-label': '서버 등록' },
      h('div', { class: 'panel-head' }, h('h2', null, edit ? `서버 수정 — ${f.name}` : '서버 등록'), edit ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { S.form = emptyForm(); S.formMsg = null; S.probe = null; render(); } }, '새로 등록') : null),
      h('form', { class: 'panel-body', onsubmit: (e) => { e.preventDefault(); saveServer(); } },
        field('f-name', '이름', h('input', { id: 'f-name', class: 'input', value: f.name, placeholder: 'smc-x13-01', oninput: set('name'), maxlength: '80' })),
        field('f-role', '역할', h('select', { id: 'f-role', class: 'input', onchange: set('role') }, [['smc', 'Supermicro 대상'], ['dell', 'Dell 기준선(비교용)'], ['other', '기타 벤더']].map(([v, l]) => h('option', { value: v, selected: f.role === v ? 'selected' : null }, l)))),
        h('div', { class: 'form-row' },
          field('f-host', 'BMC 주소(IP 또는 호스트)', h('input', { id: 'f-host', class: 'input mono', value: f.host, placeholder: '10.10.2.31', oninput: set('host'), autocomplete: 'off', spellcheck: 'false', required: true })),
          h('div', { class: 'field', style: { flex: '0 1 100px' } }, h('label', { for: 'f-port' }, 'HTTPS 포트'), h('input', { id: 'f-port', class: 'input', value: f.port, placeholder: '443', inputmode: 'numeric', oninput: set('port') }))),
        h('div', { class: 'form-row' },
          field('f-user', 'BMC 사용자', h('input', { id: 'f-user', class: 'input', value: f.username, placeholder: 'ADMIN', oninput: set('username'), autocomplete: 'off', required: true })),
          field('f-pass', '비밀번호', h('input', { id: 'f-pass', class: 'input', type: 'password', value: f.password, placeholder: edit && f.hasPassword ? '저장됨 — 바꿀 때만 입력' : '', oninput: set('password'), autocomplete: 'new-password' }))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.ipmi.enabled, onchange: setI('enabled') }), 'IPMI over LAN 도 실행(ipmitool, UDP 623)'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.ipmi.sameCreds, onchange: setI('sameCreds') }), 'IPMI 도 같은 계정 사용'),
        f.ipmi.sameCreds ? null : h('div', { class: 'form-row' },
          field('f-iuser', 'IPMI 사용자', h('input', { id: 'f-iuser', class: 'input', value: f.ipmi.username, oninput: setI('username'), autocomplete: 'off' })),
          field('f-ipass', 'IPMI 비밀번호', h('input', { id: 'f-ipass', class: 'input', type: 'password', value: f.ipmi.password, placeholder: edit && f.ipmi.hasPassword ? '저장됨' : '', oninput: setI('password'), autocomplete: 'new-password' }))),
        field('f-cipher', 'IPMI 암호 묶음(cipher suite)', h('select', { id: 'f-cipher', class: 'input', onchange: setI('cipher') }, [['', '자동(ipmitool 기본 → 실패 시 3)'], ['17', '17'], ['3', '3']].map(([v, l]) => h('option', { value: v, selected: f.ipmi.cipher === v ? 'selected' : null }, l)))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.insecure, onchange: set('insecure') }), 'BMC 인증서 확인 안 함(자체서명 — 사내망에서만)'),
        field('f-note', '메모', h('input', { id: 'f-note', class: 'input', value: f.note, oninput: set('note'), maxlength: '300' })),
        h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn', onclick: probeForm }, '연결 확인(무인증)'),
          h('button', { type: 'submit', class: 'btn btn-blue', style: { flex: '1 1 auto' } }, edit ? '수정 저장' : '저장')),
        probe, msg,
        h('div', { class: 'muted-box dim small' }, '비밀번호는 이 컴퓨터의 data/servers.json(권한 600)에만 저장되고 화면·결과 파일에는 실리지 않습니다. 주소·포트·사용자를 바꾸면 비밀번호를 다시 입력해야 합니다. 목 서버로 시험할 때는 주소에 http://127.0.0.1:9001 처럼 http:// 를 붙이세요.')));
  }

  function editServer(s) {
    S.form = { ...emptyForm(), ...s, password: '', ipmi: { ...emptyForm().ipmi, ...s.ipmi, password: '' } };
    S.formMsg = null; S.probe = null;
    render();
    document.getElementById('f-name')?.focus();
  }
  async function saveServer() {
    const f = S.form;
    const body = { name: f.name, role: f.role, host: f.host, port: f.port, username: f.username, password: f.password, insecure: f.insecure, note: f.note, ipmi: { enabled: f.ipmi.enabled, sameCreds: f.ipmi.sameCreds, username: f.ipmi.username, password: f.ipmi.password, cipher: f.ipmi.cipher } };
    try {
      const saved = f.id ? await api('PUT', `/api/servers/${f.id}`, body) : await api('POST', '/api/servers', body);
      S.formMsg = { text: `${saved.name} 저장됨`, bad: false };
      S.selected.add(saved.id);
      S.form = emptyForm();
      await loadServers();
    } catch (e) { S.formMsg = { text: String(e.message || e), bad: true }; }
    render();
  }
  async function deleteServer(s) {
    if (!window.confirm(`${s.name} 을(를) 삭제할까요? (결과 폴더는 지우지 않습니다)`)) return;
    try { await api('DELETE', `/api/servers/${s.id}`); S.selected.delete(s.id); await refreshAll(); } catch (e) { S.error = String(e.message || e); }
    render();
  }
  async function probeForm() {
    const f = S.form;
    S.probe = { ok: false, error: '확인 중…' };
    render();
    try { S.probe = await api('POST', '/api/probe', { host: f.host, port: f.port, insecure: f.insecure }); } catch (e) { S.probe = { ok: false, error: String(e.message || e) }; }
    render();
  }

  // ── 실행 ──────────────────────────────────────────────────────────────────
  let pollTimer = null;
  async function startRun(ids) {
    try {
      S.job = await api('POST', '/api/runs', { serverIds: ids, options: S.runOpts });
      S.error = '';
      render();
      poll();
    } catch (e) { S.error = String(e.message || e); render(); }
  }
  async function cancelRun() { try { await api('POST', '/api/runs/cancel', {}); } catch { /* */ } }
  function poll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const j = await api('GET', '/api/runs/current');
        const wasRunning = S.job && S.job.status === 'running';
        S.job = j;
        if (S.tab === 'servers') { const p = document.getElementById('job-panel'); if (p) p.replaceChildren(...jobPanel()); }
        if (j && j.status === 'running') poll();
        else if (wasRunning) { await refreshAll(); render(); }
      } catch { poll(); }
    }, 1000);
  }

  function jobPanel() {
    const j = S.job;
    const head = h('div', { class: 'panel-head' },
      h('div', null, h('h2', null, '실행 진행'), h('div', { class: 'dim small' }, j ? `작업 #${j.id} · ${j.status === 'running' ? '실행 중' : j.status === 'done' ? '완료' : j.status === 'canceled' ? '취소됨' : j.status} · 시작 ${fmtTime(j.startedAt)}` : '아직 실행하지 않았습니다')),
      h('div', { class: 'btns' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.verbose, onchange: (e) => { S.verbose = e.target.checked; const p = document.getElementById('job-panel'); if (p) p.replaceChildren(...jobPanel()); } }), '요청 로그 모두 보기'),
        j && j.status === 'running' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: cancelRun }, '취소') : null));
    if (!j) return [head];
    const runs = h('div', { class: 'runs' }, j.servers.map((s) => h('div', { class: 'run' },
      h('div', { class: 'step-line' }, h('strong', null, s.name), h('span', { class: 'dim mono' }, s.status === 'running' ? '실행 중' : s.status === 'waiting' ? '대기' : s.status === 'done' ? '완료' : s.status)),
      s.steps.map((st) => {
        const pct = st.state === 'done' ? 100 : st.state === 'run' && st.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : st.state === 'run' ? 30 : 0;
        const bar = h('div', { class: `bar ${st.state === 'done' ? 'done' : st.state === 'fail' ? 'fail' : ''}` }, (() => { const x = h('span'); x.style.width = `${st.state === 'fail' ? 100 : pct}%`; return x; })());
        const label = { wait: '대기', run: '진행 중', done: '완료', fail: '실패', skip: '건너뜀' }[st.state] || st.state;
        return h('div', null, h('div', { class: 'step-line' }, h('span', null, st.label), h('span', { class: st.state === 'fail' ? 'dim' : 'dim' }, label)), bar, st.detail ? h('div', { class: 'step-detail' }, st.detail) : null);
      }))));
    const lines = (j.log || []).filter((l) => S.verbose || !l.verbose).map((l) => `${new Date(l.t).toLocaleTimeString()}  ${l.line}`);
    const log = h('div', { class: 'log', 'aria-live': 'polite' }, lines.slice(-200).join('\n'));
    setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
    return [head, runs, log];
  }

  // ════════════════════════════════════════════════════════════════════════
  // ② 비교 매트릭스
  // ════════════════════════════════════════════════════════════════════════
  function viewMatrix() {
    const c = S.compare;
    if (!c) return h('div', { class: 'empty' }, '불러오는 중…');
    const cols = c.cols.filter((x) => x.hasResult);
    if (!cols.length) return noResults();
    const out = [h('div', { class: 'section-title' }, h('h1', null, '기능별 비교 매트릭스'), h('span', { class: 'dim small' }, 'The.DVC 가 Dell iDRAC 에서 읽는 항목을 같은 Redfish 경로로 요청한 결과 · 셀을 누르면 근거(요청 경로·HTTP 상태·받은 값)'))];
    out.push(h('section', { class: 'cards', 'aria-label': '서버 요약' }, cols.map(summaryCard)));
    if (c.tagCollisions?.length) out.push(h('div', { class: 'note note-bad' }, `서비스태그 충돌 — ${c.tagCollisions.map((t) => `"${t.tag}": ${t.servers.join(', ')}`).join(' · ')} → The.DVC 는 이 서버들을 한 장비로 합칩니다.`));
    const hasDellRun = cols.some((x) => x.role === 'dell');
    const filters = [['all', '전체'], ['break', 'The.DVC 깨짐·확인'], ['diff', 'Supermicro 미지원·부분']];
    const smcIds = cols.filter((x) => x.role !== 'dell').map((x) => x.id);
    let rows = c.rows;
    if (S.matrixFilter === 'break') rows = rows.filter((r) => r.impact && (r.impact.verdict === 'break' || r.impact.verdict === 'check'));
    if (S.matrixFilter === 'diff') rows = rows.filter((r) => smcIds.some((id) => r.cells[id] && r.cells[id].status !== 'ok'));
    const columns = [
      { key: 'feature', label: '기능', render: (r) => h('span', null, h('strong', null, r.feature), h('span', { class: 'sub mono' }, r.path)) },
      { key: 'fn', label: 'The.DVC 함수', mono: true },
    ];
    if (S.showDellExpect) columns.push({ key: '_dell', label: 'Dell 기대(코드 기준)', value: (r) => ST_RANK[r.dell.status], render: (r) => h('span', null, badge(r.dell.status), r.dell.note ? h('span', { class: 'sub' }, r.dell.note) : null) });
    for (const col of cols) {
      columns.push({
        key: `c_${col.id}`, label: `${col.name}${col.role === 'dell' ? ' (Dell)' : ''}`, value: (r) => (r.cells[col.id] ? ST_RANK[r.cells[col.id].status] : null),
        render: (r) => { const x = r.cells[col.id]; if (!x) return '—'; return h('button', { type: 'button', class: 'cellbtn', onclick: (ev) => { ev.stopPropagation(); openCheck(col.id, r.id); }, 'aria-label': `${col.name} ${r.feature} 상세` }, badge(x.status), x.note ? h('span', { class: 'sub' }, x.note) : null); },
      });
    }
    columns.push({ key: '_imp', label: 'The.DVC 영향', value: (r) => (r.impact ? VD_RANK[r.impact.verdict] : null), render: (r) => (r.impact ? h('span', null, badge(r.impact.verdict, VD), r.impact.nos.length ? h('span', { class: 'sub' }, `수정 지점 #${r.impact.nos.join(', #')}`) : null) : '—') });
    out.push(h('section', { class: 'panel', 'aria-label': '매트릭스' },
      h('div', { class: 'panel-head' },
        h('div', { class: 'pills', role: 'group', 'aria-label': '보기' }, filters.map(([k, l]) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(S.matrixFilter === k), onclick: () => { S.matrixFilter = k; render(); } }, l))),
        h('div', { class: 'btns' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.showDellExpect, onchange: (e) => { S.showDellExpect = e.target.checked; render(); } }), 'Dell 기대 열(The.DVC 코드 기준 — 실측 아님)'),
          EXPORT ? null : h('a', { class: 'btn btn-sm', href: '#', onclick: (e) => { e.preventDefault(); download('/api/export.html', 'smc-poc-report.html'); } }, 'HTML 내보내기'),
          EXPORT ? null : h('a', { class: 'btn btn-sm', href: '#', onclick: (e) => { e.preventDefault(); download('/api/export.md', 'smc-poc-report.md'); } }, 'Markdown'))),
      !hasDellRun ? h('div', { class: 'note note-warn', style: { margin: '12px 16px 0' } }, 'Dell 서버 실측이 없습니다 — Dell 기대 열은 The.DVC 코드가 Dell 에서 읽도록 만든 것을 적은 값이지 측정값이 아닙니다. Dell 서버를 "Dell 기준선" 역할로 등록해 실행하면 실측 열이 생깁니다.') : null,
      sortTable({ columns, rows, minWidth: 980, groupBy: (r) => r.group, limit: 100 })));
    if (c.paths) out.push(pathCompare(c.paths));
    return out;
  }

  function summaryCard(col) {
    const s = col.summary || {};
    const a = s.assumptions || {};
    const bad = col.role !== 'dell' && (a.break || 0) > 0;
    return h('article', { class: 'card' },
      h('div', { class: 'step-line' }, roleChip(col.role), h('span', { class: 'mono dim small' }, col.host)),
      h('div', null, h('div', { style: { fontSize: '16px', fontWeight: '600' } }, col.name), h('div', { class: 'dim small' }, `${s.model || '모델 미확인'} · BMC ${s.bmcFirmware || '—'} · BIOS ${s.biosVersion || '—'}`)),
      kvGrid([['인증', s.authFailed ? '실패' : (s.authMode || '—')], ['Redfish', s.redfishVersion || '—'], ['요청 · 소요', `${s.requests || 0}회 · ${fmtMs(s.durationMs)}`], ['전체 탐색', `${s.crawlResources || 0}개 자원`], ['IPMI', s.ipmiTotal ? `${s.ipmiOk}/${s.ipmiTotal} 성공` : '—'], ['벤더 판별', s.vendorLabel || col.vendor || '—']]),
      h('div', { class: 'step-line' }, h('span', { class: 'dim small' }, `점검 ${s.total || 0}개 판정`), h('strong', null, `지원 ${s.counts?.ok || 0} / ${s.total || 0}`)),
      stackBar(groupCounts(s.counts || {})),
      s.tlsNote ? h('div', { class: 'note note-warn small' }, s.tlsNote) : null,
      h('div', { class: `note ${bad ? 'note-bad' : 'note-info'} small` }, col.role === 'dell' ? '기준선 — The.DVC 가 지금 받는 모양' : `The.DVC 에 그대로 넣으면 수정 지점 깨짐 ${a.break || 0} · 확인 ${a.check || 0} · 미확인 ${a.unknown || 0}`));
  }

  function pathCompare(p) {
    const list = (arr) => sortTable({ rows: arr.map((x) => ({ p: x })), columns: [{ key: 'p', label: '경로 패턴', mono: true }], limit: 60 });
    return h('section', { class: 'panel', 'aria-label': '경로 비교' },
      h('div', { class: 'panel-head' }, h('div', null, h('h2', null, 'Redfish 경로 비교(전체 탐색 기준)'), h('div', { class: 'dim small' }, '멤버 id 를 {id} 로 바꿔 맞춘 패턴 — Dell 기준선 서버 합집합 vs 그 밖의 서버 합집합'))),
      h('div', { class: 'panel-body' },
        h('div', { class: 'counts' }, [['공통', p.common.length], ['Supermicro(대상)에만', p.otherOnly.length], ['Dell 에만', p.dellOnly.length]].map(([k, v]) => h('div', { class: 'count' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v)))),
        h('details', null, h('summary', null, `Supermicro(대상)에만 있는 경로 ${p.otherOnly.length}`), list(p.otherOnly)),
        h('details', null, h('summary', null, `Dell 에만 있는 경로 ${p.dellOnly.length}`), list(p.dellOnly)),
        h('details', null, h('summary', null, `공통 경로 ${p.common.length}`), list(p.common))));
  }

  async function openCheck(serverId, checkId) {
    const srv = S.servers.find((s) => s.id === serverId);
    const r = await loadResult(serverId);
    const c = r?.checks?.[checkId];
    const row = S.compare?.rows.find((x) => x.id === checkId);
    const body = [];
    if (!c) body.push(h('div', { class: 'empty' }, '결과 없음'));
    else {
      body.push(h('div', { class: 'btns' }, badge(c.status), h('span', null, c.note || '')));
      if (row) body.push(kvGrid([['The.DVC 함수', row.fn], ['경로', row.path], ['Dell 기대(코드 기준)', `${ST[row.dell.status][0]}${row.dell.note ? ` — ${row.dell.note}` : ''}`]]));
      body.push(h('h3', null, `근거 요청 ${c.evidence?.length || 0}`));
      body.push(sortTable({
        rows: c.evidence || [], empty: '요청 없음(다른 점검 결과로 계산)',
        columns: [{ key: 'path', label: '경로', mono: true }, { key: 'status', label: 'HTTP', num: true, render: (e) => dash(e.status || 'ERR') }, { key: 'kind', label: '판정', value: (e) => ST_RANK[e.kind], render: (e) => badge(e.kind) }],
        onRow: EXPORT ? null : (e) => { closeDrawer(); S.pick.explore = serverId; S.explore.sel = e.path; S.explore.body = null; location.hash = '#explore'; loadRaw(serverId, e.path); },
      }));
      body.push(h('h3', null, '받은 값(요약)'));
      body.push(jsonBlock(c.data || {}));
    }
    openDrawer(`${srv?.name || serverId} · ${row?.feature || checkId}`, body);
  }

  function openDrawer(title, nodes) {
    document.getElementById('drawer-title').textContent = title;
    document.getElementById('drawer-body').replaceChildren(...nodes.flat(Infinity).filter((x) => x != null && x !== false));
    const d = document.getElementById('drawer');
    if (!d.open) d.showModal();
  }
  function closeDrawer() { const d = document.getElementById('drawer'); if (d.open) d.close(); }

  async function download(path, name) {
    try {
      const res = await fetch(path, { headers: { 'X-PoC-Token': TOKEN } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { S.error = `내보내기 실패: ${e.message || e}`; render(); }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ③ The.DVC 수정 지점
  // ════════════════════════════════════════════════════════════════════════
  function viewGaps() {
    const c = S.compare;
    if (!c) return h('div', { class: 'empty' }, '불러오는 중…');
    const { el, id } = serverPicker('gaps');
    if (!id) return noResults();
    const ps = (c.perServer || []).find((x) => x.id === id);
    const list = ps?.assumptions || [];
    const cnt = { break: 0, check: 0, ok: 0, info: 0, unknown: 0 };
    for (const a of list) cnt[a.verdict] = (cnt[a.verdict] || 0) + 1;
    return [
      h('div', { class: 'section-title' }, h('h1', null, 'The.DVC 에 그대로 넣으면 어디가 틀리는가')),
      h('div', { class: 'dim small' }, `받은 응답에 The.DVC 의 실제 판정식(기준 커밋 ${EXPORT ? '' : (S.env?.dvcBase || '')})을 적용한 결과입니다. 위치는 The.DVC 저장소 기준입니다. Dell 기준선 서버로 보면 대부분 '정상' 이어야 합니다(판정식 자체의 대조군).`),
      el,
      h('div', { class: 'counts' }, [['break', '깨짐'], ['check', '확인'], ['ok', '정상'], ['info', '정보'], ['unknown', '미확인']].map(([k, l]) => h('div', { class: 'count' }, h('div', { class: 'k' }, l), h('div', { class: 'v' }, String(cnt[k] || 0))))),
      ...list.map((a) => h('article', { class: 'gap' },
        h('div', { class: 'gap-no' }, h('span', { class: 'n' }, `#${a.no}`), badge(a.verdict, VD)),
        h('div', { class: 'gap-col' }, h('strong', null, a.title), h('span', { class: 'where' }, a.where), h('span', { class: 'small' }, h('span', { class: 'dim' }, 'Dell 가정 · '), a.assume)),
        h('div', { class: 'gap-col muted-box' }, h('span', { class: 'dim small' }, '이번 응답에서 본 것'), h('span', { class: 'mono small' }, a.seen || '—')),
        h('div', { class: 'gap-col' }, h('span', { class: 'dim small' }, '이식 시 제안'), h('span', { class: 'small' }, a.fix)))),
    ];
  }

  // ════════════════════════════════════════════════════════════════════════
  // ④ IPMI 대조
  // ════════════════════════════════════════════════════════════════════════
  const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function viewIpmi() {
    const { el, id } = serverPicker('ipmi');
    if (!id) return noResults();
    const r = needResult(id);
    const head = [h('div', { class: 'section-title' }, h('h1', null, 'IPMI(ipmitool) ↔ Redfish 대조'), h('span', { class: 'dim small' }, 'Redfish 에 없거나 라이선스가 필요한 항목을 IPMI 로 대신 받을 수 있는지 봅니다')), el];
    if (r === undefined) return [...head, h('div', { class: 'empty' }, '불러오는 중…')];
    if (!r) return [...head, noResults()];
    const ip = r.ipmi || {};
    if (!ip.commands?.length) return [...head, h('div', { class: 'note note-warn' }, `IPMI 결과 없음 — ${ip.stoppedReason || '실행하지 않음'}`)];
    const P = ip.parsed || {};
    const ch = r.checks || {};
    const rfW = ch.power?.data?.dvcTotalWatts;
    const dcmiW = P.dcmiPower?.instantW;
    const diff = rfW != null && dcmiW != null ? Math.abs(rfW - dcmiW) : null;
    const fru = P.fru?.serials || {};
    const sys = ch.system?.data || {};
    const mgr = ch.manager?.data || {};
    const mc = P.mcInfo || {};
    const selN = Number(String(P.selInfo?.Entries || '').trim()) || null;
    const rfLogN = (ch.logs?.data?.services || []).reduce((a, x) => a + (x.entries || 0), 0);
    const pair = (title, verdict, cls, ipmiK, ipmiV, rfK, rfV, note) => h('article', { class: 'card' },
      h('div', { class: 'step-line' }, h('strong', null, title), h('span', { class: `badge ${cls}` }, verdict)),
      kvGrid([[`IPMI · ${ipmiK}`, ipmiV], [`Redfish · ${rfK}`, rfV]]), note ? h('div', { class: 'dim small' }, note) : null);
    const cards = h('section', { class: 'cards' },
      pair('소비전력', diff == null ? '판정 불가' : diff <= Math.max(20, (rfW || 0) * 0.05) ? '일치' : '차이', diff == null ? 'b-muted' : diff <= Math.max(20, (rfW || 0) * 0.05) ? 'b-ok' : 'b-partial', 'dcmi power reading', dcmiW != null ? `${dcmiW} W` : '—', 'PowerConsumedWatts(합산)', rfW != null ? `${rfW} W` : '—', diff != null ? `차이 ${diff} W — 측정 시각 차이 범위인지 확인` : (P.dcmiPower ? P.dcmiPower.state || '' : 'DCMI 응답 없음')),
      pair('시리얼', fru['Product Serial'] && sys.SerialNumber && normName(fru['Product Serial']) === normName(sys.SerialNumber) ? '일치' : '확인', fru['Product Serial'] && sys.SerialNumber && normName(fru['Product Serial']) === normName(sys.SerialNumber) ? 'b-ok' : 'b-partial', 'FRU Product/Board Serial', `${fru['Product Serial'] || '—'} / ${fru['Board Serial'] || '—'}`, 'SerialNumber / SKU', `${sys.SerialNumber || '—'} / ${sys.SKU || '—'}`, 'The.DVC 서비스태그 후보 대조'),
      pair('BMC 정체', mc.ipmiVersion ? '확인됨' : '—', mc.ipmiVersion ? 'b-ok' : 'b-muted', 'mc info', `IPMI ${mc.ipmiVersion || '—'} · FW ${mc.firmwareRevision || '—'}`, 'Manager', `FW ${mgr.FirmwareVersion || '—'}`, `제조사 ${mc.manufacturerName || mc.manufacturerId || '—'} · 제품 ${mc.productName || mc.productId || '—'}`),
      pair('이벤트 로그', selN != null && rfLogN ? (selN === rfLogN ? '일치' : '차이') : '—', selN != null && rfLogN && selN === rfLogN ? 'b-ok' : 'b-muted', 'sel info Entries', selN ?? '—', 'LogServices 항목 합', rfLogN || '—', 'Redfish 로그 경로가 SEL 과 같은 내용인지 교차 확인'));
    const cmds = sortTable({
      rows: ip.commands, onRow: (c) => openDrawer(`ipmitool ${c.label}`, [h('div', { class: 'btns' }, badge(c.ok ? 'ok' : 'error', ST, c.ok ? '성공' : `실패(code ${c.code})`), h('span', { class: 'dim' }, fmtMs(c.ms)), c.note ? h('span', null, c.note) : null), c.stderr ? h('pre', { class: 'json' }, c.stderr) : null, h('pre', { class: 'json' }, c.stdout || '(출력 없음)')]),
      columns: [{ key: 'label', label: '명령(읽기 전용)', mono: true }, { key: 'ok', label: '결과', value: (c) => (c.ok ? 0 : 1), render: (c) => badge(c.ok ? 'ok' : 'error', ST, c.ok ? '성공' : '실패') }, { key: 'ms', label: '소요', num: true, render: (c) => fmtMs(c.ms) }, { key: 'stderr', label: '오류 메시지', render: (c) => (c.stderr ? c.stderr.slice(0, 160) : '—') }],
    });
    const rfSensors = [...(ch.thermal?.data?.temps || []).map((t) => ({ name: t.name, val: t.reading != null ? `${t.reading} °C` : '—' })), ...(ch.fans?.data?.fans || []).map((f) => ({ name: f.name, val: f.reading != null ? `${f.reading} ${f.units}` : '—' })), ...(ch.sensors?.data?.sensors || []).map((x) => ({ name: x.name, val: x.reading != null ? `${x.reading} ${x.units}` : '—' }))];
    const rfBy = new Map();
    for (const x of rfSensors) if (!rfBy.has(normName(x.name))) rfBy.set(normName(x.name), x);
    const sdr = (P.sdr?.sensors || []).map((x) => { const m = rfBy.get(normName(x.name)); return { ...x, rfName: m?.name || '', rfVal: m?.val || '', match: m ? '일치' : 'IPMI 만' }; });
    const sdrMatched = sdr.filter((x) => x.rfName).length;
    const sdrTable = sortTable({
      rows: sdr, limit: 200, empty: 'SDR 응답 없음',
      columns: [{ key: 'name', label: 'SDR 이름', mono: true }, { key: 'reading', label: 'SDR 값' }, { key: 'status', label: '상태' }, { key: 'rfName', label: 'Redfish 이름', mono: true }, { key: 'rfVal', label: 'Redfish 값' }, { key: 'match', label: '대응', render: (x) => badge(x.rfName ? 'ok' : 'partial', ST, x.match) }],
    });
    const selTable = sortTable({ rows: P.sel?.entries || [], empty: 'SEL 항목 없음', columns: [{ key: 'id', label: '#', mono: true }, { key: 'date', label: '날짜' }, { key: 'time', label: '시각' }, { key: 'sensor', label: '센서' }, { key: 'event', label: '이벤트' }, { key: 'direction', label: '방향' }] });
    const fruRows = (P.fru?.devices || []).flatMap((d) => Object.entries(d.fields).map(([k, v]) => ({ device: d.device, k, v })));
    return [...head,
      ip.stoppedReason ? h('div', { class: 'note note-warn' }, ip.stoppedReason) : null,
      h('div', { class: 'dim small' }, `${ip.version || 'ipmitool'} · ${ip.commands.filter((x) => x.ok).length}/${ip.commands.length} 성공${ip.cipherUsed ? ` · cipher ${ip.cipherUsed}` : ''}`),
      cards,
      h('div', { class: 'row' },
        h('section', { class: 'panel grow' }, h('div', { class: 'panel-head' }, h('h2', null, 'SDR 센서 ↔ Redfish'), h('span', { class: 'dim small' }, `SDR ${sdr.length}개 · Redfish 센서 ${rfSensors.length}개 · 이름 일치 ${sdrMatched}`)), sdrTable),
        h('section', { class: 'panel side' }, h('div', { class: 'panel-head' }, h('h2', null, '실행한 명령'), h('span', { class: 'dim small' }, '행을 누르면 출력 원문')), cmds)),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, `SEL(최근) ${P.sel?.entries?.length || 0}`)), selTable),
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, 'FRU')), sortTable({ rows: fruRows, empty: 'FRU 응답 없음', columns: [{ key: 'device', label: '장치' }, { key: 'k', label: '항목' }, { key: 'v', label: '값', mono: true }] })),
    ];
  }

  // ════════════════════════════════════════════════════════════════════════
  // ⑤ 수집 정보(서버별 전체 표)
  // ════════════════════════════════════════════════════════════════════════
  function viewInfo() {
    const { el, id } = serverPicker('info');
    if (!id) return noResults();
    const r = needResult(id);
    const head = [h('div', { class: 'section-title' }, h('h1', null, '수집 정보'), h('span', { class: 'dim small' }, '이 서버에서 읽은 값 전부 — 표 제목을 누르면 정렬')), el];
    if (r === undefined) return [...head, h('div', { class: 'empty' }, '불러오는 중…')];
    if (!r) return [...head, noResults()];
    const C = r.checks || {};
    const d = (k) => C[k]?.data || {};
    const sec = (title, status, node, count) => h('details', { class: 'panel', open: true },
      h('summary', { class: 'panel-head' }, h('span', { class: 'btns' }, h('strong', null, title), count != null ? h('span', { class: 'dim small' }, String(count)) : null, status ? badge(status) : null)), node);
    const T = (rows, cols, opts = {}) => sortTable({ rows: rows || [], columns: cols.map((c) => (typeof c === 'string' ? { key: c, label: c } : c)), ...opts });
    const sys = d('system');
    const mgr = d('manager');
    const sections = [
      h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', null, '신원 · BMC')), h('div', { class: 'panel-body' },
        kvGrid([['제조사', sys.Manufacturer], ['모델', sys.Model], ['시리얼', sys.SerialNumber], ['SKU', sys.SKU], ['UUID', sys.UUID], ['자산 태그', sys.AssetTag], ['BIOS', sys.BiosVersion], ['전원', sys.PowerState], ['호스트명', sys.HostName], ['상태', `${sys.Health || '—'} / 롤업 ${sys.HealthRollup || '—'}`], ['CPU', `${sys.cpuCount ?? '—'} × ${sys.cpuModel || '—'}`], ['메모리', sys.memoryGiB != null ? `${sys.memoryGiB} GiB` : '—'],
          ['BMC 모델', mgr.Model], ['BMC 펌웨어', mgr.FirmwareVersion], ['BMC 시각', mgr.DateTime], ['The.DVC 서비스태그', `${sys.dvcServiceTag || '—'} (${sys.dvcServiceTagFrom || '—'})`], ['인증 방식', r.auth?.mode || '—'], ['TLS', r.auth?.tlsNote || (r.auth?.insecure ? '인증서 확인 안 함' : '검증')]]),
        T(mgr.interfaces, ['Id', 'MACAddress', 'IPv4', 'HostName', { key: 'SpeedMbps', label: 'SpeedMbps', num: true }], { empty: 'BMC NIC 없음' }),
        h('div', { class: 'dim small' }, 'BMC 서비스'), T(Object.entries(d('networkProtocol').protocols || {}).map(([k, v]) => ({ k, enabled: v.enabled == null ? '—' : v.enabled ? '켜짐' : '꺼짐', port: v.port })), [{ key: 'k', label: '프로토콜' }, { key: 'enabled', label: '상태' }, { key: 'port', label: '포트', num: true }], { empty: 'NetworkProtocol 없음' }))),
      sec('펌웨어', C.firmware?.status, T(d('firmware').firmware, ['Name', 'Version', 'Id', { key: 'Updateable', label: '갱신 가능', render: (x) => (x.Updateable == null ? '—' : x.Updateable ? '예' : '아니오') }, { key: 'dvcType', label: 'The.DVC 분류' }, { key: 'dvcInstalled', label: 'Installed- 필터', render: (x) => (x.dvcInstalled ? '통과' : '제외') }]), d('firmware').members),
      sec('온도 센서(Thermal)', C.thermal?.status, T(d('thermal').temps, ['name', { key: 'reading', label: '°C', num: true }, 'health', 'state', 'context', { key: 'upperWarn', label: '경고', num: true }, { key: 'upperCrit', label: '위험', num: true }, { key: 'dvcRoom', label: 'The.DVC 분류' }, 'chassis']), d('thermal').count),
      sec('팬', C.fans?.status, T(d('fans').fans, ['name', { key: 'reading', label: '값', num: true }, 'units', 'health', 'state', { key: 'lowerCrit', label: '하한', num: true }, 'chassis'])),
      sec('Sensors 컬렉션(전체)', C.sensors?.status, T(d('sensors').sensors, ['name', { key: 'reading', label: '값', num: true }, 'units', 'type', 'context', 'health', 'chassis'], { limit: 200 }), d('sensors').count),
      sec('전력(PowerControl)', C.power?.status, T((d('power').perChassis || []).flatMap((p) => (p.controls || []).map((c) => ({ chassis: p.chassis, ...c }))), ['chassis', 'name', { key: 'consumed', label: '소비 W', num: true }, { key: 'avg', label: '평균', num: true }, { key: 'max', label: '최대', num: true }, { key: 'capacity', label: '용량', num: true }, { key: 'limit', label: '한도', num: true }])),
      sec('PSU', C.psu?.status, T(d('psu').psus, ['Name', 'Model', 'Manufacturer', 'SerialNumber', { key: 'PowerCapacityWatts', label: '용량 W', num: true }, { key: 'LineInputVoltage', label: '입력 V', num: true }, { key: 'PowerOutputWatts', label: '출력 W', num: true }, 'FirmwareVersion', 'Health', 'State'])),
      sec('메모리 DIMM', C.memory?.status, T(d('memory').dimms, ['locator', { key: 'sizeGB', label: 'GB', num: true }, 'type', { key: 'speedMHz', label: 'MHz', num: true }, 'Manufacturer', 'PartNumber', 'SerialNumber', { key: 'RankCount', label: 'Rank', num: true }, 'Health']), (d('memory').dimms || []).length),
      sec('CPU · GPU', C.processors?.status, T([...(d('processors').cpus || []).map((x) => ({ ...x, kind: 'CPU' })), ...(d('processors').gpus || []).map((x) => ({ ...x, kind: 'GPU' }))], ['kind', 'Socket', 'Model', 'Manufacturer', { key: 'TotalCores', label: '코어', num: true }, { key: 'TotalThreads', label: '스레드', num: true }, { key: 'MaxSpeedMHz', label: 'MHz', num: true }, 'Health'])),
      sec('스토리지 컨트롤러', C.storage?.status, h('div', null, T(d('storage').controllers, ['storage', 'Name', 'Model', 'Manufacturer', 'FirmwareVersion', 'Protocols', 'Health'], { empty: C.storage?.note || '없음' }), T(d('storage').members, ['id', { key: 'kind', label: '판정', render: (x) => badge(x.kind) }, 'note'], { empty: '' }))),
      sec('드라이브', C.storage?.status, T(d('storage').drives, ['Name', 'Model', 'SerialNumber', { key: 'capacityGB', label: 'GB', num: true }, 'MediaType', 'Protocol', { key: 'FailurePredicted', label: '예측 실패', render: (x) => (x.FailurePredicted == null ? '—' : x.FailurePredicted ? '예' : '아니오') }, { key: 'LifeLeftPct', label: '수명 %', num: true }, 'Health'], { empty: C.storage?.note || '없음' })),
      sec('NIC 포트', C.nics?.status, h('div', null, T((d('nics').adapters || []).flatMap((a) => (a.ports || []).map((p) => ({ adapter: a.Id || a.Model, model: a.Model, ...p }))), ['adapter', 'model', 'id', 'link', { key: 'speedMbps', label: 'Mbps', num: true }, 'mac', 'portType'], { empty: 'NetworkAdapters 포트 없음' }), h('div', { class: 'dim small', style: { padding: '8px 12px' } }, '시스템 이더넷 인터페이스'), T(d('nics').systemEthernet, ['Id', 'MACAddress', { key: 'SpeedMbps', label: 'Mbps', num: true }, 'LinkStatus', 'IPv4'], { empty: '없음' }))),
      sec('PCIe 장치', C.pcie?.status, T(d('pcie').devices, ['Name', 'Model', 'Manufacturer', 'DeviceType', 'PCIeType', { key: 'Lanes', label: '레인', num: true }, 'Slot', 'FirmwareVersion', 'Health', 'source'])),
      sec('로그', C.logs?.status, h('div', null, T(d('logs').services, ['owner', 'id', 'Name', { key: 'entries', label: '항목', num: true }, { key: 'MaxNumberOfRecords', label: '최대', num: true }, 'OverWritePolicy', { key: 'kind', label: '판정', render: (x) => badge(x.kind) }]), T((d('logs').services || []).flatMap((s) => (s.recent || []).map((e) => ({ svc: s.id, ...e }))), ['svc', 'Created', 'Severity', 'Message', 'MessageId', 'SensorType'], { empty: '항목 없음', limit: 100 }))),
      sec('계정 · 잠금 정책', C.accounts?.status, h('div', { class: 'panel-body' }, kvGrid(Object.entries(d('accounts').policy || {})), T(d('accounts').accounts, ['Id', 'UserName', 'RoleId', { key: 'Enabled', label: '사용', render: (x) => (x.Enabled ? '예' : '아니오') }, { key: 'Locked', label: '잠김', render: (x) => (x.Locked == null ? '—' : x.Locked ? '예' : '아니오') }]))),
      sec('라이선스', C.licenses?.status, h('div', null, T(d('licenses').licenses, ['from', 'Name', 'Type', 'Entitlement', 'Expiry'], { empty: '라이선스 멤버 없음' }), T(d('licenses').resources, ['from', 'path', 'Name', { key: 'sample', label: '내용(앞부분)', mono: true }], { empty: '' }), T(d('licenses').tried, ['how', 'path', 'status', { key: 'kind', label: '판정', render: (x) => badge(x.kind) }]))),
      sec('BIOS 속성(전체)', C.bios?.status, T(Object.entries(d('bios').attributes || {}).map(([k, v]) => ({ k, v: typeof v === 'object' ? JSON.stringify(v) : String(v), dvc: (d('bios').dvcCuratedHits || []).includes(k) ? 'The.DVC 주요 키' : '' })), [{ key: 'k', label: '속성', mono: true }, { key: 'v', label: '값', mono: true }, { key: 'dvc', label: '비고' }], { empty: C.bios?.note || '없음', limit: 100 }), d('bios').count),
      sec('텔레메트리 리포트', C.telemetry?.status, T(d('telemetry').reports, ['id', { key: 'values', label: '값 수', num: true }, { key: 'metricIds', label: '메트릭 id(앞부분)', render: (x) => (x.metricIds || []).join(', ') || '—' }, 'Timestamp'], { empty: C.telemetry?.note || '없음' })),
      sec('기타(Secure Boot · 이벤트 · 가상 미디어 · Oem)', null, h('div', { class: 'panel-body' }, kvGrid([['Secure Boot', C.secureBoot?.note], ['EventService', C.eventService?.note], ['가상 미디어', C.virtualMedia?.note], ['Oem', C.oem?.note], ['PowerSubsystem', C.powerSubsystem?.note || C.powerSubsystem?.status], ['ThermalSubsystem', C.thermalSubsystem?.note || C.thermalSubsystem?.status]]))),
    ];
    return [...head, ...sections];
  }

  // ════════════════════════════════════════════════════════════════════════
  // ⑥ 전체 탐색
  // ════════════════════════════════════════════════════════════════════════
  async function loadRaw(serverId, p) {
    S.explore.body = null; S.explore.err = '';
    try {
      if (EXPORT) throw new Error('내보내기 판에는 원문이 없습니다 — PoC 폴더의 out/<서버>/<실행>/raw 를 보세요');
      const res = await fetch(`/api/results/${serverId}/raw?path=${encodeURIComponent(p)}`, { headers: { 'X-PoC-Token': TOKEN } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      S.explore.body = j;
    } catch (e) { S.explore.err = String(e.message || e); }
    if (S.tab === 'explore') render();
  }

  function viewExplore() {
    const { el, id } = serverPicker('explore');
    if (!id) return noResults();
    const r = needResult(id);
    const head = [h('div', { class: 'section-title' }, h('h1', null, '전체 정보 탐색'), h('span', { class: 'dim small' }, '/redfish/v1 에서 링크를 따라 읽은 모든 자원 — 경로를 누르면 받은 원문(비밀 필드 가림)')), el];
    if (r === undefined) return [...head, h('div', { class: 'empty' }, '불러오는 중…')];
    if (!r) return [...head, noResults()];
    const cr = r.crawl;
    if (!cr) return [...head, h('div', { class: 'note note-warn' }, '전체 탐색을 하지 않았습니다(옵션 꺼짐·인증 실패·접속 실패).')];
    const st = cr.stats || {};
    const q = S.explore.q.trim().toLowerCase();
    const idx = (cr.index || []).filter((e) => !q || e.path.toLowerCase().includes(q) || String(e.type || '').toLowerCase().includes(q));
    idx.sort((a, b) => a.path.localeCompare(b.path));
    const shown = idx.slice(0, 1500);
    const tree = h('div', { class: 'tree', role: 'listbox', 'aria-label': '자원 목록' }, shown.map((e) => {
      const depth = Math.max(0, e.path.split('/').length - 3);
      const ind = h('span'); ind.style.width = `${Math.min(depth, 10) * 12}px`; ind.style.flex = '0 0 auto';
      return h('button', { type: 'button', class: 'node', role: 'option', 'aria-selected': String(S.explore.sel === e.path), title: e.path, onclick: () => { S.explore.sel = e.path; loadRaw(id, e.path); render(); } },
        ind, h('span', { class: 'p' }, depth ? e.path.split('/').slice(-1)[0] || e.path : e.path), e.members != null ? h('span', { class: 'dim small' }, String(e.members)) : null, badge(e.kind, ST, String(e.status || 'ERR')));
    }));
    const sel = (cr.index || []).find((e) => e.path === S.explore.sel);
    const detail = h('section', { class: 'panel grow' },
      h('div', { class: 'panel-head' }, h('div', null, h('div', { class: 'mono small', style: { color: 'var(--mint)', overflowWrap: 'anywhere' } }, S.explore.sel || '왼쪽에서 경로를 고르세요'), sel ? h('div', { class: 'btns', style: { marginTop: '6px' } }, badge(sel.kind, ST, `HTTP ${sel.status || 'ERR'}`), h('span', { class: 'dim small' }, `${sel.bytes || 0} B · ${fmtMs(sel.ms)} · ${sel.type || ''}`), h('span', { class: 'dim small mono' }, `패턴 ${sel.pattern || ''}`)) : null)),
      h('div', { class: 'panel-body' }, S.explore.err ? h('div', { class: 'note note-warn' }, S.explore.err) : S.explore.body ? jsonBlock(S.explore.body.body) : h('div', { class: 'dim' }, S.explore.sel ? '불러오는 중…' : '')));
    return [...head,
      h('div', { class: 'counts' }, [['읽은 자원', st.resources], ['성공', st.byKind?.ok || 0], ['없음 404', st.byKind?.absent || 0], ['라이선스·권한', (st.byKind?.license || 0) + (st.byKind?.forbidden || 0)], ['오류', st.byKind?.error || 0], ['소요', fmtMs(st.durationMs)]].map(([k, v]) => h('div', { class: 'count' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, String(v ?? '—'))))),
      h('div', { class: 'dim small' }, `멈춘 이유: ${st.stopReason || '—'} · 건너뛴 경로 ${st.skipped || 0}(스키마·레지스트리·세션·로그 항목 개별·Actions) · 상한으로 일부만 읽은 컬렉션 ${st.truncatedCollections || 0} · 남은 대기 ${st.remaining || 0}`),
      h('div', { class: 'row' },
        h('section', { class: 'panel side' },
          h('div', { class: 'panel-head' }, h('label', { class: 'field' }, h('span', { class: 'lbl' }, `경로·종류 검색 (${idx.length}${idx.length > shown.length ? ` 중 ${shown.length} 표시` : ''})`), h('input', { class: 'input', type: 'search', value: S.explore.q, placeholder: 'Thermal, Oem, Sensors…', oninput: (e) => { S.explore.q = e.target.value; clearTimeout(viewExplore.t); viewExplore.t = setTimeout(() => { render(); const i = document.querySelector('input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } }))),
          tree),
        detail)];
  }

  // ── 시작 ──────────────────────────────────────────────────────────────────
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') closeDrawer(); });

  (async () => {
    readHash();
    render();
    try { S.env = await api('GET', '/api/env'); } catch { S.env = null; }
    await refreshAll();
    if (!EXPORT) {
      try { S.job = await api('GET', '/api/runs/current'); if (S.job && S.job.status === 'running') poll(); } catch { /* */ }
      for (const s of S.servers) if (!s.last) S.selected.add(s.id);
    }
    render();
  })();
})();
