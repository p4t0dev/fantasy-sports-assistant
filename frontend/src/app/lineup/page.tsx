"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { Player, LineupSlot, Injury } from "@/lib/types";
import {
  InjuryBadge,
  SignalBadges,
  PosBadge,
  EligBadges,
  SlotBadge,
} from "@/components/PlayerBadges";
import { slotLabel } from "@/lib/positions";

type Change = {
  slot: string | null;
  in: Player;
  out: Player | null;
};

type LineupData = {
  league: { name: string; teams: number };
  slots: LineupSlot[];
  current_slots: { slot: string; player: Player | null }[];
  current_total: number;
  gain: number;
  changes: Change[];
  bench: Player[];
  total: number;
  empty: string[];
  warnings: { slot: string; player: string; injury: Injury }[];
  positions: string[];
};

/** One seat, showing both answers at once: who the optimizer wants there, and
 *  who is sitting there now.
 *
 *  This used to be a toggle between two lists. Comparing two lineups by
 *  flipping between them is work the page can do instead: the reader had to
 *  hold eleven names in their head to spot the three that moved. A seat whose
 *  occupant should change now says so on its own row, with the outgoing player
 *  struck through underneath — and says where he goes, because "moves to the
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
  return (
    <div
      className={`glass-panel p-4 flex items-start gap-4 ${
        !optimal
          ? "border-l-4 border-l-red-500 bg-red-900/10"
          : displaced
          ? "border-l-4 border-l-blue-500 bg-blue-900/10"
          : "border-l-4 border-l-transparent"
      }`}
    >
      <SlotBadge slot={slot} accepts={accepts} />

      <div className="flex-1 min-w-0 space-y-1.5">
        {optimal ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-white font-medium flex items-center gap-2 flex-wrap">
                {incoming && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-green-300 border border-green-700 bg-green-900/30 px-1.5 py-0.5 rounded">
                    Rein
                  </span>
                )}
                <EligBadges player={optimal} />
                {optimal.name}
                <InjuryBadge injury={optimal.injury} />
              </div>
              <div className="text-xs text-gray-500">
                {optimal.team} • Age {optimal.age}
                {backup && <span className="text-gray-600"> · Backup: {backup}</span>}
              </div>
              <SignalBadges player={optimal} />
            </div>
            <div className="flex flex-col items-end shrink-0">
              <span className="text-sm font-bold text-blue-300">{optimal.pts}</span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Proj</span>
            </div>
          </div>
        ) : (
          <span className="text-red-400 text-sm font-medium">
            Kein zulässiger Spieler für diesen Slot
          </span>
        )}

        {displaced && (
          <div className="flex items-start justify-between gap-3 pt-1.5 border-t border-gray-700/60">
            <div className="min-w-0 text-sm flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                aktuell
              </span>
              <PosBadge pos={displaced.pos} className="opacity-60" />
              <span className="text-gray-500 line-through">{displaced.name}</span>
              <span className="text-[11px] text-gray-500">
                {movesTo ? (
                  <span className="text-blue-300/80">→ {slotLabel(movesTo)}</span>
                ) : (
                  <span className="text-red-400/80">→ Bank</span>
                )}
              </span>
            </div>
            <span className="text-sm text-gray-600 line-through shrink-0">
              {displaced.pts}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function HowItWorks({
  currentTotal,
  optimalTotal,
  gain,
  changes,
}: {
  currentTotal?: number;
  optimalTotal?: number;
  gain: number;
  changes: number;
}) {
  return (
    <details className="glass-panel border-blue-500/30 bg-blue-900/10 p-4 group">
      <summary className="cursor-pointer list-none select-none text-blue-300 font-bold text-sm flex items-center gap-2">
        <span>💡 Wie wird das berechnet?</span>
        <span className="font-normal text-gray-400 text-xs">
          Prognose, Slot-Zuordnung und Gewinnrechnung
        </span>
        <span className="ml-auto text-xs text-gray-500 group-open:hidden">Aufklappen ▸</span>
        <span className="ml-auto text-xs text-gray-500 hidden group-open:inline">Zuklappen ▾</span>
      </summary>

      <div className="mt-4 space-y-4 text-xs text-gray-300 leading-relaxed">
        <div>
          <h4 className="text-white font-semibold text-sm mb-1">
            1. Woher „Proj“ kommt
          </h4>
          <p>
            Sleeper veröffentlicht eine Saisonprognose pro Spieler — im selben
            Stat-Schema wie die echten Statistiken (<code className="text-blue-300">pass_yd</code>,{" "}
            <code className="text-blue-300">reb</code>, <code className="text-blue-300">idp_tkl_solo</code>{" "}
            …). Diese Rohwerte laufen durch das <em>Scoring deiner Liga</em>, nicht
            durch ein zweites Modell: eine 0.5-PPR-Liga und eine Full-PPR-Liga
            bekommen aus derselben Prognose verschiedene Punkte. Danach greift
            nur noch der Verletzungsabschlag — eine Meldung von heute ist jünger
            als die Prognose. Depth-Chart- und Teamstärke-Faktoren entfallen
            bewusst, weil Sleeper beides bereits eingepreist hat.
          </p>
        </div>

        <div>
          <h4 className="text-white font-semibold text-sm mb-1">
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
          <h4 className="text-white font-semibold text-sm mb-1">
            3. Wie die Slots besetzt werden
          </h4>
          <p>
            Jeder Spieler wird über <code className="text-blue-300">fantasy_positions</code>{" "}
            allen Slots zugeordnet, die ihn zulassen — inklusive FLEX, SUPERFLEX,
            G/F und UTIL. Ein Cornerback zählt damit als DB, ein Combo-Guard als
            PG <em>und</em> SG. Die Zuordnung maximiert den{" "}
            <strong className="text-white">Gesamtwert</strong> der Aufstellung, nicht
            den einzelnen Platz: es kann sich lohnen, den besten Spieler in den
            FLEX zu setzen, damit sein Stammplatz für jemand anderen frei wird.
            Das Ergebnis ist mathematisch optimal, keine Näherung.
          </p>
        </div>

        <div>
          <h4 className="text-white font-semibold text-sm mb-1">
            4. Woher der Gewinn kommt
          </h4>
          <p>
            {changes === 0 ? (
              <>
                Deine aktuelle Aufstellung erreicht bereits{" "}
                <span className="text-gray-100 font-medium">{currentTotal}</span> Punkte
                — dasselbe wie die optimale. Es gibt nichts zu tauschen.
              </>
            ) : (
              <>
                Aktuelle Aufstellung{" "}
                <span className="text-gray-100 font-medium">{currentTotal}</span>, optimale{" "}
                <span className="text-gray-100 font-medium">{optimalTotal}</span> — Differenz{" "}
                <span className="text-green-400 font-bold">+{gain}</span>. Verglichen wird{" "}
                <em>spielerweise</em>, nicht platzweise: zwei Spieler, die zwischen
                zwei gleichwertigen Slots tauschen, ändern nichts und werden
                deshalb auch nicht als Änderung gemeldet.
              </>
            )}
          </p>
        </div>

        <div>
          <h4 className="text-white font-semibold text-sm mb-1">
            5. Was in den Zeilen steht
          </h4>
          <p>
            Jede Zeile ist ein Startplatz. Oben steht, wer dort stehen sollte —{" "}
            <span className="text-green-300 font-semibold">Rein</span> markiert
            jemanden, der aktuell nirgends startet. Darunter durchgestrichen, wer
            dort <em>jetzt</em> sitzt, mit dem Hinweis, ob er auf die Bank geht
            oder nur auf einen anderen Platz rückt. Zeilen ohne
            Durchstreichung bleiben, wie sie sind.
          </p>
        </div>
      </div>
    </details>
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

  const changes = data?.changes ?? [];
  const bench = data?.bench ?? [];
  const warnings = data?.warnings ?? [];
  const gain = data?.gain ?? 0;
  const benchedIds = new Set(
    changes.map((c) => c.out?.id).filter(Boolean) as string[]
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Lineup Optimizer</h1>
          <p className="text-gray-400 mt-1">
            <span className="text-gray-200 font-medium">{data?.league.name}</span>
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
                <SlotBadge slot={c.slot ?? "—"} />
                <span className="text-green-400 font-bold text-xs uppercase tracking-wider">Rein</span>
                <span className="text-white font-medium flex items-center gap-2">
                  <PosBadge pos={c.in.pos} />
                  {c.in.name}
                  <InjuryBadge injury={c.in.injury} />
                </span>
                <span className="text-blue-300 font-bold">{c.in.pts}</span>
                {c.out && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-red-400 font-bold text-xs uppercase tracking-wider">Raus</span>
                    <span className="text-gray-300 flex items-center gap-2">
                      <PosBadge pos={c.out.pos} />
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

      <HowItWorks
        currentTotal={data?.current_total}
        optimalTotal={data?.total}
        gain={gain}
        changes={changes.length}
      />

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
            <h2 className="text-xl font-bold text-white">Aufstellung</h2>
            <span className="text-sm text-gray-500">
              optimal {data?.total} · aktuell {data?.current_total}
            </span>
          </div>

          <div className="space-y-2">
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
        </div>

        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-8 bg-gray-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Bank</h2>
            <span className="text-sm text-gray-500">{bench.length}</span>
          </div>

          <div className="space-y-2">
            {bench.map((p) => (
              <div
                key={p.id}
                className={`glass-panel p-3 flex items-start justify-between gap-3 ${
                  benchedIds.has(p.id) ? "border-l-4 border-l-red-500/60 bg-red-900/5" : ""
                }`}
              >
                <div className="min-w-0">
                  <div className="text-sm text-white flex items-center gap-2 flex-wrap">
                    <EligBadges player={p} />
                    {p.name}
                    <InjuryBadge injury={p.injury} />
                  </div>
                  <div className="text-xs text-gray-500">
                    {p.team}
                    {benchedIds.has(p.id) && (
                      <span className="text-red-400/80"> · startet aktuell, sollte raus</span>
                    )}
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
