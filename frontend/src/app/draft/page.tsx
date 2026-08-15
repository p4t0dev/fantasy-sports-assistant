"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function DraftAssistantContent() {
  const searchParams = useSearchParams();
  const username = searchParams.get("username");
  const draftId = searchParams.get("draft_id");

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchDraft = async (isRefresh = false) => {
    if (!username || !draftId) {
      setError("Missing username or draft ID in URL");
      setLoading(false);
      return;
    }
    
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const url = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5001/demo-no-project/us-central1";
      const response = await fetch(`${url}/analyze_draft?username=${username}&draft_id=${draftId}`);
      
      if (!response.ok) {
        throw new Error("Failed to analyze draft");
      }
      
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDraft();
  }, [username, draftId]);

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
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const { metadata, last_pick, roster_needs, top_recommendations, best_available } = data || {};

  return (
    <div className="space-y-8">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-6 border-green-500/30">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-white">{metadata?.name}</h1>
            {metadata?.is_rookie_draft && (
              <span className="bg-yellow-600/30 text-yellow-400 border border-yellow-500/50 text-xs px-2 py-1 rounded font-bold uppercase">
                Rookie Only
              </span>
            )}
          </div>
          <p className="text-gray-400 mt-2">
            Status: <span className="text-white capitalize font-medium">{metadata?.status}</span> | 
            Your Slot: <span className="text-green-400 font-bold">{metadata?.user_slot}</span>
          </p>
        </div>
        
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => fetchDraft(true)}
              disabled={refreshing}
              className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-green-800 disabled:cursor-not-allowed text-white rounded-lg transition-colors text-sm font-bold flex items-center gap-2 shadow-lg shadow-green-500/20"
            >
              {refreshing ? "Refreshing..." : "↻ Refresh Board"}
            </button>
            <Link href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium">
              ← Back
            </Link>
          </div>
          {last_pick && (
            <div className="text-sm text-gray-400 text-right">
              Last Pick: <span className="text-white font-medium">Round {last_pick.round}, Pick {last_pick.draft_slot}</span>
            </div>
          )}
        </div>
      </div>

      {/* Top Recommendations */}
      {top_recommendations && top_recommendations.length > 0 && (
        <div className="space-y-4 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-yellow-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Top Draft Recommendations</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {top_recommendations.map((rec: any, idx: number) => {
              const Icon = rec.type === 'bpa' ? '🥇' : rec.type === 'fit' ? '🎯' : '💰';
              const color = rec.type === 'bpa' ? 'border-yellow-500/50 bg-yellow-900/10' : 
                            rec.type === 'fit' ? 'border-green-500/50 bg-green-900/10' : 
                            'border-blue-500/50 bg-blue-900/10';
                            
              return (
                <div key={idx} className={`glass-panel p-6 border-t-4 ${color} transition-transform hover:-translate-y-1`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">{Icon}</span>
                    <h3 className="text-lg font-bold text-white">{rec.title}</h3>
                  </div>
                  <div className="mb-4">
                    <div className="text-xl font-bold text-white flex items-center gap-2">
                      {rec.player.name}
                      {rec.player.is_rookie && <span className="text-[10px] bg-yellow-600/30 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold">Rookie</span>}
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
                      <span className="text-gray-500">Trade Val</span>
                      <div className="font-bold text-purple-400">{rec.player.trade_value}</div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 bg-gray-900/50 p-3 rounded border border-gray-700">
                    {rec.reason}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Roster Needs */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-purple-500 rounded-full"></div>
            <h2 className="text-xl font-bold text-white">Your Team Needs</h2>
          </div>
          
          {!roster_needs || roster_needs.length === 0 ? (
            <div className="glass-panel p-6 text-center text-gray-400">
              No league context found for this draft, or your team is perfectly balanced!
            </div>
          ) : (
            <div className="space-y-3">
              {roster_needs.map((need: any, idx: number) => (
                <div key={idx} className={`glass-panel p-4 border-l-4 ${need.severity === 2 ? 'border-l-red-500 bg-red-900/10' : 'border-l-yellow-500 bg-yellow-900/10'}`}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-white text-lg">{need.pos}</span>
                    <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${need.severity === 2 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                      {need.severity === 2 ? 'Critical' : 'Moderate'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">{need.reason}</p>
                </div>
              ))}
            </div>
          )}
          
          <div className="glass-panel p-6 border-blue-500/30 bg-blue-900/10 mt-6">
             <h3 className="text-blue-300 font-bold mb-2">💡 Draft Strategy</h3>
             <p className="text-sm text-gray-300">
               {metadata?.is_rookie_draft 
                 ? "In rookie drafts, prioritize talent (DVS) over immediate positional need. Elite WRs have the longest shelf life. RBs are riskier but provide immediate ROI."
                 : "Build around Elite QBs and young WRs. Wait on RBs until later rounds."}
             </p>
          </div>
        </div>

        {/* Right Column: Best Available */}
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
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Player</th>
                    <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-blue-400 uppercase tracking-wider" title="Dynasty Value Score">DVS</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-purple-400 uppercase tracking-wider" title="Redraft Value Score">RVS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-transparent">
                  {best_available?.map((player: any) => {
                    const isNeeded = roster_needs?.some((n: any) => n.pos === player.pos);
                    return (
                      <tr key={player.id} className={`transition-colors hover:bg-gray-800/50 ${isNeeded ? 'bg-green-900/10' : ''}`}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center bg-gray-800 rounded-full border border-gray-700">
                              <span className="text-sm font-bold text-gray-300">{player.pos}</span>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-medium text-white flex items-center gap-2">
                                {player.name}
                                {isNeeded && <span className="w-2 h-2 rounded-full bg-green-500" title="Fits Team Need"></span>}
                                {player.is_rookie && <span className="text-[10px] bg-yellow-600/30 text-yellow-400 px-1.5 py-0.5 rounded uppercase font-bold">Rookie</span>}
                              </div>
                              <div className="text-xs text-gray-500">
                                {player.team} • Age {player.age}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            player.status === 'Active' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'
                          }`}>
                            {player.status || 'Active'}
                          </span>
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
    <Suspense fallback={<div className="text-center p-12 text-gray-400">Loading Assistant...</div>}>
      <DraftAssistantContent />
    </Suspense>
  );
}
