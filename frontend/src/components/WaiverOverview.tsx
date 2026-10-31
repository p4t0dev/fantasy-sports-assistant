"use client";

import Link from "next/link";
import type { WaiverLeague, WaiverMove, WaiverMoveSide } from "@/lib/types";
import { SwapCard, type SwapSide } from "@/components/PageParts";
import { WeekFixes } from "@/components/WeekFixes";

// The waiver half of the weekly overview: every league's move plan on one
// page, so a Tuesday evening does not mean opening nine waiver boards.

const SKIP_TEXT: Record<string, string> = {
  no_roster: "kein Kader",
  not_in_season: "nicht in der Saison",
  error: "Sleeper nicht erreichbar — beim nächsten Lauf erneut",
};

function side(label: string, s: WaiverMoveSide): SwapSide {
  return {
    label,
    pos: s.pos,
    name: s.name,
    injury: s.injury,
    value: s.per_week?.toFixed(1),
    below: s.team,
  };
}

function Move({ move }: { move: WaiverMove }) {
  const lineup = move.kind === "lineup";
  return (
    <li>
      <SwapCard
        quiet={!lineup}
        gain={`+${(lineup ? move.lineup_gain : move.edge_gain) ?? 0}`}
        unit={lineup ? "Pkt/Wo" : move.edge_unit}
        sides={[side("Add", move.add), ...(move.drop ? [side("Drop", move.drop)] : [])]}
      >
        <details className="text-[11px] text-muted">
          <summary className="cursor-pointer list-none select-none hover:text-ink">
            ▸ Warum?
            {move.faab && (
              <span className="ml-2 font-semibold text-ink-soft">
                {move.faab.min}–{move.faab.max} FAAB
              </span>
            )}
          </summary>
          <p className="mt-1">{move.reason}</p>
        </details>
      </SwapCard>
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
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          <span className="text-ink-soft">{league.profile.label}</span> · {scheduleText(league)}
          {faab?.left != null && (
            <>
              {" · "}
              <span className="text-ink-soft font-medium">
                {faab.left} von {faab.budget} FAAB übrig
              </span>
            </>
          )}
        </span>
        <Link
          href={`/waivers?${linkParams}&league_id=${league.league_id}`}
          className="link"
        >
          Waiver-Seite →
        </Link>
      </div>
      <WeekFixes fixes={league.week_fixes} />
      {league.moves_note && <p className="text-[11px] text-muted">{league.moves_note}</p>}
      {league.moves.length > 0 ? (
        <ul className="space-y-2">
          {league.moves.map((m, i) => (
            <Move key={i} move={m} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Keine sinnvollen Moves gefunden.</p>
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
  const holes = active.filter((l) => l.week_fixes?.length).length;
  return (
    (holes ? `Lückenfüller für diese Woche in ${holes} ${holes === 1 ? "Liga" : "Ligen"} · ` : "") +
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
  // A league with a hole this week is open too: that move is for now.
  const upgrade = active.filter((l) => l.lineup_moves > 0 || l.week_fixes?.length);
  const depth = active.filter((l) => !(l.lineup_moves > 0 || l.week_fixes?.length));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {waiverSummary(leagues)} · Punkte = Prognose Ø pro Woche über die nächsten 5 Wochen
      </p>

      {upgrade.map((league) => (
        <div key={league.league_id} className="panel p-3 sm:p-4 space-y-3">
          <h3 className="font-display font-bold text-xl leading-tight text-ink">{league.name}</h3>
          <LeagueWaivers league={league} linkParams={linkParams} />
        </div>
      ))}

      {depth.map((league) => (
        <details key={league.league_id} className="panel p-3 sm:p-4 group">
          <summary className="cursor-pointer list-none select-none flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-display font-semibold text-lg leading-tight text-ink">
              <span className="text-muted group-open:hidden">▸ </span>
              <span className="text-muted hidden group-open:inline">▾ </span>
              {league.name}
            </span>
            <span className="text-xs text-muted">
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
        <p className="text-xs text-muted">
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
