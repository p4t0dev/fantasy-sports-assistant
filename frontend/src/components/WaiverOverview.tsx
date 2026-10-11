"use client";

import Link from "next/link";
import type { WaiverLeague, WaiverMove, WaiverMoveSide } from "@/lib/types";
import { InjuryBadge, PosBadge } from "@/components/PlayerBadges";

// The waiver half of the weekly overview: every league's move plan on one
// page, so a Tuesday evening does not mean opening nine waiver boards.

const SKIP_TEXT: Record<string, string> = {
  no_roster: "kein Kader",
  not_in_season: "nicht in der Saison",
  error: "Sleeper nicht erreichbar — beim nächsten Lauf erneut",
};

function Side({ side, tone }: { side: WaiverMoveSide; tone: string }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
      <PosBadge pos={side.pos} />
      <span className={`${tone} truncate`}>{side.name}</span>
      <span className="text-[10px] text-gray-500">{side.team}</span>
      <InjuryBadge injury={side.injury} />
      {side.per_week != null && (
        <span className="text-[11px] text-gray-400">{side.per_week.toFixed(1)}/Wo</span>
      )}
    </span>
  );
}

function Move({ move }: { move: WaiverMove }) {
  const lineup = move.kind === "lineup";
  return (
    <li className="rounded-md border border-gray-800 bg-gray-900/50 p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
            lineup
              ? "text-green-300 border-green-700 bg-green-900/30"
              : "text-gray-400 border-gray-700 bg-gray-800/60"
          }`}
        >
          {lineup
            ? `Startelf +${move.lineup_gain ?? 0} Pkt/Wo`
            : `Kadertiefe +${move.edge_gain ?? 0} ${move.edge_unit ?? ""}`}
        </span>
        {move.faab && (
          <span className="text-[11px] text-purple-300">
            {move.faab.min}–{move.faab.max} FAAB
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-green-400 w-9 shrink-0">ADD</span>
          <Side side={move.add} tone="text-white" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-red-400 w-9 shrink-0">DROP</span>
          <Side side={move.drop} tone="text-gray-400" />
        </div>
      </div>
      <details className="text-[11px] text-gray-400">
        <summary className="cursor-pointer list-none select-none hover:text-gray-200">▸ Warum?</summary>
        <p className="mt-1">{move.reason}</p>
      </details>
    </li>
  );
}

function scheduleText(league: WaiverLeague): string {
  const s = league.schedule;
  const kind = s.kind === "faab" ? "FAAB" : "Waiver-Priorität";
  const when = s.daily ? `täglich, Hauptlauf ${s.day ?? "?"}` : s.day ? `${s.day}` : "";
  return [kind, when].filter(Boolean).join(" · ");
}

function LeagueWaivers({ league, linkParams }: { league: WaiverLeague; linkParams: string }) {
  const faab = league.faab;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-gray-400">
        <span>
          <span className="text-gray-300">{league.profile.label}</span> · {scheduleText(league)}
          {faab?.left != null && (
            <>
              {" · "}
              <span className="text-purple-300">
                {faab.left} von {faab.budget} FAAB übrig
              </span>
            </>
          )}
        </span>
        <Link
          href={`/waivers?${linkParams}&league_id=${league.league_id}`}
          className="text-blue-400 hover:text-blue-300 font-medium"
        >
          Waiver-Seite →
        </Link>
      </div>
      {league.moves_note && <p className="text-[11px] text-gray-500">{league.moves_note}</p>}
      {league.moves.length > 0 ? (
        <ul className="space-y-2">
          {league.moves.map((m, i) => (
            <Move key={i} move={m} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">Keine sinnvollen Moves gefunden.</p>
      )}
    </div>
  );
}

/** The waiver plan in one line - shown folded, and over the leagues. */
export function waiverSummary(leagues: WaiverLeague[]): string {
  const active = leagues.filter((l) => !l.skipped);
  const upgrade = active.filter((l) => l.lineup_moves > 0);
  const lineupMoves = upgrade.reduce((n, l) => n + l.lineup_moves, 0);
  const depthMoves = active.reduce((n, l) => n + l.moves.length, 0) - lineupMoves;
  const depthLeagues = active.filter((l) => l.moves.length > l.lineup_moves).length;
  return (
    `${lineupMoves} Startelf-Upgrade${lineupMoves === 1 ? "" : "s"} in ${upgrade.length} ` +
    `${upgrade.length === 1 ? "Liga" : "Ligen"} · ${depthMoves} Kadertiefe-Moves in ${depthLeagues} Ligen`
  );
}

export default function WaiverOverview({
  leagues,
  linkParams,
}: {
  leagues: WaiverLeague[];
  linkParams: string;
}) {
  const active = leagues.filter((l) => !l.skipped);
  const upgrade = active.filter((l) => l.lineup_moves > 0);
  const depth = active.filter((l) => l.lineup_moves === 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        {waiverSummary(leagues)} · Punkte = Prognose Ø pro Woche über die nächsten 5 Wochen
      </p>

      {upgrade.map((league) => (
        <div key={league.league_id} className="glass-panel p-5 border-l-4 border-l-green-500 bg-green-900/5 space-y-3">
          <h3 className="text-lg font-bold text-white">{league.name}</h3>
          <LeagueWaivers league={league} linkParams={linkParams} />
        </div>
      ))}

      {depth.map((league) => (
        <details key={league.league_id} className="glass-panel p-4 group">
          <summary className="cursor-pointer list-none select-none flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-white font-medium">
              <span className="text-gray-500 group-open:hidden">▸ </span>
              <span className="text-gray-500 hidden group-open:inline">▾ </span>
              {league.name}
            </span>
            <span className="text-xs text-gray-500">
              {league.moves.length ? `${league.moves.length} Kadertiefe-Moves` : "nichts zu tun"}
              {league.faab?.left != null ? ` · ${league.faab.left} FAAB` : ""}
            </span>
          </summary>
          <div className="mt-3">
            <LeagueWaivers league={league} linkParams={linkParams} />
          </div>
        </details>
      ))}

      {leagues.some((l) => l.skipped) && (
        <p className="text-xs text-gray-500">
          Ohne Waiver-Plan:{" "}
          {leagues
            .filter((l) => l.skipped)
            .map((l) => `${l.name} (${SKIP_TEXT[l.skipped ?? ""] ?? l.skipped})`)
            .join(", ")}
        </p>
      )}
    </div>
  );
}
