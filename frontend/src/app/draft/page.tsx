"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Need } from "@/lib/types";
import { PosBadge } from "@/components/PlayerBadges";
import NeedCard from "@/components/NeedCard";
import { PosFilter, SortBar, sortBy, type SortOption } from "@/components/Controls";

type Injury = { status: string | null; severity: number; label: string | null };

type DraftPlayer = {
  id: string;
  name: string;
  /** Primary fantasy position — what Sleeper lists first, nothing more. */
  pos: string;
  /** Every position a league slot would accept him at. This is the key the
   *  filter uses: Sleeper lists SG first for almost nobody, so filtering by
   *  `pos` answered "SG" with two names on a board full of SG-eligible wings. */
  elig?: string[];
  team: string;
  age: number | string;
  status?: string;
  rvs: number;
  dvs: number;
  pts: number;
  /** Dynasty value above what this league can freely replace the position
   *  with — the only cross-position comparable number on the board. */
  edge: number;
  edge_pos?: string;
  pts_edge: number;
  replacement: number;
  trade_value: number;
  is_rookie: boolean;
  signals?: string[];
  injury?: Injury | null;
};

type Recommendation = {
  type: "bpa" | "fit" | "now" | "trade";
  title: string;
  player: DraftPlayer;
  reason: string;
};

type DraftData = {
  metadata: {
    name: string;
    status: string;
    user_slot: number | null;
    is_rookie_draft: boolean;
    player_type: number;
    teams: number | null;
    rounds: number | null;
  };
  last_pick: { round: number; draft_slot: number; pick_no: number } | null;
  roster_needs: Need[];
  top_recommendations: Recommendation[];
  best_available: DraftPlayer[];
  positions: string[];
};

const REC_ICONS: Record<string, string> = { bpa: "🥇", fit: "🎯", now: "⚡", trade: "💰" };
const REC_COLORS: Record<string, string> = {
  bpa: "border-yellow-500/50 bg-yellow-900/10",
  fit: "border-green-500/50 bg-green-900/10",
  now: "border-sky-500/50 bg-sky-900/10",
  trade: "border-blue-500/50 bg-blue-900/10",
};

// Each card ranks on its own number, so each card shows its own number.
const REC_METRIC: Record<
  Recommendation["type"],
  (p: DraftPlayer) => { label: string; value: number; signed?: boolean }
> = {
  bpa: (p) => ({ label: "Edge", value: p.edge, signed: true }),
  fit: (p) => ({ label: "Edge", value: p.edge, signed: true }),
  now: (p) => ({ label: "Proj-Edge", value: p.pts_edge, signed: true }),
  trade: (p) => ({ label: "Trade Value", value: p.trade_value }),
};

const PLAYER_TYPE_LABELS: Record<number, string> = {
  1: "Rookie Only",
  2: "Nur Veteranen",
};

// Same controls as the waiver board, because it is the same question asked of a
// different pool. "Edge" leads: raw DVS is not comparable across positions, so
// ranking the board on it put the deepest position on top by construction.
const BOARD_SORTS: readonly SortOption<DraftPlayer>[] = [
  { id: "edge", label: "Dynasty-Edge", of: (p) => p.edge },
  { id: "dvs", label: "DVS", of: (p) => p.dvs },
  { id: "pts", label: "Projektion", of: (p) => p.pts },
  { id: "rvs", label: "RVS", of: (p) => p.rvs },
  { id: "trade", label: "Trade Value", of: (p) => p.trade_value },
];

function strategyHint(sport: string, isRookieDraft?: boolean): string {
  if (sport === "nba") {
    return isRookieDraft
      ? "In NBA-Rookie-Drafts zählt Draft-Kapital und Rolle im ersten Jahr. Guards mit Ballbesitz sammeln am schnellsten Fantasy-Punkte."
      : "Wer Minuten spielt, punktet. Center liefern Rebounds und Blocks am zuverlässigsten, Guards Assists und Steals — in Dynasty zählt Alter unter 26 doppelt.";
  }
  return isRookieDraft
    ? "In Rookie-Drafts zählt Talent (DVS) mehr als kurzfristiger Bedarf. Elite-WRs haben die längste Haltbarkeit, RBs sind riskanter, liefern aber sofort."
    : "Baue um Elite-QBs und junge WRs. RBs lassen sich in späteren Runden nachholen.";
}

function eligOf(player: DraftPlayer): string[] {
  return player.elig?.length ? player.elig : [player.pos];
}

function signed(value: number): string {
  return value >= 0 ? `+${Math.round(value)}` : `${Math.round(value)}`;
}

function DraftAssistantContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const draftId = searchParams.get("draft_id");
  const sport = searchParams.get("sport") ?? "nfl";

  const [data, setData] = useState<DraftData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [sortId, setSortId] = useState("edge");

  // State is only written after the await, so the effect never triggers a
  // synchronous cascading render.
  useEffect(() => {
    if (!username || !draftId) return;
    let active = true;

    (async () => {
      try {
        const result = await apiGet<DraftData>("analyze_draft", {
          username,
          draft_id: draftId,
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
  }, [username, draftId, sport, reloadToken]);

  const needs = useMemo(() => data?.roster_needs ?? [], [data]);
  const bestAvailable = useMemo(() => data?.best_available ?? [], [data]);

  const severityByPos = useMemo(
    () => new Map(needs.map((n) => [n.pos, n.severity])),
    [needs]
  );

  const positions = useMemo(() => {
    const fromLeague = data?.positions ?? [];
    const fromBoard = [...new Set(bestAvailable.flatMap(eligOf))];
    const all = fromLeague.length ? fromLeague : fromBoard;
    return [...all].sort(
      (a, b) => (severityByPos.get(b) ?? 0) - (severityByPos.get(a) ?? 0) || a.localeCompare(b)
    );
  }, [data, bestAvailable, severityByPos]);

  const countAt = (pos: string) =>
    bestAvailable.filter((p) => eligOf(p).includes(pos)).length;

  const visibleBoard = useMemo(() => {
    const list = posFilter
      ? bestAvailable.filter((p) => eligOf(p).includes(posFilter))
      : bestAvailable;
    return sortBy(list, BOARD_SORTS, sortId);
  }, [bestAvailable, posFilter, sortId]);

  const refresh = () => {
    setRefreshing(true);
    setReloadToken((token) => token + 1);
  };

  if (!username || !draftId) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-red-400">Username oder draft_id fehlt in der URL.</p>
        <Link href="/" className="mt-4 inline-block text-green-400 hover:text-green-300">
          ← Zurück zum Dashboard
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-green-400 hover:text-green-300">
          ← Zurück zum Dashboard
        </Link>
      </div>
    );
  }

  const metadata = data?.metadata;
  const lastPick = data?.last_pick;
  const recommendations = data?.top_recommendations ?? [];
  const typeLabel = metadata ? PLAYER_TYPE_LABELS[metadata.player_type] : undefined;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-6 border-green-500/30">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-white">{metadata?.name}</h1>
            {typeLabel && (
              <span className="bg-yellow-600/30 text-yellow-400 border border-yellow-500/50 text-xs px-2 py-1 rounded font-bold uppercase">
                {typeLabel}
              </span>
            )}
          </div>
          <p className="text-gray-400 mt-2">
            Status: <span className="text-white capitalize font-medium">{metadata?.status}</span>
            {" | "}
            Dein Slot: <span className="text-green-400 font-bold">{metadata?.user_slot ?? "—"}</span>
            {metadata?.rounds ? ` | ${metadata.rounds} Runden` : ""}
          </p>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={refresh}
              disabled={refreshing}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-bold flex items-center gap-2 shadow-lg shadow-green-500/20"
            >
              {refreshing ? "Aktualisiere…" : "↻ Board neu laden"}
            </button>
            <Link
              href="/"
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium"
            >
              ← Zurück
            </Link>
          </div>
          {lastPick && (
            <div className="text-sm text-gray-400 text-right">
              Letzter Pick:{" "}
              <span className="text-white font-medium">
                Runde {lastPick.round}, Pick {lastPick.draft_slot}
              </span>
            </div>
          )}
        </div>
      </div>

      {recommendations.length > 0 && (
        <div className="space-y-4 mb-8">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2 h-8 bg-yellow-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Top-Empfehlungen</h2>
            <span className="text-sm text-gray-500">
              Vier Fragen, vier Antworten — Value, Bedarf, Sofortnutzen, Marktwert
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            {recommendations.map((rec, idx) => (
              <div
                key={idx}
                className={`glass-panel p-5 border-t-4 ${REC_COLORS[rec.type]} flex flex-col gap-3 transition-transform hover:-translate-y-1`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{REC_ICONS[rec.type]}</span>
                  <h3 className="text-base font-bold text-white leading-tight">{rec.title}</h3>
                </div>
                <div>
                  <div className="text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                    {eligOf(rec.player).map((pos) => (
                      <PosBadge key={pos} pos={pos} />
                    ))}
                    {rec.player.name}
                    {rec.player.is_rookie && (
                      <span className="text-[10px] bg-yellow-600/30 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold">
                        Rookie
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400">
                    {rec.player.team} • Age {rec.player.age}
                  </div>
                </div>
                {/* The middle column is always the number this card was
                    ranked on. Showing the dynasty edge under "Bester
                    Sofort-Starter" put a large negative next to a pick that
                    was chosen on projected points. */}
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider block">DVS</span>
                    <span className="font-bold text-blue-400">{rec.player.dvs}</span>
                  </div>
                  {(() => {
                    const metric = REC_METRIC[rec.type](rec.player);
                    return (
                      <div>
                        <span className="text-[10px] text-gray-300 uppercase tracking-wider block font-semibold">
                          {metric.label}
                        </span>
                        <span
                          className={`font-bold ${metric.value >= 0 ? "text-green-400" : "text-gray-400"}`}
                        >
                          {metric.signed ? signed(metric.value) : metric.value}
                        </span>
                      </div>
                    );
                  })()}
                  <div>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Proj</span>
                    <span className="font-bold text-purple-400">{rec.player.pts}</span>
                  </div>
                </div>
                <p className="text-xs text-gray-300 bg-gray-900/50 p-3 rounded border border-gray-700 leading-relaxed mt-auto">
                  {rec.reason}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-purple-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Dein Teambedarf</h2>
          </div>

          {needs.length === 0 ? (
            <div className="glass-panel p-6 text-center text-gray-400">
              Kein Liga-Kontext für diesen Draft gefunden, oder dein Roster ist ausgeglichen.
            </div>
          ) : (
            <div className="space-y-3">
              {needs.map((need) => (
                <NeedCard key={need.pos} need={need} />
              ))}
            </div>
          )}

          <div className="glass-panel p-6 border-blue-500/30 bg-blue-900/10 mt-6">
            <h3 className="text-blue-300 font-bold mb-2">💡 Draft-Strategie</h3>
            <p className="text-sm text-gray-300">{strategyHint(sport, metadata?.is_rookie_draft)}</p>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2 h-8 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Best Available</h2>
            <span className="text-sm text-gray-500">
              {visibleBoard.length} von {bestAvailable.length}
            </span>
          </div>

          <SortBar options={BOARD_SORTS} active={sortId} onPick={setSortId} />

          <PosFilter
            positions={positions}
            counts={countAt}
            active={posFilter}
            onPick={setPosFilter}
            tone="bg-green-600 text-white border-green-500"
            severityByPos={severityByPos}
            needs={needs}
          />

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Spieler
                    </th>
                    <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-medium text-green-300 uppercase tracking-wider"
                      title="DVS über dem Ersatzniveau seiner besten Position — der einzige positionsübergreifend vergleichbare Wert"
                    >
                      Edge
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-blue-300 uppercase tracking-wider" title="Saisonprognose in der Wertung dieser Liga">
                      Proj
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-blue-400 uppercase tracking-wider" title="Dynasty Value Score">
                      DVS
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-purple-400 uppercase tracking-wider" title="Redraft Value Score">
                      RVS
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-transparent">
                  {visibleBoard.map((player) => {
                    const elig = eligOf(player);
                    const isNeeded = needs.some((n) => elig.includes(n.pos));
                    const severity = player.injury?.severity ?? 0;
                    return (
                      <tr
                        key={player.id}
                        className={`transition-colors hover:bg-gray-800/50 ${isNeeded ? "bg-green-900/10" : ""}`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col gap-1 items-start w-14 shrink-0">
                              {elig.map((pos) => (
                                <PosBadge key={pos} pos={pos} className="w-full" />
                              ))}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white flex items-center gap-2">
                                {player.name}
                                {isNeeded && (
                                  <span className="w-2 h-2 rounded-full bg-green-500" title="Passt auf deinen Bedarf"></span>
                                )}
                                {player.is_rookie && (
                                  <span className="text-[10px] bg-yellow-600/30 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold">
                                    Rookie
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500">
                                {player.team} • Age {player.age}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-center">
                          <span
                            title={player.injury?.label ?? undefined}
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              severity >= 3
                                ? "bg-red-900/30 text-red-400"
                                : severity > 0
                                ? "bg-yellow-900/30 text-yellow-400"
                                : "bg-green-900/30 text-green-400"
                            }`}
                          >
                            {player.injury?.status || player.status || "Active"}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-3 whitespace-nowrap text-right text-sm font-bold ${
                            player.edge >= 0 ? "text-green-400" : "text-gray-500"
                          }`}
                          title={`${player.edge_pos ?? player.pos}-Ersatzniveau: ${player.replacement} DVS`}
                        >
                          {signed(player.edge)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-bold text-blue-300">
                          {player.pts}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-bold text-white">
                          {player.dvs}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-bold text-gray-400">
                          {player.rvs}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleBoard.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                        Kein verfügbarer Spieler auf dieser Position.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DraftAssistant() {
  return (
    <Suspense fallback={<div className="text-center p-12 text-gray-400">Lade Assistant…</div>}>
      <DraftAssistantContent />
    </Suspense>
  );
}
