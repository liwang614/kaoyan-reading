/* =========================================================
   做题记录（原「英语真题记录」，并入本项目）
   数据逻辑、键盘操作、错选项、做题顺序、导出均与原项目一致；
   路由放在 #/tracker/... 下，样式统一为本项目的主题。
   ========================================================= */
(function () {
  const years = Array.from({ length: 17 }, (_, i) => 2010 + i);
  const sections = [['完形填空', 1, 20], ['阅读 · Text 1', 21, 25], ['阅读 · Text 2', 26, 30], ['阅读 · Text 3', 31, 35], ['阅读 · Text 4', 36, 40], ['新题型', 41, 45]];
  const parts = [{ id: 'cloze', label: '完形', start: 1, end: 20 }, { id: 'reading', label: '阅读', start: 21, end: 40 }, { id: 'new-type', label: '新题型', start: 41, end: 45 }];
  const pendingKey = 'english-tracker-v1-pending';
  let records = {}, loaded = null, currentYear = null, currentPart = parts[0], active = false, saving = false, retryTimer;
  let pending = [];
  try { pending = JSON.parse(localStorage.getItem(pendingKey) || '[]'); if (!Array.isArray(pending)) pending = []; } catch { pending = []; }
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch {} });

  /* ---------- 做题顺序 ---------- */
  function orderedYears(recs) {
    return Object.keys(recs).filter((y) => Number.isInteger(recs[y].studyOrder) && recs[y].studyOrder > 0)
      .sort((a, b) => recs[a].studyOrder - recs[b].studyOrder || Number(a) - Number(b));
  }
  function normalizeOrders(recs) {
    const ordered = orderedYears(recs);
    for (const [year, record] of Object.entries(recs)) record.studyOrder = ordered.includes(year) ? ordered.indexOf(year) + 1 : null;
  }
  function moveStudyOrder(recs, year, position) {
    year = String(year);
    normalizeOrders(recs);
    if (position === 'append' && recs[year].studyOrder !== null) return;
    const ordered = orderedYears(recs).filter((y) => y !== year);
    if (position !== null) ordered.splice(position === 'append' ? ordered.length : Math.min(position - 1, ordered.length), 0, year);
    for (const [y, record] of Object.entries(recs)) record.studyOrder = ordered.includes(y) ? ordered.indexOf(y) + 1 : null;
  }

  /* ---------- 统计 / 保存 ---------- */
  const stats = (r, start = 1, end = 45) => {
    const a = r.answers.slice(start - 1, end), done = a.filter((v) => v !== null).length, correct = a.filter((v) => v === true).length;
    return { done, correct, wrong: done - correct, unmarked: a.length - done, rate: done ? Math.round(correct / done * 1000) / 10 : null };
  };
  const percent = (s) => s.rate === null ? '—' : `${s.rate}%`;
  const safeDate = (iso) => iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';
  function showError(message, retry) {
    let box = document.querySelector('#trk-error');
    if (!box) { box = document.createElement('div'); box.id = 'trk-error'; box.className = 'trk-error'; box.setAttribute('role', 'alert'); document.body.append(box); }
    box.replaceChildren(document.createTextNode(message));
    if (retry) { const b = document.createElement('button'); b.textContent = '重试'; b.onclick = retry; box.append(b); }
    box.hidden = false;
  }
  const hideError = () => { const box = document.querySelector('#trk-error'); if (box) box.hidden = true; };
  function persistPending() { try { localStorage.setItem(pendingKey, JSON.stringify(pending)); } catch { /* 服务器仍是主存储 */ } }
  function applyPatch(year, patch) {
    const r = records[year];
    if ('question' in patch) { r.answers[patch.question - 1] = patch.correct; r.wrongOptions[patch.question - 1] = patch.correct === false ? (patch.wrongOption ?? null) : null; }
    if ('minutes' in patch) r.minutes = patch.minutes;
    if ('studyOrder' in patch) moveStudyOrder(records, year, patch.studyOrder);
    r.updatedAt = new Date().toISOString();
  }
  function change(year, patch) { applyPatch(year, patch); pending.push({ year, patch }); persistPending(); flush(); notify(); }
  async function flush() {
    if (saving || !pending.length) return;
    saving = true; clearTimeout(retryTimer);
    try {
      while (pending.length) {
        const item = pending[0];
        const response = await fetch(`/api/records/${item.year}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item.patch) });
        if (!response.ok) throw Error('保存失败');
        const result = await response.json(); pending.shift(); persistPending();
        if (result.studyOrders) {
          for (const [year, order] of Object.entries(result.studyOrders)) records[year].studyOrder = order;
          for (const queued of pending) if ('studyOrder' in queued.patch) moveStudyOrder(records, queued.year, queued.patch.studyOrder);
          updateOrderControls();
        }
      }
      hideError();
    } catch { showError('暂未保存，正在重试', flush); retryTimer = setTimeout(flush, 3000); }
    finally { saving = false; }
  }

  function load() {
    if (loaded) return loaded;
    loaded = (async () => {
      const response = await fetch('/api/records'); if (!response.ok) throw Error('记录读取失败');
      records = (await response.json()).records;
      for (const r of Object.values(records)) { r.wrongOptions ??= Array(45).fill(null); r.studyOrder ??= null; }
      normalizeOrders(records);
      pending = pending.filter((item) => years.includes(Number(item.year)) && item.patch && typeof item.patch === 'object');
      for (const item of pending) applyPatch(item.year, item.patch);
      flush();
      return records;
    })();
    loaded.catch(() => { loaded = null; });
    return loaded;
  }

  /* ---------- 页面 ---------- */
  const app = document.querySelector('#app');
  function shell(content, detail = false) {
    app.innerHTML = `
      <header class="topbar">
        <h1>考研英语<span>做题记录</span></h1>
        ${window.navSwitch('tracker')}
        <span class="spacer"></span>
        ${detail ? `<a class="back" href="#/tracker/${currentPart.id}">← 全部年份</a>` : ''}
        ${window.THEME_BTN}
        <button class="btn" id="export-md">下载 Markdown</button>
        <button class="btn primary" id="export-json">下载 JSON</button>
      </header>
      <main class="trk">${content}</main>`;
    document.querySelector('#export-md').onclick = () => download('md');
    document.querySelector('#export-json').onclick = () => download('json');
  }

  function renderHome() {
    shell(`
      <div class="trk-heading"><h2>年份</h2><span class="range">2010 — 2026 · 英语一客观题</span></div>
      <div class="seg trk-parts" role="group" aria-label="客观题部分">${parts.map((part) =>
        `<button type="button" data-part="${part.id}" aria-pressed="${part.id === currentPart.id}" class="${part.id === currentPart.id ? 'on' : ''}">${part.label}</button>`).join('')}</div>
      <div class="trk-table">
        <div class="trk-cols" aria-hidden="true"><span>年份</span><span>正确 / 总数</span><span>正确率</span><span>用时</span><span>做题顺序</span></div>
        <div class="trk-rows">${years.map((y) => {
          const r = records[y], s = stats(r, currentPart.start, currentPart.end);
          return `<div class="trk-row"><a class="trk-link" href="#/tracker/${currentPart.id}/${y}" aria-label="${y} 年">
              <span class="trk-year">${y}</span>
              <span class="trk-progress">${s.correct} <i>/ ${s.done + s.unmarked}</i></span>
              <span class="trk-rate"><b>${percent(s)}</b><i class="trk-bar"><i style="width:${s.rate ?? 0}%"></i></i></span>
              <span class="trk-time">${r.minutes ?? '—'}${r.minutes === null ? '' : '<i>分钟</i>'}</span></a>
            <div class="order-control" data-year="${y}"><button type="button" class="order-circle" aria-label="${y} 年做题顺序">${r.studyOrder ?? ''}</button><input hidden type="number" min="1" max="17" step="1" inputmode="numeric" aria-label="${y} 年做题顺序输入"></div></div>`;
        }).join('')}</div>
      </div>`);
    for (const button of document.querySelectorAll('[data-part]')) button.onclick = () => { location.hash = `#/tracker/${button.dataset.part}`; };
    for (const control of document.querySelectorAll('.order-control')) {
      const year = Number(control.dataset.year), input = control.querySelector('input'), button = control.querySelector('button');
      const edit = (value = records[year].studyOrder ?? '') => {
        button.hidden = true; input.hidden = false; input.value = value; input.removeAttribute('aria-invalid'); input.focus(); input.select();
      };
      const close = () => { input.hidden = true; button.hidden = false; input.removeAttribute('aria-invalid'); updateOrderControls(); };
      const commit = () => {
        if (input.hidden) return true;
        if (!input.validity.valid) { input.setAttribute('aria-invalid', 'true'); input.reportValidity(); return false; }
        const value = input.value === '' ? null : Number(input.value);
        if (value !== records[year].studyOrder) change(year, { studyOrder: value });
        close(); return true;
      };
      button.onclick = () => {
        if (records[year].studyOrder === null) { change(year, { studyOrder: 'append' }); updateOrderControls(); }
        else edit();
      };
      button.onkeydown = (e) => {
        if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); edit(e.key); }
        else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); change(year, { studyOrder: null }); updateOrderControls(); }
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (commit()) button.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); button.focus(); }
      });
    }
    updateOrderControls();
  }
  function updateOrderControls() {
    for (const control of document.querySelectorAll('.order-control')) {
      const order = records[control.dataset.year].studyOrder, button = control.querySelector('button');
      button.textContent = order ?? ''; button.classList.toggle('assigned', order !== null);
      button.title = order === null ? '点击排到队尾；也可直接键入数字' : `第 ${order} 个做的年份，点击修改`;
    }
  }

  function questionMarkup(q) {
    const r = records[currentYear], answer = r.answers[q - 1], option = r.wrongOptions[q - 1];
    return `<div class="question ${answer === true ? 'correct' : answer === false ? 'wrong' : ''}" tabindex="0" data-q="${q}" role="group" aria-label="第 ${q} 题，${answer === null ? '未做' : answer ? '对' : '错'}"><span class="q-number">${q}<span class="wrong-option">${option ?? ''}</span></span><div class="q-actions"><button tabindex="-1" data-answer="null" aria-label="第 ${q} 题未做" aria-pressed="${answer === null}" class="${answer === null ? 'chosen-undone' : ''}">未做</button><button tabindex="-1" data-answer="true" aria-label="第 ${q} 题对" aria-pressed="${answer === true}" class="${answer === true ? 'chosen-correct' : ''}">✓</button><button tabindex="-1" data-answer="false" aria-label="第 ${q} 题错" aria-pressed="${answer === false}" class="${answer === false ? 'chosen-wrong' : ''}">×</button></div></div>`;
  }
  function askWrongOption(q, year = currentYear, done) {
    if (document.querySelector('#wrong-dialog')) return;
    const old = records[year].wrongOptions[q - 1] ?? '', letters = q <= 40 ? 'ABCD' : 'ABCDEFG';
    const dialog = document.createElement('dialog'); dialog.id = 'wrong-dialog'; dialog.className = 'wrong-dialog'; dialog.setAttribute('aria-labelledby', 'wrong-title');
    dialog.innerHTML = `<form><h2 id="wrong-title">第 ${q} 题</h2><label for="wrong-choice">我的选项</label><input id="wrong-choice" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="1" required pattern="[${letters}]" aria-label="我的选项" value="${old}"><div class="option-choices">${[...letters].map((letter) => `<button type="button" data-choice="${letter}">${letter}</button>`).join('')}</div><div class="dialog-actions"><button type="button" class="btn" id="cancel-wrong">取消</button><button type="submit" class="btn primary">确认</button></div></form>`;
    document.body.append(dialog);
    const input = dialog.querySelector('input');
    const close = () => { dialog.close(); dialog.remove(); if (active && currentYear === year) focusQuestion(q); };
    input.addEventListener('input', () => { const value = input.value.toUpperCase(); input.value = /^[1-7]$/.test(value) ? 'ABCDEFG'[Number(value) - 1] : value; });
    dialog.querySelectorAll('[data-choice]').forEach((button) => button.onclick = () => { input.value = button.dataset.choice; input.focus(); input.select(); });
    dialog.querySelector('#cancel-wrong').onclick = close;
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    dialog.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault(); if (!input.checkValidity()) return; const option = input.value; close();
      if (done) done(option); else if (currentYear === year) setAnswer(q, false, option);
    });
    dialog.showModal(); input.focus(); input.select();
  }
  function sectionMarkup([title, start, end], index) {
    return `<section class="trk-section ${start === 41 ? 'new-type' : ''}"><div class="section-head"><h3>${title}<span>${start}—${end}</span></h3><span class="section-stats" id="section-${index}"></span></div><div class="question-grid">${Array.from({ length: end - start + 1 }, (_, i) => questionMarkup(start + i)).join('')}</div></section>`;
  }
  function renderDetail() {
    const r = records[currentYear];
    const content = currentPart.id === 'reading'
      ? `<div class="trk-reading">${sections.slice(1, 5).map((s, i) => sectionMarkup(s, i + 1).replace('</h3>', `</h3><a class="to-read" href="#/${currentYear}/${i + 1}" title="打开这篇阅读">读原文 →</a>`)).join('')}</div>`
      : sectionMarkup(sections[currentPart.id === 'cloze' ? 0 : 5], currentPart.id === 'cloze' ? 0 : 5);
    shell(`<div class="trk-heading"><div class="year-title"><h2>${currentYear}</h2><span>英语一 · ${currentPart.label}</span></div></div>
      <div class="trk-summary">
        <div class="summary-item"><div class="metric-label">正确率</div><div class="metric-value" id="accuracy"></div></div>
        <div class="summary-item"><div class="metric-label">答对</div><div class="metric-value" id="correct-count"></div></div>
        <div class="summary-item"><div class="metric-label">正确 / 总数</div><div class="metric-value" id="done-count"></div></div>
        <div class="summary-item"><label class="metric-label" for="minutes">用时</label><div class="time-field"><input id="minutes" type="number" min="0" max="1440" step="any" inputmode="decimal" aria-label="用时（分钟）" value="${r.minutes ?? ''}"><span>分钟</span></div></div>
      </div>
      <p class="trk-keys">键盘：<kbd>1</kbd> 未做 <kbd>2</kbd> 对 <kbd>3</kbd> 错 · 方向键切题 · <kbd>Delete</kbd> 清除</p>
      ${content}`, true);
    document.querySelector('#minutes').addEventListener('input', (e) => {
      if (e.target.validity.badInput || !e.target.validity.valid) { e.target.setAttribute('aria-invalid', 'true'); return; }
      e.target.removeAttribute('aria-invalid');
      const value = e.target.value === '' ? null : Number(e.target.value);
      change(currentYear, { minutes: value });
    });
    document.querySelector('#minutes').addEventListener('blur', (e) => { if (!e.target.validity.valid) e.target.reportValidity(); });
    for (const el of document.querySelectorAll('.question')) {
      el.addEventListener('click', (e) => {
        const q = Number(el.dataset.q), button = e.target.closest('button[data-answer]');
        if (button) { if (button.dataset.answer === 'false') askWrongOption(q); else setAnswer(q, button.dataset.answer === 'true' ? true : null); }
        else el.focus();
      });
    }
    updateStats(); focusQuestion(currentPart.start, false);
  }
  function focusQuestion(q, scroll = true) {
    const el = document.querySelector(`[data-q="${q}"]`); if (!el) return;
    el.focus({ preventScroll: true });
    if (scroll) { const rect = el.getBoundingClientRect(); if (rect.top < 80 || rect.bottom > innerHeight - 16) el.scrollIntoView({ block: 'nearest', behavior: 'auto' }); }
  }
  function moveQuestionVertically(q, direction) {
    const current = document.querySelector(`[data-q="${q}"]`);
    if (!current) return;
    const rect = current.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const candidates = [...document.querySelectorAll('[data-q]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { q: Number(el.dataset.q), dy: direction * (r.top + r.height / 2 - y), dx: Math.abs(r.left + r.width / 2 - x) };
    }).filter((item) => item.dy > 1);
    if (!candidates.length) return;
    const nearestRow = Math.min(...candidates.map((item) => item.dy));
    const target = candidates.filter((item) => item.dy <= nearestRow + 2).sort((a, b) => a.dx - b.dx)[0];
    focusQuestion(target.q);
  }
  function setAnswer(q, answer, wrongOption = null, advance = true) {
    if (!currentYear || q < currentPart.start || q > currentPart.end) return;
    change(currentYear, { question: q, correct: answer, wrongOption });
    const el = document.querySelector(`[data-q="${q}"]`);
    el.classList.toggle('correct', answer === true); el.classList.toggle('wrong', answer === false);
    el.setAttribute('aria-label', `第 ${q} 题，${answer === null ? '未做' : answer ? '对' : '错'}`);
    for (const button of el.querySelectorAll('button')) {
      const val = button.dataset.answer === 'null' ? null : button.dataset.answer === 'true';
      button.setAttribute('aria-pressed', String(answer === val));
      button.classList.toggle('chosen-undone', val === null && answer === null);
      button.classList.toggle('chosen-correct', val === true && answer === true);
      button.classList.toggle('chosen-wrong', val === false && answer === false);
    }
    el.querySelector('.wrong-option').textContent = answer === false ? (wrongOption ?? '') : '';
    updateStats(); focusQuestion(advance ? Math.min(currentPart.end, q + 1) : q);
  }
  function updateStats() {
    const r = records[currentYear], s = stats(r, currentPart.start, currentPart.end);
    document.querySelector('#accuracy').textContent = percent(s);
    document.querySelector('#correct-count').textContent = s.correct;
    document.querySelector('#done-count').innerHTML = `${s.correct}<span class="unit">/ ${s.done + s.unmarked}</span>`;
    sections.forEach((section, i) => { const el = document.querySelector(`#section-${i}`); if (!el) return; const st = stats(r, section[1], section[2]); el.textContent = `${st.correct} / ${st.done} · ${percent(st)}`; });
  }

  async function show(rest) {
    active = true;
    try { await load(); } catch { app.innerHTML = '<div class="empty">记录读取失败</div>'; showError('无法读取本地记录', () => show(rest)); return; }
    const m = rest.match(/^(?:\/(cloze|reading|new-type))?(?:\/(201\d|202[0-6]))?$/);
    currentPart = parts.find((part) => part.id === m?.[1]) ?? parts[0];
    currentYear = m?.[2] ? Number(m[2]) : null;
    document.title = currentYear ? `${currentYear} · 做题记录` : '做题记录 · 考研英语';
    currentYear ? renderDetail() : renderHome();
  }
  function hide() { active = false; currentYear = null; }

  window.addEventListener('keydown', (e) => {
    if (!active || document.querySelector('#wrong-dialog')) return;
    if (!currentYear || (e.repeat && !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
    const question = e.target.closest('[data-q]'); if (!question) return;
    const q = Number(question.dataset.q);
    if (e.key === '1' || e.code === 'Numpad1') { e.preventDefault(); setAnswer(q, null); }
    else if (e.key === '2' || e.code === 'Numpad2') { e.preventDefault(); setAnswer(q, true); }
    else if (e.key === '3' || e.code === 'Numpad3') { e.preventDefault(); askWrongOption(q); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusQuestion(Math.max(currentPart.start, q - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); focusQuestion(Math.min(currentPart.end, q + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveQuestionVertically(q, -1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); moveQuestionVertically(q, 1); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); setAnswer(q, null, null, false); }
  });

  /* ---------- 导出（与原项目相同） ---------- */
  function exportData() {
    return { schemaVersion: 2, exam: '考研英语一', exportedAt: new Date().toISOString(), pendingSaveCount: pending.length, scope: '2010—2026 年，客观题 1—45', accuracyDefinition: '答对题数 / 已标记题数；未做不计入分母；非分值加权', durationUnit: 'minutes', durationScope: '每年客观题总用时，手动输入', records: years.map((year) => {
      const r = records[year]; return { year, minutes: r.minutes, studyOrder: r.studyOrder ?? null, updatedAt: r.updatedAt, summary: stats(r), sections: sections.map(([name, start, end]) => ({ name, start, end, ...stats(r, start, end) })), questions: r.answers.map((answer, i) => ({ number: i + 1, result: answer === null ? 'unattempted' : answer ? 'correct' : 'incorrect', wrongOption: answer === false ? r.wrongOptions[i] : null })) };
    }) };
  }
  function markdown(data) {
    const lines = ['# 英语真题记录', '', `导出时间：${safeDate(data.exportedAt)}`, '', '范围：2010—2026 年，英语一客观题 1—45。', '正确率 = 答对题数 ÷ 已标记题数；未做不计入分母，不按分值加权。', '用时：每年客观题总用时，手动填写，单位为分钟；“—”表示未填写。', ''];
    if (data.pendingSaveCount) lines.push(`尚有 ${data.pendingSaveCount} 项本地保存未完成；本文件已包含当前页面的修改。`, '');
    lines.push('做题顺序：数字越小，做得越早；“—”表示未设置。', '', '| 年份 | 答对 | 答错 | 未做 | 正确率 | 用时（分钟） | 做题顺序 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const r of data.records) lines.push(`| ${r.year} | ${r.summary.correct} | ${r.summary.wrong} | ${r.summary.unmarked} | ${percent(r.summary)} | ${r.minutes ?? '—'} | ${r.studyOrder ?? '—'} |`);
    for (const r of data.records.filter((r) => r.summary.done || r.minutes !== null)) {
      lines.push('', `## ${r.year}`, '', `最近修改：${safeDate(r.updatedAt)}`, '', `用时：${r.minutes === null ? '未填写' : `${r.minutes} 分钟`}`, '', '| 题型 | 题号 | 答对 | 答错 | 未做 | 正确率 |', '| --- | --- | ---: | ---: | ---: | ---: |');
      for (const s of r.sections) lines.push(`| ${s.name} | ${s.start}—${s.end} | ${s.correct} | ${s.wrong} | ${s.unmarked} | ${percent(s)} |`);
      lines.push('', '| 题号 | 结果 | 我的错误选项 |', '| ---: | --- | --- |');
      for (const q of r.questions) lines.push(`| ${q.number} | ${{ correct: '对', incorrect: '错', unattempted: '未做' }[q.result]} | ${q.wrongOption ?? '—'} |`);
    }
    return lines.join('\n') + '\n';
  }
  function download(format) {
    const data = exportData(), content = format === 'md' ? markdown(data) : JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `英语真题记录-2010-2026.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (document.modelContext?.registerTool) {
    try { Promise.resolve(document.modelContext.registerTool({ name: 'read_exam_records', title: '读取英语真题记录', description: '读取 2010 至 2026 年英语一客观题对错与用时，不修改记录。', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => { if (!Object.keys(records).length) throw Error('记录尚未读取'); return exportData(); } })).catch(() => {}); } catch {}
  }

  /* ---------- 给阅读页用的接口 ---------- */
  window.tracker = {
    show, hide, load, change, stats, percent, askWrongOption,
    records: () => records,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
