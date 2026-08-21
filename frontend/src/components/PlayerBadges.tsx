"use client";

import type { Player, Injury } from "@/lib/types";

// These badges are the "why" behind every number on the site. They used to live
// inline in the waiver page and were duplicated, in a reduced form, in the
// lineup page - so a drop candidate and a bench player showed nothing at all
// while a waiver target explained itself. One definition, used everywhere.

export function InjuryBadge({ injury }: { injury?: Injury | null }) {
  if (!injury?.status) return null;
  const critical = injury.severity >= 3;
  return (
    <span
      title={injury.label ?? undefined}
      className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border ${
        critical
          ? "bg-red-900/40 text-red-300 border-red-700"
          : "bg-yellow-900/40 text-yellow-300 border-yellow-700"
      }`}
    >
      {injury.status}
    </span>
  );
}

export function TrendBadge({ player }: { player: Player }) {
  if (!player.trend?.label) return null;
  const rising = (player.trend.net ?? 0) >= 0;
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${
        rising
          ? "bg-emerald-900/40 text-emerald-300 border-emerald-700"
          : "bg-gray-800 text-gray-400 border-gray-700"
      }`}
    >
      {rising ? "▲" : "▼"} {player.trend.label}
    </span>
  );
}

export function OpportunityBadge({ player }: { player: Player }) {
  if (!player.opportunity?.label) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-indigo-900/40 text-indigo-200 border border-indigo-700">
      ↑ {player.opportunity.label}
    </span>
  );
}

// Sleeper's public API exposes no news text, only the timestamp of the last
// update — so recency is the entire news signal available, and it is worth
// showing: a player Sleeper touched today is a player something happened to.
const NEWS_FRESH_DAYS = 3;

export function NewsBadge({ player }: { player: Player }) {
  const days = player.news_days;
  if (days == null || days > NEWS_FRESH_DAYS) return null;
  const text = days === 0 ? "News heute" : days === 1 ? "News gestern" : `News vor ${days} Tagen`;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-sky-900/40 text-sky-200 border border-sky-700">
      ✎ {text}
    </span>
  );
}

/** Every signal we hold on a player, in one row. */
export function SignalBadges({ player }: { player: Player }) {
  const fresh = player.news_days != null && player.news_days <= NEWS_FRESH_DAYS;
  if (!player.trend?.label && !player.opportunity?.label && !fresh) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      <TrendBadge player={player} />
      <OpportunityBadge player={player} />
      <NewsBadge player={player} />
    </div>
  );
}

/** Projected season points — the number the lineup is actually built from. */
export function PointsPill({ player, label = "PROJ" }: { player: Player; label?: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-sm font-bold text-blue-300">{player.pts}</span>
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}

export function PosChip({ pos }: { pos: string }) {
  return (
    <div className="w-10 h-10 shrink-0 rounded-full bg-gray-800 flex items-center justify-center font-bold text-gray-300 text-xs border border-gray-700">
      {pos}
    </div>
  );
}
