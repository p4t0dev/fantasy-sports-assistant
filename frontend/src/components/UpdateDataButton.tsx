"use client";

import { useState } from "react";
import { apiUrl } from "@/lib/api";

// The frontend is a static export, so anything compiled into it is public by
// definition. The refresh token therefore never goes into the bundle - it is
// entered once and kept in this browser only.
const TOKEN_KEY = "fsa_refresh_token";

export default function UpdateDataButton() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [failed, setFailed] = useState(false);

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
    setFailed(false);

    try {
      const res = await fetch(apiUrl("update_data"), {
        method: "POST",
        headers: { "X-Refresh-Token": token },
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.status === "success") {
        setStatusMsg("✅ " + data.message);
        setTimeout(() => setStatusMsg(""), 6000);
      } else {
        if (res.status === 401) {
          // Wrong token - drop it so the next click asks again.
          window.localStorage.removeItem(TOKEN_KEY);
        }
        setFailed(true);
        setStatusMsg("❌ " + (data.error || data.message || "Update fehlgeschlagen"));
      }
    } catch (err) {
      console.error(err);
      setFailed(true);
      setStatusMsg("❌ Netzwerkfehler");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {statusMsg && (
        <span className={`text-sm font-medium ${failed ? "text-red-400" : "text-green-400"}`}>
          {statusMsg}
        </span>
      )}
      <button
        onClick={handleUpdate}
        disabled={isUpdating}
        title="Manueller Datenrefresh. Läuft täglich ohnehin automatisch."
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
