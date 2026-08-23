"use client";

import type { Need } from "@/lib/types";
import { PosBadge } from "@/components/PlayerBadges";

// The waiver page and the draft page had their own copy of this card, with
// different colours and different fields, so the same roster read differently
// depending on which door you came through.

const SEVERITY_STYLES: Record<number, string> = {
  3: "border-l-red-500 bg-red-900/10",
  2: "border-l-orange-500 bg-orange-900/10",
  1: "border-l-yellow-500 bg-yellow-900/10",
};

const SEVERITY_BADGES: Record<number, string> = {
  3: "bg-red-500/20 text-red-300 border-red-500/40",
  2: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  1: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
};

// Fallback only. The backend names the situation (`need.label`), because
// "Dünn" on four positions in four different states is what made this view
// unreadable: one has an empty slot, one is covered below league level, one
// has nobody for the flex, one is covered with only weak cover behind it.
const SEVERITY_LABELS: Record<number, string> = {
  3: "Kritisch",
  2: "Ungesichert",
  1: "Dünn",
};

export default function NeedCard({ need }: { need: Need }) {
  const tone = SEVERITY_STYLES[need.severity] ?? SEVERITY_STYLES[1];
  const badge = SEVERITY_BADGES[need.severity] ?? SEVERITY_BADGES[1];

  return (
    <div className={`glass-panel p-4 border-l-4 ${tone}`}>
      <div className="flex justify-between items-center gap-2 mb-2">
        <div className="flex items-center gap-2">
          <PosBadge pos={need.pos} className="text-xs px-2 py-1" />
          <span className="font-bold text-white text-lg">{need.pos}</span>
        </div>
        <span
          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${badge}`}
        >
          {need.label ?? SEVERITY_LABELS[need.severity] ?? "Hinweis"}
        </span>
      </div>

      <p className="text-xs text-gray-300 leading-snug">{need.reason}</p>

      {/* The headcount is the half nobody believes on sight — "1 von 9 über
          Liga-Startniveau" invites the question which nine, measured how. Both
          answers are one click away instead of nowhere. */}
      {need.top && need.top.length > 0 && (
        <details className="mt-2 group">
          <summary className="text-[11px] text-blue-300/80 hover:text-blue-300 cursor-pointer list-none select-none">
            <span className="group-open:hidden">▸ Welche Spieler zählen hier?</span>
            <span className="hidden group-open:inline">▾ Deine besten {need.pos}</span>
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {need.top.map((entry) => (
              <li
                key={entry.name}
                className="flex items-baseline justify-between gap-3 text-[11px]"
              >
                <span className={entry.startable ? "text-green-300" : "text-gray-400"}>
                  {entry.startable ? "✓" : "·"} {entry.name}
                </span>
                <span
                  className={`font-mono ${entry.startable ? "text-green-300" : "text-gray-500"}`}
                >
                  {entry.value}
                </span>
              </li>
            ))}
            {need.replacement != null && (
              <li className="flex items-baseline justify-between gap-3 text-[11px] pt-1 border-t border-gray-700/60">
                <span className="text-gray-500">Liga-Startniveau {need.pos}</span>
                <span className="font-mono text-gray-400">{need.replacement}</span>
              </li>
            )}
          </ul>
        </details>
      )}

      <p className="text-[10px] text-gray-500 mt-2">
        {need.startable}/{need.slots} auf Startniveau · {need.depth} im Kader ·{" "}
        {need.fixed_slots} feste Slots
      </p>
    </div>
  );
}
