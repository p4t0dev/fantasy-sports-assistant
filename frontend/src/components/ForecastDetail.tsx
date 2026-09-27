"use client";

import Link from "next/link";
import type { Player } from "@/lib/types";

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
        {player.usage?.label && <div className="text-gray-500">Nutzung {player.usage.label}</div>}
        <Link href="/prognose" className="inline-block text-blue-400 hover:text-blue-300">
          So funktioniert die Prognose →
        </Link>
      </div>
    </details>
  );
}
