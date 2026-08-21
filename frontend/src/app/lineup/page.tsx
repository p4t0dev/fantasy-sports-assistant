"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Player, LineupSlot, Injury } from "@/lib/types";
import { InjuryBadge, SignalBadges } from "@/components/PlayerBadges";

type Change = {
  slot: string | null;
  in: Player;
  out: Player | null;
};

type LineupData = {
  league: { name: string; teams: number };
  slots: LineupSlot[];
  current: { slot: string; player: Player | null }[];
  current_total: number;
  gain: number;
  changes: Change[];
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

/** One slot row. `changed` marks a seat whose occupant the optimizer disagrees with. */
function SlotRow({
  slot,
  player,
  changed,
  accepts,
  backup,
}: {
  slot: string;
  player: Player | null;
  changed?: boolean;
  accepts?: string[];
  backup?: string;
}) {
  return (
    <div
      className={`glass-panel p-4 flex items-center justify-between gap-4 ${
        !player
          ? "border-l-4 border-l-red-500 bg-red-900/10"
          : changed
          ? "border-l-4 border-l-blue-500 bg-blue-900/10"
          : ""
      }`}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div
          className="w-20 shrink-0 text-center py-1.5 rounded-md bg-gray-900 border border-gray-700 text-xs font-bold text-gray-300"
          title={accepts?.join(", ")}
        >
          {slotLabel(slot)}
        </div>
        {player ? (
          <div className="min-w-0">
            <div className="text-white font-medium flex items-center gap-2 flex-wrap">
              {player.name}
              <InjuryBadge injury={player.injury} />
            </div>
            <div className="text-xs text-gray-500">
              {player.elig?.join("/") || player.pos} • {player.team} • Age {player.age}
              {backup && <span className="text-gray-600"> · Backup: {backup}</span>}
            </div>
            <SignalBadges player={player} />
          </div>
        ) : (
          <span className="text-red-400 text-sm font-medium">
            Kein zulässiger Spieler für diesen Slot
          </span>
        )}
      </div>
      {player && (
        <div className="flex flex-col items-end shrink-0">
          <span className="text-sm font-bold text-blue-300">{player.pts}</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Proj</span>
        </div>
      )}
    </div>
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
  const [view, setView] = useState<"optimal" | "current">("optimal");

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
  const current = data?.current ?? [];
  const changes = data?.changes ?? [];
  const bench = data?.bench ?? [];
  const warnings = data?.warnings ?? [];
  const gain = data?.gain ?? 0;

  // Which optimal seats differ from what is actually set, so the rows the user
  // has to touch are marked instead of left to be spotted by eye.
  const changedIds = new Set(changes.map((c) => c.in.id));
  const benchedIds = new Set(changes.map((c) => c.out?.id).filter(Boolean) as string[]);

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

      <div
        className={`glass-panel p-5 border-l-4 ${
          changes.length > 0
            ? "border-l-blue-500 bg-blue-900/10"
            : "border-l-green-500 bg-green-900/10"
        }`}
      >
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mb-3">
          <h2 className="text-lg font-bold text-white">
            {changes.length > 0
              ? `${changes.length} Änderung${changes.length === 1 ? "" : "en"} empfohlen`
              : "Deine Aufstellung ist bereits optimal"}
          </h2>
          <p className="text-sm text-gray-400">
            aktuell <span className="text-gray-200 font-medium">{data?.current_total}</span>
            {" → "}
            optimal <span className="text-gray-200 font-medium">{data?.total}</span>
            {gain > 0 && <span className="text-green-400 font-bold"> (+{gain})</span>}
          </p>
        </div>

        {changes.length > 0 && (
          <div className="space-y-2">
            {changes.map((c, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm bg-gray-900/50 rounded-md p-3 border border-gray-800"
              >
                <span className="w-20 shrink-0 text-center py-0.5 rounded bg-gray-900 border border-gray-700 text-[11px] font-bold text-gray-300">
                  {c.slot ? slotLabel(c.slot) : "—"}
                </span>
                <span className="text-green-400 font-bold text-xs uppercase tracking-wider">Rein</span>
                <span className="text-white font-medium flex items-center gap-2">
                  {c.in.name}
                  <InjuryBadge injury={c.in.injury} />
                </span>
                <span className="text-blue-300 font-bold">{c.in.pts}</span>
                {c.out && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-red-400 font-bold text-xs uppercase tracking-wider">Raus</span>
                    <span className="text-gray-300 flex items-center gap-2">
                      {c.out.name}
                      <InjuryBadge injury={c.out.injury} />
                    </span>
                    <span className="text-gray-500 font-bold">{c.out.pts}</span>
                  </>
                )}
              </div>
            ))}
            <p className="text-xs text-gray-500 pt-1">
              Rein und Raus sind über Positionen hinweg gepaart — entscheidend ist die
              Menge, nicht das einzelne Paar. Der Gesamtgewinn oben stimmt exakt.
            </p>
          </div>
        )}
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
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-2 h-8 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">
              {view === "optimal" ? "Optimale Aufstellung" : "Aktuelle Aufstellung"}
            </h2>
            <div className="ml-auto bg-gray-900 rounded-lg p-1 flex border border-gray-800">
              <button
                onClick={() => setView("optimal")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  view === "optimal" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Optimal ({data?.total})
              </button>
              <button
                onClick={() => setView("current")}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  view === "current" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Aktuell ({data?.current_total})
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {view === "optimal"
              ? slots.map((s, idx) => (
                  <SlotRow
                    key={`opt-${s.slot}-${idx}`}
                    slot={s.slot}
                    player={s.player}
                    accepts={s.accepts}
                    changed={!!s.player && changedIds.has(s.player.id)}
                    backup={s.alternatives?.[0]?.name}
                  />
                ))
              : current.map((s, idx) => (
                  <SlotRow
                    key={`cur-${s.slot}-${idx}`}
                    slot={s.slot}
                    player={s.player}
                    changed={!!s.player && benchedIds.has(s.player.id)}
                  />
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
              <div key={p.id} className="glass-panel p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-white flex items-center gap-2 flex-wrap">
                    {p.name}
                    <InjuryBadge injury={p.injury} />
                  </div>
                  <div className="text-xs text-gray-500">
                    {p.elig?.join("/") || p.pos} • {p.team}
                  </div>
                  <SignalBadges player={p} />
                </div>
                <span className="text-sm font-bold text-blue-300 shrink-0">{p.pts}</span>
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
              „Proj“ ist die Saisonprognose von Sleeper, gerechnet mit dem{" "}
              <em>Scoring deiner Liga</em> und abgewertet nach Verletzungsstatus. Jeder
              Spieler wird über <code className="text-blue-300">fantasy_positions</code> allen
              Slots zugeordnet, die ihn zulassen — inklusive FLEX, SUPERFLEX und UTIL. Die
              Zuordnung maximiert den Gesamtwert der Aufstellung, nicht die Einzelplätze.
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
