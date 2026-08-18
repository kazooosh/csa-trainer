#!/usr/bin/env python3
"""Liest das CSA Practice Exam PDF und schreibt questions.json für den CSA Trainer.

    pip install pdfplumber
    python parse_pdf.py exam.pdf -o questions.json

Erwartetes Layout je Frage:

    Q3. AS IT RELATES TO SERVICENOW REPORTING, WHICH OF THE
    FOLLOWING STATEMENTS DESCRIBES WHAT A METRIC CAN DO?
    Reporting & Analytics · medium
    A. ...
    B. ...
    C. ...
    D. ...
    Answer: C
    <Erklärung, ein oder mehrere Absätze>
    Reference: ServiceNow Docs - Metrics

Der Link hinter der Reference-Zeile wird aus den PDF-Annotationen gelesen und landet
als "referenceUrl" in der JSON. Kopf- und Fußzeilen werden entfernt, Silbentrennung
am Zeilenende zusammengesetzt.

Bei abweichendem Layout hilft `--dump-text`, das zeigt die eingelesenen Zeilen mit
erkannten Links, ohne etwas zu schreiben.
"""

import argparse
import collections
import json
import pathlib
import re
import sys
import unicodedata

try:
    import pdfplumber
except ImportError:
    sys.exit("pdfplumber fehlt. Installieren mit: pip install pdfplumber")


# --------------------------------------------------------------------------- #
# Zeilen aus dem PDF holen                                                     #
# --------------------------------------------------------------------------- #

HEADER_FOOTER = [
    re.compile(r"^ServiceNow\s+CSA\s+Practice\s+Exam$", re.I),
    re.compile(r"^CONFIDENTIAL\s*\d*\s*(of\s*\d+)?$", re.I),
    re.compile(r"^\d+\s+of\s+\d+$"),
    re.compile(r"^\d{1,4}$"),
    re.compile(r"^Page\s+\d+", re.I),
]

HYPHENS = "-\u2010\u2011\u2012\u00ad"
DASHES = {"\u2014": " - ", "\u2013": " - ", "\u2012": " - "}


def clean(text):
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u00a0", " ").replace("\u2019", "'").replace("\u2018", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    return re.sub(r"[ \t]+", " ", text).strip()


def page_lines(page, y_tol=2.0):
    """Gibt [(text, url_or_None)] in Lesereihenfolge zurück."""
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    if not words:
        return []

    rows = []
    for w in sorted(words, key=lambda w: (round(w["top"], 1), w["x0"])):
        if rows and abs(w["top"] - rows[-1]["top"]) <= y_tol:
            rows[-1]["words"].append(w)
            rows[-1]["bottom"] = max(rows[-1]["bottom"], w["bottom"])
        else:
            rows.append({"top": w["top"], "bottom": w["bottom"], "words": [w]})

    links = []
    for a in (page.annots or []):
        uri = a.get("uri") or (a.get("data") or {}).get("A", {}).get("URI")
        if isinstance(uri, bytes):
            uri = uri.decode("utf-8", "replace")
        if uri:
            links.append({"uri": str(uri), "top": a.get("top", 0), "bottom": a.get("bottom", 0)})
    for h in (getattr(page, "hyperlinks", None) or []):
        uri = h.get("uri")
        if uri and not any(l["uri"] == uri and abs(l["top"] - h.get("top", 0)) < 3 for l in links):
            links.append({"uri": str(uri), "top": h.get("top", 0), "bottom": h.get("bottom", 0)})

    out = []
    for row in rows:
        text = clean(" ".join(w["text"] for w in sorted(row["words"], key=lambda w: w["x0"])))
        if not text or any(p.match(text) for p in HEADER_FOOTER):
            continue
        url = None
        for l in links:
            overlap = min(row["bottom"], l["bottom"]) - max(row["top"], l["top"])
            if overlap > 0.4 * (row["bottom"] - row["top"]):
                url = l["uri"]
                break
        out.append((text, url))
    return out


def read_pdf(path, pages=None):
    lines = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            if pages and i not in pages:
                continue
            lines.extend(page_lines(page))
    return lines


STRUCTURAL = re.compile(r"^(Q\s*\d+\s*[.)]|[A-J]\s*[.)]\s|Answers?\s*[:.]|References?\s*[:.])", re.I)


def join_wrapped(lines):
    """Fügt am Zeilenende getrennte Wörter wieder zusammen."""
    merged = []
    for text, url in lines:
        prev = merged[-1][0] if merged else ""
        if (prev and prev[-1] in HYPHENS and len(prev) > 1
                and not STRUCTURAL.match(text) and text[:1].islower()):
            prev, purl = merged.pop()
            merged.append((prev[:-1] + text, purl or url))
        else:
            merged.append((text, url))
    return merged


# --------------------------------------------------------------------------- #
# Groß-/Kleinschreibung der Fragen rekonstruieren                              #
# --------------------------------------------------------------------------- #

ALWAYS = {w.lower(): w for w in [
    "ServiceNow", "ITSM", "ITIL", "ITOM", "CMDB", "SLA", "SLAs", "OLA", "OLAs", "UI", "URL",
    "API", "APIs", "ACL", "ACLs", "CSA", "KB", "LDAP", "SSO", "MID", "REST", "SOAP", "JSON",
    "XML", "CSV", "HTML", "CI", "CIs", "SaaS", "GUI", "UX", "SMTP", "IMAP", "VTB", "PDF",
]}

# Funktionswörter bleiben immer klein, sonst wird aus "as it relates" ein "as IT relates".
STOPWORDS = set("""a an the and or but if then than that this these those of in on at by for
from to with without into onto about as is are was were be been being do does did can could
may might must shall should will would have has had not no nor which what when where who whom
whose why how all any both each few more most other some such only own same so too very one
two three four five following used using use it its there here you your they their we our""".split())

WORD = re.compile(r"[A-Za-z][A-Za-z'’]*")


def build_corpus(chunks):
    """Sammelt Wörter, die im korrekt gesetzten Text durchgängig groß geschrieben sind."""
    counts = collections.defaultdict(collections.Counter)
    for chunk in chunks:
        for sentence in re.split(r"(?<=[.!?;:])\s+", chunk):
            for pos, m in enumerate(WORD.finditer(sentence)):
                w = m.group(0)
                if pos == 0:
                    continue  # Satzanfang sagt nichts über die Schreibweise aus
                counts[w.lower()][w] += 1

    corpus = {}
    for low, forms in counts.items():
        if low in STOPWORDS:
            continue
        total = sum(forms.values())
        capped = sum(n for f, n in forms.items() if f[:1].isupper())
        if total >= 2 and capped == total:
            corpus[low] = forms.most_common(1)[0][0]
    return corpus


def restore_case(text, corpus):
    if not text.isupper():
        return text

    def repl(m):
        w = m.group(0)
        low = w.lower()
        if low in STOPWORDS:
            return low
        if low in ALWAYS:
            return ALWAYS[low]
        if low in corpus:
            return corpus[low]
        return low

    out = WORD.sub(repl, text)
    out = re.sub(r"(^|[.!?]\s+|\()\s*([a-z])", lambda m: m.group(1) + m.group(2).upper(), out)
    return out


def fix_dashes(text, keep):
    if keep:
        return text
    for d, r in DASHES.items():
        text = text.replace(d, r)
    return re.sub(r"\s{2,}", " ", text).strip()


# --------------------------------------------------------------------------- #
# Parser                                                                       #
# --------------------------------------------------------------------------- #

RE_Q = re.compile(r"^Q\s*(\d+)\s*[.)]\s*(.*)$")
RE_CAT = re.compile(r"^(.{2,60}?)\s*[·•∙]\s*(easy|medium|hard)\s*$", re.I)
RE_OPT = re.compile(r"^([A-J])\s*[.)]\s+(.+)$")
RE_ANS = re.compile(r"^Answers?\s*[:.]\s*(.+)$", re.I)
RE_REF = re.compile(r"^References?\s*[:.]\s*(.+)$", re.I)

COUNT_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}


def parse(lines):
    questions, warnings = [], []
    cur = None
    state = "seek"
    pending_cat = None

    def flush():
        nonlocal cur
        if cur and cur["options"] and cur["answer_raw"]:
            questions.append(cur)
        elif cur:
            warnings.append("%s unvollständig, übersprungen" % cur["number"])
        cur = None

    for text, url in lines:
        m = RE_Q.match(text)
        if m:
            flush()
            cur = {"number": "Q" + m.group(1), "qlines": [m.group(2)] if m.group(2) else [],
                   "category": None, "difficulty": None, "options": [], "answer_raw": None,
                   "expl": [], "reference": None, "url": None}
            if pending_cat:
                cur["category"], cur["difficulty"] = pending_cat
                pending_cat = None
            state = "qtext"
            continue

        mc = RE_CAT.match(text)
        if mc and state in ("qtext", "seek"):
            if cur is not None and state == "qtext":
                cur["category"] = mc.group(1).strip()
                cur["difficulty"] = mc.group(2).lower()
            else:
                pending_cat = (mc.group(1).strip(), mc.group(2).lower())
            continue

        if cur is None:
            continue

        ma = RE_ANS.match(text)
        if ma and state in ("opts", "qtext"):
            cur["answer_raw"] = ma.group(1)
            state = "expl"
            continue

        mr = RE_REF.match(text)
        if mr and state in ("expl", "opts"):
            cur["reference"] = mr.group(1).strip()
            cur["url"] = url
            flush()
            state = "seek"
            continue

        mo = RE_OPT.match(text)
        if mo and state in ("qtext", "opts"):
            expected = chr(ord("A") + len(cur["options"]))
            if mo.group(1) == expected or state == "qtext":
                cur["options"].append([mo.group(1), mo.group(2)])
                state = "opts"
                continue

        if state == "qtext":
            cur["qlines"].append(text)
        elif state == "opts" and cur["options"]:
            cur["options"][-1][1] += " " + text
        elif state == "expl":
            if cur["reference"] is None and url and not cur["expl"]:
                cur["url"] = url
            cur["expl"].append(text)

    flush()
    return questions, warnings


def build(raw, args):
    corpus = build_corpus(
        [o[1] for q in raw for o in q["options"]] + [" ".join(q["expl"]) for q in raw]
    )

    out, warnings, seen = [], [], {}
    for q in raw:
        letters = [l.strip().upper() for l in re.split(r"[,/&]| and ", q["answer_raw"]) if l.strip()]
        letters = [l for l in letters if re.fullmatch(r"[A-J]", l)]
        options = [fix_dashes(o[1].strip(), args.keep_em_dashes) for o in q["options"]]
        valid = [l for l in letters if ord(l) - 65 < len(options)]

        qtext = fix_dashes(" ".join(q["qlines"]).strip(), args.keep_em_dashes)
        if not args.keep_caps:
            qtext = restore_case(qtext, corpus)

        if not valid:
            warnings.append("%s ohne verwertbare Antwort (%r), übersprungen" % (q["number"], q["answer_raw"]))
            continue
        if len(options) < 2:
            warnings.append("%s hat nur %d Optionen, übersprungen" % (q["number"], len(options)))
            continue

        mcount = re.search(r"choose\s+(one|two|three|four|five)", qtext, re.I)
        if mcount and COUNT_WORDS[mcount.group(1).lower()] != len(valid):
            warnings.append("%s: Text sagt %s, Answer nennt %d Buchstaben"
                            % (q["number"], mcount.group(1), len(valid)))

        key = re.sub(r"\W+", "", qtext.lower())[:120]
        if key in seen:
            warnings.append("%s ist inhaltsgleich mit %s" % (q["number"], seen[key]))
        seen.setdefault(key, q["number"])

        item = {
            "id": hash_id(qtext),
            "number": q["number"],
            "category": q["category"] or "Ohne Kategorie",
            "difficulty": q["difficulty"] or "medium",
            "question": qtext,
            "options": options,
            "answer": valid,
            "explanation": fix_dashes(" ".join(q["expl"]).strip(), args.keep_em_dashes),
            "reference": fix_dashes(q["reference"] or "", args.keep_em_dashes),
        }
        if q["url"]:
            item["referenceUrl"] = q["url"]
        if not item["explanation"]:
            warnings.append("%s ohne Erklärung" % q["number"])
        out.append(item)
    return out, warnings


def hash_id(s):
    """Gleiche djb2-Variante wie app.js, damit IDs stabil bleiben."""
    h = 5381
    for ch in s:
        h = (h * 33 + ord(ch)) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if h == 0:
        return "q0"
    s36 = ""
    while h:
        h, r = divmod(h, 36)
        s36 = digits[r] + s36
    return "q" + s36


def parse_pages(spec):
    if not spec:
        return None
    pages = set()
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            pages.update(range(int(a), int(b) + 1))
        else:
            pages.add(int(part))
    return pages


def main():
    ap = argparse.ArgumentParser(description="CSA Practice Exam PDF nach questions.json")
    ap.add_argument("pdf")
    ap.add_argument("-o", "--out", default="questions.json")
    ap.add_argument("--title", default="ServiceNow CSA")
    ap.add_argument("--subtitle", default="Practice Exam")
    ap.add_argument("--pages", help="nur diese Seiten, z. B. 1-40 oder 3,7,9")
    ap.add_argument("--keep-caps", action="store_true", help="Fragen in Großbuchstaben belassen")
    ap.add_argument("--keep-em-dashes", action="store_true", help="Geviertstriche nicht ersetzen")
    ap.add_argument("--dump-text", action="store_true", help="nur eingelesene Zeilen zeigen")
    args = ap.parse_args()

    lines = join_wrapped(read_pdf(args.pdf, parse_pages(args.pages)))

    if args.dump_text:
        for text, url in lines:
            print(("[LINK] " if url else "       ") + text)
            if url:
                print("        -> " + url)
        print("\n%d Zeilen, %d davon mit Link" % (len(lines), sum(1 for _, u in lines if u)))
        return

    raw, w1 = parse(lines)
    items, w2 = build(raw, args)

    data = {"meta": {"title": args.title, "subtitle": args.subtitle, "version": 1,
                     "source": pathlib.Path(args.pdf).name, "count": len(items)},
            "questions": items}
    pathlib.Path(args.out).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    cats = collections.Counter(i["category"] for i in items)
    diffs = collections.Counter(i["difficulty"] for i in items)
    multi = sum(1 for i in items if len(i["answer"]) > 1)
    linked = sum(1 for i in items if i.get("referenceUrl"))

    print("%s geschrieben" % args.out)
    print("  Fragen ........ %d" % len(items))
    print("  Mehrfachauswahl %d" % multi)
    print("  mit Link ...... %d" % linked)
    print("  Schwierigkeit . " + ", ".join("%s %d" % (k, v) for k, v in diffs.most_common()))
    print("  Kategorien .... %d" % len(cats))
    for k, v in cats.most_common():
        print("      %-38s %d" % (k[:38], v))
    warnings = w1 + w2
    if warnings:
        print("\n%d Hinweise:" % len(warnings))
        for x in warnings[:40]:
            print("  ! " + x)
        if len(warnings) > 40:
            print("  ... und %d weitere" % (len(warnings) - 40))


if __name__ == "__main__":
    main()
