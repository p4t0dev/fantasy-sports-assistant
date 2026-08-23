"use client";

import type { Need } from "@/lib/types";
import { posTone } from "@/lib/positions";

// Every board on this site answers more than one question, so every board gets
// more than one order — and the same controls, so that "sort by projection"
// means the same thing and sits in the same place on the waiver board, the
// drop list and the draft board.

export type SortOption<T> = {
  id: string;
  label: string;
  of: (item: T) => number;
  /** Lowest first. The drop list is a worst-first list: sorting it descending
   *  buries the players it exists to surface. */
  asc?: boolean;
};

export function SortBar<T>({
  options,
  active,
  onPick,
  label = "Sortieren:",
}: {
  options: readonly SortOption<T>[];
  active: string;
  onPick: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-gray-500 mr-1">{label}</span>
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onPick(option.id)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
            active === option.id
              ? "bg-blue-600 text-white border-blue-500"
              : "bg-gray-900 text-gray-400 border-gray-700 hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function sortBy<T>(
  items: T[],
  options: readonly SortOption<T>[],
  id: string
): T[] {
  const sort = options.find((o) => o.id === id) ?? options[0];
  if (!sort) return items;
  const sign = sort.asc ? 1 : -1;
  return [...items].sort((a, b) => sign * (sort.of(a) - sort.of(b)));
}

/** Position filter chips, shared by every player list. */
export function PosFilter({
  positions,
  counts,
  active,
  onPick,
  tone,
  severityByPos,
  needs,
}: {
  positions: string[];
  counts: (pos: string) => number;
  active: string | null;
  onPick: (pos: string | null) => void;
  tone: string;
  severityByPos?: Map<string, number>;
  needs?: Need[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => onPick(null)}
        className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
          active === null ? tone : "bg-gray-900 text-gray-400 border-gray-700 hover:text-white"
        }`}
      >
        Alle
      </button>
      {positions.map((pos) => {
        const severity = severityByPos?.get(pos) ?? 0;
        const isActive = active === pos;
        return (
          <button
            key={pos}
            onClick={() => onPick(isActive ? null : pos)}
            title={severity ? needs?.find((n) => n.pos === pos)?.reason : undefined}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors flex items-center gap-1 ${
              isActive ? tone : `${posTone(pos).chip} hover:brightness-125`
            }`}
          >
            {pos}
            <span className="opacity-60">{counts(pos)}</span>
            {severity >= 2 && (
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  severity >= 3 ? "bg-red-500" : "bg-orange-400"
                }`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
