import Link from "next/link";

export default function LineupOptimizer() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Lineup Optimizer</h1>
          <p className="text-gray-400 mt-1">Ideal weekly lineup recommendations.</p>
        </div>
        <Link href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium">
          ← Back
        </Link>
      </div>

      <div className="glass-panel p-12 text-center">
        <div className="text-6xl mb-4">📈</div>
        <h2 className="text-2xl font-bold text-white mb-2">Lineup Optimizer Coming Soon</h2>
        <p className="text-gray-400 max-w-md mx-auto">
          We are calibrating our projection models for the upcoming week. The optimizer will analyze matchups and weather to provide the perfect starting roster.
        </p>
      </div>
    </div>
  );
}
