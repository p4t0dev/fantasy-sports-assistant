"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import type { League, Draft } from "@/lib/types";
import {
  subscribeToSearch,
  getSearchSnapshot,
  getSearchServerSnapshot,
  writeSearch,
  ageLabel,
} from "@/lib/leagueCache";

const SPORTS = [
  { id: "nfl", label: "NFL" },
  { id: "nba", label: "NBA" },
];

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

  const username = usernameInput ?? cached?.username ?? "p4t0b4ll3rs";
  const season = seasonInput ?? cached?.season ?? "all";
  const sport = sportInput ?? cached?.sport ?? "nfl";
  const baseLeagues = fetched?.leagues ?? cached?.leagues ?? [];
  const leagues = [
    ...extraLeagues,
    ...baseLeagues.filter((l) => !extraLeagues.some((e) => e.league_id === l.league_id)),
  ];
  const drafts = fetched?.drafts ?? cached?.drafts ?? [];
  const cachedAt = fetched ? null : cached?.savedAt ?? null;

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

  const fetchLeagues = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username) return;

    setLoading(true);
    setError("");

    try {
      const [leaguesData, draftsData] = await Promise.all([
        apiGet<League[]>("get_user_leagues", { username, season, sport }),
        apiGet<Draft[]>("get_user_drafts", { username, season, sport }),
      ]);
      const nextLeagues = Array.isArray(leaguesData) ? leaguesData : [];
      const nextDrafts = Array.isArray(draftsData) ? draftsData : [];
      setFetched({ leagues: nextLeagues, drafts: nextDrafts });
      writeSearch({ username, sport, season, leagues: nextLeagues, drafts: nextDrafts });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ein Fehler ist aufgetreten");
    } finally {
      setLoading(false);
    }
  };

  const linkParams = (extra: Record<string, string>) =>
    new URLSearchParams({ username, sport, ...extra }).toString();

  return (
    <div className="space-y-8">
      <div className="text-center py-12 px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
          Dominate Your <span className="text-blue-500">Dynasty</span>
        </h1>
        <p className="max-w-2xl mx-auto text-xl text-gray-400">
          Waiver-Empfehlungen mit Live-Spielernews, Verletzungsstatus und FAAB-Geboten — plus
          Draft-Analyse auf Basis mehrjähriger Daten.
        </p>
      </div>

      <div className="glass-panel p-6 sm:p-8 max-w-xl mx-auto">
        <form onSubmit={fetchLeagues} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-300">
              Sleeper Username
            </label>
            <div className="mt-1 flex flex-col sm:flex-row gap-2 rounded-md shadow-sm">
              <input
                type="text"
                name="username"
                id="username"
                className="flex-1 min-w-0 block w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white placeholder-gray-500 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                placeholder="e.g. patrickschmidt"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <select
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white text-sm focus:ring-blue-500 focus:border-blue-500 cursor-pointer"
              >
                <option value="all">Alle Saisons</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
              </select>
              <button
                type="submit"
                disabled={loading || !username}
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 btn"
              >
                {loading ? "Lädt…" : "Ligen laden"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Sportart:</span>
            <div className="bg-gray-900 rounded-lg p-1 flex border border-gray-800">
              {SPORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSportInput(s.id);
                    setFetched({ leagues: [], drafts: [] });
                    setExtraLeagues([]);
                  }}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    sport === s.id ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </form>

        <div className="mt-6 pt-6 border-t border-gray-800">
          <form onSubmit={addManualLeague} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-1.5 rounded-md bg-gray-900 border border-gray-700 text-white text-xs placeholder-gray-500"
              placeholder="Liga ID direkt eingeben (z. B. 1318881290115633152)"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
            />
            <button
              type="submit"
              disabled={manualLoading || !manualId.trim()}
              className="px-3 py-1.5 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium border border-gray-700 disabled:opacity-50"
            >
              {manualLoading ? "Lade…" : "+ Liga ID hinzufügen"}
            </button>
          </form>
        </div>
      </div>

      {!loading && leagues.length === 0 && drafts.length === 0 && (
        <p className="text-center text-gray-500 text-sm">
          Noch keine Ligen geladen. Username eingeben, Sportart wählen und „Ligen laden“ drücken.
        </p>
      )}

      {(leagues.length > 0 || drafts.length > 0) && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-2xl font-bold text-white">
              Deine Ligen &amp; Drafts <span className="text-gray-500 text-lg">({sport.toUpperCase()})</span>
            </h2>
            {cachedAt && (
              <span className="text-xs text-gray-500">
                zwischengespeichert {ageLabel(cachedAt)} · „Ligen laden“ holt neu
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {leagues.map((league) => {
              const leagueDrafts = drafts.filter((d) => d.league_id === league.league_id);

              return (
                <div
                  key={league.league_id}
                  className="glass-panel overflow-hidden transition-all hover:border-blue-500/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] flex flex-col h-full"
                >
                  <div className="px-6 py-5 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-lg leading-6 font-medium text-white truncate" title={league.name}>
                        {league.name}
                      </h3>
                      <span className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-900/50 text-blue-300 border border-blue-800">
                        {league.total_rosters} Teams
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
                      <p>Saison: {league.season}</p>
                      <p>
                        Status: <span className="capitalize">{league.status}</span>
                      </p>
                    </div>
                  </div>
                  <div className="bg-gray-900/50 px-6 py-3 border-t border-gray-800 flex flex-wrap gap-4 justify-between items-center">
                    <Link
                      href={`/waivers?${linkParams({ league_id: league.league_id })}`}
                      className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                    >
                      Waiver Wire →
                    </Link>
                    <Link
                      href={`/lineup?${linkParams({ league_id: league.league_id })}`}
                      className="text-blue-400 hover:text-blue-300 text-sm font-medium"
                    >
                      Lineup Optimizer →
                    </Link>
                    {leagueDrafts.map((d) => (
                      <Link
                        key={d.draft_id}
                        href={`/draft?${linkParams({ draft_id: d.draft_id })}`}
                        className="text-green-400 hover:text-green-300 text-sm font-medium w-full text-center mt-2 pt-2 border-t border-gray-800"
                      >
                        Draft Assistant ({d.status}) →
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
                  className="glass-panel overflow-hidden transition-all border-green-500/30 hover:border-green-500/60 hover:shadow-[0_0_15px_rgba(34,197,94,0.2)] flex flex-col h-full"
                >
                  <div className="px-6 py-5 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-lg leading-6 font-medium text-white truncate" title={draft.name}>
                        {draft.name}
                      </h3>
                      <span className="shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-300 border border-green-800">
                        Mock Draft
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
                      <p>
                        Status: <span className="capitalize">{draft.status}</span>
                      </p>
                    </div>
                  </div>
                  <div className="bg-gray-900/50 px-6 py-3 border-t border-gray-800 flex justify-end">
                    <Link
                      href={`/draft?${linkParams({ draft_id: draft.draft_id })}`}
                      className="text-green-400 hover:text-green-300 text-sm font-medium w-full text-center"
                    >
                      Draft Assistant öffnen →
                    </Link>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
