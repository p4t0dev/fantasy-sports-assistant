# Changelog

Versionsschema: **`0.<PR>.<Patch>`** — die mittlere Zahl ist die Nummer des
Pull Requests, der die Version ausgeliefert hat. Die Web-App zeigt Version,
PR und Commit unten auf jeder Seite; damit lässt sich jeder Screenshot einem
PR zuordnen. Ein Nachbessern ohne neuen PR erhöht nur den Patch.

| Version | PR | Inhalt |
|---|---|---|
| 0.14.0 | [#14](https://github.com/p4t0dev/fantasy-sports-assistant/pull/14) | Deploy-Workflow grün ohne Konfiguration (vorher rot bei jedem Merge), aktuelle Action-Versionen; zuklappbare Abschnitte auf Aufstellung und Wochenübersicht; ESPN-Ausfälle nicht mehr als „kein College-Profil“ gespeichert, Fehltreffer nach 30 Tagen neu geprüft; Dev-Server über 127.0.0.1; Altlasten entfernt |
| 0.13.0 | [#13](https://github.com/p4t0dev/fantasy-sports-assistant/pull/13) | Dashboard-Box zeigt den Waiver-Stand und verlinkt direkt zu den Waivern; Wochenübersicht zeigt den Waiver-Bereich immer (mit Hinweis, solange der Snapshot älter ist); Sprung zu `#waiver` nach dem Laden |
| 0.12.0 | [#12](https://github.com/p4t0dev/fantasy-sports-assistant/pull/12) | Waiver-Seite: alle Abschnitte zuklappbar (mit Kurzfassung im zugeklappten Zustand, pro Browser gemerkt), Sprungleiste mit „Alle zu/auf“; Startaufstellung in Pkt/Woche statt Saison-Hochrechnung |
| 0.11.0 | [#11](https://github.com/p4t0dev/fantasy-sports-assistant/pull/11) | Waiver-Übersicht über alle Ligen in der Wochenübersicht (Moves, FAAB, Waiver-Tag, Strategie) und in `--overview`; keine Kicker/DEF mehr als Kadertiefe für andere Positionen; Sleeper-Aufrufe wiederholen Netzwerkfehler |
| 0.10.0 | [#10](https://github.com/p4t0dev/fantasy-sports-assistant/pull/10) | Form aus der Nutzung (xFP, per Backtest: IDP 63.6 %, TE 60.6 %, QB); Floor/Ceiling bei knappen Entscheidungen je nach Matchup; Waiver-Strategie je Ligatyp (Dynasty/Keeper/Redraft/Chopped); Positionen nach den Slots der Liga; Deploy per GitHub Actions; Sleeper-State-Cache (Übersicht 7 s statt 14 s) |
| 0.9.0 | [#9](https://github.com/p4t0dev/fantasy-sports-assistant/pull/9) | Waiver auf die Wochenprognose: Bewertung, Ersatzniveau, Bedarf und Moves rechnen mit der Prognose über W+0…W+4 (Bye = 0) statt mit der Saisonprognose, angezeigt pro Woche; Spieler ohne Sleeper-Prognose nur noch mit echten Snaps prognostiziert; Drop-Schutz für kurzfristig Verletzte |
| 0.8.0 | [#8](https://github.com/p4t0dev/fantasy-sports-assistant/pull/8) | Wochenprognose aus Sleeper, Form und Qualität, per Backtest 2025 gewichtet; Matchup, Wetter (Open-Meteo), Vegas (The Odds API); Erklärung pro Spieler und Seite `/prognose`; Box-Scores aller Positionen; DEF-Saisonwerte ×17-Fehler behoben; Versionsanzeige |
| 0.7.0 | [#7](https://github.com/p4t0dev/fantasy-sports-assistant/pull/7) | Wochenprojektionen, Aufstellungs-Check über alle Ligen (`/overview`), Historie- und K/DEF-Fixes |
| 0.6.0 | [#6](https://github.com/p4t0dev/fantasy-sports-assistant/pull/6) | Liga-relative Replacement Levels, Waiver/Lineup/Draft-Ansichten überarbeitet |
| 0.5.0 | [#5](https://github.com/p4t0dev/fantasy-sports-assistant/pull/5) | Kaderbreite je Position auf der Waiver-Seite |
| 0.4.0 | [#4](https://github.com/p4t0dev/fantasy-sports-assistant/pull/4) | Positionsbewusste Depth-Moves |
| 0.3.0 | [#3](https://github.com/p4t0dev/fantasy-sports-assistant/pull/3) | Saisonprojektionen, Bedarfsanalyse ohne Über-Markierung, Ligen-Dedupe |
| 0.2.0 | [#2](https://github.com/p4t0dev/fantasy-sports-assistant/pull/2) | Positions-Eligibility, Lineup-Optimizer |
| 0.1.0 | [#1](https://github.com/p4t0dev/fantasy-sports-assistant/pull/1) | Waiver- und Draft-Engine neu, Live-News, Firebase-Deploy |

Die Versionen 0.1–0.7 sind nachträglich vergeben; die App zeigt eine Version
erst ab 0.8.0.
