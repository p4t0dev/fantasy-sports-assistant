"use client";

import { useState } from "react";

export default function UpdateDataButton() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  const handleUpdate = async () => {
    setIsUpdating(true);
    setStatusMsg("");
    
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5001/demo-no-project/us-central1";
      const res = await fetch(`${baseUrl}/update_data`, { method: "POST" });
      const data = await res.json();
      
      if (res.ok) {
        setStatusMsg("✅ " + data.message);
        setTimeout(() => setStatusMsg(""), 3000);
      } else {
        setStatusMsg("❌ Error updating data");
      }
    } catch (err) {
      console.error(err);
      setStatusMsg("❌ Network error");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {statusMsg && <span className="text-sm text-green-400 font-medium">{statusMsg}</span>}
      <button 
        onClick={handleUpdate}
        disabled={isUpdating}
        className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg flex items-center gap-2"
      >
        {isUpdating ? (
          <>
            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Aktualisiere...
          </>
        ) : (
          "Daten Aktualisieren"
        )}
      </button>
    </div>
  );
}
