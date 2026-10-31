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
  WaiverMove,
  WaiverMoveSide,
} from "@/lib/types";
import {
  TrendBadge,
  SignalBadges,
  EligBadges,
  SlotBadge,
} from "@/components/PlayerBadges";
import NeedCard from "@/components/NeedCard";
import {
  BoardHead,
  BoardRow,
  PageHead,
  RefreshButton,
  ScoreBar,
  Spinner,
  SwapCard,
  TABLE,
  type ScoreTile,
} from "@/components/PageParts";
import { WeekFixes } from "@/components/WeekFixes";
import { Section, SectionNav, useSections } from "@/components/Section";
import { useRememberLeague } from "@/lib/lastLeague";
import { HorizonDetail, waiverPts } from "@/components/ForecastDetail";
import { PosFilter, SortBar, sortBy, type SortOption } from "@/components/Controls";

/** A board entry in the shape the shared move components read. */
function moveSide(p: Player): WaiverMoveSide {
  return { id: p.id, name: p.name, pos: p.pos, team: p.team, per_week: null,
           pts_week: p.pts_week, injury: p.injury };
}

type Balance = {
  pos_in: string;
  pos_out: string | null;
  lineup_gain: number;
  dvs_gain?: number;
  /** Dynasty gap measured above each position's replacement level — the number
   *  the depth engine actually decides on. Raw DVS is not comparable across
   *  positions. */
  edge_gain?: number;
  /** "DVS", or "Pkt/Woche" where depth moves compare forecast points. */
  edge_unit?: string;
  starts: boolean;
  empty_slots: string[];
};

type WaiverData = {
  league?: LeagueInfo;
  /** True for the whole move section, so it is stated once above the cards
   *  instead of opening every one of them. */
  moves_note?: string | null;
  drop_candidates: Player[];
  /** Taxi and IR: owned, but neither startable nor a drop that frees an active spot. */
  stashed?: Player[];
  waiver_targets: Player[];
  smart_recommendations: {
    kind: "lineup" | "depth";
    drop: Player;
    add: Player;
    reason: string;
    faab: Faab | null;
    balance: Balance;
  }[];
  /** Pickups for this week's lineup only - alternatives, pick one. */
  week_fixes?: {
    add: Player;
    drop: Player | null;
    out: Player | null;
    slot: string | null;
    gain: number;
    reason: string;
  }[];
  roster_needs: Need[];
  roster_depth: RosterDepth[];
  lineup: { slots: LineupSlot[]; bench: Player[]; total: number; empty: string[] };
  positions: string[];
  faab: { budget: number | null; left: number | null; waiver_type: number | null };
  /** The weeks `pts` is forecast over; null off-season (season projection). */
  horizon?: { weeks: number[]; weights?: number[] | null; pace_weeks?: number } | null;
  /** The waiver strategy for this league's format. */
  profile?: { key: "dynasty" | "keeper" | "redraft" | "chopped"; label: string } | null;
};

// The page's foldable sections, in page order. Folding is remembered per
// browser, the same for every league: someone who never reads the drop list
// does not want to fold it again in each of nine leagues.
const SECTIONS = [
  { id: "bedarf", label: "Bedarf" },
  { id: "moves", label: "Moves" },
  { id: "team", label: "Mein Team" },
  { id: "targets", label: "Top Targets" },
  { id: "drops", label: "Drops" },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

// What each league format changes on this page (api_core.LEAGUE_PROFILES).
const PROFILE_TEXT: Record<string, string> = {
  dynasty: "Punkte dieser Wochen plus Dynasty-Wert; Kadertiefe nach Dynasty-Wert.",
  keeper: "wie Dynasty, der Dynasty-Wert zählt halb.",
  redraft: "nur Punkte zählen, Dynasty-Wert und Draft-Kapital spielen keine Rolle.",
  chopped:
    "nur Punkte zählen, diese Woche dreifach — wer Letzter wird, fliegt. Dynasty-Wert spielt keine Rolle.",
};

// The board answers more than one question, so it gets more than one order.
// Ranking by waiver score alone is what made this view disagree with the draft
// board, which sorts by dynasty value — both are right, for different questions.
const TARGET_SORTS: readonly SortOption<Player>[] = [
  { id: "score", label: "Waiver-Score", of: (p) => p.score ?? 0 },
  { id: "pts", label: "Prognose", of: (p) => p.pts ?? 0 },
  { id: "dvs", label: "Dynasty (DVS)", of: (p) => p.dvs ?? 0 },
];

// Drops are a worst-first list: the backend hands them over weakest-unprotected
// first, and re-sorting them descending would bury the whole point of the list.
const DROP_SORTS: readonly SortOption<Player>[] = [
  { id: "order", label: "Drop-Priorität", of: () => 0, asc: true },
  { id: "pts", label: "Prognose", of: (p) => p.pts ?? 0, asc: true },
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
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold border whitespace-nowrap ${DEPTH_TONES[depth.tier]}`}
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
      ? "bg-highlight text-on-highlight border-transparent"
      : "bg-raised text-ink-soft border-line";
  return (
    <span className={`text-xs px-1.5 py-0.5 border font-semibold whitespace-nowrap ${tone}`}>
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
}: {
  player: Player | null;
  slot: string;
  accepts?: string[];
}) {
  const chip = <SlotBadge slot={slot} accepts={accepts} compact />;
  if (!player) {
    return (
      <BoardRow
        chip={chip}
        name="Kein zulässiger Spieler"
        stats={[null, null]}
        tint="bg-red-900/10"
      />
    );
  }
  return (
    <BoardRow
      chip={chip}
      name={player.name}
      injury={player.injury}
      sub={
        <>
          <EligBadges player={player} />
          <span>
            {player.team} · Age {player.age}
          </span>
        </>
      }
      stats={[waiverPts(player).value, player.dvs]}
      below={
        <>
          <SignalBadges player={player} />
          <HorizonDetail player={player} />
        </>
      }
    />
  );
}

/** Add or drop in a move: his number at the end, the rest under the line. */
function moveLine(label: string, player: Player, extra?: React.ReactNode) {
  return {
    label,
    pos: player.pos,
    name: player.name,
    injury: player.injury,
    value: waiverPts(player).value,
    below: (
      <>
        <div>
          {player.team} · Age {player.age} · {player.dvs} DVS · {waiverPts(player).unit}
        </div>
        {extra}
        <HorizonDetail player={player} />
      </>
    ),
  };
}

function WaiversContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const leagueId = searchParams.get("league_id");
  const sport = searchParams.get("sport") ?? "nfl";
  useRememberLeague(username, leagueId, sport);

  const [data, setData] = useState<WaiverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [posFilter, setPosFilter] = useState<string | null>(null);
  const [dropFilter, setDropFilter] = useState<string | null>(null);
  const [sortId, setSortId] = useState("score");
  const [dropSortId, setDropSortId] = useState("order");
  const sections = useSections("waivers.sections", SECTION_IDS);

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
      <div className="panel p-8 text-center">
        <p className="text-red-400">Username oder league_id fehlt in der URL.</p>
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

  const recommendations = data?.smart_recommendations ?? [];
  const lineup = data?.lineup;
  const faab = data?.faab;
  const rosterDepth = data?.roster_depth ?? [];
  const league = data?.league;
  const pointsLabel = data?.horizon ? "Ø/WO" : "PROJ";
  const bestUpgrade = Math.max(
    0,
    ...recommendations.filter((r) => r.kind === "lineup").map((r) => r.balance.lineup_gain)
  );
  const tiles: ScoreTile[] = [
    ...(faab?.left != null ? [{ label: "FAAB übrig", value: faab.left }] : []),
    { label: "Bedarf", value: needs.length },
    {
      label: "Upgrade",
      value: bestUpgrade > 0 ? `+${bestUpgrade}` : "–",
      hot: bestUpgrade > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHead
        title="Waiver"
        // The league id is a routing detail, not a name. It stays as the
        // fallback for a league Sleeper answers for but does not name.
        sub={
          <>
            {league?.name ?? `Liga ${leagueId}`}
            {league?.teams ? ` · ${league.teams} Teams` : ""}
            {league?.season ? ` · ${league.season}` : ""}
          </>
        }
        action={
          <RefreshButton
            busy={refreshing}
            onClick={() => {
              setRefreshing(true);
              setReloadToken((token) => token + 1);
            }}
          />
        }
      />

      <ScoreBar label="Stand der Waiver" tiles={tiles} />

      {(data?.profile || data?.horizon?.weeks?.length) && (
        <div className="space-y-1 text-xs text-muted">
          {data?.profile && (
            <p>
              Strategie: <span className="text-ink font-medium">{data.profile.label}</span>
              {" — "}
              {PROFILE_TEXT[data.profile.key]}
            </p>
          )}
          {data?.horizon?.weeks?.length ? (
            <p>
              Punkte auf dieser Seite: unsere Prognose, Ø pro Woche über W
              {data.horizon.weeks[0]}–{data.horizon.weeks[data.horizon.weeks.length - 1]}{" "}
              {sport === "nba"
                ? "(Lock-In: ein Spiel pro Woche zählt, mehr Spiele sind mehr Chancen darauf)"
                : "(Bye zählt 0)"}{" "}
              — dieselbe Prognose wie in der Aufstellung.{" "}
              <Link href="/prognose" className="link">
                So entsteht sie →
              </Link>
            </p>
          ) : null}
        </div>
      )}

      <SectionNav
        items={SECTIONS.filter(
          (s) =>
            (s.id !== "bedarf" || needs.length > 0) &&
            (s.id !== "moves" || recommendations.length > 0) &&
            (s.id !== "team" || !!lineup),
        )}
        state={sections}
      />

      <WeekFixes
        week={data?.horizon?.weeks?.[0]}
        fixes={(data?.week_fixes ?? []).map(
          (f): WaiverMove => ({
            kind: "week",
            add: moveSide(f.add),
            drop: f.drop && moveSide(f.drop),
            out: f.out && moveSide(f.out),
            slot: f.slot,
            reason: f.reason,
            faab: null,
            lineup_gain: f.gain,
          })
        )}
      />

      {needs.length > 0 && (
        <Section
          id="bedarf"
          title="Team-Bedarf"
          meta={`${needs.length} Position${needs.length === 1 ? "" : "en"}`}
          summary={needs.map((n) => `${n.pos}: ${n.label ?? n.kind ?? ""}`).join(" · ")}
          state={sections}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {needs.map((need) => (
              <NeedCard key={need.pos} need={need} />
            ))}
          </div>
        </Section>
      )}

      {recommendations.length > 0 && (
        <Section
          id="moves"
          title="Empfohlene Moves"
          meta={`${recommendations.length}`}
          summary={recommendations
            .map((r) => `${r.add.name} für ${r.drop.name}`)
            .join(" · ")}
          state={sections}
        >

          {data?.moves_note && (
            <p className="text-xs text-muted">{data.moves_note}</p>
          )}

          <div className="space-y-2.5">
            {recommendations.map((rec, idx) => {
              const start = rec.kind === "lineup";
              return (
                <SwapCard
                  key={idx}
                  quiet={!start}
                  gain={`+${start ? rec.balance.lineup_gain : rec.balance.edge_gain ?? rec.balance.dvs_gain}`}
                  unit={
                    start ? (data?.horizon ? "Pkt/Wo" : null) : rec.balance.edge_unit
                  }
                  sides={[
                    moveLine("Add", rec.add, <TrendBadge player={rec.add} />),
                    moveLine("Drop", rec.drop),
                  ]}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span>
                      <span className="font-semibold text-ink-soft">
                        {start ? "Startelf-Upgrade" : "Kadertiefe"}
                      </span>
                      {start
                        ? rec.balance.starts
                          ? " · steht sofort in der Startelf"
                          : " · zunächst Bank-Verstärkung"
                        : " · Wert über Ersatzniveau, verändert die Startelf nicht"}
                    </span>
                    <FaabPill faab={rec.faab} />
                  </div>
                  <p className="text-xs text-ink-soft leading-relaxed">{rec.reason}</p>
                </SwapCard>
              );
            })}
          </div>
        </Section>
      )}

      {lineup && (
        <Section
          id="team"
          title="Mein Team"
          meta={
            // In season the board counts in forecast pace (per week x a
            // season's weeks); the lineup total is shown per week, like
            // everything else here.
            data?.horizon
              ? `${(lineup.total / (data.horizon.pace_weeks ?? 17)).toFixed(1)} Pkt/Woche`
              : `${lineup.total} Pkt projiziert`
          }
          summary={rosterDepth.map((d) => `${d.pos} ${d.count}/${d.needed}`).join(" · ")}
          state={sections}
        >

          {rosterDepth.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {rosterDepth.map((d) => (
                <DepthPill key={d.pos} depth={d} />
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
            <div className={TABLE}>
              <BoardHead first="SLOT" stats={[pointsLabel, "DVS"]} />
              {lineup.slots.map((s, idx) => (
                <RosterRow key={`${s.slot}-${idx}`} slot={s.slot} accepts={s.accepts} player={s.player} />
              ))}
            </div>

            <div className={TABLE}>
              <BoardHead first="BANK" stats={[pointsLabel, "DVS"]} />
              {lineup.bench.map((p) => (
                <RosterRow key={p.id} slot="BN" player={p} />
              ))}
              {lineup.bench.length === 0 && (
                <div className="p-4 text-center text-muted text-sm">
                  Alle Spieler stehen in der Aufstellung.
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        <Section
          id="targets"
          title="Top Targets"
          meta={`${visibleTargets.length} von ${targets.length}`}
          summary={targets
            .slice(0, 3)
            .map((t) => t.name)
            .join(" · ")}
          state={sections}
        >

          <SortBar options={TARGET_SORTS} active={sortId} onPick={setSortId} />

          <PosFilter
            positions={positions}
            counts={(pos) => targets.filter((t) => t.pos === pos).length}
            active={posFilter}
            onPick={setPosFilter}
            severityByPos={severityByPos}
            needs={needs}
          />

          <div className={TABLE}>
            <BoardHead first="POS" stats={[pointsLabel, "DVS"]} />
            {visibleTargets.map((player) => (
              <BoardRow
                key={player.id}
                chip={<SlotBadge slot={player.pos} compact />}
                name={player.name}
                injury={player.injury}
                tag={
                  player.is_upgrade && (
                    <span className="font-sans not-italic text-[10px] bg-green-600/30 text-green-300 border border-green-700 px-1.5 py-0.5 rounded uppercase font-bold shrink-0">
                      Upgrade
                    </span>
                  )
                }
                sub={
                  <>
                    <span>
                      {player.team} · Age {player.age}
                    </span>
                    <FaabPill faab={player.faab} />
                  </>
                }
                stats={[waiverPts(player).value, player.dvs]}
                below={
                  <>
                    <SignalBadges player={player} />
                    <HorizonDetail player={player} />
                  </>
                }
              />
            ))}
          </div>
        </Section>

        <Section
          id="drops"
          title="Drop-Kandidaten"
          meta={`${visibleDrops.length} von ${drops.length}`}
          summary={drops
            .slice(0, 3)
            .map((d) => d.name)
            .join(" · ")}
          state={sections}
        >

          <SortBar options={DROP_SORTS} active={dropSortId} onPick={setDropSortId} />

          {(data?.stashed?.length ?? 0) > 0 && (
            <p className="text-xs text-muted mb-2">
              Ohne Taxi &amp; IR ({data?.stashed?.map((p) => p.name).join(", ")}): ihr Drop macht
              keinen aktiven Kaderplatz für einen Neuzugang frei.
            </p>
          )}

          <PosFilter
            positions={dropPositions}
            counts={(pos) => drops.filter((d) => d.pos === pos).length}
            active={dropFilter}
            onPick={setDropFilter}
          />

          <div className={TABLE}>
            <BoardHead first="POS" stats={[pointsLabel, "DVS"]} />
            {visibleDrops.map((player) => (
              <BoardRow
                key={player.id}
                chip={<SlotBadge slot={player.pos} compact />}
                name={player.name}
                injury={player.injury}
                tint={player.protected ? "bg-amber-900/5" : player.is_liability ? "bg-red-900/10" : ""}
                tag={
                  player.protected && (
                    <span className="font-sans not-italic text-[10px] bg-amber-600/30 text-amber-300 border border-amber-700 px-1.5 py-0.5 rounded uppercase font-bold shrink-0">
                      Halten
                    </span>
                  )
                }
                sub={
                  <span>
                    {player.team} · Age {player.age} · Exp {player.exp} yr
                  </span>
                }
                stats={[waiverPts(player).value, player.dvs]}
                below={
                  <>
                    {player.protected && (
                      <p className="text-xs text-amber-300/90 mt-1">{player.protected}</p>
                    )}
                    <SignalBadges player={player} />
                    <HorizonDetail player={player} />
                  </>
                }
              />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

export default function Waivers() {
  return (
    <Suspense fallback={<div className="text-ink">Lade…</div>}>
      <WaiversContent />
    </Suspense>
  );
}
