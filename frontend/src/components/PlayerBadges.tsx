"use client";

import type { Player, Injury } from "@/lib/types";
import { posTone, slotTone, slotLabel, slotShort } from "@/lib/positions";

// These badges are the "why" behind every number on the site. They used to live
// inline in the waiver page and were duplicated, in a reduced form, in the
// lineup page - so a drop candidate and a bench player showed nothing at all
// while a waiver target explained itself. One definition, used everywhere.

export function InjuryBadge({ injury, short = false }: { injury?: Injury | null; short?: boolean }) {
  if (!injury?.status) return null;
  const critical = injury.severity >= 3;
  return (
    <span
      title={injury.label ?? injury.status}
      className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border shrink-0 font-sans not-italic ${
        critical
          ? "bg-red-900/40 text-red-300 border-red-700"
          : "bg-yellow-900/40 text-yellow-300 border-yellow-700"
      }`}
    >
      {short && injury.status.length > 3 ? injury.status[0] : injury.status}
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
          : "bg-raised text-muted border-line"
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
// update. Where ESPN has a headline on him it is shown instead; otherwise the
// timestamp still says that something happened to him.
const NEWS_FRESH_DAYS = 3;

function ago(days: number): string {
  return days === 0 ? "heute" : days === 1 ? "gestern" : `vor ${days} Tagen`;
}

export function NewsBadge({ player }: { player: Player }) {
  if (player.news) {
    return (
      <span
        title={player.news.headline}
        className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-sky-900/40 text-sky-200 border border-sky-700 max-w-full truncate"
      >
        ✎ {ago(player.news.days)}: {player.news.headline}
      </span>
    );
  }
  const days = player.news_days;
  if (days == null || days > NEWS_FRESH_DAYS) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-sky-900/40 text-sky-200 border border-sky-700">
      ✎ News {ago(days)}
    </span>
  );
}

/** His quarterback is out: why his forecast and his trend fell. */
export function ContextBadge({ player }: { player: Player }) {
  const c = player.context;
  if (!c) return null;
  return (
    <span
      title={c.news?.headline ?? undefined}
      className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-900/40 text-amber-200 border border-amber-700 max-w-full truncate"
    >
      ⚠ QB fällt aus: {c.name} ({c.status})
      {c.news ? ` — ${c.news.headline}` : ""}
    </span>
  );
}

/** Every signal we hold on a player, in one row. */
export function SignalBadges({ player }: { player: Player }) {
  const fresh =
    !!player.news || (player.news_days != null && player.news_days <= NEWS_FRESH_DAYS);
  if (!player.trend?.label && !player.opportunity?.label && !fresh && !player.context) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      <ContextBadge player={player} />
      <TrendBadge player={player} />
      <OpportunityBadge player={player} />
      <NewsBadge player={player} />
    </div>
  );
}

/** The number a lineup is built from: this week's projection in season, the
 *  season projection when there is no weekly one. Never mixed - the backend
 *  sends weekly numbers for every player or for none. */
export function startPts(player: Player): number {
  return player.pts_week ?? player.pts;
}

const TIER_TONE = {
  hard: { chip: "bg-tier-hard text-white", label: "schwerer Gegner für seine Position" },
  ok: { chip: "bg-tier-ok text-[#1a1400]", label: "mittlerer Gegner für seine Position" },
  easy: { chip: "bg-tier-easy text-[#06281a]", label: "leichter Gegner für seine Position" },
} as const;

const NEUTRAL_CHIP = "bg-raised text-ink-soft";

/** The opponents in the legend's order, for whoever draws the legend. */
export const TIER_LEGEND = [
  { label: "schwer", chip: TIER_TONE.hard.chip },
  { label: "okay", chip: TIER_TONE.ok.chip },
  { label: "leicht", chip: TIER_TONE.easy.chip },
];

/** NBA Lock-In: this game is worth locking. */
export function LockBadge({ player }: { player: Player }) {
  if (!player.lock || player.lock.final || !player.lock.lock) return null;
  return (
    <span
      title={`Letztes Spiel ${player.lock.score} Pkt — mehr, als sein Platz ohne Lock noch bringt (${player.lock.open ?? player.lock.rest}). Einlocken, falls nicht schon geschehen.`}
      className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border bg-emerald-900/40 text-emerald-300 border-emerald-700"
    >
      Einlocken
    </span>
  );
}

/** The opponent column: who he plays, coloured by how hard that is for his
 *  position - or why there is no opponent to name. */
export function OppChip({ player }: { player: Player }) {
  const base = "block py-1 text-center text-[13px] font-bold leading-tight";
  if (player.locked) {
    return <span title="Sein Spiel ist vorbei — er kann weder rein noch raus." className={`${base} ${NEUTRAL_CHIP}`}>🔒</span>;
  }
  if (player.bye) return <span className={`${base} ${NEUTRAL_CHIP}`}>Bye</span>;
  if (player.games_week != null) {
    return (
      <span
        title={player.opp ? `vs ${player.opp.split("/").join(", ")}` : undefined}
        className={`${base} ${NEUTRAL_CHIP}`}
      >
        {player.games_week} Sp.
      </span>
    );
  }
  if (!player.opp) return <span className={`${base} text-muted`}>–</span>;
  const tier = player.opp_tier ? TIER_TONE[player.opp_tier] : null;
  return (
    <span title={tier?.label} className={`${base} ${tier?.chip ?? NEUTRAL_CHIP}`}>
      {player.opp}
    </span>
  );
}

/** Who he plays this week - or why he will not play for you. */
export function MatchupBadge({ player }: { player: Player }) {
  if (player.locked) {
    return (
      <span
        title="Sein Spiel ist vorbei — er kann weder rein noch raus."
        className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border bg-raised text-muted border-line"
      >
        🔒 gespielt
      </span>
    );
  }
  if (player.bye) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase border bg-red-900/40 text-red-300 border-red-700">
        Bye
      </span>
    );
  }
  if (player.games_week != null) {
    // NBA: one game per starter counts, so the number of chances is what
    // matters - the opponents are in the tooltip.
    return (
      <span className="flex items-center gap-1">
        <span title={player.opp ? `vs ${player.opp.split("/").join(", ")}` : undefined}
              className="text-[10px] text-muted font-medium">
          {player.games_week} {player.games_week === 1 ? "Spiel" : "Spiele"}
        </span>
        <LockBadge player={player} />
      </span>
    );
  }
  if (!player.opp) return null;
  const tier = player.opp_tier ? TIER_TONE[player.opp_tier] : null;
  if (!tier) return <span className="text-[10px] text-muted font-medium">vs {player.opp}</span>;
  return (
    <span title={tier.label} className={`text-[10px] px-1 font-bold ${tier.chip}`}>
      vs {player.opp}
    </span>
  );
}

/** Projected season points — the number the lineup is actually built from. */
export function PointsPill({ player, label = "PROJ" }: { player: Player; label?: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-sm font-bold text-ink">{player.pts}</span>
      <span className="text-[10px] text-muted uppercase tracking-wider">{label}</span>
    </div>
  );
}

export function PosChip({ pos }: { pos: string }) {
  return (
    <div
      className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-bold text-xs border ${posTone(pos).chip}`}
    >
      {pos}
    </div>
  );
}

/** The position, in front of the name, in the position's colour.

    Used on every list that names players. A change list reading "Rein: Bijan
    Robinson · Raus: Brock Bowers" asks the reader to remember what those two
    play before the swap means anything. */
export function PosBadge({ pos, className = "" }: { pos?: string | null; className?: string }) {
  if (!pos) return null;
  return (
    <span
      className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide border shrink-0 ${posTone(pos).chip} ${className}`}
    >
      {pos}
    </span>
  );
}

/** Every position a player may be slotted at, primary first. */
export function EligBadges({ player }: { player: Player }) {
  const positions = player.elig?.length ? player.elig : [player.pos];
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {positions.map((pos) => (
        <PosBadge key={pos} pos={pos} />
      ))}
    </span>
  );
}

/** A roster seat. Wider than a position badge because the label can read
    "WR/RB FLEX", and coloured by the slot rather than by whoever sits in it.
    `compact` fits a table column; `highlight` says: this seat changes. */
export function SlotBadge({
  slot,
  accepts,
  compact = false,
  highlight = false,
}: {
  slot: string;
  accepts?: string[];
  compact?: boolean;
  highlight?: boolean;
}) {
  const tone = highlight ? "bg-highlight text-on-highlight border-transparent" : slotTone(slot).chip;
  return (
    <div
      title={accepts?.join(", ")}
      className={`shrink-0 text-center border -skew-x-10 font-display font-bold ${tone} ${
        compact ? "py-0.5 text-base leading-tight" : "w-20 sm:w-24 py-1 text-[13px]"
      }`}
    >
      {compact ? slotShort(slot) : slotLabel(slot)}
    </div>
  );
}
