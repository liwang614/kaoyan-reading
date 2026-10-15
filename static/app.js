const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const pop = $('#pop');
const WORD_CH = /[A-Za-z0-9'’\-]/;
const ALNUM = /[A-Za-z0-9]/;

const state = { list: [], art: null, pending: null };

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1800);
}

function download(items, mode, include = ['word', 'sentence']) {
  const a = document.createElement('a');
  a.href = `/api/export?items=${items.join(',')}&mode=${mode}&include=${include.join(',')}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ================= 两个模块的公共顶栏部件 ================= */

window.THEME_BTN = '<button class="btn icon theme-btn" data-theme-btn title="配色" aria-label="配色"><i class="palette"></i></button>';
window.navSwitch = (active) => `
  <nav class="seg modes" aria-label="切换模块">
    <a href="#/" class="${active === 'read' ? 'on' : ''}">阅读标注</a>
    <a href="#/tracker/reading" class="${active === 'tracker' ? 'on' : ''}">做题记录</a>
  </nav>`;

/* ================= 路由 ================= */

window.addEventListener('hashchange', route);
route();

function route() {
  hidePop();
  document.body.classList.remove('selecting');
  if (location.hash.startsWith('#/tracker')) {
    state.art = null;
    tracker.show(location.hash.slice('#/tracker'.length)).then(() => window.scrollTo(0, 0));
    return;
  }
  tracker.hide();
  const m = location.hash.match(/^#\/(\d{4})\/(\d+)$/);
  (m ? showArticle(+m[1], +m[2]) : showHome()).then(() => window.scrollTo(0, 0)).catch((e) => {
    app.innerHTML = `<div class="empty">出错了：${esc(e.message)}<br><br><a class="link" href="#/">返回首页</a></div>`;
  });
}

/* ================= 首页：选年份 / Text ================= */

const keyOf = (a) => `${a.year}-${a.text}`;
const STATUS_LABEL = { todo: '未做', doing: '进行中', done: '已完成' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const exp = {
  on: false,
  sel: new Set(store.get('exportSel', [])),
  mode: store.get('exportMode', 'separate'),
  include: store.get('exportInclude2', ['word', 'sentence', 'quiz', 'occ']),
  anchor: null,
  save() {
    store.set('exportSel', [...this.sel]);
    store.set('exportMode', this.mode);
    store.set('exportInclude2', this.include);
  },
};

async function showHome() {
  document.title = '考研阅读 · 生词难句';
  state.art = null;
  const [list, recs] = await Promise.all([api('/api/articles'), tracker.load().catch(() => null)]);
  state.list = list;
  const valid = new Set(list.map(keyOf));
  exp.sel = new Set([...exp.sel].filter((k) => valid.has(k)));

  const years = [...new Set(list.map((a) => a.year))];
  const total = list.reduce((s, a) => ((s.w += a.words), (s.s += a.sentences), s), { w: 0, s: 0 });
  const count = { todo: 0, doing: 0, done: 0 };
  list.forEach((a) => count[a.status]++);
  const pct = (n) => (list.length ? (n / list.length) * 100 : 0).toFixed(2);
  const last = list.filter((a) => a.opened).sort((a, b) => b.opened.localeCompare(a.opened))[0];

  const rows = years.map((y) => {
    const arts = list.filter((a) => a.year === y);
    const max = Math.max(4, ...arts.map((a) => a.text));
    const cards = [];
    for (let t = 1; t <= max; t++) {
      const a = arts.find((x) => x.text === t);
      const qz = quizStats(recs, y, t);
      cards.push(a
        ? `<a class="card st-${a.status}" href="#/${y}/${t}" data-key="${y}-${t}" data-status="${a.status}">
             <i class="tick"></i><span class="st"><i class="st-ic"></i>${STATUS_LABEL[a.status]}</span>
             ${qz && qz.done ? `<span class="quiz${qz.correct === qz.done ? ' full' : ''}" title="21–40 题记录：对 ${qz.correct} / 已做 ${qz.done}">✓ ${qz.correct}/${qz.done}</span>` : ''}
             <b>Text ${t}</b><small>${a.words + a.sentences ? `生词 ${a.words} · 难句 ${a.sentences}` : '尚无标注'}</small></a>`
        : `<div class="card off"><b>Text ${t}</b><small>未导入</small></div>`);
    }
    const done = arts.filter((a) => a.status === 'done').length;
    const dots = arts.map((a) => `<i class="dot ${a.status}" title="Text ${a.text} ${STATUS_LABEL[a.status]}"></i>`).join('');
    return `<section class="year" data-year="${y}">
      <div class="ylabel"><h2 data-year="${y}" title="选择模式下点击可整年选中">${y}</h2>
        <span class="dots">${dots}</span><small>${done}/${arts.length} 完成</small></div>
      <div class="texts">${cards.join('')}</div></section>`;
  });
  const chip = (f, label, n) => `<button data-filter="${f}">${label}<em>${n}</em></button>`;

  app.innerHTML = `
    <header class="topbar">
      <h1>考研英语<span>阅读标注</span></h1>
      ${navSwitch('read')}
      <span class="spacer"></span>
      <button class="btn icon theme-btn" data-theme-btn title="配色" aria-label="配色"><i class="palette"></i></button>
      <button id="selBtn" class="btn primary" ${list.length ? '' : 'disabled'}>选择导出</button>
    </header>
    <main class="home">
      ${list.length
        ? `<div class="overview">
             <div class="ring" style="--d:${pct(count.done)};--g:${pct(count.doing)}" title="已完成 ${count.done} · 进行中 ${count.doing} · 未做 ${count.todo}">
               <div class="ring-in"><b>${count.done}</b><small>/ ${list.length}</small></div>
             </div>
             <div class="ov-main">
               <div class="ov-title">已完成 <b>${count.done}</b> 篇<span class="sep"></span>进行中 <b>${count.doing}</b> 篇</div>
               <div class="ov-meta">还有 ${count.todo} 篇未做 · 已标生词 ${total.w} · 难句 ${total.s}</div>
               <span class="filters" id="filters">
                 ${chip('all', '全部', list.length)}${chip('todo', '未做', count.todo)}${chip('doing', '进行中', count.doing)}${chip('done', '已完成', count.done)}
               </span>
             </div>
             ${last ? `<a class="resume" href="#/${last.year}/${last.text}">
                 <small>继续上次</small><b>${last.year} · Text ${last.text}</b>
                 <span class="st-mini st-${last.status}"><i class="st-ic"></i>${STATUS_LABEL[last.status]}</span><em>→</em></a>` : ''}
           </div>${rows.join('')}`
        : `<div class="empty">还没有文章。<br>把原文放到 <code>articles/年份/textN.txt</code> 后刷新页面。</div>`}
    </main>
    <div class="exportbar" id="exportBar" hidden>
      <div class="eb-row">
        <b id="selCount"></b>
        <span class="eb-quick">
          <button class="link" data-q="all">全选</button>
          <button class="link" data-q="marked">仅已标注</button>
          <button class="link" data-q="invert">反选</button>
          <button class="link" data-q="none">清空</button>
        </span>
        <span class="eb-hint">点卡片选择 · 点年份整年 · Shift 连选</span>
      </div>
      <div class="eb-row">
        <span class="seg" id="modeSeg">
          <button data-mode="separate">每篇一个 md</button>
          <button data-mode="merged">合并为一个 md</button>
        </span>
        <span class="incs" id="incSeg">${incButtons()}</span>
        <span class="eb-spacer"></span>
        <button class="btn" id="selCancel">完成</button>
        <button class="btn primary" id="doExport">下载</button>
      </div>
    </div>`;

  if (!list.length) return;
  $('#filters').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) applyFilter(b.dataset.filter);
  };
  applyFilter(store.get('homeFilter', 'all'));
  $('#selBtn').onclick = () => setSelecting(!exp.on);
  $('#selCancel').onclick = () => setSelecting(false);
  $('#doExport').onclick = doExport;
  $('.home').addEventListener('click', onHomeClick);
  $('#exportBar').addEventListener('click', onBarClick);
  setSelecting(exp.on);
}

/* 阅读 Text n 对应 21+5(n-1) 起的 5 道题 */
function quizStats(recs, year, text) {
  if (!recs || !recs[year] || !(text >= 1 && text <= 4)) return null;
  const start = 21 + 5 * (text - 1);
  return tracker.stats(recs[year], start, start + 4);
}

function applyFilter(f) {
  store.set('homeFilter', f);
  document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.filter === f));
  document.querySelectorAll('.card[data-key]').forEach((c) => c.classList.toggle('dim', f !== 'all' && c.dataset.status !== f));
  document.querySelectorAll('section.year').forEach((sec) => {
    sec.hidden = f !== 'all' && !sec.querySelector(`.card[data-status="${f}"]`);
  });
}

function setSelecting(on) {
  exp.on = on;
  document.body.classList.toggle('selecting', on);
  $('#exportBar').hidden = !on;
  $('#selBtn').textContent = on ? '退出选择' : '选择导出';
  $('#selBtn').classList.toggle('primary', !on);
  if (on && !exp.sel.size) state.list.filter((a) => a.words + a.sentences > 0).forEach((a) => exp.sel.add(keyOf(a)));
  paintSel();
}

function paintSel() {
  document.querySelectorAll('.card[data-key]').forEach((c) => c.classList.toggle('picked', exp.sel.has(c.dataset.key)));
  document.querySelectorAll('.year h2').forEach((h) => {
    const keys = state.list.filter((a) => a.year === +h.dataset.year).map(keyOf);
    const n = keys.filter((k) => exp.sel.has(k)).length;
    h.classList.toggle('full', n === keys.length);
    h.classList.toggle('part', n > 0 && n < keys.length);
  });
  const picked = state.list.filter((a) => exp.sel.has(keyOf(a)));
  const w = picked.reduce((s, a) => s + a.words, 0), st = picked.reduce((s, a) => s + a.sentences, 0);
  const cnt = $('#selCount');
  if (cnt) cnt.textContent = `已选 ${picked.length} 篇 · 生词 ${w} · 难句 ${st}`;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === exp.mode));
  paintIncs();
  const dl = $('#doExport');
  if (dl) dl.disabled = !picked.length || !incOk();
  exp.save();
}

function onHomeClick(e) {
  if (!exp.on) return;
  const h = e.target.closest('.year h2');
  if (h) {
    const keys = state.list.filter((a) => a.year === +h.dataset.year).map(keyOf);
    const all = keys.every((k) => exp.sel.has(k));
    keys.forEach((k) => (all ? exp.sel.delete(k) : exp.sel.add(k)));
    return paintSel();
  }
  const card = e.target.closest('.card[data-key]');
  if (!card) return;
  e.preventDefault();
  const key = card.dataset.key;
  const order = state.list.map(keyOf);
  if (e.shiftKey && exp.anchor && order.includes(exp.anchor)) {
    const [i, j] = [order.indexOf(exp.anchor), order.indexOf(key)].sort((a, b) => a - b);
    const target = !exp.sel.has(key);
    order.slice(i, j + 1).forEach((k) => (target ? exp.sel.add(k) : exp.sel.delete(k)));
  } else {
    exp.sel.has(key) ? exp.sel.delete(key) : exp.sel.add(key);
  }
  exp.anchor = key;
  paintSel();
}

function onBarClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const { q, mode, inc } = b.dataset;
  if (q) {
    state.list.forEach((a) => {
      const k = keyOf(a);
      if (q === 'all') exp.sel.add(k);
      else if (q === 'none') exp.sel.delete(k);
      else if (q === 'invert') exp.sel.has(k) ? exp.sel.delete(k) : exp.sel.add(k);
      else if (q === 'marked') a.words + a.sentences > 0 ? exp.sel.add(k) : exp.sel.delete(k);
    });
  }
  if (mode) exp.mode = mode;
  if (inc) toggleInc(inc);
  paintSel();
}

/* ---------- 导出内容选项（首页导出栏、阅读页下载共用） ---------- */
const INCLUDE_OPTS = [['word', '生词'], ['sentence', '难句'], ['quiz', '做题结果'], ['occ', '历年统计']];
const incButtons = () => INCLUDE_OPTS.map(([k, label]) =>
  `<button type="button" class="chk" data-inc="${k}" title="${k === 'occ' ? '生词表里的「历年出现 / 分布」两列，需要同时导出生词' : ''}">${label}</button>`).join('');
const incOk = () => ['word', 'sentence', 'quiz'].some((k) => exp.include.includes(k));
// 历年统计依附于生词表：没选生词时不传
const incList = () => exp.include.filter((k) => k !== 'occ' || exp.include.includes('word'));
function toggleInc(k) {
  exp.include = exp.include.includes(k) ? exp.include.filter((x) => x !== k) : [...exp.include, k];
  exp.save();
  paintIncs();
}
function paintIncs() {
  document.querySelectorAll('.chk[data-inc]').forEach((b) => {
    b.classList.toggle('on', exp.include.includes(b.dataset.inc));
    b.disabled = b.dataset.inc === 'occ' && !exp.include.includes('word');
  });
  const one = $('#dlGo');
  if (one) one.disabled = !incOk();
}

function doExport() {
  const items = state.list.map(keyOf).filter((k) => exp.sel.has(k));
  if (!items.length) return toast('请至少选择一篇');
  if (!incOk()) return toast('请至少选择生词、难句或做题结果中的一项');
  download(items, exp.mode, incList());
}

/* ================= 阅读页：选生词 / 难句 ================= */

async function showArticle(year, text) {
  document.body.classList.remove('selecting');
  const art = (state.art = await api(`/api/article?year=${year}&text=${text}`));
  document.title = `${year} Text ${text} · 考研阅读`;
  if (!state.list.length) state.list = await api('/api/articles');

  const idx = state.list.findIndex((a) => a.year === year && a.text === text);
  const prev = state.list[idx - 1]; // 列表按 年份→Text 正序排列
  const next = state.list[idx + 1];
  const nav = (a, label) => a
    ? `<a class="btn" href="#/${a.year}/${a.text}">${label}</a>`
    : `<button class="btn" disabled>${label}</button>`;

  app.innerHTML = `
    <header class="topbar">
      <a class="back" href="#/">← 返回</a>
      <h1>${year} · Text ${text}</h1>
      <span class="save-state" id="saveState"></span>
      <span class="seg status-seg" id="statusSeg" title="这篇的进度">
        <button data-st="todo">未做</button><button data-st="doing">进行中</button><button data-st="done">✓ 已完成</button>
      </span>
      ${nav(prev, '‹ 上一篇')}${nav(next, '下一篇 ›')}
      <button class="btn icon theme-btn" data-theme-btn title="配色" aria-label="配色"><i class="palette"></i></button>
      <button class="btn primary" id="dlOne">下载本篇 MD</button>
      <div class="dl-menu" id="dlMenu" hidden>
        <div class="dl-title">下载本篇 MD · 包含内容</div>
        <div class="incs">${incButtons()}</div>
        <button class="btn primary" id="dlGo">下载</button>
      </div>
    </header>
    <div class="reader" id="reader">
      <div class="main-col">
        <div class="hint">用鼠标选中单词或句子，点「生词」或「难句」（快捷键 <kbd>D</kbd> / <kbd>F</kbd>）；点击已标注内容可删除。</div>
        <article id="article"></article>
      </div>
      <aside id="side"></aside>
      <button class="side-tab" id="sideTab" title="展开侧栏" hidden></button>
    </div>`;

  $('#dlOne').onclick = (e) => {
    e.stopPropagation();
    const m = $('#dlMenu');
    m.hidden = !m.hidden;
    if (!m.hidden) paintIncs();
  };
  $('#dlMenu').onclick = (e) => {
    const b = e.target.closest('.chk[data-inc]');
    if (b) return toggleInc(b.dataset.inc);
    if (e.target.closest('#dlGo')) {
      if (!incOk()) return toast('请至少选择生词、难句或做题结果中的一项');
      download([`${year}-${text}`], 'separate', incList());
      $('#dlMenu').hidden = true;
    }
  };
  $('#statusSeg').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) setStatus(b.dataset.st);
  };
  paintStatus();
  const el = $('#article');
  el.addEventListener('mouseup', onMouseUp);
  $('#sideTab').onclick = () => setSideUI({ hidden: false });
  renderArticle();
  renderSide();
  setSideUI({});
}

function sortedMarks() {
  return [...state.art.marks].sort((a, b) => a.p - b.p || a.start - b.start || b.end - a.end);
}

function renderArticle() {
  const { paragraphs, marks } = state.art;
  $('#article').innerHTML = paragraphs.map((text, i) => {
    const ms = marks.filter((m) => m.p === i && !m.stale);
    const cuts = [...new Set([0, text.length, ...ms.flatMap((m) => [m.start, m.end])])].sort((a, b) => a - b);
    let html = '';
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k], b = cuts[k + 1];
      const seg = esc(text.slice(a, b));
      const cov = ms.filter((m) => m.start <= a && m.end >= b);
      if (!cov.length) { html += seg; continue; }
      const cls = ['mk'];
      if (cov.some((m) => m.type === 'sentence')) cls.push('s');
      if (cov.some((m) => m.type === 'word')) cls.push('w');
      html += `<span class="${cls.join(' ')}" data-ids="${cov.map((m) => m.id).join(' ')}">${seg}</span>`;
    }
    return `<p data-p="${i}" data-n="${i + 1}">${html}</p>`;
  }).join('');
}

// 侧栏：整体可收起，「生词」「难句」各自可折叠；状态记在浏览器里
const sideUI = Object.assign({ hidden: false, word: false, sentence: false }, store.get('sideUI', {}));

function setSideUI(patch) {
  Object.assign(sideUI, patch);
  store.set('sideUI', sideUI);
  const reader = $('#reader');
  if (!reader) return;
  reader.classList.toggle('side-off', sideUI.hidden);
  $('#sideTab').hidden = !sideUI.hidden;
  document.querySelectorAll('#side .box').forEach((b) => {
    const c = sideUI[b.dataset.type];
    b.classList.toggle('collapsed', c);
    b.querySelector('.box-h').setAttribute('aria-expanded', String(!c));
  });
}

function renderSide() {
  const ms = sortedMarks();
  const words = ms.filter((m) => m.type === 'word');
  const sents = ms.filter((m) => m.type === 'sentence');
  const item = (m, sent) => `
    <li data-id="${m.id}" class="${m.stale ? 'stale' : ''}" title="${m.stale ? '原文已变动，找不到这处标注' : '点击定位'}">
      <span class="t ${sent ? 'sent' : ''}">${esc(m.text)}</span>
      ${sent ? '' : `<button class="occ" data-occ="${esc(m.text)}" title="历年真题中出现的次数，点开看分布">${occBadge(m.text)}</button>`}
      <span class="p">P${m.p + 1}</span>
      <button class="x" data-del="${m.id}" title="删除">✕</button>
      ${sent ? '' : `<div class="occ-detail" hidden></div>`}
    </li>`;
  const box = (type, title, sw, list, sent) => `
    <section class="box${sideUI[type] ? ' collapsed' : ''}" data-type="${type}">
      <button class="box-h" data-toggle="${type}" aria-expanded="${!sideUI[type]}" title="折叠 / 展开">
        <i class="${sw}"></i>${title}<span class="n">${list.length}</span><span class="chev"></span>
      </button>
      <div class="box-b"><div>
        ${list.length ? `<ul>${list.map((m) => item(m, sent)).join('')}</ul>` : '<div class="none">暂无，选中文字后按 ' + (type === 'word' ? 'D' : 'F') + '</div>'}
      </div></div>
    </section>`;
  const side = $('#side');
  side.innerHTML = `
    <div class="side-head">
      <span>本篇标注</span>
      <button class="side-hide" data-hide title="收起侧栏">收起 <b>›</b></button>
    </div>` +
    box('word', '生词', 'sw-w', words, false) +
    box('sentence', '难句', 'sw-s', sents, true);
  loadOcc();
  $('#sideTab').innerHTML = `<b>‹</b><span><i class="sw-w"></i>${words.length}</span><span><i class="sw-s"></i>${sents.length}</span>`;
  side.onclick = (e) => {
    const ob = e.target.closest('[data-occ]');
    if (ob) return toggleOcc(ob);
    if (e.target.closest('.occ-detail')) return;
    if (e.target.closest('[data-hide]')) return setSideUI({ hidden: true });
    const tg = e.target.closest('[data-toggle]');
    if (tg) return setSideUI({ [tg.dataset.toggle]: !sideUI[tg.dataset.toggle] });
    const del = e.target.dataset.del;
    if (del) return removeMark(del);
    const li = e.target.closest('li');
    if (li) locate(li.dataset.id);
  };
}

/* ---------- 历年出现次数 ---------- */

const occCache = {};
const occKey = (t) => t.toLowerCase().trim();

function occBadge(text) {
  const o = occCache[occKey(text)];
  if (!o) return '<i class="occ-wait"></i>';
  return `历年 ${o.total}`;
}

async function loadOcc() {
  const terms = [...new Set(state.art.marks.filter((m) => m.type === 'word').map((m) => m.text))]
    .filter((t) => !(occKey(t) in occCache));
  if (terms.length) {
    try {
      const res = await api('/api/occurrences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ terms }),
      });
      for (const [t, info] of Object.entries(res)) occCache[occKey(t)] = info;
    } catch (e) {
      return;
    }
  }
  document.querySelectorAll('#side [data-occ]').forEach((b) => {
    const o = occCache[occKey(b.dataset.occ)];
    if (!o) return;
    b.innerHTML = occBadge(b.dataset.occ);
    b.classList.toggle('zero', o.total <= 1);
  });
}

function toggleOcc(btn) {
  const li = btn.closest('li');
  const box = li.querySelector('.occ-detail');
  const o = occCache[occKey(btn.dataset.occ)];
  if (!o) return;
  if (!box.hidden) { box.hidden = true; btn.classList.remove('open'); return; }
  const { year, text } = state.art;
  const here = `阅读 Text ${text}`;
  const years = {};
  o.by.forEach((d) => (years[d.year] = years[d.year] || []).push(d));
  const forms = Object.entries(o.forms);
  box.innerHTML = `
    <div class="occ-sum"><b>${o.total}</b> 次 · ${o.years} 年${o.exact !== o.total ? `<span>本词形 ${o.exact} 次</span>` : ''}</div>
    <div class="occ-years">${Object.entries(years).map(([y, ds]) => `
      <div class="occ-y"><em>${y}</em><span>${ds.map((d) =>
        `<i class="${+y === year && d.label === here ? 'here' : ''}">${d.label}${d.n > 1 ? ` ×${d.n}` : ''}</i>`).join('')}</span></div>`).join('')}
    </div>
    ${forms.length > 1 ? `<div class="occ-forms">词形：${forms.map(([f, n]) => `${esc(f)} ${n}`).join(' · ')}</div>` : ''}`;
  box.hidden = false;
  btn.classList.add('open');
}

function locate(id) {
  const spans = document.querySelectorAll(`#article [data-ids~="${id}"]`);
  if (!spans.length) return;
  spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  spans.forEach((s) => { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); });
}

/* ---------- 选区 ---------- */

function paraOf(node) {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return el && el.closest('#article p[data-p]');
}

function offsetIn(p, node, off) {
  const r = document.createRange();
  r.selectNodeContents(p);
  r.setEnd(node, off);
  return r.toString().length;
}

function onMouseUp(e) {
  setTimeout(() => {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) {
      const span = e.target.closest('.mk');
      return span ? showMarkPop(span) : hidePop();
    }
    const range = sel.getRangeAt(0);
    const p1 = paraOf(range.startContainer), p2 = paraOf(range.endContainer);
    if (!p1 || !p2) return hidePop();
    if (p1 !== p2) { hidePop(); return toast('请在同一段内选择'); }
    const start = offsetIn(p1, range.startContainer, range.startOffset);
    const end = offsetIn(p1, range.endContainer, range.endOffset);
    if (!state.art.paragraphs[+p1.dataset.p].slice(start, end).trim()) return hidePop();
    state.pending = { p: +p1.dataset.p, start, end };
    const rect = range.getBoundingClientRect();
    pop.innerHTML = `
      <button data-act="word"><i class="sw-w"></i>生词 <kbd>D</kbd></button>
      <button data-act="sentence"><i class="sw-s"></i>难句 <kbd>F</kbd></button>`;
    placePop(rect);
  }, 0);
}

function showMarkPop(span) {
  const ids = span.dataset.ids.split(' ');
  const ms = state.art.marks.filter((m) => ids.includes(m.id));
  pop.innerHTML = ms.map((m) =>
    `<button class="del" data-del="${m.id}">✕ 删除${m.type === 'word' ? '生词' : '难句'}「${esc(m.text.length > 24 ? m.text.slice(0, 24) + '…' : m.text)}」</button>`
  ).join('');
  state.pending = null;
  placePop(span.getBoundingClientRect());
}

function placePop(rect) {
  pop.hidden = false;
  const w = pop.offsetWidth;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), window.innerWidth - w - 8);
  let top = rect.top - pop.offsetHeight - 8;
  if (top < 60) top = rect.bottom + 8;
  pop.style.left = left + window.scrollX + 'px';
  pop.style.top = top + window.scrollY + 'px';
}

function hidePop() {
  pop.hidden = true;
  state.pending = null;
}

pop.addEventListener('mousedown', (e) => e.preventDefault()); // 保持选区
pop.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.del) removeMark(btn.dataset.del);
  else if (btn.dataset.act) addMark(btn.dataset.act);
  hidePop();
});

document.addEventListener('mousedown', (e) => {
  if (!pop.hidden && !pop.contains(e.target)) hidePop();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return hidePop();
  if (!state.pending || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'd' || k === 'f') {
    e.preventDefault();
    addMark(k === 'd' ? 'word' : 'sentence');
    hidePop();
  }
});

/* ---------- 增删标注 ---------- */

function addMark(type) {
  if (!state.pending) return;
  let { p, start, end } = state.pending;
  const t = state.art.paragraphs[p];

  if (type === 'word') {
    // 去掉两端标点空白，再扩展到完整单词
    while (start < end && !ALNUM.test(t[start])) start++;
    while (end > start && !ALNUM.test(t[end - 1])) end--;
    while (start > 0 && WORD_CH.test(t[start - 1])) start--;
    while (end < t.length && WORD_CH.test(t[end])) end++;
  } else {
    while (start < end && /\s/.test(t[start])) start++;
    while (end > start && /\s/.test(t[end - 1])) end--;
  }
  if (start >= end) return;

  const dup = state.art.marks.find((m) => m.type === type && m.p === p && !m.stale && m.start < end && m.end > start);
  if (dup) return toast(`与已标${type === 'word' ? '生词' : '难句'}「${dup.text.slice(0, 20)}」重叠`);

  state.art.marks.push({ id: uid(), type, p, start, end, text: t.slice(start, end) });
  if (state.art.status === 'todo') setStatus('doing');
  window.getSelection().removeAllRanges();
  refresh();
}

function removeMark(id) {
  state.art.marks = state.art.marks.filter((m) => m.id !== id);
  refresh();
}

function paintStatus() {
  document.querySelectorAll('#statusSeg button').forEach((b) => {
    b.classList.toggle('on', b.dataset.st === state.art.status);
  });
}

async function setStatus(st) {
  const { year, text } = state.art;
  const prev = state.art.status;
  state.art.status = st;
  paintStatus();
  try {
    await api(`/api/status?year=${year}&text=${text}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: st }),
    });
    const a = state.list.find((x) => x.year === year && x.text === text);
    if (a) a.status = st;
    if (st === 'done' && prev !== 'done') toast(`${year} Text ${text} 已完成`);
  } catch (e) {
    state.art.status = prev;
    paintStatus();
    toast('状态保存失败：' + e.message);
  }
}

function refresh() {
  renderArticle();
  renderSide();
  save();
}

// 保存排队：同一时间只发一个请求，期间的改动在上一个完成后再保存一次
let saving = null, saveAgain = false;
function save() {
  if (saving) { saveAgain = true; return saving; }
  saving = (async () => {
    do {
      saveAgain = false;
      await saveOnce();
    } while (saveAgain);
    saving = null;
  })();
  return saving;
}

async function saveOnce() {
  const { year, text } = state.art;
  const marks = state.art.marks.map(({ stale, ...m }) => m);
  const s = $('#saveState');
  if (s) s.textContent = '保存中…';
  try {
    await api(`/api/marks?year=${year}&text=${text}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marks }),
    });
    if (s) s.textContent = '已保存';
    const a = state.list.find((x) => x.year === year && x.text === text);
    if (a) {
      a.words = marks.filter((m) => m.type === 'word').length;
      a.sentences = marks.length - a.words;
    }
  } catch (e) {
    if (s) s.textContent = '保存失败';
    toast('保存失败：' + e.message);
  }
}

/* ================= 配色面板 ================= */

const THEME_DEFAULT = { h: 232, sat: 100, glow: 100, mode: 'system' };
const PRESETS = [
  ['靛蓝', 232, 100], ['雾蓝', 212, 80], ['天青', 198, 100], ['青碧', 178, 85],
  ['薄荷', 158, 75], ['松绿', 140, 60], ['橄榄', 82, 45], ['琥珀', 38, 90],
  ['蜜桃', 18, 90], ['珊瑚', 2, 80], ['玫瑰', 340, 70], ['樱粉', 320, 60],
  ['紫罗兰', 268, 80], ['薰衣草', 252, 70], ['石墨', 225, 12], ['暖灰', 30, 14],
];
const theme = Object.assign({}, THEME_DEFAULT, store.get('theme', {}));
const tp = $('#themePanel');

function applyTheme(save = true) {
  const r = document.documentElement;
  r.style.setProperty('--h', theme.h);
  r.style.setProperty('--sat', theme.sat / 100);
  r.style.setProperty('--glow', theme.glow / 100);
  if (theme.mode === 'system') delete r.dataset.theme;
  else r.dataset.theme = theme.mode;
  if (save) store.set('theme', theme);
  paintThemePanel();
}

function paintThemePanel() {
  $('#tpHue').value = theme.h;
  $('#tpSat').value = theme.sat;
  $('#tpGlow').value = theme.glow;
  $('#hueVal').textContent = `${theme.h}°`;
  $('#satVal').textContent = `${theme.sat}%`;
  $('#glowVal').textContent = `${theme.glow}%`;
  document.querySelectorAll('#swatches button').forEach((b) =>
    b.classList.toggle('on', +b.dataset.h === theme.h && +b.dataset.sat === theme.sat));
  document.querySelectorAll('#themeMode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === theme.mode));
}

$('#swatches').innerHTML = PRESETS.map(([name, h, sat]) =>
  `<button data-h="${h}" data-sat="${sat}" title="${name}" style="--sh:${h};--ss:${sat / 100}"><i></i><span>${name}</span></button>`
).join('');

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme-btn]');
  if (btn) {
    tp.hidden = !tp.hidden;
    if (!tp.hidden) paintThemePanel();
    return;
  }
  if (!tp.hidden && !tp.contains(e.target)) tp.hidden = true;
});

tp.addEventListener('click', (e) => {
  if (e.target.closest('[data-tp-close]')) { tp.hidden = true; return; }
  if (e.target.closest('[data-tp-reset]')) { Object.assign(theme, THEME_DEFAULT); return applyTheme(); }
  const sw = e.target.closest('#swatches button');
  if (sw) { theme.h = +sw.dataset.h; theme.sat = +sw.dataset.sat; return applyTheme(); }
  const md = e.target.closest('#themeMode button');
  if (md) { theme.mode = md.dataset.mode; applyTheme(); }
});

for (const [id, key] of [['#tpHue', 'h'], ['#tpSat', 'sat'], ['#tpGlow', 'glow']]) {
  $(id).addEventListener('input', (e) => { theme[key] = +e.target.value; applyTheme(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tp.hidden = true; });
window.addEventListener('hashchange', () => { tp.hidden = true; });

applyTheme(false);

document.addEventListener('mousedown', (e) => {
  const m = $('#dlMenu');
  if (m && !m.hidden && !m.contains(e.target) && !e.target.closest('#dlOne')) m.hidden = true;
});
