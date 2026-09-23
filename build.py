#!/usr/bin/env python3
"""Baut standalone.html: index.html, styles.css, app.js und questions.json in einer Datei.

Praktisch zum Weitergeben oder Offline-Nutzen, weil kein Webserver nötig ist.
Fuer GitHub Pages brauchst du das nicht, dort reichen die Einzeldateien.

    python build.py
"""
import json
import pathlib
import re

here = pathlib.Path(__file__).parent
html = (here / "index.html").read_text(encoding="utf-8")
css = (here / "styles.css").read_text(encoding="utf-8")
js = (here / "app.js").read_text(encoding="utf-8")
# Muss zu CATALOG_FILES in app.js passen
CATALOG_FILES = ["questions.json", "measureup.json"]
catalogs = [json.loads((here / f).read_text(encoding="utf-8")) for f in CATALOG_FILES if (here / f).exists()]

# Fragen fest einbetten, damit kein fetch nötig ist
embed = "window.__EMBEDDED_QUESTIONS__ = " + json.dumps(catalogs, ensure_ascii=False) + ";\n"

html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + embed + js + "\n</script>")
html = re.sub(r"<title>.*?</title>", "<title>CSA Trainer</title>", html, count=1)

out = here / "standalone.html"
out.write_text(html, encoding="utf-8")
print("standalone.html geschrieben:", round(len(html) / 1024), "KB,", sum(len(c["questions"]) for c in catalogs), "Fragen aus", len(catalogs), "Katalogen")
