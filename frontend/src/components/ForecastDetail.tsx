"use client";

import Link from "next/link";
import type { CloseCall, MatchupStance, Player } from "@/lib/types";

// Every forecast on the site can be taken apart right where it is shown.
// A number that says "13.2" and a Sleeper app that says "9.0" is a question
// the page has to answer on the spot - not in a chat log, not in the README.

const PART_TONE = {
  S: { bar: "bg-blue-500", text: "text-blue-300", label: "Sleeper" },
  F: { bar: "bg-emerald-500", text: "text-emerald-300", label: "Form" },
  Q: { bar: "bg-purple-500", text: "text-purple-300", label: "Qualität" },
} as const;

/** "Sleeper 9.0" next to a forecast that differs from it, so every
 *  deviation is visible without opening anything. */
export function ForecastDelta({ player }: { player: Player }) {
  const base = player.pts_week_base;
  const forecast = player.pts_week;
  if (base == null || forecast == null || Math.abs(forecast - base) < 0.5) return null;
  const up = forecast > base;
  return (
    <span
      title="Sleepers eigene Wochenprognose. Die Zahl daneben ist unsere Prognose."
      className={`text-[10px] font-medium ${up ? "text-emerald-400/80" : "text-orange-400/80"}`}
    >
      Sleeper {base.toFixed(1)}
    </span>
  );
}

/** The three estimates the base is blended from, as one bar. */
function WeightBar({ weights }: { weights: { S: number; F: number; Q: number } }) {
  const parts = (["S", "F", "Q"] as const).filter((k) => weights[k] > 0);
  return (
    <div className="space-y-1">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-800">
        {parts.map((k) => (
          <div
            key={k}
            className={PART_TONE[k].bar}
            style={{ width: `${weights[k] * 100}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-[10px]">
        {parts.map((k) => (
          <span key={k} className={PART_TONE[k].text}>
            {PART_TONE[k].label} {Math.round(weights[k] * 100)} %
          </span>
        ))}
      </div>
    </div>
  );
}

/** "Wie kommt die Zahl zustande?" - collapsed by default, one per player. */
export function ForecastDetail({ player }: { player: Player }) {
  const fc = player.forecast;
  if (!fc) return null;
  const weeks = Object.entries(player.usage?.pts_by_week ?? {});
  return (
    <details className="mt-1.5 group/fc">
      <summary className="cursor-pointer list-none select-none text-[11px] text-gray-500 hover:text-gray-300">
        <span className="group-open/fc:hidden">▸</span>
        <span className="hidden group-open/fc:inline">▾</span> Wie kommt die {fc.P.toFixed(1)} zustande?
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-gray-800 bg-gray-900/60 p-3 text-[11px] text-gray-300">
        <WeightBar weights={fc.weights} />
        <ul className="space-y-0.5">
          {fc.explain.map((line, i) => (
            <li
              key={i}
              className={i === fc.explain.length - 1 ? "font-semibold text-white" : ""}
            >
              {line}
            </li>
          ))}
        </ul>
        {weeks.length > 0 && (
          <div className="text-gray-400">
            Echte Punkte:{" "}
            {weeks.map(([w, pts]) => (
              <span key={w} className="mr-2">
                W{w} <span className="text-gray-200">{pts}</span>
              </span>
            ))}
          </div>
        )}
        {weeks.length > 0 && player.usage?.xfp_by_week && (
          <div className="text-gray-400">
            Erwartet aus Nutzung:{" "}
            {Object.entries(player.usage.xfp_by_week)
              .filter(([, x]) => x != null)
              .map(([w, x]) => (
                <span key={w} className="mr-2">
                  W{w} <span className="text-gray-200">{x}</span>
                </span>
              ))}
          </div>
        )}
        {player.usage?.label && <div className="text-gray-500">Nutzung {player.usage.label}</div>}
        <Link href="/prognose" className="inline-block text-blue-400 hover:text-blue-300">
          So funktioniert die Prognose →
        </Link>
      </div>
    </details>
  );
}

/** The number the waiver board ranks by, as a reader should see it.
 *
 *  In season `pts` there is the forecast pace over the horizon (per week ×
 *  17, so it sits on the scale of a season projection). Shown as a season it
 *  read like a projection nobody made; shown per week it is the same number
 *  as on the lineup page. Off-season it is the season projection. */
export function waiverPts(player: Player): { value: string; unit: string } {
  const h = player.horizon;
  if (player.pts_season != null && h?.length) {
    return {
      value: ((player.pts ?? 0) / 17).toFixed(1),
      unit: `Ø W${h[0].week}–${h[h.length - 1].week}`,
    };
  }
  return { value: String(player.pts ?? 0), unit: "Proj" };
}

/** The horizon week by week, with opponents and byes. */
export function HorizonDetail({ player }: { player: Player }) {
  const weeks = player.horizon;
  if (!weeks?.length) return null;
  const total = weeks.reduce((sum, w) => sum + w.pts, 0);
  return (
    <details className="mt-1.5 group/hz">
      <summary className="cursor-pointer list-none select-none text-[11px] text-gray-500 hover:text-gray-300">
        <span className="group-open/hz:hidden">▸</span>
        <span className="hidden group-open/hz:inline">▾</span> Prognose W{weeks[0].week}–
        {weeks[weeks.length - 1].week}: {total.toFixed(1)} Pkt
      </summary>
      <div className="mt-2 rounded-md border border-gray-800 bg-gray-900/60 p-3 text-[11px] text-gray-300 space-y-2">
        <div className="grid grid-cols-5 gap-1 text-center">
          {weeks.map((w) => (
            <div key={w.week} className="rounded bg-gray-800/60 py-1">
              <div className="text-gray-500">W{w.week}</div>
              <div className={w.opp ? "text-white font-medium" : "text-red-300"}>
                {w.opp ? w.pts.toFixed(1) : "Bye"}
              </div>
              <div className="text-gray-500 truncate">{w.opp ? `vs ${w.opp}` : ""}</div>
            </div>
          ))}
        </div>
        {player.pts_season != null && (
          <div className="text-gray-500">
            Zum Vergleich Sleepers Saisonprognose: {(player.pts_season / 17).toFixed(1)} pro Woche
          </div>
        )}
        {player.forecast && (
          <ul className="space-y-0.5 text-gray-400">
            {player.forecast.explain.map((line, i) => (
              <li key={i}>{i === 0 ? `W${weeks[0].week}: ` : ""}{line}</li>
            ))}
          </ul>
        )}
        <Link href="/prognose" className="inline-block text-blue-400 hover:text-blue-300">
          So funktioniert die Prognose →
        </Link>
      </div>
    </details>
  );
}

const STANCE_TEXT: Record<MatchupStance["kind"], string> = {
  favorite: "Favorit — bei knappen Entscheidungen den sicheren Spieler",
  underdog: "Außenseiter — bei knappen Entscheidungen den mit Potenzial",
  even: "offenes Duell — knappe Entscheidungen bleiben Münzwurf",
  chopped: "Chopped — nicht Letzter werden, also immer den sicheren Spieler",
};

/** Your matchup this week, in one line. */
export function MatchupLine({
  stance,
  compact = false,
}: {
  stance?: MatchupStance | null;
  /** Score line only, without the advice sentence. */
  compact?: boolean;
}) {
  if (!stance) return null;
  const tone =
    stance.kind === "favorite" ? "text-emerald-300" : stance.kind === "underdog" ? "text-orange-300" : "text-gray-300";
  return (
    <p className="text-xs text-gray-400">
      {stance.opponent ? (
        <>
          Matchup vs <span className="text-gray-200">{stance.opponent}</span>:{" "}
          <span className="text-gray-200">{stance.my_total}</span> :{" "}
          <span className="text-gray-200">{stance.opp_total}</span>{" "}
          <span className={tone}>
            ({(stance.margin ?? 0) > 0 ? "+" : ""}
            {stance.margin})
          </span>
          {!compact && <> · {STANCE_TEXT[stance.kind]}</>}
        </>
      ) : (
        <span className={tone}>{STANCE_TEXT[stance.kind]}</span>
      )}
    </p>
  );
}

/** Close calls, with the pick the matchup suggests. */
export function CloseCalls({ calls }: { calls?: CloseCall[] }) {
  if (!calls?.length) return null;
  return (
    <ul className="space-y-1 text-xs text-yellow-300/90">
      {calls.map((c, i) => (
        <li key={i}>
          Knapp: {c.in} vs. {c.out} ({c.gap > 0 ? "+" : ""}
          {c.gap} Pkt) —{" "}
          {c.advice ?? "ein Münzwurf, entscheide nach Matchup oder Bauchgefühl."}
        </li>
      ))}
    </ul>
  );
}
