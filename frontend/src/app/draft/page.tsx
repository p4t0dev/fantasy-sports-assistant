"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Need } from "@/lib/types";
import { PosBadge, SlotBadge } from "@/components/PlayerBadges";
import NeedCard from "@/components/NeedCard";
import { BoardHead, BoardRow, PageHead, RefreshButton, ScoreBar, Spinner, TABLE } from "@/components/PageParts";
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
      <div className="panel p-8 text-center">
        <p className="text-red-400">Username oder draft_id fehlt in der URL.</p>
        <Link href="/" className="mt-4 inline-block link">
          ← Zurück zum Dashboard
        </Link>
      </div>
    );
  }

  if (loading) return <Spinner />;

  if (error) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block link">
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
    <div className="space-y-6">
      <PageHead
        title={metadata?.name}
        sub={
          <>
            <span className="capitalize">{metadata?.status}</span>
            {typeLabel ? ` · ${typeLabel}` : ""}
          </>
        }
        action={<RefreshButton busy={refreshing} onClick={refresh} />}
      />

      <ScoreBar
        label="Stand des Drafts"
        tiles={[
          { label: "Dein Slot", value: metadata?.user_slot ?? "–", hot: metadata?.user_slot != null },
          {
            label: "Letzter Pick",
            value: lastPick ? `${lastPick.round}.${String(lastPick.draft_slot).padStart(2, "0")}` : "–",
          },
          { label: "Runden", value: metadata?.rounds ?? "–" },
        ]}
      />

      {recommendations.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="headline">Top-Empfehlungen</h2>
          <p className="text-xs text-muted">
            Vier Fragen, vier Antworten — Value, Bedarf, Sofortnutzen, Marktwert
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {recommendations.map((rec, idx) => {
              // The block is always the number this card was ranked on.
              // Showing the dynasty edge under "Bester Sofort-Starter" put a
              // large negative next to a pick chosen on projected points.
              const metric = REC_METRIC[rec.type](rec.player);
              return (
                <div key={idx} className="flex items-stretch bg-surface">
                  <div className="flex-1 min-w-0 px-3 py-2.5 space-y-1">
                    <div className="eyebrow">{rec.title}</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {eligOf(rec.player).map((pos) => (
                        <PosBadge key={pos} pos={pos} />
                      ))}
                      <span className="font-display font-bold text-xl leading-tight text-ink">
                        {rec.player.name}
                      </span>
                      {rec.player.is_rookie && (
                        <span className="text-[10px] bg-yellow-600/30 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold">
                          Rookie
                        </span>
                      )}
                    </div>
                    <div className="text-[13px] text-muted">
                      {rec.player.team} · Age {rec.player.age} · {rec.player.dvs} DVS · {rec.player.pts} Proj
                    </div>
                    <p className="text-xs text-ink-soft leading-relaxed">{rec.reason}</p>
                  </div>
                  <div
                    className={`min-w-16 px-2 shrink-0 flex flex-col items-center justify-center ${
                      metric.value >= 0 ? "bg-highlight text-on-highlight" : "bg-raised text-ink"
                    }`}
                  >
                    <span className="display text-[26px]">
                      {metric.signed ? signed(metric.value) : metric.value}
                    </span>
                    <span className="mt-0.5 text-[10px] font-semibold">{metric.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <h2 className="headline">Dein Teambedarf</h2>

          {needs.length === 0 ? (
            <div className="panel p-6 text-center text-muted">
              Kein Liga-Kontext für diesen Draft gefunden, oder dein Roster ist ausgeglichen.
            </div>
          ) : (
            <div className="space-y-3">
              {needs.map((need) => (
                <NeedCard key={need.pos} need={need} />
              ))}
            </div>
          )}

          <div className="panel p-4">
            <h3 className="eyebrow mb-2">Draft-Strategie</h3>
            <p className="text-sm text-ink-soft">{strategyHint(sport, metadata?.is_rookie_draft)}</p>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="headline">Best Available</h2>
            <span className="text-sm text-muted">
              {visibleBoard.length} von {bestAvailable.length}
            </span>
          </div>

          <SortBar options={BOARD_SORTS} active={sortId} onPick={setSortId} />

          <PosFilter
            positions={positions}
            counts={countAt}
            active={posFilter}
            onPick={setPosFilter}
            severityByPos={severityByPos}
            needs={needs}
          />

          <div className={TABLE}>
            <BoardHead first="POS" stats={["EDGE", "PROJ"]} />
            {visibleBoard.map((player) => {
              const elig = eligOf(player);
              // NBA players are "ACT", NFL players "Active".
              const inactive = !player.injury?.status && player.status && !["Active", "ACT"].includes(player.status);
              return (
                <BoardRow
                  key={player.id}
                  chip={<SlotBadge slot={player.pos} compact />}
                  name={player.name}
                  injury={player.injury}
                  tag={
                    <>
                      {needs.some((n) => elig.includes(n.pos)) && (
                        <span className="w-2 h-2 shrink-0 rounded-full bg-highlight" title="Passt auf deinen Bedarf"></span>
                      )}
                      {player.is_rookie && (
                        <span className="font-sans not-italic text-[10px] bg-yellow-600/30 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold shrink-0">
                          Rookie
                        </span>
                      )}
                    </>
                  }
                  sub={
                    <>
                      {elig.length > 1 && elig.map((pos) => <PosBadge key={pos} pos={pos} />)}
                      <span>
                        {player.team} · Age {player.age} · {player.dvs} DVS · {player.rvs} RVS
                        {inactive ? ` · ${player.status}` : ""}
                      </span>
                    </>
                  }
                  stats={[
                    <span key="edge" title={`${player.edge_pos ?? player.pos}-Ersatzniveau: ${player.replacement} DVS`}>
                      {signed(player.edge)}
                    </span>,
                    player.pts,
                  ]}
                />
              );
            })}
            {visibleBoard.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-muted">
                Kein verfügbarer Spieler auf dieser Position.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DraftAssistant() {
  return (
    <Suspense fallback={<div className="text-center p-12 text-muted">Lade Assistant…</div>}>
      <DraftAssistantContent />
    </Suspense>
  );
}
