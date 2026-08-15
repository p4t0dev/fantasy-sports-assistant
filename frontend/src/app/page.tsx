"use client";

import { useState } from "react";
import Link from "next/link";

export default function Dashboard() {
  const [username, setUsername] = useState("p4t0b4ll3rs");
  const [season, setSeason] = useState("all");
  const [leagues, setLeagues] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualId, setManualId] = useState("");
  const [manualLoading, setManualLoading] = useState(false);

  const addManualLeague = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualId.trim()) return;
    setManualLoading(true);
    setError("");
    try {
      const url = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5001/demo-no-project/us-central1";
      const res = await fetch(`${url}/get_single_league?league_id=${manualId.trim()}`);
      if (!res.ok) throw new Error("Liga mit dieser ID konnte nicht gefunden werden.");
      const data = await res.json();
      if (data && data.league_id) {
        setLeagues(prev => [data, ...prev.filter(l => l.league_id !== data.league_id)]);
        setManualId("");
      }
    } catch (err: any) {
      setError(err.message || "Fehler beim Laden der Liga ID");
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
      // Assuming Firebase functions are hosted locally or on the same domain in prod
      const url = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5001/demo-no-project/us-central1";
      const leaguesRes = await fetch(`${url}/get_user_leagues?username=${username}&season=${season}`);
      const draftsRes = await fetch(`${url}/get_user_drafts?username=${username}&season=${season}`);
      
      if (!leaguesRes.ok || !draftsRes.ok) {
        throw new Error("Failed to fetch data. Check username.");
      }
      
      const leaguesData = await leaguesRes.json();
      const draftsData = await draftsRes.json();
      setLeagues(leaguesData);
      setDrafts(draftsData);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="text-center py-12 px-4 sm:px-6 lg:px-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
          Dominate Your <span className="text-blue-500">Dynasty</span>
        </h1>
        <p className="max-w-2xl mx-auto text-xl text-gray-400">
          Advanced analytics, waiver wire recommendations, and draft analysis powered by AI and multi-year data models.
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
                <option value="all">Alle Saisons (2024-2026)</option>
                <option value="2026">2026 Season</option>
                <option value="2025">2025 Season</option>
                <option value="2024">2024 Season</option>
              </select>
              <button
                type="submit"
                disabled={loading || !username}
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 btn"
              >
                {loading ? "Loading..." : "Load Leagues"}
              </button>
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
              {manualLoading ? "Lade..." : "+ Liga ID hinzufügen"}
            </button>
          </form>
        </div>
      </div>

      {leagues.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-white">Your Leagues & Drafts</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {leagues.map((league) => {
              const leagueDrafts = drafts.filter(d => d.league_id === league.league_id);
              
              return (
                <div key={league.league_id} className="glass-panel overflow-hidden transition-all hover:border-blue-500/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] flex flex-col h-full">
                  <div className="px-6 py-5 flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg leading-6 font-medium text-white truncate" title={league.name}>
                        {league.name}
                      </h3>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-900/50 text-blue-300 border border-blue-800">
                        {league.total_rosters} Teams
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
                      <p>Season: {league.season}</p>
                      <p>Status: <span className="capitalize">{league.status}</span></p>
                    </div>
                  </div>
                  <div className="bg-gray-900/50 px-6 py-3 border-t border-gray-800 flex flex-wrap gap-4 justify-between items-center">
                    <Link href={`/waivers?league_id=${league.league_id}&username=${username}`} className="text-blue-400 hover:text-blue-300 text-sm font-medium">
                      Waiver Wire →
                    </Link>
                    <Link href={`/lineup?league_id=${league.league_id}&username=${username}`} className="text-blue-400 hover:text-blue-300 text-sm font-medium">
                      Lineup Optimizer →
                    </Link>
                    {leagueDrafts.map(d => (
                      <Link key={d.draft_id} href={`/draft?draft_id=${d.draft_id}&username=${username}`} className="text-green-400 hover:text-green-300 text-sm font-medium w-full text-center mt-2 pt-2 border-t border-gray-800">
                        Draft Assistant ({d.status}) →
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
            
            {/* Show standalone drafts (e.g. mock drafts) that don't belong to any league in the list */}
            {drafts.filter(d => !leagues.some(l => l.league_id === d.league_id)).map((draft) => (
              <div key={draft.draft_id} className="glass-panel overflow-hidden transition-all border-green-500/30 hover:border-green-500/60 hover:shadow-[0_0_15px_rgba(34,197,94,0.2)] flex flex-col h-full">
                <div className="px-6 py-5 flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg leading-6 font-medium text-white truncate" title={draft.name}>
                      {draft.name}
                    </h3>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-900/50 text-green-300 border border-green-800">
                      Mock Draft
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm text-gray-400">
                    <p>Status: <span className="capitalize">{draft.status}</span></p>
                  </div>
                </div>
                <div className="bg-gray-900/50 px-6 py-3 border-t border-gray-800 flex justify-end">
                  <Link href={`/draft?draft_id=${draft.draft_id}&username=${username}`} className="text-green-400 hover:text-green-300 text-sm font-medium w-full text-center">
                    Enter Draft Assistant →
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
