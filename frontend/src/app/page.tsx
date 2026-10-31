"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { League, Draft, Overview } from "@/lib/types";
import {
  subscribeToSearch,
  getSearchSnapshot,
  getSearchServerSnapshot,
  writeSearch,
  ageLabel,
} from "@/lib/leagueCache";
import { PageHead, ScoreBar } from "@/components/PageParts";

const SPORTS = [
  { id: "nfl", label: "NFL" },
  { id: "nba", label: "NBA" },
];

/** Sleeper's "in_season", "pre_draft". */
function statusLabel(status: string): string {
  return status.replace("_", " ");
}

export default function Dashboard() {
  // The last search is restored from session storage, so coming back from a
  // waiver or draft view does not force a reload of every league. Read through
  // an external store rather than an effect: the static export is prerendered
  // without storage, and this keeps hydration honest.
  const cached = useSyncExternalStore(
    subscribeToSearch,
    getSearchSnapshot,
    getSearchServerSnapshot
  );

  const [usernameInput, setUsernameInput] = useState<string | null>(null);
  const [seasonInput, setSeasonInput] = useState<string | null>(null);
  const [sportInput, setSportInput] = useState<string | null>(null);
  const [fetched, setFetched] = useState<{ leagues: League[]; drafts: Draft[] } | null>(null);
  const [extraLeagues, setExtraLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualId, setManualId] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);

  const username = usernameInput ?? cached?.username ?? "p4t0b4ll3rs";
  const season = seasonInput ?? cached?.season ?? "all";
  const sport = sportInput ?? cached?.sport ?? "nfl";
  const baseLeagues = fetched?.leagues ?? cached?.leagues ?? [];
  const allLeagues = [
    ...extraLeagues,
    ...baseLeagues.filter((l) => !extraLeagues.some((e) => e.league_id === l.league_id)),
  ];
  // "Alle Saisons" pulls three years of listings, so leagues finished long ago
  // sat next to live ones with nothing to tell them apart. They stay reachable,
  // just not in the way.
  const archivedCount = allLeagues.filter((l) => l.archived).length;
  const leagues = showArchive ? allLeagues : allLeagues.filter((l) => !l.archived);
  const allDrafts = fetched?.drafts ?? cached?.drafts ?? [];
  // A draft is only shown next to its league. Sleeper keeps returning drafts
  // for leagues that are long gone from the league listing — the user left
  // them, or they are old seasons — and rendering those as standalone cards
  // put three dozen dead leagues on the dashboard under a "Mock Draft" label
  // they never earned. A real mock draft has no league at all.
  const drafts = allDrafts.filter(
    (d) => !d.league_id || leagues.some((l) => l.league_id === d.league_id)
  );
  const cachedAt = fetched ? null : cached?.savedAt ?? null;

  // The overview is a stored snapshot, so reading it is cheap - but it only
  // exists for configured usernames, and a missing one is not an error here.
  const overviewUser = fetched ? username : cached?.username;
  useEffect(() => {
    if (!overviewUser) return;
    let active = true;
    apiGet<Overview>("get_overview", { username: overviewUser, sport })
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch(() => {
        if (active) setOverview(null);
      });
    return () => {
      active = false;
    };
    // Keyed on the searched username, not the input field: re-read after a
    // search, never on a keystroke.
  }, [overviewUser, sport, fetched]);
  const severityByLeague = new Map(
    (overview?.lineup.leagues ?? []).map((l) => [l.league_id, l.severity])
  );
  const overviewLeagues = (overview?.lineup.leagues ?? []).filter((l) => !l.skipped);
  // The waiver half of the snapshot. Snapshots from before it existed have
  // none; say when it will be there instead of saying nothing.
  const waiverLeagues = (overview?.waivers?.leagues ?? []).filter((l) => !l.skipped);
  const upgradeMoves = waiverLeagues.reduce((n, l) => n + l.lineup_moves, 0);
  const upgradeLeagues = waiverLeagues.filter((l) => l.lineup_moves > 0).length;
  const waiverSummary = !overview?.waivers
    ? "Waiver-Plan kommt mit dem nächsten Datenlauf"
    : upgradeMoves
    ? `Waiver: ${upgradeMoves} Startelf-Upgrade${upgradeMoves === 1 ? "" : "s"} in ${upgradeLeagues} ${upgradeLeagues === 1 ? "Liga" : "Ligen"}`
    : `Waiver: keine Startelf-Upgrades · ${waiverLeagues.filter((l) => l.moves.length).length} Ligen mit Kadertiefe-Moves`;
  const urgentCount = overviewLeagues.filter((l) => l.severity >= 2).length;
  const hintCount = overviewLeagues.filter((l) => l.severity === 1).length;

  const setUsername = setUsernameInput;
  const setSeason = setSeasonInput;

  const addManualLeague = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualId.trim()) return;
    setManualLoading(true);
    setError("");
    try {
      const data = await apiGet<League>("get_single_league", { league_id: manualId.trim() });
      if (data?.league_id) {
        setExtraLeagues((prev) => [data, ...prev.filter((l) => l.league_id !== data.league_id)]);
        setManualId("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden der Liga ID");
    } finally {
      setManualLoading(false);
    }
  };

  const fetchLeagues = async (e?: React.FormEvent, nextSport = sport) => {
    if (e) e.preventDefault();
    if (!username) return;

    setLoading(true);
    setError("");

    try {
      const [leaguesData, draftsData] = await Promise.all([
        apiGet<League[]>("get_user_leagues", { username, season, sport: nextSport }),
        apiGet<Draft[]>("get_user_drafts", { username, season, sport: nextSport }),
      ]);
      const nextLeagues = Array.isArray(leaguesData) ? leaguesData : [];
      const nextDrafts = Array.isArray(draftsData) ? draftsData : [];
      setFetched({ leagues: nextLeagues, drafts: nextDrafts });
      writeSearch({ username, sport: nextSport, season, leagues: nextLeagues, drafts: nextDrafts });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ein Fehler ist aufgetreten");
    } finally {
      setLoading(false);
    }
  };

  // A fresh start has nothing cached, and from the home screen every start is
  // fresh: session storage does not outlive the app. Open with the leagues
  // rather than with a form to submit. Once, so read the store and not `cached`.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- only the "Lädt…" flag; the rest arrives async
    if (!getSearchSnapshot()) void fetchLeagues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkParams = (extra: Record<string, string>) =>
    new URLSearchParams({ username, sport, ...extra }).toString();

  return (
    <div className="space-y-6">
      <PageHead
        title="Ligen"
        sub={username}
        action={
          <div className="flex shrink-0 border border-line">
            {SPORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={loading}
                onClick={() => {
                  if (s.id === sport) return;
                  setSportInput(s.id);
                  setFetched({ leagues: [], drafts: [] });
                  setExtraLeagues([]);
                  void fetchLeagues(undefined, s.id);
                }}
                className={`px-4 h-11 text-sm font-semibold transition-colors ${
                  sport === s.id ? "bg-ink text-canvas" : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        }
      />

      {overview && (
        <section className="space-y-2">
          <ScoreBar
            label={`Stand${overview.week ? ` Woche ${overview.week}` : ""}`}
            tiles={[
              { label: "Dringend", value: urgentCount, hot: urgentCount > 0 },
              { label: "Hinweise", value: hintCount },
              { label: "Upgrades", value: upgradeMoves },
            ]}
          />
          <p className="text-xs text-muted">
            {overview.week ? `Woche ${overview.week} · ` : ""}
            {urgentCount
              ? `${urgentCount} ${urgentCount === 1 ? "Aufstellung braucht" : "Aufstellungen brauchen"} Aufmerksamkeit`
              : "Alle Aufstellungen in Ordnung"}
            {" · "}
            {waiverSummary}
          </p>
          <p className="flex gap-4 text-sm">
            <Link href={`/overview?${linkParams({})}`} className="link">
              Aufstellung →
            </Link>
            <Link href={`/overview?${linkParams({})}#waiver`} className="link">
              Waiver →
            </Link>
          </p>
        </section>
      )}

      {!loading && leagues.length === 0 && drafts.length === 0 && (
        <p className="text-center text-muted text-sm">
          Noch keine Ligen geladen. Username eingeben und „Ligen laden“ drücken.
        </p>
      )}

      {(leagues.length > 0 || drafts.length > 0) && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="headline">Deine Ligen &amp; Drafts</h2>
            {cachedAt && (
              <span className="text-xs text-muted">
                zwischengespeichert {ageLabel(cachedAt)} · „Ligen laden“ holt neu
              </span>
            )}
            {archivedCount > 0 && (
              <button
                onClick={() => setShowArchive((v) => !v)}
                className="ml-auto px-3 py-1 rounded-md text-xs font-semibold border bg-surface text-muted border-line hover:text-ink"
              >
                {showArchive
                  ? `Archiv ausblenden (${archivedCount})`
                  : `Archiv einblenden (${archivedCount})`}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {leagues.map((league) => {
              const leagueDrafts = drafts.filter((d) => d.league_id === league.league_id);

              return (
                <div
                  key={league.league_id}
                  className={`panel overflow-hidden flex flex-col h-full ${
                    league.archived ? "opacity-60" : ""
                  }`}
                >
                  <div className="px-3 py-2.5 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display font-bold text-xl leading-tight text-ink truncate" title={league.name}>
                        {league.name}
                      </h3>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {league.archived && (
                          <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase bg-raised text-muted border border-line">
                            Archiv
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {league.total_rosters} Teams · {league.season} ·{" "}
                      <span className="capitalize">{statusLabel(league.status)}</span>
                    </p>
                    {(severityByLeague.get(league.league_id) ?? 0) >= 2 && (
                      <Link
                        href={`/overview?${linkParams({})}`}
                        className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${
                          severityByLeague.get(league.league_id) === 3
                            ? "text-red-300 hover:text-red-200"
                            : "text-orange-300 hover:text-orange-200"
                        }`}
                      >
                        ⚠ Aufstellung prüfen →
                      </Link>
                    )}
                  </div>
                  <div className="grid grid-cols-2 border-t border-line font-display text-[17px] font-semibold uppercase text-center">
                    <Link href={`/lineup?${linkParams({ league_id: league.league_id })}`} className="py-2 text-ink hover:bg-raised">
                      Lineup
                    </Link>
                    <Link href={`/waivers?${linkParams({ league_id: league.league_id })}`} className="py-2 text-ink hover:bg-raised border-l border-line">
                      Waiver
                    </Link>
                    {leagueDrafts.map((d) => (
                      <Link
                        key={d.draft_id}
                        href={`/draft?${linkParams({ draft_id: d.draft_id })}`}
                        className="col-span-2 py-2 text-ink hover:bg-raised border-t border-line"
                      >
                        Draft · {statusLabel(d.status)}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Drafts that belong to no league in the current list (e.g. mock drafts) */}
            {drafts
              .filter((d) => !leagues.some((l) => l.league_id === d.league_id))
              .map((draft) => (
                <div
                  key={draft.draft_id}
                  className="panel overflow-hidden flex flex-col h-full"
                >
                  <div className="px-3 py-2.5 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display font-bold text-xl leading-tight text-ink truncate" title={draft.name}>
                        {draft.name}
                      </h3>
                      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase bg-raised text-muted border border-line">
                        Mock Draft
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-muted capitalize">{statusLabel(draft.status)}</p>
                  </div>
                  <Link
                    href={`/draft?${linkParams({ draft_id: draft.draft_id })}`}
                    className="py-2 border-t border-line font-display text-[17px] font-semibold uppercase text-center text-ink hover:bg-raised"
                  >
                    Draft öffnen
                  </Link>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="panel p-4">
        <form onSubmit={fetchLeagues} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-ink-soft">
              Sleeper Username
            </label>
            <div className="mt-1 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                name="username"
                id="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md bg-surface border border-line text-ink placeholder-muted sm:text-sm"
                placeholder="e.g. patrickschmidt"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <select
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="px-3 py-2 rounded-md bg-surface border border-line text-ink sm:text-sm cursor-pointer"
              >
                <option value="all">Alle Saisons</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
              </select>
              <button
                type="submit"
                disabled={loading || !username}
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-bold text-canvas bg-ink hover:opacity-85 disabled:opacity-50"
              >
                {loading ? "Lädt…" : "Ligen laden"}
              </button>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </form>

        <div className="mt-4 pt-4 border-t border-line">
          <form onSubmit={addManualLeague} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-1.5 rounded-md bg-surface border border-line text-ink sm:text-xs placeholder-muted"
              placeholder="Liga ID direkt eingeben (z. B. 1318881290115633152)"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
            />
            <button
              type="submit"
              disabled={manualLoading || !manualId.trim()}
              className="px-3 py-1.5 rounded-md bg-raised hover:bg-raised-2 text-ink text-xs font-medium border border-line disabled:opacity-50"
            >
              {manualLoading ? "Lade…" : "+ Liga ID hinzufügen"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
