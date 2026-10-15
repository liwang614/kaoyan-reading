#!/usr/bin/env python3
"""考研英语阅读 · 生词难句标注工具 —— 本地服务器（仅用标准库）。

运行：python3 server.py   然后浏览器打开 http://127.0.0.1:8765
"""
import base64
import hmac
import io
import json
import os
import re
import sys
import threading
import webbrowser
import zipfile
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

ROOT = Path(__file__).resolve().parent
ARTICLES = ROOT / "articles"
DATA = Path(os.environ.get("KAOYAN_DATA_DIR") or ROOT / "data")
MARKS = DATA / "marks"
STATIC = ROOT / "static"
PORT = int(os.environ.get("PORT", "8765"))
HOST = os.environ.get("HOST", "127.0.0.1")
AUTH_USER = os.environ.get("BASIC_AUTH_USER", "admin")
AUTH_PASSWORD = os.environ.get("BASIC_AUTH_PASSWORD", "")
SAVE_LOCK = threading.Lock()
PROGRESS = DATA / "progress.json"
RECORDS = DATA / "records.json"
STATUSES = ("todo", "doing", "done")

TEXT_FILE = re.compile(r"text\s*(\d+)\.txt", re.I)


# ---------- 文章 ----------

def article_path(year, text):
    return ARTICLES / str(year) / f"text{text}.txt"


def marks_path(year, text):
    return MARKS / f"{year}-text{text}.json"


def load_paragraphs(path):
    """段落之间用空行分隔；段落内部的换行合并为空格。"""
    raw = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").strip()
    blocks = re.split(r"\n\s*\n", raw)
    return [re.sub(r"\s+", " ", b).strip() for b in blocks if b.strip()]


def list_articles():
    items = []
    if not ARTICLES.exists():
        return items
    progress = load_progress()
    for ydir in ARTICLES.iterdir():
        if not (ydir.is_dir() and ydir.name.isdigit()):
            continue
        for f in ydir.iterdir():
            m = TEXT_FILE.fullmatch(f.name)
            if not m:
                continue
            year, text = int(ydir.name), int(m.group(1))
            marks = load_marks(year, text)
            info = progress.get(f"{year}-{text}", {})
            items.append({
                "year": year,
                "text": text,
                "words": sum(1 for x in marks if x["type"] == "word"),
                "sentences": sum(1 for x in marks if x["type"] == "sentence"),
                "status": derive_status(info, marks),
                "opened": info.get("opened"),
            })
    items.sort(key=lambda x: (x["year"], x["text"]))
    return items


# ---------- 进度 ----------

def load_progress():
    try:
        return json.loads(PROGRESS.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def write_json(target, data):
    """先写临时文件再整体替换，避免并发保存把文件写坏。调用方需持有 SAVE_LOCK。"""
    tmp = target.with_suffix(f".{threading.get_ident()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, target)


def update_progress(year, text, **fields):
    with SAVE_LOCK:
        data = load_progress()
        data.setdefault(f"{year}-{text}", {}).update(fields)
        write_json(PROGRESS, data)
        return data[f"{year}-{text}"]


def derive_status(info, marks):
    """手动设置过就用设置的；否则有标注算进行中，没有算未做。"""
    if info.get("status") in STATUSES:
        return info["status"]
    return "doing" if marks else "todo"


# ---------- 做题记录（原「英语真题记录」，逻辑原样移植）----------
# 每年 45 道客观题：完形 1–20、阅读 21–40（Text n 对应 21+5(n-1) 起的 5 题）、新题型 41–45。

YEARS = list(range(2010, 2027))


def blank_record():
    return {"answers": [None] * 45, "wrongOptions": [None] * 45, "minutes": None,
            "studyOrder": None, "updatedAt": None}


def ordered_years(records):
    ys = [y for y, r in records.items() if isinstance(r.get("studyOrder"), int)
          and not isinstance(r.get("studyOrder"), bool) and r["studyOrder"] > 0]
    return sorted(ys, key=lambda y: (records[y]["studyOrder"], int(y)))


def normalize_orders(records):
    ordered = ordered_years(records)
    for y, r in records.items():
        r["studyOrder"] = ordered.index(y) + 1 if y in ordered else None


def move_study_order(records, year, position):
    year = str(year)
    normalize_orders(records)
    if position == "append" and records[year]["studyOrder"] is not None:
        return
    ordered = [y for y in ordered_years(records) if y != year]
    if position is not None:
        at = len(ordered) if position == "append" else min(position - 1, len(ordered))
        ordered.insert(at, year)
    for y, r in records.items():
        r["studyOrder"] = ordered.index(y) + 1 if y in ordered else None


def load_records():
    try:
        state = json.loads(RECORDS.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        state = {"schemaVersion": 2, "exam": "考研英语一",
                 "records": {str(y): blank_record() for y in YEARS}}
    for y in YEARS:
        state["records"].setdefault(str(y), blank_record())
    for r in state["records"].values():
        r.setdefault("wrongOptions", [None] * 45)
        r.setdefault("studyOrder", None)
    normalize_orders(state["records"])
    state["schemaVersion"] = 2
    return state


def patch_record(year, patch):
    """校验并应用一次修改，返回与原接口相同的结果；格式不对时抛 ValueError。"""
    keys = {"question", "correct", "minutes", "wrongOption", "studyOrder"}
    if not isinstance(patch, dict) or set(patch) - keys:
        raise ValueError("记录格式有误")
    with SAVE_LOCK:
        state = load_records()
        old = state["records"]
        nxt = json.loads(json.dumps(old[year]))
        if "question" in patch:
            q, correct = patch["question"], patch.get("correct")
            if not isinstance(q, int) or isinstance(q, bool) or not 1 <= q <= 45 or correct not in (True, False, None):
                raise ValueError("题目格式有误")
            option = patch.get("wrongOption")
            allowed = "ABCD" if q <= 40 else "ABCDEFG"
            if option is not None and (correct is not False or not isinstance(option, str)
                                       or len(option) != 1 or option not in allowed):
                raise ValueError("选项格式有误")
            nxt["wrongOptions"][q - 1] = option if correct is False else None
            nxt["answers"][q - 1] = correct
        elif "correct" in patch or "wrongOption" in patch:
            raise ValueError("缺少题号")
        if "minutes" in patch:
            m = patch["minutes"]
            if m is not None and (isinstance(m, bool) or not isinstance(m, (int, float)) or m != m or not 0 <= m <= 1440):
                raise ValueError("用时格式有误")
            nxt["minutes"] = m
        if "studyOrder" in patch:
            o = patch["studyOrder"]
            if o is not None and o != "append" and (not isinstance(o, int) or isinstance(o, bool) or not 1 <= o <= 17):
                raise ValueError("做题顺序应为 1—17 的整数，或留空")
        now = datetime.utcnow().isoformat(timespec="milliseconds") + "Z"
        nxt["updatedAt"] = now
        records = json.loads(json.dumps(old))
        records[year] = nxt
        if "studyOrder" in patch:
            move_study_order(records, year, patch["studyOrder"])
            for y, r in records.items():
                if r["studyOrder"] != old[y]["studyOrder"]:
                    r["updatedAt"] = now
        state["records"] = records
        write_json(RECORDS, state)
    return dict(records[year], studyOrders={y: r["studyOrder"] for y, r in records.items()})


def quiz_slice(year, text):
    """阅读 Text n 对应的 5 道题：[(题号, 对错, 错选项), ...]"""
    r = load_records()["records"].get(str(year))
    if not r or not str(text).isdigit():
        return []
    start = 21 + 5 * (int(text) - 1)
    return [(q, r["answers"][q - 1], r["wrongOptions"][q - 1]) for q in range(start, start + 5)]


# ---------- 标注 ----------

def load_marks(year, text):
    p = marks_path(year, text)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("marks", [])
    except (ValueError, OSError):
        return []


def save_marks(year, text, marks):
    MARKS.mkdir(parents=True, exist_ok=True)
    clean = []
    for m in marks:
        if not isinstance(m, dict) or m.get("type") not in ("word", "sentence"):
            continue
        clean.append({
            "id": str(m.get("id", "")),
            "type": m["type"],
            "p": int(m.get("p", 0)),
            "start": int(m.get("start", 0)),
            "end": int(m.get("end", 0)),
            "text": str(m.get("text", "")),
        })
    data = {"year": year, "text": text, "marks": clean}
    with SAVE_LOCK:
        write_json(marks_path(year, text), data)


def relocate(marks, paragraphs):
    """文章若被修改过，按记录的文本重新定位标注；找不到的标为 stale。"""
    for m in marks:
        p, s, e, t = m["p"], m["start"], m["end"], m["text"]
        if p < len(paragraphs) and paragraphs[p][s:e] == t:
            m["stale"] = False
            continue
        m["stale"] = True
        order = [p] + [i for i in range(len(paragraphs)) if i != p]
        for i in order:
            if i >= len(paragraphs):
                continue
            idx = paragraphs[i].find(t)
            if idx >= 0:
                m.update(p=i, start=idx, end=idx + len(t), stale=False)
                break
    return marks


# ---------- 历年出现次数 ----------
# 在全部真题文本（阅读原文 + articles/，完形 / 阅读题目 / 新题型 / 翻译 / 写作 + corpus/）里统计生词出现次数。
# 纯规则：词形还原（-s/-es/-ies、-ed/-ied、-ing、不规则动词表），不依赖任何模型。

CORPUS = ROOT / "corpus"
SECTIONS = {"cloze": "完形", "reading": "阅读", "questions": "阅读题目",
            "partb": "新题型", "partc": "翻译", "writing": "写作"}
SECTION_ORDER = list(SECTIONS)
TOKEN = re.compile(r"[a-z]+(?:'[a-z]+)?")

_IRREGULAR = """arise arose arisen|awake awoke awoken|be was were been being am is are|bear bore borne|beat beaten|
become became|begin began begun|bend bent|bind|bite bit bitten|blow blew blown|break broke broken|breed bred|
bring brought|build built|burn burnt|buy bought|catch caught|choose chose chosen|come came|creep crept|deal dealt|
dig dug|do did done does|draw drew drawn|dream dreamt|drink drank drunk|drive drove driven|eat ate eaten|
fall fallen|feed|feel|fight fought|find|flee fled|fly flew flown flies|forbid forbade forbidden|forecast|
foresee foresaw foreseen|forget forgot forgotten|forgive forgave forgiven|freeze froze frozen|get got gotten|
give gave given|go went gone goes|grind|grow grew grown|hang hung|have had has|hear heard|hide hid hidden|
hold held|keep kept|know knew known|lay laid|lead|lean leant|leap leapt|learn learnt|leave|lend lent|lie lain|
light|lose lost|make made|mean meant|meet met|mislead misled|mistake mistook mistaken|overcome overcame|
overtake overtook overtaken|overthrow overthrew overthrown|pay paid|prove proven|ride rode ridden|ring rang rung|
rise risen|run ran|say said|see seen|seek sought|sell sold|send sent|shake shook shaken|shine shone|shoot shot|
show shown|shrink shrank shrunk|sing sang sung|sink sank sunk|sit sat|sleep slept|slide slid|speak spoke spoken|
speed sped|spend spent|spin spun|spring sprang sprung|stand stood|steal stole stolen|stick stuck|sting stung|
strike struck stricken|strive strove striven|swear swore sworn|sweep swept|swim swam swum|swing swung|
take took taken|teach taught|tear tore torn|tell told|think thought|throw threw thrown|tread trod trodden|
undergo underwent undergone|understand understood|undertake undertook undertaken|uphold upheld|wake woke woken|
wear wore worn|weave wove woven|weep wept|win won|withdraw withdrew withdrawn|withhold withheld|
withstand withstood|write wrote written|man men|woman women|child children|foot feet|tooth teeth|mouse mice|
analysis analyses|crisis crises|hypothesis hypotheses|thesis theses|criterion criteria|phenomenon phenomena|
basis bases|medium media"""
IRREGULAR = {}
for group in _IRREGULAR.replace("\n", "").split("|"):
    base, *forms = group.split()
    for f in forms:
        IRREGULAR.setdefault(f, set()).add(base)
# 本身就是常用词、又恰好是别的词过去式的形式：不往原形还原，避免 found 被算成 find
AMBIGUOUS = {"found", "left", "lay", "saw", "bound", "ground", "wound", "lead", "felt", "rose", "fell", "fed",
             "lit", "stole", "tore", "bore", "spoke", "shot", "won", "ran", "spun"}
NO_S_STRIP = {"news", "series", "species", "means", "physics", "economics", "politics", "ethics", "statistics",
              "mathematics", "goods", "arms", "clothes", "lens", "bus", "gas", "this", "his", "is", "was", "has",
              "does", "us", "yes", "less", "unless", "across", "always", "perhaps", "towards", "whereas", "thus",
              "plus", "bonus", "census", "status", "campus", "virus", "focus", "chaos", "process", "access",
              "success", "business", "analysis", "basis", "crisis", "emphasis", "thesis", "series", "diabetes"}


def word_bases(t):
    """一个词可能的原形集合（含自身）。"""
    t = t.lower().strip("'")
    if t.endswith("'s"):
        t = t[:-2]
    res = {t}
    if t in AMBIGUOUS:
        return res
    res |= IRREGULAR.get(t, set())
    n = len(t)
    if t not in NO_S_STRIP and n > 3 and t.endswith("s") and not t.endswith(("ss", "us", "is")):
        res.add(t[:-1])
        if t.endswith("ies") and n > 4:
            res.add(t[:-3] + "y")
        elif t.endswith("es"):
            res.add(t[:-2])
    if n > 4 and t.endswith("ed"):
        stem = t[:-2]
        res |= {stem, t[:-1]}
        if t.endswith("ied"):
            res.add(t[:-3] + "y")
        if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in "aeiouls":
            res.add(stem[:-1])
    if n > 5 and t.endswith("ing"):
        stem = t[:-3]
        res |= {stem, stem + "e"}
        if t.endswith("ying"):
            res.add(t[:-4] + "ie")
        if len(stem) > 2 and stem[-1] == stem[-2] and stem[-1] not in "aeiouls":
            res.add(stem[:-1])
    return {b for b in res if len(b) >= 3} | {t}


class CorpusIndex:
    def __init__(self):
        self.sig = None
        self.docs = []      # [(year, section, label, [tokens])]
        self.vocab = {}     # form -> bases
        self.lock = threading.Lock()

    def _signature(self):
        files = list(ARTICLES.glob("*/text*.txt")) + list(CORPUS.glob("*/*.txt"))
        return tuple(sorted((str(f), f.stat().st_mtime) for f in files))

    def ensure(self):
        with self.lock:
            sig = self._signature()
            if sig == self.sig:
                return
            docs = []
            for f in sorted(ARTICLES.glob("*/text*.txt")):
                m = TEXT_FILE.fullmatch(f.name)
                if m and f.parent.name.isdigit():
                    docs.append((int(f.parent.name), "reading", f"阅读 Text {m.group(1)}", f.read_text(encoding="utf-8")))
            for f in sorted(CORPUS.glob("*/*.txt")):
                if f.parent.name.isdigit() and f.stem in SECTIONS:
                    docs.append((int(f.parent.name), f.stem, SECTIONS[f.stem], f.read_text(encoding="utf-8")))
            self.docs = [(y, sec, label, TOKEN.findall(text.lower().replace("’", "'"))) for y, sec, label, text in docs]
            self.vocab = {}
            for *_, toks in self.docs:
                for t in toks:
                    if t not in self.vocab:
                        self.vocab[t] = word_bases(t)
            self.sig = sig

    def forms_for(self, word):
        """语料中与 word 属于同一个词的所有词形。"""
        word = word.lower().strip("'")
        if word.endswith("'s"):
            word = word[:-2]
        bases = word_bases(word)
        if len(word) < 3:
            bases = {word}
        return {f for f, fb in self.vocab.items() if f == word or (fb & bases)}

    def count(self, term):
        self.ensure()
        words = TOKEN.findall(term.lower().replace("’", "'"))
        if not words:
            return {"total": 0, "years": 0, "exact": 0, "by": [], "forms": {}}
        sets = [self.forms_for(w) for w in words]
        by, forms, exact = [], {}, 0
        for y, sec, label, toks in self.docs:
            n = 0
            for i in range(len(toks) - len(words) + 1):
                if all(toks[i + k] in sets[k] for k in range(len(words))):
                    n += 1
                    f = " ".join(toks[i:i + len(words)])
                    forms[f] = forms.get(f, 0) + 1
                    exact += toks[i:i + len(words)] == words
            if n:
                by.append({"year": y, "sec": sec, "label": label, "n": n})
        by.sort(key=lambda d: (d["year"], SECTION_ORDER.index(d["sec"]), d["label"]))
        return {"total": sum(d["n"] for d in by), "years": len({d["year"] for d in by}), "exact": exact,
                "by": by, "forms": dict(sorted(forms.items(), key=lambda kv: -kv[1]))}


INDEX = CorpusIndex()


def occ_total(info):
    """例如：26 次 / 6 年（本词形 5 次）"""
    s = f"{info['total']} 次 / {info['years']} 年"
    if info["exact"] != info["total"]:
        s += f"（本词形 {info['exact']} 次）"
    return s


def occ_summary(info):
    """把分布压缩成一行，例如：2015 阅读 Text 3×2、完形；2024 新题型"""
    years = {}
    for d in info["by"]:
        years.setdefault(d["year"], []).append(d["label"] + (f"×{d['n']}" if d["n"] > 1 else ""))
    return "；".join(f"{y} " + "、".join(parts) for y, parts in years.items())


# ---------- 导出 Markdown ----------

def md_cell(s):
    return s.replace("|", "\\|")


# 导出可选内容：生词、难句、做题结果、历年统计（生词表里的「历年出现 / 分布」两列）
ALL_TYPES = ("word", "sentence", "quiz", "occ")


def article_md(year, text, level=1, include=ALL_TYPES):
    marks = sorted(load_marks(year, text), key=lambda m: (m["p"], m["start"]))
    words = [m for m in marks if m["type"] == "word"]
    sents = [m for m in marks if m["type"] == "sentence"]
    h = "#" * level
    out = [f"{h} {year} Text {text}", ""]

    quiz = quiz_slice(year, text) if "quiz" in include else []
    done = [x for x in quiz if x[1] is not None]
    if done:
        right = sum(1 for x in done if x[1])
        cells = [f"{q} ✓" if a else (f"{q} ✗（选 {o}）" if o else f"{q} ✗") if a is False else f"{q} 未做"
                 for q, a, o in quiz]
        out += [f"{h}# 做题结果（对 {right} / {len(done)}）", "", " · ".join(cells), ""]

    if "word" in include:
        out += [f"{h}# 生词（{len(words)}）", ""]
        if words and "occ" in include:
            out += ["| # | 生词 | 段落 | 历年出现 | 分布 |", "|---|------|------|------|------|"]
            for i, m in enumerate(words, 1):
                occ = INDEX.count(m["text"])
                out.append(f"| {i} | {md_cell(m['text'])} | P{m['p'] + 1} | "
                           f"{occ_total(occ)} | {md_cell(occ_summary(occ))} |")
        elif words:
            out += ["| # | 生词 | 段落 |", "|---|------|------|"]
            for i, m in enumerate(words, 1):
                out.append(f"| {i} | {md_cell(m['text'])} | P{m['p'] + 1} |")
        else:
            out.append("_无_")
        out.append("")

    if "sentence" in include:
        out += [f"{h}# 难句（{len(sents)}）", ""]
        if sents:
            for i, m in enumerate(sents, 1):
                out += [f"**{i}.** P{m['p'] + 1}", "", f"> {m['text']}", ""]
        else:
            out += ["_无_", ""]
    return "\n".join(out)


def merged_md(items, include=ALL_TYPES):
    all_words = {}
    n_words = n_sents = 0
    for y, t in items:
        for m in load_marks(y, t):
            if m["type"] == "word":
                n_words += 1
                key = m["text"].lower()
                all_words.setdefault(key, (m["text"], []))[1].append(f"{y}-T{t}")
            else:
                n_sents += 1

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    counts = [f"生词 {n_words}"] * ("word" in include) + [f"难句 {n_sents}"] * ("sentence" in include)
    title = "与".join(["生词"] * ("word" in include) + ["难句"] * ("sentence" in include)
                     + ["做题结果"] * ("quiz" in include)) or "导出"
    out = [
        f"# 考研英语阅读 · {title}", "",
        f"> 导出时间 {now} ｜ 共 {len(items)} 篇 ｜ " + " ｜ ".join(counts), "",
        "## 目录", "",
    ]
    out += [f"- [{y} Text {t}](#{y}-text-{t})" for y, t in items]
    out.append("")
    for y, t in items:
        out += [article_md(y, t, level=2, include=include), ""]

    if "word" not in include:
        return "\n".join(out)
    out += [f"## 生词总表（去重，{len(all_words)}）", ""]
    if all_words and "occ" in include:
        out += ["| # | 生词 | 标注出处 | 历年出现 | 分布 |", "|---|------|------|------|------|"]
        for i, key in enumerate(sorted(all_words), 1):
            word, where = all_words[key]
            occ = INDEX.count(word)
            out.append(f"| {i} | {md_cell(word)} | {', '.join(where)} | "
                       f"{occ_total(occ)} | {md_cell(occ_summary(occ))} |")
    elif all_words:
        out += ["| # | 生词 | 标注出处 |", "|---|------|------|"]
        for i, key in enumerate(sorted(all_words), 1):
            word, where = all_words[key]
            out.append(f"| {i} | {md_cell(word)} | {', '.join(where)} |")
    else:
        out.append("_无_")
    out.append("")
    return "\n".join(out)


# ---------- HTTP ----------

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(STATIC), **kw)

    def log_message(self, fmt, *args):
        pass

    def parse_request(self):
        if not super().parse_request():
            return False
        health = self.command in ("GET", "HEAD") and urlparse(self.path).path == "/healthz"
        if AUTH_PASSWORD and not health:
            expected = "Basic " + base64.b64encode(
                f"{AUTH_USER}:{AUTH_PASSWORD}".encode("utf-8")).decode("ascii")
            supplied = self.headers.get("Authorization", "")
            if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="Kaoyan Reading", charset="UTF-8"')
                self.send_header("Content-Length", "0")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                return False
        if self.command in ("POST", "PUT", "PATCH", "DELETE"):
            origin = self.headers.get("Origin")
            if origin:
                parsed = urlparse(origin)
                if parsed.scheme not in ("http", "https") or parsed.netloc != self.headers.get("Host"):
                    self.send_json({"error": "访问被拒绝"}, 403)
                    self.close_connection = True
                    return False
        return True

    def end_headers(self):
        # 每次都向服务器确认，改了前端代码后刷新即可生效
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_download(self, body, filename, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition",
                         f"attachment; filename*=UTF-8''{quote(filename)}")
        self.end_headers()
        self.wfile.write(body)

    def year_text(self, q):
        try:
            return int(q["year"][0]), int(q["text"][0])
        except (KeyError, ValueError, IndexError):
            return None

    def do_GET(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        if url.path == "/healthz":
            return self.send_json({"ok": True})
        if url.path == "/api/articles":
            return self.send_json(list_articles())

        if url.path == "/api/records":
            return self.send_json(load_records())

        if url.path == "/api/article":
            yt = self.year_text(q)
            if not yt or not article_path(*yt).exists():
                return self.send_json({"error": "文章不存在"}, 404)
            paragraphs = load_paragraphs(article_path(*yt))
            marks = relocate(load_marks(*yt), paragraphs)
            info = update_progress(*yt, opened=datetime.now().isoformat(timespec="seconds"))
            return self.send_json({"year": yt[0], "text": yt[1],
                                   "paragraphs": paragraphs, "marks": marks,
                                   "status": derive_status(info, marks)})

        if url.path == "/api/export":
            items = []
            for tok in q.get("items", [""])[0].split(","):
                m = re.fullmatch(r"(\d{4})-(\d+)", tok.strip())
                if m and article_path(int(m.group(1)), int(m.group(2))).exists():
                    items.append((int(m.group(1)), int(m.group(2))))
            if not items:
                return self.send_json({"error": "没有可导出的文章"}, 400)
            items.sort()
            include = tuple(x for x in q.get("include", [",".join(ALL_TYPES)])[0].split(",")
                            if x in ALL_TYPES) or ALL_TYPES
            md_type = "text/markdown; charset=utf-8"
            if q.get("mode", ["separate"])[0] == "merged":
                return self.send_download(merged_md(items, include).encode("utf-8"),
                                          "考研阅读-生词难句.md", md_type)
            if len(items) == 1:
                y, t = items[0]
                return self.send_download(article_md(y, t, include=include).encode("utf-8"),
                                          f"{y}-Text{t}.md", md_type)
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for y, t in items:
                    z.writestr(f"{y}-Text{t}.md", article_md(y, t, include=include))
            return self.send_download(buf.getvalue(), "考研阅读-生词难句.zip",
                                      "application/zip")

        if url.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        if url.path in ("/", "/index.html"):
            return self.send_index()
        return super().do_GET()

    def send_index(self):
        """给 app.js / style.css 加上修改时间作版本号，改了前端后浏览器一定会拿到新文件。"""
        html = (STATIC / "index.html").read_text(encoding="utf-8")
        for name in ("app.js", "tracker.js", "style.css"):
            v = int((STATIC / name).stat().st_mtime)
            html = html.replace(f'"{name}"', f'"{name}?v={v}"')
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/api/occurrences":
            return self.send_json({"error": "not found"}, 404)
        try:
            length = int(self.headers.get("Content-Length", 0))
            terms = json.loads(self.rfile.read(length).decode("utf-8")).get("terms", [])
            if not isinstance(terms, list) or len(terms) > 500:
                raise ValueError("terms 格式不正确")
            result = {str(t): INDEX.count(str(t)) for t in terms}
        except (ValueError, AttributeError) as e:
            return self.send_json({"error": str(e)}, 400)
        return self.send_json(result)

    def do_PATCH(self):
        url = urlparse(self.path)
        m = re.fullmatch(r"/api/records/(201\d|202[0-6])", url.path)
        if not m:
            return self.send_json({"error": "未找到"}, 404)
        if not (self.headers.get("Content-Type") or "").startswith("application/json"):
            return self.send_json({"error": "需要 JSON"}, 415)
        length = int(self.headers.get("Content-Length", 0))
        if length > 8192:
            return self.send_json({"error": "内容过长"}, 413)
        try:
            patch = json.loads(self.rfile.read(length).decode("utf-8"))
            return self.send_json(patch_record(m.group(1), patch))
        except ValueError as e:
            return self.send_json({"error": str(e)}, 400)
        except OSError:
            return self.send_json({"error": "保存失败"}, 500)

    def do_PUT(self):
        url = urlparse(self.path)
        if url.path not in ("/api/marks", "/api/status"):
            return self.send_json({"error": "not found"}, 404)
        yt = self.year_text(parse_qs(url.query))
        if not yt or not article_path(*yt).exists():
            return self.send_json({"error": "文章不存在"}, 404)
        try:
            length = int(self.headers.get("Content-Length", 0))
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if url.path == "/api/marks":
                save_marks(*yt, data.get("marks", []))
            else:
                status = data.get("status")
                if status not in STATUSES:
                    raise ValueError("状态无效")
                update_progress(*yt, status=status)
        except (ValueError, AttributeError) as e:
            return self.send_json({"error": str(e)}, 400)
        return self.send_json({"ok": True})


def main():
    if HOST not in ("127.0.0.1", "localhost", "::1") and not AUTH_PASSWORD:
        raise SystemExit("对外部署请先设置 BASIC_AUTH_PASSWORD 访问密码")
    ARTICLES.mkdir(exist_ok=True)
    MARKS.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"考研阅读标注工具已启动：{url}   （Ctrl+C 退出）")
    if HOST in ("127.0.0.1", "localhost", "::1") and "--no-browser" not in sys.argv:
        threading.Timer(0.6, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")


if __name__ == "__main__":
    main()
