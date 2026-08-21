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
  severity: number;
  gain: number;
  ratio: number;
  slots: number;
  fixed_slots: number;
  depth: number;
  startable: number;
  reason: string;
};

export type LineupSlot = {
  slot: string;
  accepts?: string[];
  player: Player | null;
  alternatives?: Player[];
};
