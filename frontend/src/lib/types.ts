export type League = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  previous_league_id?: string | null;
  /** Set by the API: a past season, or a league that has finished. */
  archived?: boolean;
};

export type Draft = {
  draft_id: string;
  name: string;
  status: string;
  league_id: string | null;
};

export type Injury = {
  status: string | null;
  severity: number;
  term?: string | null;
  label: string | null;
};

export type Player = {
  id: string;
  name: string;
  pos: string;
  elig?: string[];
  real_pos?: string | null;
  team: string;
  age: number | string;
  exp?: number;
  status?: string;
  rvs: number;
  dvs: number;
  /** Projected season points in this league's scoring — the lineup currency. */
  pts: number;
  /** Raw Sleeper season projection, before availability adjustments. */
  proj?: number | null;
  score?: number;
  signals?: string[];
  injury?: Injury | null;
  opportunity?: { score: number; label: string | null };
  trend?: { adds: number; drops: number; net: number; label: string | null };
  /** Days since Sleeper last touched this player's news entry. */
  news_days?: number | null;
  is_upgrade?: boolean;
  protected?: string | null;
  is_liability?: boolean;
  faab?: Faab | null;
};

export type Faab = { min: number; max: number; tier: string; budget_left: number };

export type Need = {
  pos: string;
  /** How loud: 3 critical, 2 unsecured, 1 worth watching. */
  severity: number;
  /** Which situation this is. Two positions at the same severity are usually
   *  not the same problem, and the badge shows this rather than the severity. */
  kind?: "empty" | "below_level" | "flex_gap" | "no_depth" | "no_backup" | "upgrade";
  label?: string;
  gain: number;
  ratio: number;
  /** Bodies the position has to be able to field, flex share included. */
  slots: number;
  fixed_slots: number;
  depth: number;
  startable: number;
  /** startable - slots, and eligible - slots: room before a drop hurts. */
  surplus?: number;
  spare?: number;
  /** No empty slot and nothing a league-average starter would add: the hole is
   *  on the bench, not in the lineup. */
  covered?: boolean;
  /** The bar `startable` was counted against, in the league's own points. */
  replacement?: number;
  /** The best eligible players at this position, so the count can be checked. */
  top?: { name: string; value: number; startable: boolean }[];
  reason: string;
};

/** Raw headcount at a position vs. how many bodies the league's slots require —
 *  independent of `Need`, which grades the same position on lineup quality. A
 *  position can be headcount-"good" and quality-"kritisch" at once: six
 *  linemen, none of them startable, is a true statement about both. */
export type RosterDepth = {
  pos: string;
  count: number;
  needed: number;
  spare: number;
  tier: "good" | "ok" | "bad";
  label: string;
};

export type LineupSlot = {
  slot: string;
  accepts?: string[];
  player: Player | null;
  alternatives?: Player[];
};

export type LeagueInfo = { name?: string | null; teams?: number; season?: string | null };
