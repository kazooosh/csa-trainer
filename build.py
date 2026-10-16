#!/usr/bin/env python3
"""Baut standalone.html: index.html, styles.css, app.js und alle Kataloge aus catalogs.json in einer Datei.

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
# Kataloge kommen aus catalogs.json, genau wie in der Web-Version
manifest = json.loads((here / "catalogs.json").read_text(encoding="utf-8"))
catalogs = []
for c in manifest["catalogs"]:
    f = here / c["file"]
    if f.exists():
        catalogs.append(dict(c, data=json.loads(f.read_text(encoding="utf-8"))))

# Fragen fest einbetten, damit kein fetch nötig ist
embed = "window.__EMBEDDED_QUESTIONS__ = " + json.dumps({"manifest": manifest, "catalogs": catalogs}, ensure_ascii=False) + ";\n"

html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>\n" + css + "\n</style>")
html = html.replace('<script src="app.js"></script>', "<script>\n" + embed + js + "\n</script>")
html = re.sub(r"<title>.*?</title>", "<title>CSA Trainer</title>", html, count=1)

out = here / "standalone.html"
out.write_text(html, encoding="utf-8")
print("standalone.html geschrieben:", round(len(html) / 1024), "KB,", sum(len(c["data"]["questions"]) for c in catalogs), "Fragen aus", len(catalogs), "Katalogen")
