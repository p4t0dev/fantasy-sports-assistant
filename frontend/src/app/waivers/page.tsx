"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type {
  Player,
  Need,
  Faab,
  LineupSlot,
  RosterDepth,
  LeagueInfo,
} from "@/lib/types";
import {
  InjuryBadge,
  TrendBadge,
  SignalBadges,
  PosChip,
  PosBadge,
  EligBadges,
  SlotBadge,
} from "@/components/PlayerBadges";
import NeedCard from "@/components/NeedCard";
import { PosFilter, SortBar, sortBy, type SortOption } from "@/components/Controls";

type Balance = {
  pos_in: string;
  pos_out: string | null;
  lineup_gain: number;
  dvs_gain?: number;
  /** Dynasty gap measured above each position's replacement level — the number
   *  the depth engine actually decides on. Raw DVS is not comparable across
   *  positions. */
  edge_gain?: number;
  starts: boolean;
  empty_slots: string[];
};

type WaiverData = {
  league?: LeagueInfo;
  /** True for the whole move section, so it is stated once above the cards
   *  instead of opening every one of them. */
  moves_note?: string | null;
  drop_candidates: Player[];
  waiver_targets: Player[];
  smart_recommendations: {
    kind: "lineup" | "depth";
    drop: Player;
    add: Player;
    reason: string;
    faab: Faab | null;
    balance: Balance;
  }[];
  roster_needs: Need[];
  roster_depth: RosterDepth[];
  lineup: { slots: LineupSlot[]; bench: Player[]; total: number; empty: string[] };
  positions: string[];
  faab: { budget: number | null; left: number | null; waiver_type: number | null };
};

// The board answers more than one question, so it gets more than one order.
// Ranking by waiver score alone is what made this view disagree with the draft
// board, which sorts by dynasty value — both are right, for different questions.
const TARGET_SORTS: readonly SortOption<Player>[] = [
  { id: "score", label: "Waiver-Score", of: (p) => p.score ?? 0 },
  { id: "pts", label: "Projektion", of: (p) => p.pts ?? 0 },
  { id: "dvs", label: "Dynasty (DVS)", of: (p) => p.dvs ?? 0 },
];

// Drops are a worst-first list: the backend hands them over weakest-unprotected
// first, and re-sorting them descending would bury the whole point of the list.
const DROP_SORTS: readonly SortOption<Player>[] = [
  { id: "order", label: "Drop-Priorität", of: () => 0, asc: true },
  { id: "pts", label: "Projektion", of: (p) => p.pts ?? 0, asc: true },
  { id: "dvs", label: "Dynasty (DVS)", of: (p) => p.dvs ?? 0, asc: true },
];

// Headcount vs. league demand at a position — deliberately separate from the
// severity colors on the need cards, which grade lineup quality. Six bench-only
// linemen reads "good" here and "kritisch" there at once, and both are correct;
// sharing one color scale would have hidden that distinction.
const DEPTH_TONES: Record<RosterDepth["tier"], string> = {
  good: "bg-green-900/30 text-green-300 border-green-700",
  ok: "bg-yellow-900/30 text-yellow-300 border-yellow-700",
  bad: "bg-red-900/30 text-red-300 border-red-700",
};

function DepthPill({ depth }: { depth: RosterDepth }) {
  return (
    <span
      title={depth.label}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border whitespace-nowrap ${DEPTH_TONES[depth.tier]}`}
    >
      {depth.pos}
      <span className="font-bold">{depth.count}</span>
      <span className="opacity-60">/ {depth.needed} benötigt</span>
    </span>
  );
}

function FaabPill({ faab }: { faab?: Faab | null }) {
  if (!faab) return null;
  const tone =
    faab.tier === "aggressiv"
      ? "bg-purple-900/40 text-purple-200 border-purple-600"
      : faab.tier === "solide"
      ? "bg-blue-900/40 text-blue-200 border-blue-700"
      : "bg-gray-800 text-gray-300 border-gray-700";
  return (
    <span className={`text-xs px-2 py-1 rounded-md border font-semibold whitespace-nowrap ${tone}`}>
      {faab.min}–{faab.max} FAAB
      <span className="font-normal opacity-70"> · {faab.tier}</span>
    </span>
  );
}

/** One roster player. The same shape for a starter and for a bench player:
 *  a slot chip on the left, the position badges on the name line. The bench
 *  used to render its positions as grey body text, which made the same
 *  information look like an afterthought two columns apart. */
function RosterRow({
  player,
  slot,
  accepts,
  empty,
}: {
  player: Player | null;
  slot: string;
  accepts?: string[];
  empty?: boolean;
}) {
  return (
    <div
      className={`glass-panel p-3 flex items-start gap-3 ${
        empty ? "border-l-4 border-l-red-500 bg-red-900/10" : ""
      }`}
    >
      <SlotBadge slot={slot} accepts={accepts} />
      {player ? (
        <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm text-white flex items-center gap-2 flex-wrap">
              <EligBadges player={player} />
              {player.name}
              <InjuryBadge injury={player.injury} />
            </div>
            <div className="text-xs text-gray-500">
              {player.team} • Age {player.age}
            </div>
            <SignalBadges player={player} />
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-sm font-bold text-blue-300">{player.pts}</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Proj</span>
          </div>
        </div>
      ) : (
        <span className="text-red-400 text-sm font-medium self-center">
          Kein zulässiger Spieler
        </span>
      )}
    </div>
  );
}

function WaiversContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const leagueId = searchParams.get("league_id");
  const sport = searchParams.get("sport") ?? "nfl";

  const [data, setData] = useState<WaiverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [dropFilter, setDropFilter] = useState<string | null>(null);
  const [sortId, setSortId] = useState("score");
  const [dropSortId, setDropSortId] = useState("order");
  const [showTeam, setShowTeam] = useState(true);

  // State is only written after the await, so the effect never triggers a
  // synchronous cascading render.
  useEffect(() => {
    if (!username || !leagueId) return;
    let active = true;

    (async () => {
      try {
        const result = await apiGet<WaiverData>("analyze_waivers", {
          username,
          league_id: leagueId,
          sport,
        });
        if (!active) return;
        setData(result);
        setError("");
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Ein Fehler ist aufgetreten");
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [username, leagueId, sport, reloadToken]);

  const needs = useMemo(() => data?.roster_needs ?? [], [data]);
  const targets = useMemo(() => data?.waiver_targets ?? [], [data]);
  const drops = useMemo(() => data?.drop_candidates ?? [], [data]);

  const severityByPos = useMemo(
    () => new Map(needs.map((n) => [n.pos, n.severity])),
    [needs]
  );

  // Every position this league starts, not just the ones that happen to appear
  // in the top of the board - an IDP-heavy score distribution used to hide RB
  // and WR from the filter entirely.
  const positions = useMemo(
    () =>
      [...(data?.positions ?? [])].sort(
        (a, b) => (severityByPos.get(b) ?? 0) - (severityByPos.get(a) ?? 0) || a.localeCompare(b)
      ),
    [data, severityByPos]
  );

  const visibleTargets = useMemo(() => {
    const list = posFilter ? targets.filter((t) => t.pos === posFilter) : targets;
    return sortBy(list, TARGET_SORTS, sortId);
  }, [targets, posFilter, sortId]);

  const dropPositions = useMemo(
    () => [...new Set(drops.map((d) => d.pos))].sort(),
    [drops]
  );
  const visibleDrops = useMemo(() => {
    const list = dropFilter ? drops.filter((d) => d.pos === dropFilter) : drops;
    return sortBy(list, DROP_SORTS, dropSortId);
  }, [drops, dropFilter, dropSortId]);

  if (!username || !leagueId) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-red-400">Username oder league_id fehlt in der URL.</p>
        <Link href="/" className="mt-4 inline-block text-blue-400 hover:text-blue-300">
          ← Zurück zum Dashboard
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-blue-400 hover:text-blue-300">
          ← Zurück zum Dashboard
        </Link>
      </div>
    );
  }

  const recommendations = data?.smart_recommendations ?? [];
  const lineup = data?.lineup;
  const faab = data?.faab;
  const rosterDepth = data?.roster_depth ?? [];
  const league = data?.league;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Waiver Wire Assistant</h1>
          {/* The league id is a routing detail, not a name. It stays as the
              fallback for a league Sleeper answers for but does not name. */}
          <p className="text-gray-400 mt-1">
            <span className="text-gray-200 font-medium">
              {league?.name ?? `Liga ${leagueId}`}
            </span>
            {league?.teams ? (
              <span className="text-gray-500">
                {" · "}
                {league.teams} Teams
                {league.season ? ` · ${league.season}` : ""}
              </span>
            ) : null}
            {faab?.left != null && (
              <>
                {" · "}
                <span className="text-purple-300 font-medium">
                  {faab.left} von {faab.budget} FAAB übrig
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setRefreshing(true);
              setReloadToken((token) => token + 1);
            }}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-bold"
          >
            {refreshing ? "Aktualisiere…" : "↻ Neu laden"}
          </button>
          <Link
            href={`/lineup?username=${username}&league_id=${leagueId}&sport=${sport}`}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            Lineup →
          </Link>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            ← Zurück
          </Link>
        </div>
      </div>

      {needs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {needs.map((need) => (
            <NeedCard key={need.pos} need={need} />
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Empfohlene Moves</h2>
          </div>

          {data?.moves_note && (
            <p className="glass-panel p-3 text-sm text-blue-100 border-l-4 border-l-blue-500 bg-blue-900/10 leading-relaxed">
              {data.moves_note}
            </p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recommendations.map((rec, idx) => (
              <div
                key={idx}
                className="glass-panel p-5 border border-blue-500/30 bg-blue-900/10 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border ${
                      rec.kind === "lineup"
                        ? "text-green-300 border-green-700 bg-green-900/30"
                        : "text-gray-300 border-gray-700 bg-gray-800"
                    }`}
                  >
                    {rec.kind === "lineup" ? "Startelf-Upgrade" : "Kadertiefe"}
                  </span>
                  <FaabPill faab={rec.faab} />
                </div>

                <p className="text-sm text-blue-100 bg-blue-900/30 p-3 rounded-md border border-blue-800/50 leading-relaxed">
                  {rec.reason}
                </p>

                {rec.kind === "lineup" ? (
                  <p className="text-xs text-gray-400">
                    Startaufstellung{" "}
                    <span className="text-green-400 font-medium">
                      +{rec.balance.lineup_gain}
                    </span>
                    {rec.balance.starts ? (
                      <span className="text-gray-500"> · steht sofort in der Startelf</span>
                    ) : (
                      <span className="text-gray-500"> · zunächst Bank-Verstärkung</span>
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">
                    Wert über Ersatzniveau{" "}
                    <span className="text-green-400 font-medium">
                      +{rec.balance.edge_gain ?? rec.balance.dvs_gain}
                    </span>
                    <span className="text-gray-500"> · verändert die Startelf nicht</span>
                  </p>
                )}

                <div className="flex items-center justify-between gap-3 border-b border-gray-700 pb-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs text-green-400 uppercase font-bold tracking-wider">Add</span>
                    <span className="text-white font-medium flex items-center gap-2 flex-wrap">
                      <PosBadge pos={rec.add.pos} />
                      {rec.add.name}
                      <InjuryBadge injury={rec.add.injury} />
                    </span>
                    <span className="text-gray-400 text-xs">
                      {rec.add.team} • Age {rec.add.age}
                    </span>
                    <TrendBadge player={rec.add} />
                  </div>
                  <div className="flex gap-3 text-right shrink-0">
                    <div className="flex flex-col">
                      <span className="text-blue-300 font-bold">{rec.add.pts}</span>
                      <span className="text-[10px] text-gray-500 uppercase">Proj</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-green-400 font-bold">{rec.add.dvs}</span>
                      <span className="text-[10px] text-gray-500 uppercase">DVS</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs text-red-400 uppercase font-bold tracking-wider">Drop</span>
                    <span className="text-white font-medium flex items-center gap-2 flex-wrap">
                      <PosBadge pos={rec.drop.pos} />
                      {rec.drop.name}
                    </span>
                    <span className="text-gray-400 text-xs">{rec.drop.team}</span>
                  </div>
                  <div className="flex gap-3 text-right shrink-0">
                    <div className="flex flex-col">
                      <span className="text-gray-300 font-bold">{rec.drop.pts}</span>
                      <span className="text-[10px] text-gray-500 uppercase">Proj</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-red-400 font-bold">{rec.drop.dvs}</span>
                      <span className="text-[10px] text-gray-500 uppercase">DVS</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lineup && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-purple-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Mein Team</h2>
            <span className="text-sm text-gray-500">
              Startaufstellung {lineup.total} Punkte projiziert
            </span>
            <button
              onClick={() => setShowTeam((v) => !v)}
              className="ml-auto px-3 py-1 rounded-md text-xs font-semibold border bg-gray-900 text-gray-400 border-gray-700 hover:text-white"
            >
              {showTeam ? "Einklappen" : "Ausklappen"}
            </button>
          </div>

          {rosterDepth.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {rosterDepth.map((d) => (
                <DepthPill key={d.pos} depth={d} />
              ))}
            </div>
          )}

          {showTeam && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  Startaufstellung
                </h3>
                {lineup.slots.map((s, idx) => (
                  <RosterRow
                    key={`${s.slot}-${idx}`}
                    slot={s.slot}
                    accepts={s.accepts}
                    player={s.player}
                    empty={!s.player}
                  />
                ))}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                  Bank ({lineup.bench.length})
                </h3>
                {lineup.bench.map((p) => (
                  <RosterRow key={p.id} slot="BN" player={p} />
                ))}
                {lineup.bench.length === 0 && (
                  <div className="glass-panel p-4 text-center text-gray-500 text-sm">
                    Alle Spieler stehen in der Aufstellung.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2 h-8 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Top Targets</h2>
            <span className="text-sm text-gray-500">
              {visibleTargets.length} von {targets.length}
            </span>
          </div>

          <SortBar options={TARGET_SORTS} active={sortId} onPick={setSortId} />

          <PosFilter
            positions={positions}
            counts={(pos) => targets.filter((t) => t.pos === pos).length}
            active={posFilter}
            onPick={setPosFilter}
            tone="bg-green-600 text-white border-green-500"
            severityByPos={severityByPos}
            needs={needs}
          />

          <div className="space-y-3">
            {visibleTargets.map((player) => (
              <div
                key={player.id}
                className="glass-panel p-4 flex justify-between items-start gap-4 border-l-4 border-l-green-500/50"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <PosChip pos={player.pos} />
                  <div className="min-w-0">
                    <h4 className="text-white font-medium flex items-center gap-2 flex-wrap">
                      {player.name}
                      <InjuryBadge injury={player.injury} />
                      {player.is_upgrade && (
                        <span className="text-[10px] bg-green-600/30 text-green-300 border border-green-700 px-1.5 py-0.5 rounded uppercase font-bold">
                          Upgrade
                        </span>
                      )}
                    </h4>
                    <p className="text-sm text-gray-400">
                      {player.team} • Age {player.age}
                    </p>
                    <SignalBadges player={player} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <FaabPill faab={player.faab} />
                  <div className="flex gap-3 text-right">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-blue-300">{player.pts}</span>
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Proj</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-green-400">{player.dvs}</span>
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">DVS</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2 h-8 bg-red-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Drop-Kandidaten</h2>
            <span className="text-sm text-gray-500">
              {visibleDrops.length} von {drops.length}
            </span>
          </div>

          <SortBar options={DROP_SORTS} active={dropSortId} onPick={setDropSortId} />

          <PosFilter
            positions={dropPositions}
            counts={(pos) => drops.filter((d) => d.pos === pos).length}
            active={dropFilter}
            onPick={setDropFilter}
            tone="bg-red-600 text-white border-red-500"
          />

          <div className="space-y-3">
            {visibleDrops.map((player) => (
              <div
                key={player.id}
                className={`glass-panel p-4 flex justify-between items-start gap-4 ${
                  player.protected
                    ? "border-l-4 border-l-amber-500/60 bg-amber-900/5"
                    : player.is_liability
                    ? "border-red-500/50 bg-red-900/10"
                    : ""
                }`}
              >
                <div className="flex items-start gap-4 min-w-0">
                  <PosChip pos={player.pos} />
                  <div className="min-w-0">
                    <h4 className="text-white font-medium flex items-center gap-2 flex-wrap">
                      {player.name}
                      <InjuryBadge injury={player.injury} />
                      {player.protected && (
                        <span className="text-[10px] bg-amber-600/30 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded uppercase font-bold">
                          Halten
                        </span>
                      )}
                    </h4>
                    <p className="text-sm text-gray-400">
                      {player.team} • Age {player.age} • Exp {player.exp} yr
                    </p>
                    {player.protected && (
                      <p className="text-xs text-amber-300/90 mt-1">{player.protected}</p>
                    )}
                    <SignalBadges player={player} />
                  </div>
                </div>
                <div className="flex gap-3 text-right shrink-0">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-blue-300">{player.pts}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Proj</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-white">{player.dvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">DVS</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Waivers() {
  return (
    <Suspense fallback={<div className="text-white">Lade…</div>}>
      <WaiversContent />
    </Suspense>
  );
}
