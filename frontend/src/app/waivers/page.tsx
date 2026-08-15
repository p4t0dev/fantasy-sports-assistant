"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function WaiversContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const leagueId = searchParams.get("league_id");
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortMode, setSortMode] = useState<"DVS" | "RVS">("DVS");

  useEffect(() => {
    if (!username || !leagueId) {
      setError("Missing username or league_id in URL");
      setLoading(false);
      return;
    }

    const fetchWaivers = async () => {
      try {
        const url = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5001/demo-no-project/us-central1";
        const response = await fetch(`${url}/analyze_waivers?username=${username}&league_id=${leagueId}`);
        if (!response.ok) throw new Error("Failed to analyze waivers");
        
        const result = await response.json();
        setData(result);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchWaivers();
  }, [username, leagueId]);

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
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const sortedDrops = [...(data?.drop_candidates || [])].sort((a, b) => 
    sortMode === "DVS" ? a.dvs - b.dvs : a.rvs - b.rvs
  );

  const sortedTargets = [...(data?.waiver_targets || [])].sort((a, b) => 
    sortMode === "DVS" ? b.dvs - a.dvs : b.rvs - a.rvs
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Waiver Wire Assistant</h1>
          <p className="text-gray-400 mt-1">Recommendations for league {leagueId}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-gray-900 rounded-lg p-1 flex">
            <button 
              onClick={() => setSortMode("RVS")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${sortMode === "RVS" ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"}`}
            >
              Redraft Focus (RVS)
            </button>
            <button 
              onClick={() => setSortMode("DVS")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${sortMode === "DVS" ? "bg-blue-600 text-white shadow" : "text-gray-400 hover:text-white"}`}
            >
              Dynasty Focus (DVS)
            </button>
          </div>
          <Link href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium hidden sm:block">
            ← Back
          </Link>
        </div>
      </div>

      {/* Smart Recommendations */}
      {data?.smart_recommendations && data.smart_recommendations.length > 0 && (
        <div className="space-y-4 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Smart Recommendations (Team Needs)</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.smart_recommendations.map((rec: any, idx: number) => (
              <div key={idx} className="glass-panel p-5 border border-blue-500/30 bg-blue-900/10 flex flex-col gap-4">
                <p className="text-sm text-blue-200 bg-blue-900/30 p-2 rounded-md italic border border-blue-800/50">
                  <span className="font-semibold block mb-1">Why?</span> {rec.reason}
                </p>
                <div className="flex items-center justify-between border-b border-gray-700 pb-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-red-400 uppercase font-bold tracking-wider mb-1">Drop</span>
                    <span className="text-white font-medium">{rec.drop.name}</span>
                    <span className="text-gray-400 text-xs">{rec.drop.pos} • {rec.drop.team}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs text-gray-500">DVS</span>
                    <span className="text-red-400 font-bold">{rec.drop.dvs}</span>
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-xs text-green-400 uppercase font-bold tracking-wider mb-1">Add</span>
                    <span className="text-white font-medium">{rec.add.name}</span>
                    <span className="text-gray-400 text-xs">{rec.add.pos} • {rec.add.team}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-xs text-gray-500">DVS</span>
                    <span className="text-green-400 font-bold">{rec.add.dvs}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Drop Candidates */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-red-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Drop Candidates</h2>
          </div>
          
          <div className="space-y-3">
            {sortedDrops.map((player: any, idx: number) => (
              <div key={player.id} className={`glass-panel p-4 flex justify-between items-center ${player.is_liability ? 'border-red-500/50 bg-red-900/10' : ''}`}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center font-bold text-gray-300 text-xs border border-gray-700">
                    {player.pos}
                  </div>
                  <div>
                    <h4 className="text-white font-medium flex items-center gap-2">
                      {player.name}
                    </h4>
                    <p className="text-sm text-gray-400">{player.team} • Age {player.age} • Exp {player.exp} yr {player.status !== 'Active' && <span className="text-red-400 ml-1">({player.status})</span>}</p>
                  </div>
                </div>
                <div className="flex gap-4 text-right items-center">
                  <div className={`flex flex-col ${sortMode === "RVS" ? "opacity-50" : ""}`}>
                    <span className="text-sm font-bold text-white">{player.dvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">DVS</span>
                  </div>
                  <div className={`flex flex-col ${sortMode === "DVS" ? "opacity-50" : ""}`}>
                    <span className="text-sm font-bold text-white">{player.rvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">RVS</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Targets */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-green-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Top Targets</h2>
          </div>
          
          <div className="space-y-3">
            {sortedTargets.map((player: any, idx: number) => (
              <div key={player.id} className="glass-panel p-4 flex justify-between items-center border-l-4 border-l-green-500/50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center font-bold text-gray-300 text-xs border border-gray-700">
                    {player.pos}
                  </div>
                  <div>
                    <h4 className="text-white font-medium">
                      {player.name}
                    </h4>
                    <p className="text-sm text-gray-400">{player.team} • Age {player.age} {player.status !== 'Active' && <span className="text-red-400 ml-1">({player.status})</span>}</p>
                  </div>
                </div>
                <div className="flex gap-4 text-right items-center">
                  <div className={`flex flex-col ${sortMode === "RVS" ? "opacity-50" : ""}`}>
                    <span className="text-sm font-bold text-green-400">{player.dvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">DVS</span>
                  </div>
                  <div className={`flex flex-col ${sortMode === "DVS" ? "opacity-50" : ""}`}>
                    <span className="text-sm font-bold text-green-400">{player.rvs}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">RVS</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Waivers() {
  return (
    <Suspense fallback={<div className="text-white">Loading...</div>}>
      <WaiversContent />
    </Suspense>
  );
}
