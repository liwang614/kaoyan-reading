/* 双击 HTML 版：所有资料内嵌，接口由浏览器本地存储实现，不发送网络请求。 */
(() => {
  'use strict';
  const pack = JSON.parse(document.getElementById('offline-data').textContent);
  const KEY = 'kaoyan-reading-offline-v1';
  const years = Array.from({length: 17}, (_, i) => String(2010 + i));
  const clone = value => JSON.parse(JSON.stringify(value));
  const blank = () => ({answers: Array(45).fill(null), wrongOptions: Array(45).fill(null), minutes: null, studyOrder: null, updatedAt: null});
  const fresh = () => ({version: 1, marks: {}, progress: {}, records: Object.fromEntries(years.map(y => [y, blank()]))});
  const load = () => {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : fresh();
  };
  const commit = data => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch { throw Error('浏览器未能保存数据，请检查存储权限或剩余空间，并及时备份。'); }
  };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json;charset=utf-8'}});
  const ordered = records => Object.keys(records).filter(y => Number.isInteger(records[y].studyOrder) && records[y].studyOrder > 0)
    .sort((a, b) => records[a].studyOrder - records[b].studyOrder || Number(a) - Number(b));
  const normalize = records => {
    const list = ordered(records);
    for (const y of Object.keys(records)) records[y].studyOrder = list.includes(y) ? list.indexOf(y) + 1 : null;
  };
  const statusOf = (data, key) => ['todo', 'doing', 'done'].includes(data.progress[key]?.status)
    ? data.progress[key].status : data.marks[key]?.length ? 'doing' : 'todo';
  const tokens = text => text.toLowerCase().replace(/’/g, "'").match(/[a-z]+(?:'[a-z]+)?/g) || [];
  const ambiguous = new Set(pack.ambiguous), noStrip = new Set(pack.noStrip);
  const bases = value => {
    let t = value.toLowerCase().replace(/^'+|'+$/g, '').replace(/'s$/, '');
    if (ambiguous.has(t)) return new Set([t]);
    let out = new Set([t, ...(pack.irregular[t] || [])]);
    const n = t.length;
    if (!noStrip.has(t) && n > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) {
      out.add(t.slice(0, -1));
      if (n > 4 && t.endsWith('ies')) out.add(t.slice(0, -3) + 'y');
      else if (t.endsWith('es')) out.add(t.slice(0, -2));
    }
    if (n > 4 && t.endsWith('ed')) {
      const stem = t.slice(0, -2);
      out.add(stem); out.add(t.slice(0, -1));
      if (t.endsWith('ied')) out.add(t.slice(0, -3) + 'y');
      if (stem.length > 2 && stem.at(-1) === stem.at(-2) && !'aeiouls'.includes(stem.at(-1))) out.add(stem.slice(0, -1));
    }
    if (n > 5 && t.endsWith('ing')) {
      const stem = t.slice(0, -3);
      out.add(stem); out.add(stem + 'e');
      if (t.endsWith('ying')) out.add(t.slice(0, -4) + 'ie');
      if (stem.length > 2 && stem.at(-1) === stem.at(-2) && !'aeiouls'.includes(stem.at(-1))) out.add(stem.slice(0, -1));
    }
    return new Set([...out].filter(b => b.length >= 3 || b === t));
  };
  let docs, vocab;
  const cache = new Map();
  function count(term) {
    if (cache.has(term)) return cache.get(term);
    if (!docs) {
      docs = pack.docs.map(d => ({...d, tokens: tokens(d.text)}));
      vocab = new Map();
      for (const d of docs) for (const t of d.tokens) if (!vocab.has(t)) vocab.set(t, bases(t));
    }
    const words = tokens(term), by = [], forms = {};
    let exact = 0;
    if (!words.length) return {total: 0, years: 0, exact: 0, by, forms};
    const sets = words.map(word => {
      const w = word.replace(/^'+|'+$/g, '').replace(/'s$/, '');
      const bs = w.length < 3 ? new Set([w]) : bases(w);
      return new Set([...vocab].filter(([form, fb]) => form === w || [...bs].some(b => fb.has(b))).map(([f]) => f));
    });
    for (const d of docs) {
      let n = 0;
      for (let i = 0; i <= d.tokens.length - words.length; i++) {
        if (!sets.every((s, k) => s.has(d.tokens[i + k]))) continue;
        n++;
        const form = d.tokens.slice(i, i + words.length).join(' ');
        forms[form] = (forms[form] || 0) + 1;
        if (words.every((w, k) => w === d.tokens[i + k])) exact++;
      }
      if (n) by.push({year: d.year, sec: d.sec, label: d.label, n});
    }
    const sections = ['cloze', 'reading', 'questions', 'partb', 'partc', 'writing'];
    by.sort((a,b) => a.year-b.year || sections.indexOf(a.sec)-sections.indexOf(b.sec) || a.label.localeCompare(b.label));
    const result = {total: by.reduce((s,d) => s+d.n,0), years: new Set(by.map(d => d.year)).size, exact, by,
      forms: Object.fromEntries(Object.entries(forms).sort((a,b) => b[1]-a[1]))};
    cache.set(term, result); return result;
  }
  const cell = text => text.replace(/\|/g, '\\|');
  const occTotal = o => `${o.total} 次 / ${o.years} 年${o.exact !== o.total ? `（本词形 ${o.exact} 次）` : ''}`;
  const occSummary = o => {
    const grouped = {};
    for (const d of o.by) (grouped[d.year] ||= []).push(d.label + (d.n > 1 ? `×${d.n}` : ''));
    return Object.entries(grouped).map(([y, parts]) => `${y} ${parts.join('、')}`).join('；');
  };
  function articleMD(data, year, text, include, level=1) {
    const marks = [...(data.marks[`${year}-${text}`] || [])].sort((a,b) => a.p-b.p || a.start-b.start);
    const words = marks.filter(m => m.type === 'word'), sentences = marks.filter(m => m.type === 'sentence');
    const h = '#'.repeat(level), out = [`${h} ${year} Text ${text}`, ''];
    const r = data.records[year], start = 20 + 5 * (Number(text)-1);
    const quiz = Array.from({length: 5}, (_,i) => ({q: start+i+1, a: r.answers[start+i], o: r.wrongOptions[start+i]}));
    const done = quiz.filter(x => x.a !== null);
    if (include.includes('quiz') && done.length) out.push(`${h}# 做题结果（对 ${done.filter(x=>x.a).length} / ${done.length}）`, '',
      quiz.map(x => x.a === null ? `${x.q} 未做` : x.a ? `${x.q} ✓` : `${x.q} ✗${x.o ? `（选 ${x.o}）` : ''}`).join(' · '), '');
    if (include.includes('word')) {
      out.push(`${h}# 生词（${words.length}）`, '');
      if (!words.length) out.push('_无_');
      else if (include.includes('occ')) {
        out.push('| # | 生词 | 段落 | 历年出现 | 分布 |', '|---|------|------|------|------|');
        words.forEach((m,i) => {const o=count(m.text); out.push(`| ${i+1} | ${cell(m.text)} | P${m.p+1} | ${occTotal(o)} | ${cell(occSummary(o))} |`);});
      } else {
        out.push('| # | 生词 | 段落 |', '|---|------|------|');
        words.forEach((m,i) => out.push(`| ${i+1} | ${cell(m.text)} | P${m.p+1} |`));
      }
      out.push('');
    }
    if (include.includes('sentence')) {
      out.push(`${h}# 难句（${sentences.length}）`, '');
      if (!sentences.length) out.push('_无_', '');
      sentences.forEach((m,i) => out.push(`**${i+1}.** P${m.p+1}`, '', `> ${m.text}`, ''));
    }
    return out.join('\n');
  }
  function mergedMD(data, items, include) {
    const all = new Map(); let words=0, sentences=0;
    for (const [y,t] of items) for (const m of data.marks[`${y}-${t}`] || []) {
      if (m.type === 'word') {
        words++; const key=m.text.toLowerCase();
        if (!all.has(key)) all.set(key, {word:m.text, where:[]});
        all.get(key).where.push(`${y}-T${t}`);
      } else sentences++;
    }
    const title=[['word','生词'],['sentence','难句'],['quiz','做题结果']].filter(([k])=>include.includes(k)).map(([,v])=>v).join('与') || '导出';
    const counts=[...(include.includes('word')?[`生词 ${words}`]:[]), ...(include.includes('sentence')?[`难句 ${sentences}`]:[])];
    const out=[`# 考研英语阅读 · ${title}`, '', `> 导出时间 ${new Date().toLocaleString('zh-CN')} ｜ 共 ${items.length} 篇 ｜ ${counts.join(' ｜ ')}`, '', '## 目录', '',
      ...items.map(([y,t])=>`- [${y} Text ${t}](#${y}-text-${t})`), ''];
    for (const [y,t] of items) out.push(articleMD(data,y,t,include,2),'');
    if (include.includes('word')) {
      out.push(`## 生词总表（去重，${all.size}）`, '');
      if (!all.size) out.push('_无_');
      else {
        const occ=include.includes('occ');
        out.push(occ?'| # | 生词 | 标注出处 | 历年出现 | 分布 |':'| # | 生词 | 标注出处 |', occ?'|---|------|------|------|------|':'|---|------|------|');
        [...all].sort(([a],[b])=>a.localeCompare(b)).forEach(([,m],i)=>{
          let line=`| ${i+1} | ${cell(m.word)} | ${m.where.join(', ')} |`;
          if (occ) {const o=count(m.word); line+=` ${occTotal(o)} | ${cell(occSummary(o))} |`;}
          out.push(line);
        });
      }
    }
    return out.join('\n')+'\n';
  }
  // 无依赖 ZIP（STORE）：保留“每篇一个 MD”的多篇打包导出。
  const encoder = new TextEncoder();
  const crcTable = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function zip(files) {
    const chunks=[], central=[]; let offset=0, centralSize=0;
    const header=(size,signature)=>{const bytes=new Uint8Array(size); const view=new DataView(bytes.buffer); view.setUint32(0,signature,true);return [bytes,view];};
    for (const [name,text] of files) {
      const filename=encoder.encode(name), content=encoder.encode(text);
      let crc=0xffffffff; for(const b of content)crc=crcTable[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
      const [local,l]=header(30,0x04034b50);
      l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,content.length,true);l.setUint32(22,content.length,true);l.setUint16(26,filename.length,true);
      chunks.push(local,filename,content);
      const [cent,c]=header(46,0x02014b50);
      c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,content.length,true);c.setUint32(24,content.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);
      central.push(cent,filename);centralSize+=46+filename.length;offset+=30+filename.length+content.length;
    }
    const [end,e]=header(22,0x06054b50);
    e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob([...chunks,...central,end],{type:'application/zip'});
  }
  function exportFile(url) {
    const data=load(), params=url.searchParams;
    const items=(params.get('items')||'').split(',').filter(key=>pack.articles[key]).map(key=>key.split('-')).sort((a,b)=>Number(a[0])-Number(b[0])||Number(a[1])-Number(b[1]));
    if (!items.length) throw Error('没有可导出的文章');
    const include=(params.get('include')||'word,sentence,quiz,occ').split(',');
    if (params.get('mode')==='merged') return {filename:'考研阅读-生词难句.md',blob:new Blob([mergedMD(data,items,include)],{type:'text/markdown;charset=utf-8'})};
    const files=items.map(([y,t])=>[`${y}-Text${t}.md`,articleMD(data,y,t,include)]);
    return files.length===1 ? {filename:files[0][0],blob:new Blob([files[0][1]],{type:'text/markdown;charset=utf-8'})} : {filename:'考研阅读-生词难句.zip',blob:zip(files)};
  }
  const saveBlob=(blob,filename)=>{
    const a=document.createElement('a'), url=URL.createObjectURL(blob);
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  };
  document.addEventListener('click',event=>{
    const a=event.target.closest?.('a');
    if (!a || !a.getAttribute('href')?.startsWith('/api/export?')) return;
    event.preventDefault();
    try {const f=exportFile(new URL(a.getAttribute('href'),'https://offline.local'));saveBlob(f.blob,f.filename);}
    catch(e){alert(e.message);}
  },true);
  // 仅拦截本应用接口；保持原前端和服务端版本的交互一致。
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async (input,options={})=>{
    const path=typeof input==='string'?input:input.url;
    if (!path.startsWith('/api/')) return nativeFetch(input,options);
    try {
      const url=new URL(path,'https://offline.local'), key=`${url.searchParams.get('year')}-${url.searchParams.get('text')}`;
      const method=(options.method||'GET').toUpperCase(), body=options.body?JSON.parse(options.body):{};
      const data=load(); normalize(data.records);
      if (url.pathname==='/api/articles' && method==='GET') return reply(Object.keys(pack.articles).map(k=>{
        const [year,text]=k.split('-').map(Number), marks=data.marks[k]||[];
        return {year,text,words:marks.filter(m=>m.type==='word').length,sentences:marks.filter(m=>m.type==='sentence').length,status:statusOf(data,k),opened:data.progress[k]?.opened||null};
      }).sort((a,b)=>a.year-b.year||a.text-b.text));
      if (url.pathname==='/api/records' && method==='GET') return reply({schemaVersion:2,exam:'考研英语一',records:data.records});
      if (url.pathname==='/api/article' && method==='GET' && pack.articles[key]) {
        const paragraphs=pack.articles[key], marks=clone(data.marks[key]||[]);
        for (const m of marks) {
          m.stale=paragraphs[m.p]?.slice(m.start,m.end)!==m.text;
          if (m.stale) for (const p of [m.p,...paragraphs.map((_,i)=>i).filter(i=>i!==m.p)]) {
            const index=paragraphs[p]?.indexOf(m.text)??-1;
            if(index>=0){Object.assign(m,{p,start:index,end:index+m.text.length,stale:false});break;}
          }
        }
        (data.progress[key]||={}).opened=new Date().toISOString();commit(data);
        const [year,text]=key.split('-').map(Number);
        return reply({year,text,paragraphs,marks,status:statusOf(data,key)});
      }
      if (url.pathname==='/api/occurrences' && method==='POST') return reply(Object.fromEntries(body.terms.map(t=>[t,count(String(t))])));
      if (method==='PUT' && pack.articles[key]) {
        if(url.pathname==='/api/marks')data.marks[key]=body.marks.filter(m=>['word','sentence'].includes(m.type));
        else if(url.pathname==='/api/status' && ['todo','doing','done'].includes(body.status))(data.progress[key]||={}).status=body.status;
        else return reply({error:'状态无效'},400);
        commit(data);return reply({ok:true});
      }
      const match=url.pathname.match(/^\/api\/records\/(201\d|202[0-6])$/);
      if(match && method==='PATCH'){
        const year=match[1], r=data.records[year], now=new Date().toISOString();
        if('question' in body){
          if(!Number.isInteger(body.question)||body.question<1||body.question>45||![true,false,null].includes(body.correct))throw Error('题目格式有误');
          const option=body.wrongOption??null;
          if(option!==null&&(body.correct!==false||!(body.question<=40?'ABCD':'ABCDEFG').includes(option)||option.length!==1))throw Error('选项格式有误');
          r.answers[body.question-1]=body.correct;r.wrongOptions[body.question-1]=body.correct===false?option:null;
        }
        if('minutes' in body){if(body.minutes!==null&&(!Number.isFinite(body.minutes)||body.minutes<0||body.minutes>1440))throw Error('用时格式有误');r.minutes=body.minutes;}
        if('studyOrder' in body){
          const position=body.studyOrder;
          if(position!==null&&position!=='append'&&(!Number.isInteger(position)||position<1||position>17))throw Error('做题顺序应为 1—17 的整数，或留空');
          if(!(position==='append'&&r.studyOrder!==null)){
            const list=ordered(data.records).filter(y=>y!==year);
            if(position!==null)list.splice(position==='append'?list.length:Math.min(position-1,list.length),0,year);
            for(const y of years){const order=list.includes(y)?list.indexOf(y)+1:null;if(order!==data.records[y].studyOrder)data.records[y].updatedAt=now;data.records[y].studyOrder=order;}
          }
        }
        r.updatedAt=now;commit(data);
        return reply({...r,studyOrders:Object.fromEntries(years.map(y=>[y,data.records[y].studyOrder]))});
      }
      return reply({error:'未找到'},404);
    } catch(e){return reply({error:e.message},400);}
  };
  // 本地版增加完整备份 / 恢复，避免换浏览器或移动文件时丢失学习记录。
  const controls=()=>{
    const bar=document.querySelector('.topbar');if(!bar||bar.querySelector('[data-offline-backup]'))return;
    const backup=document.createElement('button');backup.className='btn';backup.dataset.offlineBackup='';backup.textContent='备份数据';
    backup.onclick=()=>saveBlob(new Blob([JSON.stringify({format:'kaoyan-reading-offline',version:1,exportedAt:new Date().toISOString(),data:load()},null,2)],{type:'application/json;charset=utf-8'}),'考研阅读-完整备份.json');
    const restore=document.createElement('button');restore.className='btn';restore.textContent='恢复数据';
    restore.onclick=()=>{
      const file=document.createElement('input');file.type='file';file.accept='.json,application/json';
      file.onchange=async()=>{try{
        if(!file.files?.[0])return;
        const saved=JSON.parse(await file.files[0].text()), data=saved.data;
        if(saved.format!=='kaoyan-reading-offline'||saved.version!==1||!data?.marks||!data.progress||!data.records)throw Error('请选择本工具导出的完整备份文件');
        for(const y of years){const r=data.records[y];if(!r||!Array.isArray(r.answers)||r.answers.length!==45||!r.answers.every(a=>[true,false,null].includes(a))||!Array.isArray(r.wrongOptions)||r.wrongOptions.length!==45)throw Error('备份中的做题记录格式有误');}
        for(const [key,marks] of Object.entries(data.marks)){if(!pack.articles[key]||!Array.isArray(marks)||!marks.every(m=>m&&typeof m.id==='string'&&/^[A-Za-z0-9_-]+$/.test(m.id)&&['word','sentence'].includes(m.type)&&Number.isInteger(m.p)&&Number.isInteger(m.start)&&Number.isInteger(m.end)&&m.p>=0&&m.start>=0&&m.end>=m.start&&typeof m.text==='string'))throw Error('备份中的标注格式有误');}
        if(!confirm('恢复会替换当前浏览器内的学习记录。请先备份当前数据，确定恢复吗？'))return;
        commit(data);location.reload();
      }catch(e){alert(e.message);}};file.click();
    };
    bar.append(backup,restore);
  };
  new MutationObserver(controls).observe(document.getElementById('app'),{childList:true});
})();
