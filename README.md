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
- `functions/signals.py` — Signal-Layer: Verletzungsstatus, Depth-Chart-Chancen,
  Trending-Adds/Drops, Liga-Transaktionen
- `functions/api_core.py` — Datenschicht, Scoring-Modell (RVS/DVS), Waiver- und
  Draft-Analyse
- `functions/main.py` — HTTP-Endpunkte + täglicher Datenrefresh

## Bewertungsmodell

**RVS (Redraft Value Score)** — Wert für die *laufende* Saison.
Produktion × Positionsnormalisierung × Rolle × Team × kurzfristige Verfügbarkeit.

**DVS (Dynasty Value Score)** — langfristiger Assetwert:

```
DVS = (Produktion + Marktwert + Prospect-Wert) × Alterskurve × Verfügbarkeit
```

Additive und multiplikative Anteile sind bewusst getrennt: ein kurzfristiger
Ausfall darf den Marktwert eines Spielers nicht skalieren.

**Replacement Level** — je Position der Wert des letzten Spielers, der in dieser
Liga noch irgendwo starten würde (`Teams × Starterplätze`-ter bester Spieler auf
der Position). Erst dadurch wird ein DB mit einem WR vergleichbar.

**Move-Planung** — Empfehlungen entstehen als *Sequenz*, nicht als Liste
unabhängiger Ideen. Jeder akzeptierte Move schreibt den simulierten Kader fort,
bevor der nächste gewählt wird. Daraus folgen drei Regeln:

- Ziele werden nach *aktueller* Bedarfsschwere gewählt, nicht nach Rohscore
- Aus einer Position mit eigenem Bedarf wird kein Starter gedroppt
- Höchstens zwei Zugänge pro Position, damit eine Position nicht das ganze
  Budget bindet

**Waiver-Score** — ein eigenes Ranking, nicht identisch mit DVS:

```
Score = (0.6·RVS + 0.4·DVS) × Chance × Marktdruck
        + Marktdruck-Bonus + Chancen-Bonus + Bedarfs-Bonus
```

Trending-Daten werden **live pro Request** geholt und sind damit unabhängig vom
Alter des Spieler-Snapshots.

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

`players.json`, `stats_*.json` und `college_stats.json` sind bewusst **nicht**
eingecheckt (players.json allein ist 16 MB). Sie werden erzeugt durch:

- die geplante Function `refresh_data` (täglich 06:00 Europe/Berlin), oder
- den Button „Daten aktualisieren“, oder
- `assistant.py --update`

Geschrieben wird über `_write_data`, das in ein beschreibbares Verzeichnis legt
(`/tmp` auf Cloud Run) und zusätzlich nach Cloud Storage spiegelt. Direkt ins
Function-Verzeichnis zu schreiben funktioniert dort nicht — das Dateisystem ist
read-only.

Aktuelle Verletzungsdaten sind für Waiver-Entscheidungen entscheidend: der
`injury_status` ändert sich täglich.
