"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { ForecastModel, ForecastParams } from "@/lib/types";
import { PosBadge } from "@/components/PlayerBadges";

// The one place the forecast is explained end to end. Weights, backtest
// numbers and limits come from the `forecast_model` endpoint - the page can
// never describe a model other than the one producing the numbers.

const GROUP_LABEL: Record<string, string> = {
  QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF", IDP: "IDP (DL/LB/DB)",
};

/** Mirrors forecast.weights() in functions/forecast.py. */
function weightsAt(n: number, p: ForecastParams) {
  const f = n ? Math.min(p.cap, n / (n + p.k)) : 0;
  const rest = 1 - f;
  return { S: rest * p.s_share, F: f, Q: rest * (1 - p.s_share) };
}

function pct(x: number) {
  return `${Math.round(x * 100)} %`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass-panel p-5 space-y-3">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <div className="text-sm text-gray-300 leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-gray-800 bg-gray-900/70 p-3 text-[13px] text-blue-200">
      {children}
    </pre>
  );
}

export default function ForecastModelPage() {
  const [model, setModel] = useState<ForecastModel | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiGet<ForecastModel>("forecast_model")
      .then((m) => active && setModel(m))
      .catch((e) => active && setError(e instanceof Error ? e.message : "Fehler"));
    return () => {
      active = false;
    };
  }, []);

  const results = model?.backtest?.results ?? {};
  const groups = Object.keys(model?.params ?? {});
  const limits = model?.limits;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">So entsteht die Prognose</h1>
          <p className="text-gray-400 mt-1">
            Jede Wochenzahl in der App — Aufstellung, Wochenübersicht — kommt aus
            dieser einen Formel. Unter jedem Spieler lässt sich aufklappen, wie
            seine Zahl zustande kommt.
          </p>
        </div>
        <Link
          href="/"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium shrink-0"
        >
          ← Zurück
        </Link>
      </div>

      <Section title="Die Formel">
        <Formula>{`Prognose  P = B × K × A

Basis     B = g_S · S  +  g_F · F  +  g_Q · Q        (g_S + g_F + g_Q = 1)
Korrektur K = R × M × W                               begrenzt auf [${limits?.k_min ?? 0.75}, ${limits?.k_max ?? 1.25}]
A         = Verfügbarkeit`}</Formula>
        <p>
          <strong className="text-white">Erst die Basis:</strong> drei Schätzungen
          derselben Frage — wie viele Punkte macht er in einem Spiel? — werden
          gewichtet gemittelt. <strong className="text-white">Dann die
          Korrekturen:</strong> was die Basis nicht oder zu schwach berücksichtigt,
          jede einzeln gedeckelt. <strong className="text-white">Zuletzt die
          Verfügbarkeit.</strong>
        </p>
        <p>
          Wichtig: Sleepers Prognose enthält Gegner, Depth Chart und Verletzungen
          schon zum Teil. Jeder weitere Faktor darf nur hinzufügen, was Sleeper
          fehlt — sonst zählt er doppelt. Wie viel das ist, wird nicht geschätzt,
          sondern im Backtest gemessen (unten).
        </p>
      </Section>

      <Section title="Die Bausteine">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="py-2 pr-3">Faktor</th>
                <th className="py-2 pr-3">Was er misst</th>
                <th className="py-2">Quelle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800 align-top">
              <tr>
                <td className="py-2 pr-3 text-blue-300 font-bold">S · Sleeper</td>
                <td className="py-2 pr-3">Sleepers Prognose für diese Woche, im Scoring deiner Liga</td>
                <td className="py-2 text-gray-400">Sleeper, 3× täglich</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-emerald-300 font-bold">F · Form</td>
                <td className="py-2 pr-3">
                  Schnitt seiner letzten {model?.form_games ?? 4} Spiele — was er tatsächlich
                  gepunktet hat. Gewicht wächst mit jedem Spiel:{" "}
                  <code className="text-blue-300">g_F = min(cap, n / (n + k))</code>
                </td>
                <td className="py-2 text-gray-400">Box-Scores der gespielten Wochen</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-purple-300 font-bold">Q · Qualität</td>
                <td className="py-2 pr-3">
                  Generelle Klasse: Saisonprognose pro Spiel, gemischt mit dem Schnitt der
                  Vorsaison (je mehr Spiele dahinter, desto mehr Gewicht, max. 50 %)
                </td>
                <td className="py-2 text-gray-400">Sleeper Saisonprognose + Stats Vorjahr</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-white font-bold">R · Rolle</td>
                <td className="py-2 pr-3">
                  Situation im Team: Snap-Anteil-Trend, Rang in der Positionsgruppe
                  (&bdquo;WR3 → WR2&ldquo;), Vertretung vs. echter Aufstieg. Max. ±
                  {pct(limits?.role_max ?? 0.15)}
                </td>
                <td className="py-2 text-gray-400">Box-Scores (Snaps, Targets, Touches)</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-white font-bold">M · Matchup</td>
                <td className="py-2 pr-3">
                  Punkte, die der Gegner dieser Position im Schnitt erlaubt, gegen den
                  Ligaschnitt — früh in der Saison zum Schnitt gezogen (Gewicht{" "}
                  <code className="text-blue-300">
                    Spiele / (Spiele + {limits?.matchup_shrink ?? 6})
                  </code>
                  ). Dazu die Vegas-Erwartung für sein Team (Implied Team Total, Gewicht{" "}
                  {limits?.vegas_weight ?? 0.3}). Max. ±{pct(limits?.matchup_max ?? 0.1)}
                </td>
                <td className="py-2 text-gray-400">Box-Scores, The Odds API</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-white font-bold">W · Wetter</td>
                <td className="py-2 pr-3">
                  Mittlerer Wind und stärkster Regen/Schnee im Spielfenster am Stadion.
                  Unter einem Dach (auch schließbar) immer 1.0. Regeln siehe unten
                </td>
                <td className="py-2 text-gray-400">Open-Meteo</td>
              </tr>
              <tr>
                <td className="py-2 pr-3 text-white font-bold">A · Verfügbarkeit</td>
                <td className="py-2 pr-3">
                  Out/IR = 0, Doubtful abgeschlagen. Questionable ohne Abschlag, aber
                  markiert: vor Kickoff die Inactives prüfen
                </td>
                <td className="py-2 text-gray-400">Sleeper Verletzungsstatus</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          Fehlt Sleepers Wochenprognose für einen gesunden Spieler, dessen Team
          spielt (z. B. sonntags die Defense eines Montagsteams), rechnet die Basis
          aus Form (bis {pct(model?.form_without_s ?? 0.7)}) und Qualität — statt
          mit 0.
        </p>
      </Section>

      <Section title="Gewichte je Position — gemessen, nicht geschätzt">
        <p>
          Die Gewichte stammen aus einem Backtest auf der Saison{" "}
          {model?.backtest?.season ?? "2025"}
          {model?.backtest?.league ? ` (Scoring von ${model.backtest.league})` : ""}: für jede
          Woche wird jeder Faktor nur aus dem berechnet, was <em>vor</em> dem Spiel
          bekannt war, und mit den echten Punkten verglichen. Gefittet auf die
          Wochen 3–10, geprüft auf 11–18. Maßstab ist die Frage, die eine
          Aufstellung stellt: <em>Von zwei Spielern, die Sleeper höchstens 5
          Punkte auseinander sieht — wie oft liegt der Richtige vorn?</em>
        </p>
        <p>
          <strong className="text-white">Regel:</strong> Schlägt das Modell Sleeper
          auf den Prüfwochen nicht, gilt für diese Position Sleeper allein.
        </p>
        {error && <p className="text-red-400 text-xs">Modell nicht geladen: {error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="py-2 pr-3">Pos</th>
                <th className="py-2 pr-3">Basis nach 2 / 4 / 8 Spielen (S · F · Q)</th>
                <th className="py-2 pr-3">Rolle β</th>
                <th className="py-2 pr-3">Matchup α</th>
                <th className="py-2 pr-3">Richtig: Sleeper → Modell</th>
                <th className="py-2">Ergebnis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {groups.map((g) => {
                const p = model!.params[g];
                const r = results[g];
                return (
                  <tr key={g}>
                    <td className="py-2 pr-3">
                      <PosBadge pos={g === "IDP" ? "LB" : g} /> <span className="ml-1">{GROUP_LABEL[g] ?? g}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-300">
                      {[2, 4, 8].map((n) => {
                        const w = weightsAt(n, p);
                        return (
                          <div key={n}>
                            <span className="text-gray-500">{n} Sp.:</span>{" "}
                            <span className="text-blue-300">{pct(w.S)}</span> ·{" "}
                            <span className="text-emerald-300">{pct(w.F)}</span> ·{" "}
                            <span className="text-purple-300">{pct(w.Q)}</span>
                          </div>
                        );
                      })}
                    </td>
                    <td className="py-2 pr-3">{p.beta}</td>
                    <td className="py-2 pr-3">{p.alpha}</td>
                    <td className="py-2 pr-3">
                      {r ? (
                        <>
                          {pct(r.sleeper.pairs)} → <span className="text-white">{pct(r.model.pairs)}</span>
                          <div className="text-gray-500">
                            Fehler {r.sleeper.mae} → {r.model.mae} Pkt · {r.pairs} Paare
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`py-2 ${r?.verdict === "Modell" ? "text-emerald-300" : "text-gray-400"}`}>
                      {r?.verdict ?? "Startwerte"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500">
          Lesehilfe: 50 % richtige Entscheidungen wäre Münzwurf. Knappe Duelle sind
          schwer — Sleeper liegt bei rund 56–61 %. Ein Prozentpunkt mehr heißt: von
          100 knappen Entscheidungen eine mehr richtig. Rolle β = 0 heißt, der
          Faktor hat im Backtest nicht geholfen und ist abgeschaltet; die
          Nutzungsdaten stehen trotzdem als Information beim Spieler.
        </p>
      </Section>

      <Section title="Wetter-Regeln">
        <p>
          Wind ab {model?.weather.wind_strong ?? 24} km/h (15 mph) gilt als stark, ab{" "}
          {model?.weather.wind_severe ?? 40} km/h (25 mph) als Sturm; Regen ab{" "}
          {model?.weather.rain_heavy ?? 2.5} mm/h oder Schnee als Niederschlag.
          Wetter ist <em>nicht</em> im Backtest (historische Stadionwetterdaten
          fehlen) — die Werte sind bewusst vorsichtig.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gray-500 uppercase tracking-wider">
              <tr>
                <th className="py-2 pr-3">Pos</th>
                <th className="py-2 pr-3">Starker Wind</th>
                <th className="py-2 pr-3">Sturm</th>
                <th className="py-2">Regen / Schnee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {Object.entries(model?.weather.effect ?? {}).map(([pos, [strong, severe, rain]]) => (
                <tr key={pos}>
                  <td className="py-1.5 pr-3"><PosBadge pos={pos} /></td>
                  {[strong, severe, rain].map((v, i) => (
                    <td key={i} className={`py-1.5 pr-3 ${v < 0 ? "text-orange-300" : "text-emerald-300"}`}>
                      {v > 0 ? "+" : "−"}{Math.abs(Math.round(v * 100))} %
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Von der Prognose zur Empfehlung">
        <ol className="list-decimal list-inside space-y-1.5">
          <li>Jeder Spieler deines Kaders bekommt seine Prognose P.</li>
          <li>
            Die Aufstellung wird so besetzt, dass die <strong className="text-white">Summe
            aller P maximal</strong> ist — über alle Slots gleichzeitig, inklusive FLEX und
            SUPERFLEX. Das Ergebnis ist mathematisch optimal.
          </li>
          <li>
            Wer schon gespielt hat (🔒), bleibt, wo er ist. Optimiert wird nur der Rest.
          </li>
          <li>
            Die Differenz zu deiner aktuellen Aufstellung wird als Rein/Raus gezeigt.
            Trennen zwei Spieler weniger als {limits?.close_call ?? 1.5} Punkte, steht
            dort <span className="text-yellow-300">&bdquo;Knapp&ldquo;</span>: die Prognose
            kann das nicht verlässlich entscheiden, dein Wissen schon.
          </li>
          <li>
            Starter, bei denen unsere Prognose deutlich von Sleeper abweicht, sind in der
            Wochenübersicht mit Begründung gelistet.
          </li>
        </ol>
      </Section>

      <Section title="Was (noch) nicht drin ist">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong className="text-white">Trainingsbeteiligung</strong> — Sleeper liefert
            sie praktisch nie (1 von 12.000 Spielern).
          </li>
          <li>
            <strong className="text-white">Game Script aus dem Spread</strong> — nur indirekt
            über das Implied Team Total.
          </li>
          <li>
            <strong className="text-white">Erwartete Punkte aus der Nutzung</strong>{" "}
            (Targets, Red-Zone-Touches) als stabilere Form — geplant.
          </li>
          <li>
            <strong className="text-white">Floor/Ceiling je nach deinem Matchup</strong> in
            der Liga — geplant.
          </li>
        </ul>
        <p className="text-xs text-gray-500">
          Neu fitten: <code className="text-blue-300">python3 tools/backtest_forecast.py
          --league_id &lt;ID&gt; --fit --out functions/data/forecast_params.json</code>
        </p>
      </Section>
    </div>
  );
}
