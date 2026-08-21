"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Player, LineupSlot, Injury } from "@/lib/types";

type LineupData = {
  league: { name: string; teams: number };
  slots: LineupSlot[];
  bench: Player[];
  total: number;
  empty: string[];
  warnings: { slot: string; player: string; injury: Injury }[];
  positions: string[];
};

const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SUPERFLEX",
  IDP_FLEX: "IDP FLEX",
  REC_FLEX: "REC FLEX",
  WRRB_FLEX: "WR/RB FLEX",
};

function slotLabel(slot: string) {
  return SLOT_LABELS[slot] ?? slot;
}

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

function LineupContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const leagueId = searchParams.get("league_id");
  const sport = searchParams.get("sport") ?? "nfl";

  const [data, setData] = useState<LineupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!username || !leagueId) return;
    let active = true;

    (async () => {
      try {
        const result = await apiGet<LineupData>("optimize_lineup", {
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

  const slots = data?.slots ?? [];
  const bench = data?.bench ?? [];
  const warnings = data?.warnings ?? [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Lineup Optimizer</h1>
          <p className="text-gray-400 mt-1">
            {data?.league.name}
            {" · "}
            Beste zulässige Aufstellung, Mehrfach-Positionen berücksichtigt
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setRefreshing(true);
              setReloadToken((t) => t + 1);
            }}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-bold"
          >
            {refreshing ? "Aktualisiere…" : "↻ Neu laden"}
          </button>
          <Link
            href={`/waivers?username=${username}&league_id=${leagueId}&sport=${sport}`}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            Waiver Wire →
          </Link>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            ← Zurück
          </Link>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="glass-panel p-4 border-l-4 border-l-yellow-500 bg-yellow-900/10">
          <h3 className="text-yellow-300 font-bold text-sm mb-2">
            ⚠ Verletzungsstatus in deiner Startelf
          </h3>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-sm text-gray-300">
                <span className="text-gray-500">{slotLabel(w.slot)}</span> — {w.player}:{" "}
                <span className="text-yellow-300">{w.injury.label ?? w.injury.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Startaufstellung</h2>
            <span className="text-sm text-gray-500">Gesamtwert {data?.total}</span>
          </div>

          <div className="space-y-2">
            {slots.map((s, idx) => (
              <div
                key={`${s.slot}-${idx}`}
                className={`glass-panel p-4 flex items-center justify-between gap-4 ${
                  s.player ? "" : "border-l-4 border-l-red-500 bg-red-900/10"
                }`}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div
                    className="w-20 shrink-0 text-center py-1.5 rounded-md bg-gray-900 border border-gray-700 text-xs font-bold text-gray-300"
                    title={s.accepts?.join(", ")}
                  >
                    {slotLabel(s.slot)}
                  </div>
                  {s.player ? (
                    <div className="min-w-0">
                      <div className="text-white font-medium flex items-center gap-2 flex-wrap">
                        {s.player.name}
                        <InjuryBadge injury={s.player.injury} />
                      </div>
                      <div className="text-xs text-gray-500">
                        {s.player.elig?.join("/") || s.player.pos} • {s.player.team} • Age{" "}
                        {s.player.age}
                        {s.alternatives && s.alternatives.length > 0 && (
                          <span className="text-gray-600">
                            {" "}
                            · Backup: {s.alternatives[0].name}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-red-400 text-sm font-medium">
                      Kein zulässiger Spieler für diesen Slot
                    </span>
                  )}
                </div>
                {s.player && (
                  <div className="flex flex-col items-end shrink-0">
                    <span className="text-sm font-bold text-green-400">{s.player.rvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">RVS</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-gray-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Bank</h2>
            <span className="text-sm text-gray-500">{bench.length}</span>
          </div>

          <div className="space-y-2">
            {bench.map((p) => (
              <div key={p.id} className="glass-panel p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white flex items-center gap-2 flex-wrap">
                    {p.name}
                    <InjuryBadge injury={p.injury} />
                  </div>
                  <div className="text-xs text-gray-500">
                    {p.elig?.join("/") || p.pos} • {p.team}
                  </div>
                </div>
                <span className="text-sm font-bold text-gray-400 shrink-0">{p.rvs}</span>
              </div>
            ))}
            {bench.length === 0 && (
              <div className="glass-panel p-4 text-center text-gray-500 text-sm">
                Alle Spieler stehen in der Aufstellung.
              </div>
            )}
          </div>

          <div className="glass-panel p-4 border-blue-500/30 bg-blue-900/10">
            <h3 className="text-blue-300 font-bold text-sm mb-2">💡 Wie das berechnet wird</h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              Jeder Spieler wird über <code className="text-blue-300">fantasy_positions</code>{" "}
              allen Slots zugeordnet, die ihn zulassen — inklusive FLEX, SUPERFLEX und UTIL. Die
              Zuordnung maximiert den Gesamtwert der Startaufstellung, nicht die Einzelplätze.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LineupOptimizer() {
  return (
    <Suspense fallback={<div className="text-center p-12 text-gray-400">Lade Aufstellung…</div>}>
      <LineupContent />
    </Suspense>
  );
}
