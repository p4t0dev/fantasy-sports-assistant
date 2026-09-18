"use client";

import { useEffect, useState, useSyncExternalStore, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { LineupIssue, Overview, OverviewLeague, Player } from "@/lib/types";
import { InjuryBadge, MatchupBadge, PosBadge, startPts } from "@/components/PlayerBadges";
import { slotLabel } from "@/lib/positions";
import {
  subscribeToSearch,
  getSearchSnapshot,
  getSearchServerSnapshot,
} from "@/lib/leagueCache";

// The snapshot is rebuilt at 06:00, 12:00 and 18:00 Berlin time. Anything older
// than the longest gap between two runs means a run was missed.
const STALE_AFTER_HOURS = 13;

const SEVERITY_TONE: Record<number, { border: string; text: string; dot: string }> = {
  3: { border: "border-l-red-500 bg-red-900/10", text: "text-red-300", dot: "bg-red-500" },
  2: { border: "border-l-orange-400 bg-orange-900/10", text: "text-orange-300", dot: "bg-orange-400" },
  1: { border: "border-l-yellow-500 bg-yellow-900/10", text: "text-yellow-300", dot: "bg-yellow-500" },
};

const SKIP_REASON: Record<string, string> = {
  best_ball: "Best Ball — Sleeper stellt selbst auf",
  not_in_season: "nicht in der laufenden Saison",
  no_roster: "kein Kader in dieser Liga",
};

function issueText(issue: LineupIssue): React.ReactNode {
  const name = issue.player?.name;
  const slot = issue.slot ? slotLabel(issue.slot) : "";
  switch (issue.kind) {
    case "empty":
      return <>Slot <strong className="text-white">{slot}</strong> ist leer</>;
    case "bye":
      return <><strong className="text-white">{name}</strong> ({slot}) hat diese Woche Bye</>;
    case "out":
      return (
        <>
          <strong className="text-white">{name}</strong> ({slot}) fällt aus{" "}
          <InjuryBadge injury={issue.player?.injury} />
        </>
      );
    case "doubtful":
      return (
        <>
          <strong className="text-white">{name}</strong> ({slot}) ist fraglich{" "}
          <InjuryBadge injury={issue.player?.injury} />
        </>
      );
    case "questionable":
      return (
        <>
          <strong className="text-white">{name}</strong> ({slot}) ist angeschlagen{" "}
          <InjuryBadge injury={issue.player?.injury} />
        </>
      );
    case "bench":
      return (
        <>
          Auf der Bank liegen{" "}
          <strong className="text-green-400">+{issue.gain}</strong> projizierte Punkte
        </>
      );
  }
}

function PlayerLine({ player, tone }: { player: Player; tone: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 min-w-0 flex-wrap">
        <PosBadge pos={player.pos} />
        <span className={`${tone} truncate`}>{player.name}</span>
        <MatchupBadge player={player} />
      </span>
      <span className="text-gray-400 font-medium shrink-0">{startPts(player)}</span>
    </div>
  );
}

function LeagueCard({
  league,
  week,
  linkParams,
}: {
  league: OverviewLeague;
  week: number | null;
  linkParams: string;
}) {
  const tone = SEVERITY_TONE[league.severity] ?? SEVERITY_TONE[1];
  const changes = league.changes ?? [];
  const incoming = changes.map((c) => c.in);
  const outgoing = changes.map((c) => c.out).filter((p): p is Player => p !== null);

  return (
    <div className={`glass-panel p-5 border-l-4 ${tone.border} space-y-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-lg font-bold text-white">{league.name}</h3>
        <p className="text-sm text-gray-400">
          aktuell <span className="text-gray-200 font-medium">{league.current_total}</span>
          {" → "}optimal <span className="text-gray-200 font-medium">{league.total}</span>
          {(league.gain ?? 0) > 0 && (
            <span className="text-green-400 font-bold"> (+{league.gain})</span>
          )}
        </p>
      </div>

      <ul className="space-y-1.5">
        {(league.issues ?? []).map((issue, i) => {
          const t = SEVERITY_TONE[issue.severity] ?? SEVERITY_TONE[1];
          return (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${t.dot}`} />
              <span className="flex items-center gap-1 flex-wrap">{issueText(issue)}</span>
            </li>
          );
        })}
      </ul>

      {changes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-gray-800">
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-green-400">
              Rein{week ? ` · Punkte W${week}` : ""}
            </div>
            {incoming.map((p) => (
              <PlayerLine key={p.id} player={p} tone="text-white" />
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-red-400">Raus</div>
            {outgoing.map((p) => (
              <PlayerLine key={p.id} player={p} tone="text-gray-400" />
            ))}
            {outgoing.length === 0 && (
              <p className="text-xs text-gray-500">Leere Slots werden aufgefüllt.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href={`/lineup?${linkParams}&league_id=${league.league_id}`}
          className="text-blue-400 hover:text-blue-300 text-sm font-medium"
        >
          Im Lineup Optimizer öffnen →
        </Link>
      </div>
    </div>
  );
}

function snapshotAge(generatedAt: number): { label: string; stale: boolean } {
  const hours = (Date.now() / 1000 - generatedAt) / 3600;
  const label =
    hours < 1 ? "vor weniger als einer Stunde" : `vor ${Math.floor(hours)} Std.`;
  return { label, stale: hours > STALE_AFTER_HOURS };
}

function OverviewContent() {
  const searchParams = useSearchParams();
  const cached = useSyncExternalStore(subscribeToSearch, getSearchSnapshot, getSearchServerSnapshot);
  const username = searchParams.get("username") ?? cached?.username ?? null;
  const sport = searchParams.get("sport") ?? "nfl";

  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!username) return;
    let active = true;
    (async () => {
      try {
        const result = await apiGet<Overview>("get_overview", { username, sport });
        if (!active) return;
        setData(result);
        setError("");
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Ein Fehler ist aufgetreten");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [username, sport]);

  if (!username) {
    return (
      <div className="glass-panel p-8 text-center">
        <p className="text-gray-300">Kein Username bekannt.</p>
        <Link href="/" className="mt-4 inline-block text-blue-400 hover:text-blue-300">
          ← Auf dem Dashboard Ligen laden
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

  if (error || !data) {
    return (
      <div className="glass-panel p-8 text-center space-y-3">
        <p className="text-red-400">{error || "Keine Daten"}</p>
        <Link href="/" className="inline-block text-blue-400 hover:text-blue-300">
          ← Zurück zum Dashboard
        </Link>
      </div>
    );
  }

  const leagues = data.lineup.leagues;
  const flagged = leagues.filter((l) => !l.skipped && l.severity >= 1);
  const fine = leagues.filter((l) => !l.skipped && l.severity === 0);
  const skipped = leagues.filter((l) => l.skipped);
  const urgent = flagged.filter((l) => l.severity >= 2).length;
  const age = snapshotAge(data.generated_at);
  const stamp = new Date(data.generated_at * 1000).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const linkParams = new URLSearchParams({ username, sport }).toString();

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Wochenübersicht</h1>
          <p className="text-gray-400 mt-1">
            Aufstellungs-Check über alle Ligen
            {data.week ? ` · Woche ${data.week}` : ""} ·{" "}
            <span className="text-gray-200 font-medium">{data.username}</span>
          </p>
          <p className={`text-xs mt-1 ${age.stale ? "text-orange-300" : "text-gray-500"}`}>
            Stand {stamp} ({age.label}) · wird morgens, mittags und abends neu berechnet
            {age.stale && " — der letzte Lauf ist ausgeblieben"}
          </p>
        </div>
        <Link
          href="/"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium shrink-0"
        >
          ← Zurück
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { n: urgent, label: "Handlungsbedarf", tone: urgent ? "text-red-300" : "text-gray-500" },
          { n: flagged.length - urgent, label: "Hinweise", tone: "text-yellow-300" },
          { n: fine.length, label: "In Ordnung", tone: "text-green-400" },
          { n: skipped.length, label: "Übersprungen", tone: "text-gray-400" },
        ].map((tile) => (
          <div key={tile.label} className="glass-panel p-4">
            <div className={`text-2xl font-bold ${tile.tone}`}>{tile.n}</div>
            <div className="text-xs text-gray-500 uppercase tracking-wider mt-1">{tile.label}</div>
          </div>
        ))}
      </div>

      {flagged.length > 0 && (
        <div className="space-y-4">
          {flagged.map((league) => (
            <LeagueCard
              key={league.league_id}
              league={league}
              week={data.week}
              linkParams={linkParams}
            />
          ))}
        </div>
      )}

      {fine.length > 0 && (
        <div className="glass-panel p-5 space-y-2">
          <h2 className="text-sm font-bold text-green-400 uppercase tracking-wider">
            Aufstellung optimal
          </h2>
          {fine.map((league) => (
            <div key={league.league_id} className="flex justify-between gap-3 text-sm">
              <Link
                href={`/lineup?${linkParams}&league_id=${league.league_id}`}
                className="text-gray-200 hover:text-white"
              >
                ✓ {league.name}
              </Link>
              <span className="text-gray-500">{league.total}</span>
            </div>
          ))}
        </div>
      )}

      {skipped.length > 0 && (
        <div className="glass-panel p-5 space-y-2 opacity-70">
          <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Übersprungen</h2>
          {skipped.map((league) => (
            <div key={league.league_id} className="flex justify-between gap-3 text-sm">
              <span className="text-gray-300">{league.name}</span>
              <span className="text-gray-500">
                {SKIP_REASON[league.skipped ?? ""] ?? league.skipped}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="text-center p-12 text-gray-400">Lade Übersicht…</div>}>
      <OverviewContent />
    </Suspense>
  );
}
