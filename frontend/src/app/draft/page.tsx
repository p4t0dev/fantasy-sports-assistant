"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";

type Injury = { status: string | null; severity: number; label: string | null };

type DraftPlayer = {
  id: string;
  name: string;
  pos: string;
  team: string;
  age: number | string;
  status?: string;
  rvs: number;
  dvs: number;
  pts: number;
  trade_value: number;
  is_rookie: boolean;
  signals?: string[];
  injury?: Injury | null;
};

type Need = { pos: string; severity: number; reason: string };

type Recommendation = {
  type: "bpa" | "fit" | "trade";
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
};

const NEED_STYLES: Record<number, string> = {
  3: "border-l-red-500 bg-red-900/10",
  2: "border-l-orange-500 bg-orange-900/10",
  1: "border-l-yellow-500 bg-yellow-900/10",
};
const NEED_BADGES: Record<number, string> = {
  3: "bg-red-500/20 text-red-400",
  2: "bg-orange-500/20 text-orange-400",
  1: "bg-yellow-500/20 text-yellow-400",
};
const NEED_LABELS: Record<number, string> = { 3: "Kritisch", 2: "Ungesichert", 1: "Dünn" };

const REC_ICONS: Record<string, string> = { bpa: "🥇", fit: "🎯", trade: "💰" };
const REC_COLORS: Record<string, string> = {
  bpa: "border-yellow-500/50 bg-yellow-900/10",
  fit: "border-green-500/50 bg-green-900/10",
  trade: "border-blue-500/50 bg-blue-900/10",
};

const PLAYER_TYPE_LABELS: Record<number, string> = {
  1: "Rookie Only",
  2: "Nur Veteranen",
};

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
  const needs = data?.roster_needs ?? [];
  const recommendations = data?.top_recommendations ?? [];
  const bestAvailable = data?.best_available ?? [];
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
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-yellow-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Top-Empfehlungen</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {recommendations.map((rec, idx) => (
              <div
                key={idx}
                className={`glass-panel p-6 border-t-4 ${REC_COLORS[rec.type]} transition-transform hover:-translate-y-1`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{REC_ICONS[rec.type]}</span>
                  <h3 className="text-lg font-bold text-white">{rec.title}</h3>
                </div>
                <div className="mb-4">
                  <div className="text-xl font-bold text-white flex items-center gap-2 flex-wrap">
                    {rec.player.name}
                    {rec.player.is_rookie && (
                      <span className="text-[10px] bg-yellow-600/30 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold">
                        Rookie
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-400">
                    {rec.player.pos} • {rec.player.team} • Age {rec.player.age}
                  </div>
                </div>
                <div className="flex items-center gap-4 mb-4 text-sm">
                  <div>
                    <span className="text-gray-500">DVS</span>
                    <div className="font-bold text-blue-400">{rec.player.dvs}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Trade Value</span>
                    <div className="font-bold text-purple-400">{rec.player.trade_value}</div>
                  </div>
                </div>
                <p className="text-sm text-gray-300 bg-gray-900/50 p-3 rounded border border-gray-700">
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
              {needs.map((need, idx) => (
                <div
                  key={idx}
                  className={`glass-panel p-4 border-l-4 ${NEED_STYLES[need.severity] ?? NEED_STYLES[1]}`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-white text-lg">{need.pos}</span>
                    <span
                      className={`text-xs px-2 py-1 rounded font-bold uppercase ${
                        NEED_BADGES[need.severity] ?? NEED_BADGES[1]
                      }`}
                    >
                      {NEED_LABELS[need.severity] ?? "Hinweis"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">{need.reason}</p>
                </div>
              ))}
            </div>
          )}

          <div className="glass-panel p-6 border-blue-500/30 bg-blue-900/10 mt-6">
            <h3 className="text-blue-300 font-bold mb-2">💡 Draft-Strategie</h3>
            <p className="text-sm text-gray-300">{strategyHint(sport, metadata?.is_rookie_draft)}</p>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Best Available</h2>
          </div>

          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-800">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Spieler
                    </th>
                    <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-blue-300 uppercase tracking-wider" title="Saisonprognose in der Wertung dieser Liga">
                      Proj
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-blue-400 uppercase tracking-wider" title="Dynasty Value Score">
                      DVS
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-purple-400 uppercase tracking-wider" title="Redraft Value Score">
                      RVS
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-transparent">
                  {bestAvailable.map((player) => {
                    const isNeeded = needs.some((n) => n.pos === player.pos);
                    const severity = player.injury?.severity ?? 0;
                    return (
                      <tr
                        key={player.id}
                        className={`transition-colors hover:bg-gray-800/50 ${isNeeded ? "bg-green-900/10" : ""}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center bg-gray-800 rounded-full border border-gray-700">
                              <span className="text-sm font-bold text-gray-300">{player.pos}</span>
                            </div>
                            <div className="ml-4">
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
                        <td className="px-6 py-4 whitespace-nowrap text-center">
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
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-blue-300">
                          {player.pts}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-white">
                          {player.dvs}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-bold text-gray-400">
                          {player.rvs}
                        </td>
                      </tr>
                    );
                  })}
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
