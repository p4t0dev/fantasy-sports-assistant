"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type {
  Player,
  LineupSlot,
  Injury,
  LineupChange,
  CloseCall,
  LockCall,
  MatchupStance,
  ActivationOption,
} from "@/lib/types";
import { ActivationOptions, StashBadge } from "@/components/ActivationOptions";
import {
  InjuryBadge,
  SignalBadges,
  PosBadge,
  EligBadges,
  SlotBadge,
  LockBadge,
  OppChip,
  TIER_LEGEND,
  startPts,
} from "@/components/PlayerBadges";
import { CloseCalls, ForecastDetail, LockCalls, MatchupLine } from "@/components/ForecastDetail";
import { useRememberLeague } from "@/lib/lastLeague";
import { slotLabel } from "@/lib/positions";
import { Section, SectionNav, useSections } from "@/components/Section";

type LineupData = {
  league: { name: string; teams: number };
  /** The week being set, or null off-season (season projections then). */
  week: number | null;
  slots: LineupSlot[];
  current_slots: { slot: string; player: Player | null }[];
  current_total: number;
  gain: number;
  changes: LineupChange[];
  bench: Player[];
  total: number;
  empty: string[];
  warnings: { slot: string; player: string; injury: Injury }[];
  close_calls?: CloseCall[];
  lock_calls?: LockCall[];
  /** Taxi/IR players who would help - each at the price of a roster move. */
  activations?: ActivationOption[];
  /** Taxi and IR: on the roster, but not startable without a roster move. */
  stashed?: Player[];
  matchup?: MatchupStance | null;
  positions: string[];
};

/** Slot, player, opponent, our forecast, the number it is compared against. */
const COLUMNS = "grid grid-cols-[2.75rem_minmax(0,1fr)_3rem_2.5rem_2.5rem] gap-x-2 px-3";

/** Edge to edge on a phone: every pixel goes to the player's name. */
const TABLE = "panel overflow-hidden -mx-4 sm:mx-0 border-x-0 sm:border-x";

function TableHead({ first, base }: { first: string; base: string }) {
  return (
    <div
      aria-hidden="true"
      className={`${COLUMNS} py-1.5 text-[11px] font-semibold tracking-wide text-muted border-b border-line`}
    >
      <span>{first}</span>
      <span>SPIELER</span>
      <span className="text-center">GEGNER</span>
      <span className="text-right">PROG</span>
      <span className="text-right">{base}</span>
    </div>
  );
}

/** One line of the table, for a seat and for the bench alike. */
function PlayerRow({
  chip,
  player,
  sub,
  meta,
  note,
  changed = false,
}: {
  chip: React.ReactNode;
  player: Player;
  /** In front of the team, in the line under the name. */
  sub?: React.ReactNode;
  /** Behind the team, in the same line. */
  meta?: string;
  /** A line in the colour of changes: what happens to this row. */
  note?: React.ReactNode;
  changed?: boolean;
}) {
  return (
    <div className={`${COLUMNS} items-center py-2 border-b border-line last:border-b-0 ${changed ? "bg-change" : ""}`}>
      {chip}
      <div className="min-w-0">
        <div className="font-display font-semibold text-lg leading-tight text-ink flex items-center gap-1.5">
          <span className="truncate">{player.name}</span>
          <InjuryBadge injury={player.injury} short />
        </div>
        <div className="text-[13px] text-muted flex items-center gap-1.5 flex-wrap">
          {sub}
          <span>{player.team}</span>
          {meta && <span className="truncate">· {meta}</span>}
          <LockBadge player={player} />
        </div>
        {note && <div className="text-[13px] font-semibold text-change-ink">{note}</div>}
      </div>
      <OppChip player={player} />
      <span className="display text-right text-xl normal-case tracking-normal font-bold text-ink">
        {startPts(player).toFixed(1)}
      </span>
      <span className="text-right text-sm text-muted">{player.pts_week_base?.toFixed(1) ?? "–"}</span>
      <div className="col-span-full empty:hidden">
        <SignalBadges player={player} />
        <ForecastDetail player={player} />
      </div>
    </div>
  );
}

/** One seat, showing both answers at once: who the optimizer wants there, and
 *  who is sitting there now.
 *
 *  This used to be a toggle between two lists. Comparing two lineups by
 *  flipping between them is work the page can do instead: the reader had to
 *  hold eleven names in their head to spot the three that moved. A seat whose
 *  occupant should change now says so on its own row, in the colour of
 *  changes, and says where the outgoing player goes, because "moves to the
 *  FLEX" and "goes to the bench" are very different instructions. */
function SeatRow({
  slot,
  accepts,
  optimal,
  displaced,
  movesTo,
  incoming,
  backup,
}: {
  slot: string;
  accepts?: string[];
  optimal: Player | null;
  /** Who sits here now, when that is actually a change worth acting on. */
  displaced: Player | null;
  /** Where the displaced player goes: a slot name, or null for the bench. */
  movesTo?: string | null;
  /** The optimal occupant is not currently starting anywhere. */
  incoming: boolean;
  backup?: string;
}) {
  const chip = <SlotBadge slot={slot} accepts={accepts} compact highlight={!!displaced} />;
  if (!optimal) {
    return (
      <div className={`${COLUMNS} items-center py-3 border-b border-line last:border-b-0 bg-red-900/10`}>
        {chip}
        <span className="col-span-4 text-red-400 text-sm font-medium">
          Kein zulässiger Spieler für diesen Slot
        </span>
      </div>
    );
  }
  // A seat already shows the position, unless he is in a flex or can play more.
  const showPos = optimal.pos !== slot || (optimal.elig?.length ?? 0) > 1;
  return (
    <PlayerRow
      chip={chip}
      player={optimal}
      changed={!!displaced}
      sub={showPos ? <EligBadges player={optimal} /> : undefined}
      meta={backup ? `Backup: ${backup}` : undefined}
      note={
        displaced ? (
          <>
            {incoming ? "REIN für " : "Statt "}
            {displaced.name} → {movesTo ? slotLabel(movesTo) : "Bank"}
          </>
        ) : undefined
      }
    />
  );
}

/** One recommended change: who comes in, who goes, what it brings. */
function SwapCard({ change }: { change: LineupChange }) {
  const gain = change.out ? startPts(change.in) - startPts(change.out) : null;
  return (
    <div className="flex items-stretch bg-change">
      <div className="flex-1 min-w-0 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-xs font-bold uppercase tracking-wide text-change-ink">Rein</span>
          <PosBadge pos={change.in.pos} />
          <span className="font-display font-bold text-xl leading-tight text-ink truncate">{change.in.name}</span>
          <InjuryBadge injury={change.in.injury} />
          <span className="ml-auto text-sm font-semibold text-ink">{startPts(change.in)}</span>
        </div>
        {change.out && (
          <div className="flex items-center gap-2 text-muted">
            <span className="w-9 shrink-0 text-xs font-bold uppercase tracking-wide">Raus</span>
            <PosBadge pos={change.out.pos} />
            <span className="text-[15px] truncate">{change.out.name}</span>
            <InjuryBadge injury={change.out.injury} />
            <span className="ml-auto text-sm">{startPts(change.out)}</span>
          </div>
        )}
      </div>
      {gain != null && (
        <div className="display w-16 shrink-0 flex items-center justify-center bg-highlight text-on-highlight text-[26px]">
          {gain > 0 ? "+" : ""}
          {gain.toFixed(1)}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ current, optimal, gain }: { current?: number; optimal?: number; gain: number }) {
  const label = "text-xs font-semibold tracking-wider uppercase";
  const value = "display text-[40px] normal-case tracking-normal mt-0.5";
  return (
    <section aria-label="Punkte der Aufstellung" className="grid grid-cols-3 bg-bar text-bar-ink">
      <div className="px-3 pt-2.5 pb-2">
        <div className={label}>Aktuell</div>
        <div className={`${value} font-bold`}>{current}</div>
      </div>
      <div className="px-3 pt-2.5 pb-2 border-l border-bar-line">
        <div className={label}>Optimal</div>
        <div className={`${value} font-bold`}>{optimal}</div>
      </div>
      <div className={`px-3 pt-2.5 pb-2 ${gain > 0 ? "bg-highlight text-on-highlight" : "border-l border-bar-line"}`}>
        <div className={label}>Gewinn</div>
        <div className={value}>{gain > 0 ? `+${gain}` : gain}</div>
      </div>
    </section>
  );
}

function HowItWorks({
  currentTotal,
  optimalTotal,
  gain,
  changes,
  week,
}: {
  currentTotal?: number;
  optimalTotal?: number;
  gain: number;
  changes: number;
  week: number | null;
}) {
  return (
    <details className="panel border-blue-500/30 bg-blue-900/10 p-4 group">
      <summary className="cursor-pointer list-none select-none text-blue-300 font-bold text-sm flex items-center gap-2">
        <span>Wie wird das berechnet?</span>
        <span className="font-normal text-muted text-xs">
          Prognose, Slot-Zuordnung und Gewinnrechnung
        </span>
        <span className="ml-auto text-xs text-muted group-open:hidden">Aufklappen ▸</span>
        <span className="ml-auto text-xs text-muted hidden group-open:inline">Zuklappen ▾</span>
      </summary>

      <div className="mt-4 space-y-4 text-xs text-ink-soft leading-relaxed">
        <div>
          <h4 className="text-ink font-semibold text-sm mb-1">
            1. Woher die Punkte kommen
          </h4>
          <p className="mb-2">
            {week ? (
              <>
                Jede Zahl ist unsere <strong className="text-ink">Prognose für
                Woche {week}</strong>: Sleepers Wochenprognose, gemischt mit der
                Form der letzten Spiele und der generellen Qualität des Spielers,
                korrigiert um Gegner und Wetter — so weit das im Backtest auf der
                Saison 2025 bessere Entscheidungen gebracht hat. Wo nicht, bleibt
                es bei Sleeper. Weicht die Prognose von Sleeper ab, steht Sleepers
                Zahl klein daneben; unter jedem Spieler lässt sich aufklappen,
                wie seine Zahl zustande kommt.{" "}
                <Link href="/prognose" className="text-blue-400 hover:text-blue-300">
                  Das ganze Modell →
                </Link>
              </>
            ) : (
              <>Außerhalb der Saison gibt es keine Wochenprognose — dann zählt die
              Saisonprognose.</>
            )}
          </p>
          <p>
            Bye ergibt 0, <em>Out</em> ebenfalls, <em>Doubtful</em> wird
            abgeschlagen. <em>Questionable</em> bleibt ohne Abschlag: die meisten
            spielen, und ob dieser spielt, steht vor dem Kickoff fest. Spieler,
            deren Spiel schon gelaufen ist (<span className="text-muted">🔒
            gespielt</span>), bleiben, wo sie sind; optimiert wird nur der Rest.
            Alle Punkte laufen durch das <em>Scoring deiner Liga</em>.
          </p>
        </div>

        <div>
          <h4 className="text-ink font-semibold text-sm mb-1">
            2. Warum Punkte und nicht DVS/RVS
          </h4>
          <p>
            Die Aufstellung ist eine Punktefrage. RVS skaliert QBs runter und TEs
            hoch, damit sich <em>Assets</em> vergleichen lassen — für einen
            FLEX-Platz ist das falsch: ein TE mit 150 projizierten Punkten würde
            sonst einen RB mit 170 verdrängen. Hier zählen deshalb echte
            Projektionspunkte.
          </p>
        </div>

        <div>
          <h4 className="text-ink font-semibold text-sm mb-1">
            3. Wie die Slots besetzt werden
          </h4>
          <p>
            Jeder Spieler wird über <code className="text-blue-300">fantasy_positions</code>{" "}
            allen Slots zugeordnet, die ihn zulassen — inklusive FLEX, SUPERFLEX,
            G/F und UTIL. Ein Cornerback zählt damit als DB, ein Combo-Guard als
            PG <em>und</em> SG. Die Zuordnung maximiert den{" "}
            <strong className="text-ink">Gesamtwert</strong> der Aufstellung, nicht
            den einzelnen Platz: es kann sich lohnen, den besten Spieler in den
            FLEX zu setzen, damit sein Stammplatz für jemand anderen frei wird.
            Das Ergebnis ist mathematisch optimal, keine Näherung.
          </p>
        </div>

        <div>
          <h4 className="text-ink font-semibold text-sm mb-1">
            4. Woher der Gewinn kommt
          </h4>
          <p>
            {changes === 0 ? (
              <>
                Deine aktuelle Aufstellung erreicht bereits{" "}
                <span className="text-ink font-medium">{currentTotal}</span> Punkte
                — dasselbe wie die optimale. Es gibt nichts zu tauschen.
              </>
            ) : (
              <>
                Aktuelle Aufstellung{" "}
                <span className="text-ink font-medium">{currentTotal}</span>, optimale{" "}
                <span className="text-ink font-medium">{optimalTotal}</span> — Differenz{" "}
                <span className="text-green-400 font-bold">+{gain}</span>. Verglichen wird{" "}
                <em>spielerweise</em>, nicht platzweise: zwei Spieler, die zwischen
                zwei gleichwertigen Slots tauschen, ändern nichts und werden
                deshalb auch nicht als Änderung gemeldet. Rein und Raus werden
                zuerst innerhalb desselben Slots gepaart — Kicker gegen Kicker —
                und erst danach über Positionen hinweg.
              </>
            )}
          </p>
        </div>

        <div>
          <h4 className="text-ink font-semibold text-sm mb-1">
            5. Was in den Zeilen steht
          </h4>
          <p>
            Jede Zeile ist ein Startplatz mit dem Spieler, der dort stehen sollte.
            Gelb markiert sind die Plätze, die sich ändern:{" "}
            <span className="text-change-ink font-semibold">REIN</span> heißt, er
            startet aktuell nirgends, dahinter steht, wer dort <em>jetzt</em> sitzt
            und ob er auf die Bank geht oder nur auf einen anderen Platz rückt.
            Die Spalte Gegner zeigt, wie schwer der Gegner für seine Position ist:
            rot gehört zum Drittel der Liga, das dieser Position am wenigsten
            Punkte erlaubt, grün zu dem, das am meisten erlaubt. PROG ist unsere
            Prognose, SLPR die von Sleeper. Zeilen ohne
            Durchstreichung bleiben, wie sie sind.
          </p>
        </div>
      </div>
    </details>
  );
}

const SECTIONS = [
  { id: "aufstellung", label: "Aufstellung" },
  { id: "bank", label: "Bank" },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

function LineupContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const leagueId = searchParams.get("league_id");
  const sport = searchParams.get("sport") ?? "nfl";

  useRememberLeague(username, leagueId, sport);

  const [data, setData] = useState<LineupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const sections = useSections("lineup.sections", SECTION_IDS);

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

  // `current` and `slots` are both built from the league's non-bench roster
  // positions in order, so index i is the same seat in both.
  const seats = useMemo(() => {
    const slots = data?.slots ?? [];
    const seated = data?.current_slots ?? [];
    const nowIds = new Set(
      seated.map((s) => s.player?.id).filter(Boolean) as string[]
    );
    const optimalSlotOf = new Map<string, string>();
    for (const s of slots) if (s.player) optimalSlotOf.set(s.player.id, s.slot);

    return slots.map((s, idx) => {
      const now = seated[idx]?.player ?? null;
      const incoming = !!s.player && !nowIds.has(s.player.id);
      // A displaced player who still starts somewhere is being moved, not
      // benched — no entry in the map means the bench.
      const movesTo = now ? optimalSlotOf.get(now.id) ?? null : null;
      const toBench = !!now && movesTo === null;
      // Two players trading two interchangeable RB seats is not a change: the
      // total is identical and there is nothing for the manager to do. The
      // per-seat view would otherwise report it twice, once in each direction,
      // which is exactly the noise the change list above was built to avoid.
      const changed = now && now.id !== s.player?.id && (incoming || toBench);
      return {
        key: `${s.slot}-${idx}`,
        slot: s.slot,
        accepts: s.accepts,
        optimal: s.player,
        displaced: changed ? now : null,
        movesTo,
        incoming,
        backup: s.alternatives?.[0]?.name,
      };
    });
  }, [data]);

  if (!username || !leagueId) {
    return (
      <div className="panel p-8 text-center">
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
      <div className="panel p-8 text-center">
        <p className="text-red-400">{error}</p>
        <Link href="/" className="mt-4 inline-block text-blue-400 hover:text-blue-300">
          ← Zurück zum Dashboard
        </Link>
      </div>
    );
  }

  const changes = data?.changes ?? [];
  const bench = data?.bench ?? [];
  const stashed = data?.stashed ?? [];
  const warnings = data?.warnings ?? [];
  const gain = data?.gain ?? 0;
  const week = data?.week ?? null;
  const benchedIds = new Set(
    changes.map((c) => c.out?.id).filter(Boolean) as string[]
  );

  const baseLabel = sport === "nba" ? "O. A." : "SLPR";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-extrabold leading-none text-ink">
            {week ? `Woche ${week}` : "Aufstellung"}
          </h1>
          <p className="text-sm text-muted mt-1 truncate">{data?.league.name}</p>
        </div>
        <button
          onClick={() => {
            setRefreshing(true);
            setReloadToken((t) => t + 1);
          }}
          disabled={refreshing}
          aria-label="Neu laden"
          title="Neu laden"
          className="w-11 h-11 shrink-0 flex items-center justify-center border border-line text-ink disabled:opacity-50"
        >
          <svg
            className={`h-5 w-5 ${refreshing ? "animate-spin" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 11a8 8 0 1 0-2.3 6.3" />
            <path d="M20 4v7h-7" />
          </svg>
        </button>
      </div>

      <ScoreBar current={data?.current_total} optimal={data?.total} gain={gain} />

      <section className="space-y-2.5">
        <h2 className="text-[26px] font-extrabold uppercase leading-none text-ink">
          {changes.length > 0
            ? `${changes.length} Wechsel`
            : "Aufstellung ist optimal"}
        </h2>
        {changes.map((c, i) => (
          <SwapCard key={i} change={c} />
        ))}
        <div className="space-y-2 pt-1">
          <MatchupLine stance={data?.matchup} />
          <LockCalls calls={data?.lock_calls} />
          <ActivationOptions options={data?.activations} />
          <CloseCalls calls={data?.close_calls} />
        </div>
        {changes.length > 1 && (
          <p className="text-xs text-muted">
            Rein und Raus sind wo möglich im selben Slot gepaart, sonst über
            Positionen hinweg — entscheidend ist die Menge, nicht das einzelne
            Paar. Der Gesamtgewinn oben stimmt exakt.
          </p>
        )}
      </section>

      {warnings.length > 0 && (
        <div className="panel p-4 border-l-4 border-l-yellow-500 bg-yellow-900/10">
          <h3 className="text-yellow-300 font-bold text-sm mb-2">
            Verletzungsstatus in deiner Startelf
          </h3>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="text-sm text-ink-soft">
                <span className="text-muted">{slotLabel(w.slot)}</span> — {w.player}:{" "}
                <span className="text-yellow-300">{w.injury.label ?? w.injury.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SectionNav items={SECTIONS} state={sections} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2">
        <Section
          id="aufstellung"
          title="Aufstellung"
          accent="bg-ink"
          summary={seats
            .filter((s) => s.optimal)
            .map((s) => s.optimal!.name)
            .join(" · ")}
          state={sections}
        >
          {sport === "nfl" && week && (
            <div aria-label="Legende Gegnerstärke" className="flex items-center gap-1 text-xs font-semibold">
              <span className="mr-1 font-medium text-muted">Gegner</span>
              {TIER_LEGEND.map((tier) => (
                <span key={tier.label} className={`px-1.5 py-0.5 ${tier.chip}`}>
                  {tier.label}
                </span>
              ))}
            </div>
          )}

          <div className={TABLE}>
            <TableHead first="SLOT" base={baseLabel} />
            {seats.map((seat) => (
              <SeatRow
                key={seat.key}
                slot={seat.slot}
                accepts={seat.accepts}
                optimal={seat.optimal}
                displaced={seat.displaced}
                movesTo={seat.movesTo}
                incoming={seat.incoming}
                backup={seat.backup}
              />
            ))}
          </div>
        </Section>
        </div>

        <div className="lg:col-span-1">
        <Section
          id="bank"
          title="Bank"
          accent="bg-raised-2"
          meta={`${bench.length}`}
          summary={bench
            .slice(0, 4)
            .map((p) => p.name)
            .join(" · ")}
          state={sections}
        >

          <div className="space-y-2">
            {bench.length > 0 && (
              <div className={TABLE}>
                <TableHead first="POS" base={baseLabel} />
                {bench.map((p) => (
                  <PlayerRow
                    key={p.id}
                    chip={<SlotBadge slot={p.pos} compact />}
                    player={p}
                    note={benchedIds.has(p.id) ? "Sollte raus" : undefined}
                  />
                ))}
              </div>
            )}
            {bench.length === 0 && (
              <div className="panel p-4 text-center text-muted text-sm">
                Alle Spieler stehen in der Aufstellung.
              </div>
            )}
            {stashed.length > 0 && (
              <div className="pt-2 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Taxi &amp; IR — nicht aufstellbar ohne Kaderzug
                </div>
                {stashed.map((p) => (
                  <div
                    key={p.id}
                    className="panel p-3 flex items-start justify-between gap-3 opacity-70"
                  >
                    <div className="text-sm text-ink-soft flex items-center gap-2 flex-wrap min-w-0">
                      <StashBadge stash={p.stash} />
                      <EligBadges player={p} />
                      {p.name}
                      <InjuryBadge injury={p.injury} />
                    </div>
                    <span className="text-sm text-muted shrink-0">{startPts(p)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
        </div>
      </div>

      <HowItWorks
        currentTotal={data?.current_total}
        optimalTotal={data?.total}
        gain={gain}
        changes={changes.length}
        week={week}
      />
    </div>
  );
}

export default function LineupOptimizer() {
  return (
    <Suspense fallback={<div className="text-center p-12 text-muted">Lade Aufstellung…</div>}>
      <LineupContent />
    </Suspense>
  );
}
