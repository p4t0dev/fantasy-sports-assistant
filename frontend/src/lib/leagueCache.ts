"use client";

import type { League, Draft } from "./types";

// Going back from a waiver or draft view used to drop everything and force a
// fresh load of every league. Cache the last search per (user, sport, season)
// so the back button is instant; leagues do not change minute to minute.
const KEY = "fsa_league_cache_v1";
const TTL_MS = 15 * 60 * 1000;

export type LeagueSearch = {
  username: string;
  sport: string;
  season: string;
  leagues: League[];
  drafts: Draft[];
  savedAt: number;
};

// useSyncExternalStore compares snapshots by identity, so the parsed object has
// to stay stable while the underlying string is unchanged - otherwise React
// re-renders forever.
let snapshotRaw: string | null = null;
let snapshotValue: LeagueSearch | null = null;
const listeners = new Set<() => void>();

export function subscribeToSearch(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSearchSnapshot(): LeagueSearch | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === snapshotRaw) return snapshotValue;

  snapshotRaw = raw;
  snapshotValue = null;
  if (raw) {
    try {
      const entry: LeagueSearch = JSON.parse(raw);
      if (Date.now() - entry.savedAt <= TTL_MS) snapshotValue = entry;
    } catch {
      snapshotValue = null;
    }
  }
  return snapshotValue;
}

// The static export is prerendered without any browser storage.
export function getSearchServerSnapshot(): LeagueSearch | null {
  return null;
}

function notify() {
  for (const listener of listeners) listener();
}

export function writeSearch(entry: Omit<LeagueSearch, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...entry, savedAt: Date.now() }));
    notify();
  } catch {
    /* storage full or blocked - caching is a convenience, not a requirement */
  }
}

export function clearSearch() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
    notify();
  } catch {
    /* ignore */
  }
}

export function ageLabel(savedAt: number): string {
  const seconds = Math.floor((Date.now() - savedAt) / 1000);
  if (seconds < 60) return "gerade eben";
  const minutes = Math.floor(seconds / 60);
  return minutes === 1 ? "vor 1 Minute" : `vor ${minutes} Minuten`;
}
