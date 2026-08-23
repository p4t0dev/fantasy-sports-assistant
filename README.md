# Fantasy Sports Assistant

Sleeper-basierter Dynasty-Assistent für **NFL und NBA**: Waiver-Empfehlungen mit
Live-Spielernews, Draft-Board und Bewertungsmodell über mehrere Saisons.

## Aufbau

| Ebene | Ort | Zweck |
|---|---|---|
| CLI | `assistant.py` | Dünner Wrapper um dieselbe Engine wie die API |
| Backend | `functions/` | Firebase Python Cloud Functions |
| Frontend | `frontend/` | Next.js 16 (Static Export) |

Die Bewertungslogik liegt **einmal** in `functions/api_core.py`. CLI und Cloud
Functions rufen sie beide auf — es gibt keine zweite Kopie mehr.

### Module

- `functions/sleeper_api.py` — dünne Wrapper um die Sleeper-REST-API
- `functions/projections.py` — Saisonprognosen (forward-looking Produktionsterm)
- `functions/signals.py` — Signal-Layer: Verletzungsstatus, Depth-Chart-Chancen,
  Trending-Adds/Drops, Liga-Transaktionen
- `functions/api_core.py` — Datenschicht, Scoring-Modell (RVS/DVS), Waiver- und
  Draft-Analyse
- `functions/main.py` — HTTP-Endpunkte + täglicher Datenrefresh

## Bewertungsmodell

**Projektionen sind der Produktionsterm.** Sleeper liefert Saisonprognosen im
selben Stat-Schema wie die Stats-Dateien, also laufen sie durch dasselbe
`calculate_custom_score` mit dem Scoring *dieser* Liga — es gibt kein zweites
Scoring-Modell. Ein rein historisches Modell liegt in der Vorsaison in beide
Richtungen daneben: ein Rookie hat keine Historie und ist damit null wert, ein
Veteran ohne Job trägt noch die Produktion des Vorjahres. Beides landet auf
demselben Kader.

Wichtig: liegt eine Projektion vor, entfallen der Depth-Chart- und der
Teamstärke-Multiplikator. Sleeper hat beides bereits eingepreist; ein zweites
Mal angewandt war es Doppelbestrafung. Der Verletzungsmultiplikator greift
weiter — eine Meldung von heute ist jünger als die Prognose.

**Punkte (`pts`)** — projizierte Saisonpunkte, **ohne** Positionsnormalisierung.
Das ist die Währung der Aufstellung. RVS skaliert QBs runter und TEs hoch, damit
*Assets* vergleichbar werden; für einen FLEX-Platz zählen dagegen echte Punkte.
Die Aufstellung über RVS zu bauen hieß, dass ein TE mit 150 projizierten Punkten
einen RB mit 170 verdrängt und ein 333-Punkte-QB seinen SUPER_FLEX-Platz an
einen 292-Punkte-RB verliert.

**RVS (Redraft Value Score)** — Wert für die *laufende* Saison.
Produktion × Positionsnormalisierung × Rolle × Team × kurzfristige Verfügbarkeit.

**DVS (Dynasty Value Score)** — langfristiger Assetwert:

```
DVS = (Produktion + Marktwert + Prospect-Wert) × Alterskurve × Verfügbarkeit
```

Additive und multiplikative Anteile sind bewusst getrennt: ein kurzfristiger
Ausfall darf den Marktwert eines Spielers nicht skalieren.

**Replacement Level** — je Position der Wert des letzten Spielers, der in dieser
Liga noch irgendwo starten würde. Erst dadurch wird ein DB mit einem WR
vergleichbar.

Dieser Satz wird wörtlich gerechnet: die *komplette* Slot-Menge der Liga
(`roster_positions × Teams`) wird mit den besten verfügbaren Spielern besetzt,
und der Schwellwert einer Position ist der schwächste Spieler, der dort noch
einen Platz bekommen hat. Vorher war es die Näherung „der (Slots × Teams)-te
beste Spieler *dieser* Position“ — das stimmt nur, solange Positionen sich
nicht überlappen. In einer Liga mit G-, F- und UTIL-Slots zählt ein Spieler auf
drei oder vier Positionen gleichzeitig, jeder Pool ist damit ein Vielfaches der
Slots dahinter, und der Schwellwert wandert mit. In einer 12er-NBA-Liga landete
die SG-Latte so bei einem Top-25-Guard der gesamten NBA — ein Kader mit einem
klaren Starter auf der Position meldete „1 von 9 über Liga-Startniveau“.

Das Matching läuft auf *Slot-Typen*, nicht auf einzelnen Plätzen: eine
32-Team-IDP-Liga hat 704 Startplätze, und Slots, die dieselben Positionen
akzeptieren, sind untereinander austauschbar — genau wie Spieler mit derselben
Eligibility. Der Graph fällt dadurch auf eine Handvoll Knoten pro Seite
zusammen, ohne dass sich die Auswahl ändert (18 s → unter 1 s).

**Bedarfsschwere** — zwei Signale, `gain` und `depth`. `gain` misst direkt, was
ein Liga-Durchschnitts-Starter der Aufstellung hinzufügen würde; `depth` zählt
Köpfe über dem Replacement Level. Gemeldet wird das schlechtere der beiden, mit
einer Ausnahme: **eine Position mit `gain == 0` und ohne leeren Slot kann nie
„kritisch" sein.** Nur `gain` misst die Aufstellung selbst. Ohne diese Regel
machte die hohe Replacement-Schwelle einer tiefen Liga jeden normalen Kader
flächendeckend rot — jede Position kritisch, auf einer Aufstellung ohne eine
einzige Lücke.

Greift die Ausnahme, ändert sich auch das Etikett: „FLEX offen“ über einer
Aufstellung ohne freien Platz und ohne Gewinnpotenzial heißt jetzt **„Nur
Kadertiefe“**. Und jede Bedarfskarte liefert die Zahlen mit, an denen sie hängt
— den Schwellwert in Liga-Punkten und die Namen, die dagegen gezählt wurden. „1
von 9 SG-fähigen Spielern über Liga-Startniveau“ ist ohne diese beiden Angaben
nicht überprüfbar, und was man nicht überprüfen kann, glaubt man nicht.

**Move-Planung** — Empfehlungen entstehen als *Sequenz*, nicht als Liste
unabhängiger Ideen. Jeder akzeptierte Move schreibt den simulierten Kader fort,
bevor der nächste gewählt wird. Daraus folgen drei Regeln:

- Ziele werden nach *aktueller* Bedarfsschwere gewählt, nicht nach Rohscore
- Aus einer Position mit eigenem Bedarf wird kein Starter gedroppt
- Höchstens zwei Zugänge pro Position, damit eine Position nicht das ganze
  Budget bindet

Kann kein Zugang die Startelf verbessern — der Normalfall in einer tiefen Liga
mit vollem Kader —, folgt eine zweite Stufe für **Kadertiefe**: der schwächste
Spieler, der weder startet noch über Replacement Level liegt, gegen das beste
verfügbare Asset. Diese Moves sind als `kind: "depth"` markiert und behaupten
keinen Aufstellungsgewinn. Ihre gemeinsame Voraussetzung steht **einmal** über
dem Abschnitt (`moves_note`) statt als erster Satz jeder einzelnen Karte.

## Draft-Board

Das Board ist nach **Edge** sortiert — DVS über dem Ersatzniveau der Position,
an der ein Spieler am meisten wert ist. Roher DVS ist positionsübergreifend
nicht vergleichbar, ein Ranking darauf setzt also die tiefste Position nach oben.
Vier Empfehlungen beantworten vier verschiedene Fragen, jede mit ihrer eigenen
Kennzahl: Value (Edge), Bedarf (bester Spieler auf der lautesten Position),
Sofortnutzen (Punkte über Startniveau) und Marktwert (Trade Value). Vorher
rankten „Best Player Available“ und „Best Trade Asset“ beide rohen DVS und
lieferten damit fast immer denselben Spieler zweimal.

Gefiltert und gesucht wird über **`fantasy_positions`**, nicht über die primäre
Position: Sleeper listet SG bei fast niemandem an erster Stelle, weshalb die
Suche nach dem besten SG jeden SG-fähigen Flügelspieler übersprang und auf
einem Namen tausend DVS weiter unten landete. Das Board wird zusätzlich pro
Position aufgefüllt, damit ein Positionsfilter nicht zwei Namen zurückgibt.

**Waiver-Score** — ein eigenes Ranking, nicht identisch mit DVS:

```
Score = (max(0, pts − Replacement) + 0.35·pts + 0.25·DVS)
        × Chance × Marktdruck
        + Marktdruck-Bonus + Chancen-Bonus + Bedarfs-Bonus
```

Verankert an projizierten Punkten **über Replacement Level** — die einzige Zahl,
die sagt, ob ein Zugang überhaupt etwas ausrichten kann. Die Marktterme sind
Modifikatoren darauf, kein Ersatz dafür: ein pauschaler `+160` für Trending
überstieg den kompletten Grundwert eines Randspielers, weshalb das Board sich
mit dem füllte, was gerade heiß war, unabhängig von jeder Prognose.

Trending-Daten werden **live pro Request** geholt und sind damit unabhängig vom
Alter des Spieler-Snapshots.

## Ligenliste

Eine Dynasty-Liga bekommt pro Saison eine neue `league_id` und ist über
`previous_league_id` rückwärts verkettet. „Alle Saisons“ lieferte dieselbe Liga
deshalb dreifach — und jede Liga, die man seit 2024 verlassen hatte, gleich
mit. Ligen, auf die eine andere Liga der Liste zurückzeigt, sind Vorsaisons und
werden entfernt; abgeschlossene Saisons kommen als `archived` markiert zurück
und sind im Dashboard hinter „Archiv einblenden“ erreichbar.

## Setup

```bash
python3 -m venv functions/venv && functions/venv/bin/pip install -r functions/requirements.txt
npm install --prefix frontend
```

Frontend-Umgebung anlegen (`frontend/.env.local`, Vorlage siehe `.env.example`):

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:5001/<project-id>/us-central1
```

Ohne diese Variable kompiliert der statische Build die Localhost-Adresse fest ein.

## CLI

```bash
functions/venv/bin/python assistant.py --username DEIN_NAME --waivers --league_id <LIGA_ID>
```

```bash
functions/venv/bin/python assistant.py --username DEIN_NAME --draft_id <DRAFT_ID> --sport nba
```

```bash
functions/venv/bin/python assistant.py --update --sport nfl
```

## Deployment

Firebase-Projekt einmalig zuordnen (legt `.firebaserc` an):

```bash
firebase use --add
```

Danach bauen und deployen:

```bash
npm run build --prefix frontend && firebase deploy
```

`firebase.json` liefert `frontend/out` aus; `next.config.ts` erzeugt dieses
Verzeichnis über `output: "export"`. Python Cloud Functions sind gen2 und
benötigen den Blaze-Plan.

### Zugriffskontrolle

Die Endpunkte sind öffentlich erreichbar. Zwei Umgebungsvariablen begrenzen das:

| Variable | Wirkung |
|---|---|
| `FSA_ALLOWED_ORIGINS` | Komma-Liste erlaubter Origins für CORS. Ohne Wert: `*` |
| `FSA_REFRESH_TOKEN` | Shared Secret für `update_data`. **Ohne Wert bleibt der Endpunkt geschlossen** (503) |

`update_data` lädt bei jedem Aufruf die komplette Spielerdatenbank plus bis zu 25
ESPN-Requests — ungeschützt ist das eine offene Kostenquelle. Der Endpunkt ist
deshalb fail-closed: kein Token konfiguriert, kein manueller Refresh. Der
geplante Job `refresh_data` ruft den Updater direkt auf und ist davon nicht
betroffen.

Secret setzen (Secret Manager):

```bash
firebase functions:secrets:set FSA_REFRESH_TOKEN
```

`FSA_ALLOWED_ORIGINS` steht in `functions/.env`. Diese Datei ist **gitignored** —
nach einem frischen Clone muss sie aus `functions/.env.example` neu angelegt
werden, sonst fällt die API stillschweigend auf `*` zurück.

Das Frontend bekommt das Secret **nicht** eingebaut — der statische Export wäre
sonst öffentlich lesbar. Der Button fragt den Token beim ersten Klick ab und legt
ihn in `localStorage` dieses Browsers ab.

## Daten

`players.json`, `stats_*.json`, `projections_*.json` und `college_stats.json`
sind bewusst **nicht** eingecheckt (players.json allein ist 16 MB). Sie werden
erzeugt durch:

- die geplante Function `refresh_data` (täglich 06:00 Europe/Berlin), oder
- den Button „Daten aktualisieren“, oder
- `assistant.py --update`

Geschrieben wird über `_write_data`, das in ein beschreibbares Verzeichnis legt
(`/tmp` auf Cloud Run) und zusätzlich nach Cloud Storage spiegelt. Direkt ins
Function-Verzeichnis zu schreiben funktioniert dort nicht — das Dateisystem ist
read-only.

Aktuelle Verletzungsdaten sind für Waiver-Entscheidungen entscheidend: der
`injury_status` ändert sich täglich.
