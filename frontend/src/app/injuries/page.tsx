import Link from "next/link";

export default function InjuryReports() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Injury Reports</h1>
          <p className="text-gray-400 mt-1">Real-time status updates for your roster.</p>
        </div>
        <Link href="/" className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm font-medium">
          ← Back
        </Link>
      </div>

      <div className="glass-panel p-12 text-center">
        <div className="text-6xl mb-4">🚑</div>
        <h2 className="text-2xl font-bold text-white mb-2">Injury Hub Coming Soon</h2>
        <p className="text-gray-400 max-w-md mx-auto">
          We are connecting to real-time injury feeds to keep you updated on the health of your players.
        </p>
      </div>
    </div>
  );
}
