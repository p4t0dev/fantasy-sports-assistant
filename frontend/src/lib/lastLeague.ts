"use client";

import { useEffect } from "react";

// Lineup and waivers need a league in the URL, the tab bar has none. It links
// to the league last opened, kept across visits so the installed app opens
// where it was left.
const KEY = "fsa_last_league";

export type LastLeague = { username: string; league_id: string; sport: string };

const listeners = new Set<() => void>();

export function subscribeToLastLeague(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stored string, not the parsed object: useSyncExternalStore compares by identity. */
export function getLastLeagueSnapshot(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getLastLeagueServerSnapshot(): string | null {
  return null;
}

export function parseLastLeague(raw: string | null): LastLeague | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LastLeague;
  } catch {
    return null;
  }
}

/** Call on a page that has a league in its URL. */
export function useRememberLeague(username: string | null, leagueId: string | null, sport: string) {
  useEffect(() => {
    if (!username || !leagueId) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ username, league_id: leagueId, sport }));
    } catch {
      return; // the tabs then lead to the league list, which also works
    }
    for (const listener of listeners) listener();
  }, [username, leagueId, sport]);
}
