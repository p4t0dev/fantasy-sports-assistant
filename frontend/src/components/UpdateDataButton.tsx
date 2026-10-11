"use client";

import { useState } from "react";
import { apiUrl } from "@/lib/api";

// The frontend is a static export, so anything compiled into it is public by
// definition. The refresh token therefore never goes into the bundle - it is
// entered once and kept in this browser only.
const TOKEN_KEY = "fsa_refresh_token";

const SPORTS = [
  { id: "nfl", label: "NFL" },
  { id: "nba", label: "NBA" },
];

type RefreshResult = { label: string; ok: boolean; status: number; message: string };

async function refresh(sport: { id: string; label: string }, token: string): Promise<RefreshResult> {
  try {
    const res = await fetch(apiUrl("update_data", { sport: sport.id }), {
      method: "POST",
      headers: { "X-Refresh-Token": token },
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data.status === "success";
    return {
      label: sport.label,
      ok,
      status: res.status,
      message: ok ? data.message : data.error || data.message || "Update fehlgeschlagen",
    };
  } catch (err) {
    console.error(err);
    return { label: sport.label, ok: false, status: 0, message: "Netzwerkfehler" };
  }
}

export default function UpdateDataButton() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [failed, setFailed] = useState(false);
  // The full server messages (what was loaded, which overviews were rebuilt),
  // on hover - the line next to the button only says which sport worked.
  const [detail, setDetail] = useState("");

  const requestToken = (): string | null => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
    const entered = window.prompt(
      "Refresh-Token eingeben (wird nur in diesem Browser gespeichert):"
    );
    if (!entered) return null;
    window.localStorage.setItem(TOKEN_KEY, entered.trim());
    return entered.trim();
  };

  const handleUpdate = async () => {
    const token = requestToken();
    if (!token) return;

    setIsUpdating(true);
    setStatusMsg("");
    setDetail("");
    setFailed(false);

    // Both sports at once, as two calls: each runs in its own function
    // instance with its own time limit, so the wait is the slower of the two
    // rather than their sum - one call doing both would come close to the
    // five minutes the function gets.
    const results = await Promise.all(SPORTS.map((sport) => refresh(sport, token)));

    if (results.some((r) => r.status === 401)) {
      // Wrong token - drop it so the next click asks again.
      window.localStorage.removeItem(TOKEN_KEY);
    }
    const anyFailed = results.some((r) => !r.ok);
    setFailed(anyFailed);
    setStatusMsg(
      results.map((r) => `${r.ok ? "✅" : "❌"} ${r.label}${r.ok ? "" : `: ${r.message}`}`).join(" · "),
    );
    setDetail(results.map((r) => `${r.label}: ${r.message}`).join("\n"));
    if (!anyFailed) setTimeout(() => setStatusMsg(""), 8000);
    setIsUpdating(false);
  };

  return (
    <div className="flex items-center gap-3">
      {statusMsg && (
        <span
          title={detail || undefined}
          className={`text-sm font-medium ${failed ? "text-red-400" : "text-green-400"}`}
        >
          {statusMsg}
        </span>
      )}
      <button
        onClick={handleUpdate}
        disabled={isUpdating}
        title="Lädt NFL- und NBA-Daten neu und baut die Wochenübersichten. Läuft mehrmals täglich ohnehin automatisch."
        className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg flex items-center gap-2"
      >
        {isUpdating ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Aktualisiere…
          </>
        ) : (
          "Daten aktualisieren"
        )}
      </button>
    </div>
  );
}
