# CSA Trainer

Statische Lern-App für Multiple-Choice-Prüfungsfragen. Kein Backend, kein Build, kein Framework.
Fortschritt liegt im localStorage des Browsers und lässt sich als JSON exportieren und importieren.

```
index.html       Gerüst mit allen Screens
parse_pdf.py     PDF nach questions.json
styles.css       Dark Theme
app.js           Logik
questions.json   Fragenkatalog (aus der PDF)
measureup.json   MeasureUp-Fragen, Kategorie "MeasureUp", Schwierigkeit unbekannt
build.py         baut standalone.html
standalone.html  alles in einer Datei, läuft per Doppelklick
```

## Lokal starten

`questions.json` wird per fetch geladen, das geht nicht per Doppelklick auf die HTML-Datei.
Kleiner Webserver reicht:

```bash
cd csa-trainer
python -m http.server 8000
# http://localhost:8000
```

Alternativ `python build.py` ausführen und `standalone.html` per Doppelklick öffnen. Darin stecken CSS, JS und Fragen in einer Datei.

## Auf GitHub Pages hosten

1. Neues Repository anlegen, zum Beispiel `csa-trainer`. Public, sonst braucht Pages einen bezahlten Plan.
2. Dateien hochladen (Web-Oberfläche: "Add file" > "Upload files") oder per Git:

```bash
cd csa-trainer
git init -b main
git add .
git commit -m "CSA Trainer"
git remote add origin git@github.com:kazoosh/csa-trainer.git
git push -u origin main
```

3. Im Repository auf **Settings** > **Pages**.
4. Bei "Build and deployment" als Source **Deploy from a branch** wählen, Branch `main`, Ordner `/ (root)`, dann **Save**.
5. Nach etwa einer Minute liegt die Seite auf `https://kazoosh.github.io/csa-trainer/`. Den Stand des Deployments siehst du im Tab **Actions**.

Wichtig: Die Dateien müssen im Wurzelverzeichnis des Repos liegen, nicht in einem Unterordner, sonst zeigt Pages ein 404.

Fragen aktualisieren heißt danach nur noch: `questions.json` ändern, committen, pushen. Wenn du die Einzeldatei-Version weiterreichst, vorher `python build.py` laufen lassen.

## Bedienung

| Taste | Funktion |
|---|---|
| `1` bis `9` | Antwort wählen, bei Mehrfachauswahl umschalten |
| `Enter` | Antwort prüfen, danach weiter |
| `←` `→` | Frage zurück und vor |
| `M` | Frage markieren |
| `Esc` | zurück ins Hauptmenü, Runde bleibt gespeichert |

Die Leiste unter der Kopfzeile zeigt einen Strich pro Frage der Runde, grün für richtig, rot für falsch. Klick springt direkt zur Frage.

## Lernlogik

Jede Frage hat eine Leitner-Box von 0 bis 4.

- Im ersten Versuch richtig: Box plus 1, Serie plus 1
- Falsch: Box minus 1, Serie zurück auf 0, Frage landet in den Wissenslücken
- Zwei richtige Antworten in Folge: Frage verlässt die Wissenslücken

Beim Ziehen einer Runde bekommen ungesehene Fragen das höchste Gewicht, danach niedrige Boxen, Wissenslücken zählen doppelt. Antwortoptionen werden nie gemischt, weil die Erklärungen sich auf die Buchstaben beziehen. Die Reihenfolge der Fragen ist zufällig.

## Fragen aus der PDF ziehen

```bash
pip install pdfplumber
python parse_pdf.py exam.pdf -o questions.json
```

Das Skript liest Frage, Kategorie, Schwierigkeit, Optionen, Antwort, Erklärung und die Reference-Zeile.
Der Hyperlink hinter der Reference wird aus den PDF-Annotationen gelesen und landet als `referenceUrl`
in der JSON, in der App wird die Quelle dann klickbar.

Am Ende kommt ein Report mit Anzahl, Kategorien, Verteilung und Hinweisen, zum Beispiel wenn eine Frage
"Choose two" sagt, die Answer-Zeile aber nur einen Buchstaben nennt, oder wenn zwei Fragen inhaltsgleich sind.
Die Hinweise sind Prüfpunkte, keine Abbrüche.

Weitere Schalter:

| Option | Wirkung |
|---|---|
| `--pages 1-40` | nur bestimmte Seiten, gut zum Testen |
| `--dump-text` | zeigt die eingelesenen Zeilen samt erkannter Links und schreibt nichts |
| `--keep-caps` | lässt die Fragen in Großbuchstaben, so wie sie in der PDF stehen |
| `--keep-em-dashes` | ersetzt Geviertstriche nicht durch normale Bindestriche |

Standardmäßig werden die durchgehend groß geschriebenen Fragen in normale Schreibweise übersetzt.
Welche Wörter dabei groß bleiben, leitet das Skript aus den Erklärungstexten ab: Wörter, die dort
durchgängig groß geschrieben sind, bleiben groß, Funktionswörter bleiben klein. Bei Fragen mit
Sonderlayout, etwa Tabellen oder Screenshots, hilft `--dump-text` beim Nachjustieren.

## Format von questions.json

```json
{
  "meta": { "title": "ServiceNow CSA", "subtitle": "Practice Exam", "version": 1 },
  "questions": [
    {
      "number": "Q5",
      "category": "Reporting & Analytics",
      "difficulty": "medium",
      "question": "Reports can be created from which different places in the platform? (Choose two.)",
      "options": ["List column heading", "Metrics module", "Statistics module", "View / Run module"],
      "answer": ["A", "D"],
      "explanation": "…",
      "reference": "ServiceNow Docs - Create a report",
      "referenceUrl": "https://www.servicenow.com/docs/..."
    }
  ]
}
```

- `answer` mit mehr als einem Buchstaben macht die Frage automatisch zur Mehrfachauswahl.
- `difficulty` erwartet `easy`, `medium`, `hard` oder `unknown` (leer zählt als `unknown`, in der App "unbekannt").
- `topic` ist optional und erscheint als zusätzlicher Tag, bei MeasureUp steht dort das Original-Thema.
- `referenceUrl` darf auch eine Liste sein, dann wird jede URL ein eigener Link.

Weitere Kataloge: Datei ins Wurzelverzeichnis legen und in `CATALOG_FILES` in `app.js` und `build.py` eintragen. Alle Kataloge werden zusammengeführt.
- `referenceUrl` ist optional. Ist sie gesetzt, wird die Quelle unter der Erklärung zum Link.
- `id` ist optional. Ohne Angabe wird sie aus dem Fragetext gehasht, damit ein Neu-Parsen der PDF den Fortschritt nicht zerstört. Umformulierte Fragen gelten dann allerdings als neu.

## Fortschritt mitnehmen

Unter "Daten und Sicherung": Export lädt eine JSON-Datei, Import spielt sie auf einem anderen Gerät wieder ein und überschreibt dort den lokalen Stand.
