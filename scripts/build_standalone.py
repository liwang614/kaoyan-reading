#!/usr/bin/env python3
"""更新双击即用 HTML。只读取资料与源码，不读取任何个人 data/ 文件。"""
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('reading_server', ROOT / 'server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
articles = {}
docs = []
for path in sorted((ROOT / 'articles').glob('*/text*.txt')):
    match = server.TEXT_FILE.fullmatch(path.name)
    if not match or not path.parent.name.isdigit():
        continue
    year, text = int(path.parent.name), int(match.group(1))
    articles[f'{year}-{text}'] = server.load_paragraphs(path)
    docs.append(dict(year=year, sec='reading', label=f'阅读 Text {text}', text=path.read_text(encoding='utf-8')))
for path in sorted((ROOT / 'corpus').glob('*/*.txt')):
    if path.parent.name.isdigit() and path.stem in server.SECTIONS:
        docs.append(dict(year=int(path.parent.name), sec=path.stem, label=server.SECTIONS[path.stem], text=path.read_text(encoding='utf-8')))
payload = dict(articles=articles, docs=docs, irregular={k:sorted(v) for k,v in server.IRREGULAR.items()},
               ambiguous=sorted(server.AMBIGUOUS), noStrip=sorted(server.NO_S_STRIP))
def safe(text):
    return text.replace('</script', '<\\/script').replace('</SCRIPT', '<\\/SCRIPT')
html = (ROOT / 'static/index.html').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (ROOT/'static/style.css').read_text(encoding='utf-8') + '\n</style>')
data = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
bootstrap = '<script type="application/json" id="offline-data">' + data + '</script>\n'
bootstrap += '<script>\n' + safe((ROOT/'static/offline.js').read_text(encoding='utf-8')) + '\n</script>\n'
html = html.replace('<script src="tracker.js"></script>', bootstrap + '<script>\n' + safe((ROOT/'static/tracker.js').read_text(encoding='utf-8')) + '\n</script>')
html = html.replace('<script src="app.js"></script>', '<script>\n' + safe((ROOT/'static/app.js').read_text(encoding='utf-8')) + '\n</script>')
output = ROOT / '打开即用.html'
output.write_text(html, encoding='utf-8')
print(f'{output.name}: {len(articles)} 篇阅读，{len(docs)} 份词频资料，{output.stat().st_size:,} 字节')
