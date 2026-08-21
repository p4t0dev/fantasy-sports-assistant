"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Player, Need, Faab, Injury, LineupSlot } from "@/lib/types";

type Balance = {
  pos_in: string;
  pos_out: string | null;
  lineup_gain: number;
  starts: boolean;
  empty_slots: string[];
};

type WaiverData = {
  drop_candidates: Player[];
  waiver_targets: Player[];
  smart_recommendations: {
    drop: Player;
    add: Player;
    reason: string;
    faab: Faab | null;
    balance: Balance;
  }[];
  roster_needs: Need[];
  lineup: { slots: LineupSlot[]; bench: Player[]; total: number; empty: string[] };
  positions: string[];
  faab: { budget: number | null; left: number | null; waiver_type: number | null };
};

const SEVERITY_STYLES: Record<number, string> = {
  3: "border-l-red-500 bg-red-900/10",
  2: "border-l-orange-500 bg-orange-900/10",
  1: "border-l-yellow-500 bg-yellow-900/10",
};

const SEVERITY_LABELS: Record<number, string> = { 3: "Kritisch", 2: "Ungesichert", 1: "Dünn" };

function InjuryBadge({ injury }: { injury?: Injury | null }) {
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

function TrendBadge({ player }: { player: Player }) {
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

  const refresh = () => {
    setRefreshing(true);
    setReloadToken((token) => token + 1);
  };

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

  const needs = data?.roster_needs ?? [];
  const recommendations = data?.smart_recommendations ?? [];
  const targets = data?.waiver_targets ?? [];
  const drops = data?.drop_candidates ?? [];
  const faab = data?.faab;

  const severityByPos = new Map(needs.map((n) => [n.pos, n.severity]));
  // Every position this league starts, not just the ones that happen to appear
  // in the top of the board - an IDP-heavy score distribution used to hide RB
  // and WR from the filter entirely.
  const positions = [...(data?.positions ?? [])].sort(
    (a, b) => (severityByPos.get(b) ?? 0) - (severityByPos.get(a) ?? 0) || a.localeCompare(b)
  );
  const visibleTargets = posFilter ? targets.filter((t) => t.pos === posFilter) : targets;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Waiver Wire Assistant</h1>
          <p className="text-gray-400 mt-1">
            Liga {leagueId}
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
            onClick={refresh}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-bold"
          >
            {refreshing ? "Aktualisiere…" : "↻ Neu laden"}
          </button>
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
          {needs.slice(0, 4).map((need) => (
            <div
              key={need.pos}
              className={`glass-panel p-4 border-l-4 ${SEVERITY_STYLES[need.severity] ?? SEVERITY_STYLES[1]}`}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="font-bold text-white text-lg">{need.pos}</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-bold uppercase bg-black/30 text-gray-300">
                  {SEVERITY_LABELS[need.severity] ?? "Hinweis"}
                </span>
              </div>
              <p className="text-xs text-gray-300 leading-snug">{need.reason}</p>
              <p className="text-[10px] text-gray-500 mt-1">
                {need.startable}/{need.depth} startbar · {need.fixed_slots} feste Slots
              </p>
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Empfohlene Moves</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {recommendations.map((rec, idx) => (
              <div
                key={idx}
                className="glass-panel p-5 border border-blue-500/30 bg-blue-900/10 flex flex-col gap-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-blue-300 uppercase font-bold tracking-wider">
                    Move {idx + 1}
                  </span>
                  <FaabPill faab={rec.faab} />
                </div>

                <p className="text-sm text-blue-100 bg-blue-900/30 p-3 rounded-md border border-blue-800/50 leading-relaxed">
                  {rec.reason}
                </p>

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

                <div className="flex items-center justify-between gap-3 border-b border-gray-700 pb-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs text-green-400 uppercase font-bold tracking-wider">Add</span>
                    <span className="text-white font-medium flex items-center gap-2 flex-wrap">
                      {rec.add.name}
                      <InjuryBadge injury={rec.add.injury} />
                    </span>
                    <span className="text-gray-400 text-xs">
                      {rec.add.pos} • {rec.add.team} • Age {rec.add.age}
                    </span>
                    <TrendBadge player={rec.add} />
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs text-gray-500">DVS</span>
                    <span className="text-green-400 font-bold">{rec.add.dvs}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-xs text-red-400 uppercase font-bold tracking-wider">Drop</span>
                    <span className="text-white font-medium">{rec.drop.name}</span>
                    <span className="text-gray-400 text-xs">
                      {rec.drop.pos} • {rec.drop.team}
                    </span>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-xs text-gray-500">DVS</span>
                    <span className="text-red-400 font-bold">{rec.drop.dvs}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Top Targets</h2>
            <span className="text-sm text-gray-500">
              {visibleTargets.length} von {targets.length}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setPosFilter(null)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors ${
                posFilter === null
                  ? "bg-green-600 text-white border-green-500"
                  : "bg-gray-900 text-gray-400 border-gray-700 hover:text-white"
              }`}
            >
              Alle
            </button>
            {positions.map((pos) => {
              const severity = severityByPos.get(pos) ?? 0;
              const active = posFilter === pos;
              return (
                <button
                  key={pos}
                  onClick={() => setPosFilter(active ? null : pos)}
                  title={severity ? needs.find((n) => n.pos === pos)?.reason : undefined}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors flex items-center gap-1 ${
                    active
                      ? "bg-green-600 text-white border-green-500"
                      : "bg-gray-900 text-gray-400 border-gray-700 hover:text-white"
                  }`}
                >
                  {pos}
                  <span className="opacity-60">{targets.filter((t) => t.pos === pos).length}</span>
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

          <div className="space-y-3">
            {visibleTargets.map((player) => (
              <div
                key={player.id}
                className="glass-panel p-4 flex justify-between items-start gap-4 border-l-4 border-l-green-500/50"
              >
                <div className="flex items-start gap-4 min-w-0">
                  <div className="w-10 h-10 shrink-0 rounded-full bg-gray-800 flex items-center justify-center font-bold text-gray-300 text-xs border border-gray-700">
                    {player.pos}
                  </div>
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
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <TrendBadge player={player} />
                      {player.opportunity?.label && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-indigo-900/40 text-indigo-200 border border-indigo-700">
                          ↑ {player.opportunity.label}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <FaabPill faab={player.faab} />
                  <div className="flex gap-3 text-right">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-green-400">{player.dvs}</span>
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">DVS</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-gray-300">{player.rvs}</span>
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">RVS</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-red-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Drop-Kandidaten</h2>
          </div>

          <div className="space-y-3">
            {drops.map((player) => (
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
                  <div className="w-10 h-10 shrink-0 rounded-full bg-gray-800 flex items-center justify-center font-bold text-gray-300 text-xs border border-gray-700">
                    {player.pos}
                  </div>
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
                  </div>
                </div>
                <div className="flex gap-3 text-right shrink-0">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-white">{player.dvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">DVS</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-gray-400">{player.rvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">RVS</span>
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
