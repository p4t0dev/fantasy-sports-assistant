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
- `functions/projections.py` — Saison- und Wochenprognosen (forward-looking
  Produktionsterm, Spielplan, Bye-Wochen)
- `functions/signals.py` — Signal-Layer: Verletzungsstatus, Depth-Chart-Chancen,
  Trending-Adds/Drops, Liga-Transaktionen
- `functions/api_core.py` — Datenschicht, Scoring-Modell (RVS/DVS), Waiver- und
  Draft-Analyse
- `functions/lineup.py` — Slot-Zuordnung (optimale Aufstellung) und Bedarfsanalyse
- `functions/main.py` — HTTP-Endpunkte + Datenrefresh dreimal täglich

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

**Wochenpunkte (`pts_week`)** — die Prognose für *diese* Woche, im Scoring der
Liga. Während der Saison ist das die Währung der Aufstellung, nicht `pts`: eine
Aufstellung wird für ein Spiel gesetzt, und nach Saisonpunkten gerankt startete
ein Spieler im Bye vor einem gesunden. Gegner und Bye-Wochen kommen aus
denselben Wochenzeilen — ein Team, dessen Zeilen keinen Gegner tragen, hat
Bye (Backups mit leeren Stats haben nie einen, daher zählt „irgendeine Zeile
mit Gegner“, nicht „irgendeine Zeile“). `Out`/IR ergibt 0, `Doubtful` wird
abgeschlagen, `Questionable` **nicht**: die meisten spielen, und ob dieser
spielt, steht vor dem Kickoff fest. Der 20-%-Saisonabschlag bänkte Joe Burrow
für Tyler Shough; jetzt ist `Questionable` ein Hinweis im Aufstellungs-Check.

**Wochenprognose (`forecast`)** — `pts_week` ist nicht mehr Sleepers Zahl,
sondern `P = B × K × A` aus `functions/forecast.py`:

```
B = g_S·S + g_F·F + g_Q·Q     Sleeper-Woche, Form (Ø letzte 4 Spiele), Qualität
K = R × M × W  ∈ [0.75, 1.25] Rolle, Matchup (Gegner + Vegas), Wetter
A                              Verfügbarkeit (Out 0, Doubtful abgeschlagen)
```

Die Gewichte sind **gemessen**: `tools/backtest_forecast.py` rechnet die
Saison 2025 Woche für Woche nur mit dem, was vor dem Spiel bekannt war,
fittet auf den Wochen 3–10 die Paar-Entscheidungen („von zwei Spielern, die
Sleeper ≤ 5 Punkte trennt, wer liegt vorn?“) und prüft auf 11–18. Schlägt
das Modell Sleeper dort nicht, gilt für die Position Sleeper allein — Stand
2025: Modell bei IDP, TE, RB; Sleeper bei QB, WR, K, DEF; Rolle β = 0
überall. Ergebnis in `functions/data/forecast_params.json`, neu fitten mit

```bash
python3 tools/backtest_forecast.py --league_id <ID> --fit --out functions/data/forecast_params.json
```

Jeder Faktor liefert seinen Erklärsatz mit; die App zeigt ihn unter jedem
Spieler, `pts_week_base` ist Sleepers Zahl zum Vergleich, und `/prognose`
erklärt das Modell aus dem Endpunkt `forecast_model` — also immer das, das
gerade rechnet. Fehlt Sleepers Wochenzeile für einen gesunden Spieler, dessen
Team spielt, rechnet die Basis aus Form und Qualität statt mit 0.

Daten: Box-Scores aller gespielten Wochen (`stats_nfl_<saison>_weekly.json`,
alle Positionen, mit Gegner), Wetter von Open-Meteo (mittlerer Wind und
stärkster Niederschlag im Spielfenster, Dach = kein Wetter) und Vegas-Linien
von The Odds API (`gameday_nfl_<saison>_w<woche>.json`). Die Nutzungsdaten
(`functions/usage.py`: Snaps, Rang in der Positionsgruppe, „WR3 → WR2“)
stehen als Information beim Spieler.

**Gesperrte Spieler** — ist das Spiel eines Spielers vorbei (Spieldatum vor
heute, US-Zeit), bleibt er, wo er ist: ein Starter behält Platz und Punkte, ein
Bankspieler kann nicht mehr rein. Optimiert wird nur der Rest. Eine
Verletzungsmeldung nach seinem Spiel betrifft die kommenden Wochen, nicht
diese.

**Horizont (`pts_horizon`)** — Summe über diese und die nächsten vier Wochen
(`WEEK_HORIZON`), inklusive Bye-Wochen. Grundlage für die Waiver-Bewertung im
nächsten Schritt.

**Historie** — die Saison in Arbeit belegt keinen Recency-Platz, sondern geht
als Tempo (Punkte pro Spiel × 17) mit dem Anteil einer Saison ein, den der
Spieler gespielt hat. Vorher nahm sie den obersten Platz ein — als
Saison*summe*: eine Woche nach Saisonstart stand ein Ein-Spiel-Wert mit
Gewicht 1.0 neben vollen Saisons und halbierte die Historie aller, die gespielt
hatten (Drake Maye 294.8 → 150.8), während Verletzte ihren vollen Wert
behielten. Ohne abgeschlossene Saison (Rookies) zählt, was bisher tatsächlich
erzielt wurde — ein starkes Spiel hochgerechnet wäre eine Monstersaison.

**Kicker und DEF** werden wie bei Sleeper als Skalarprodukt aus Stat- und
Scoring-Keys gewertet, jede Position nur über ihre eigenen Keys. Beide liefen
vorher durch den Offense-Scorer, der kein `fgm_*` und kein `pts_allow_*` kennt
— jeder Kicker stand bei 0.0.

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

## Wochenübersicht

`/overview` zeigt den **Aufstellungs-Check über alle Ligen** der laufenden
Saison: pro Liga die aktuelle Aufstellung gegen die beste noch mögliche, und
was daran nicht stimmt — leere Slots, Starter mit Bye oder `Out` (Stufe 3),
`Doubtful` oder ≥ 5 Punkte auf der Bank (Stufe 2), `Questionable` oder
1.5–5 Punkte (Stufe 1). Best-Ball-Ligen werden übersprungen, dort stellt
Sleeper selbst auf.

Rein/Raus werden zuerst im selben Slot gepaart — Kicker gegen Kicker — und erst
danach über Positionen hinweg. Nach Wert allein gepaart las sich ein
Kicker-Tausch als „starte den 7-Punkte-Kicker statt des 14-Punkte-RB“.

Die Übersicht ist ein **Snapshot**, nie eine Live-Berechnung: alle Ligen durch
das volle Modell dauern für einen Seitenaufruf zu lange, und die Antwort ändert
sich nur mit neuen Prognosen und Meldungen. `refresh_data` baut sie um 06:00,
12:00 und 18:00 (Europe/Berlin) für jeden Username in `FSA_SNAPSHOT_USERS` neu;
`get_overview` liefert nur, was gespeichert ist. Gelesen wird direkt aus Cloud
Storage statt über `load_json`, das eine Datei einmal pro Container zieht und
danach die lokale Kopie ausliefert — für einen Snapshot, der dreimal am Tag in
einem anderen Container entsteht, hieße das: veraltet bis zum Neustart.

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
functions/venv/bin/python assistant.py --username DEIN_NAME --overview
```

```bash
functions/venv/bin/python assistant.py --update --sport nfl
```

Lokal gegen den Functions-Emulator (die Frontend-Fallback-URL zeigt auf
`demo-no-project`):

```bash
firebase emulators:start --only functions --project demo-no-project
```

## Deployment

Firebase-Projekt einmalig zuordnen (legt `.firebaserc` an):

```bash
firebase use --add
```

Danach bauen und deployen — mit einem Befehl, der auch das Secret
`ODDS_API_KEY` anlegt, falls es fehlt, und vorher die Tests laufen lässt:

```bash
tools/deploy.sh
```

### Version

Schema `0.<PR>.<Patch>`: die mittlere Zahl ist der Pull Request, der die
Version ausgeliefert hat (`frontend/package.json`, Übersicht in
`CHANGELOG.md`). Der Footer jeder Seite zeigt Version, PR-Link und Commit.
Jeder PR, der ausgeliefert wird, setzt die Version auf seine Nummer.

`firebase.json` liefert `frontend/out` aus; `next.config.ts` erzeugt dieses
Verzeichnis über `output: "export"`. Python Cloud Functions sind gen2 und
benötigen den Blaze-Plan.

### Zugriffskontrolle

Die Endpunkte sind öffentlich erreichbar. Drei Umgebungsvariablen begrenzen das:

| Variable | Wirkung |
|---|---|
| `FSA_ALLOWED_ORIGINS` | Komma-Liste erlaubter Origins für CORS. Ohne Wert: `*` |
| `FSA_REFRESH_TOKEN` | Shared Secret für `update_data`. **Ohne Wert bleibt der Endpunkt geschlossen** (503) |
| `FSA_SNAPSHOT_USERS` | Komma-Liste von Sleeper-Usernames, deren Wochenübersicht berechnet wird. Ohne Wert gibt es keine Übersicht |

`update_data` lädt bei jedem Aufruf die komplette Spielerdatenbank plus bis zu 25
ESPN-Requests — ungeschützt ist das eine offene Kostenquelle. Der Endpunkt ist
deshalb fail-closed: kein Token konfiguriert, kein manueller Refresh. Der
geplante Job `refresh_data` ruft den Updater direkt auf und ist davon nicht
betroffen.

Secret setzen (Secret Manager):

```bash
firebase functions:secrets:set FSA_REFRESH_TOKEN
```

`FSA_SNAPSHOT_USERS` ist Opt-in per Konfiguration statt „beim ersten Aufruf“:
eine Übersicht rechnet jede Liga eines Users durchs volle Modell, und ein
öffentlicher Endpunkt, der das für jeden übergebenen Namen täte, wäre dieselbe
offene Kostenquelle. Der Button „Daten aktualisieren“ baut die Übersichten nach
dem Refresh ebenfalls neu.

`ODDS_API_KEY` (The Odds API, für die Vegas-Linien) ist ein Secret und muss
**vor dem Deploy** existieren, sonst schlägt der Deploy fehl:

```bash
firebase functions:secrets:set ODDS_API_KEY
```

Ohne Linien rechnet das Matchup nur mit den erlaubten Punkten des Gegners.

`FSA_ALLOWED_ORIGINS` und `FSA_SNAPSHOT_USERS` stehen in `functions/.env`. Diese Datei ist **gitignored** —
nach einem frischen Clone muss sie aus `functions/.env.example` neu angelegt
werden, sonst fällt die API stillschweigend auf `*` zurück.

Das Frontend bekommt das Secret **nicht** eingebaut — der statische Export wäre
sonst öffentlich lesbar. Der Button fragt den Token beim ersten Klick ab und legt
ihn in `localStorage` dieses Browsers ab.

## Daten

`players.json`, `stats_*.json`, `projections_*.json` (Saison und Wochenfenster),
`college_stats.json` und die Übersichten `overview_*.json` sind bewusst **nicht**
eingecheckt (players.json allein ist 16 MB). Sie werden erzeugt durch:

- die geplante Function `refresh_data` (NFL um 06:00, 12:00 und 18:00, NBA um
  06:00, Europe/Berlin), oder
- den Button „Daten aktualisieren“, oder
- `assistant.py --update`

Geschrieben wird über `_write_data`, das in ein beschreibbares Verzeichnis legt
(`/tmp` auf Cloud Run) und zusätzlich nach Cloud Storage spiegelt. Direkt ins
Function-Verzeichnis zu schreiben funktioniert dort nicht — das Dateisystem ist
read-only.

Aktuelle Verletzungsdaten sind für Waiver-Entscheidungen entscheidend: der
`injury_status` ändert sich täglich.
