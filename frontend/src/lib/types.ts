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
  /** This week's forecast (see `Forecast`), availability applied. Null off-season. */
  pts_week?: number | null;
  /** Sleeper's projection for this week as it came, availability applied -
   *  what `pts_week` is compared against. */
  pts_week_base?: number | null;
  /** How `pts_week` came about, factor by factor. */
  forecast?: Forecast | null;
  /** What his team has been doing with him: snaps, rank, points per week. */
  usage?: Usage | null;
  /** Forecast points over this week and the following ones (see `WEEK_HORIZON`). */
  pts_horizon?: number | null;
  /** The horizon as a season: per week × 17. On the waiver board this is `pts`. */
  pts_pace?: number | null;
  /** The season projection, where `pts` holds the pace instead (waivers). */
  pts_season?: number | null;
  /** The forecast week by week; opp null means bye. */
  horizon?: { week: number; opp: string | null; pts: number }[] | null;
  /** This week's opponent; null on bye or off-season. */
  opp?: string | null;
  bye?: boolean;
  /** First bye week inside the horizon, if any. */
  bye_week?: number | null;
  /** His game this week is over: he can be neither started nor benched. */
  locked?: boolean;
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

/** The weekly forecast P = B × K × A (functions/forecast.py). */
export type Forecast = {
  P: number;
  /** Base: weighted mean of Sleeper (S), form (F) and quality (Q). */
  B: number;
  /** Corrections R × M × W, bounded. */
  K: number;
  /** Availability. */
  A: number;
  S: number | null;
  F: number | null;
  /** Games behind F. */
  n: number;
  Q: number | null;
  weights: { S: number; F: number; Q: number };
  R: number;
  M: number;
  W: number;
  /** The forecast as readable lines, last one "Prognose …". */
  explain: string[];
};

export type Usage = {
  label: string;
  adj: number;
  rank: number | null;
  snap_pct: number | null;
  avg_pts: number;
  pts_by_week: Record<string, number>;
};

export type ForecastNote = {
  name: string;
  pos: string;
  starting: boolean;
  pts_week: number;
  pts_week_base: number;
  explain: string[];
};

export type CloseCall = { in: string; out: string; gap: number };

export type ForecastParams = { k: number; cap: number; s_share: number; beta: number; alpha: number };

export type ForecastModel = {
  params: Record<string, ForecastParams>;
  backtest: {
    season: string;
    league: string;
    results: Record<string, {
      params: ForecastParams;
      n: number;
      pairs: number;
      sleeper: { mae: number; pairs: number };
      model: { mae: number; pairs: number };
      verdict: string;
    }>;
  } | null;
  form_games: number;
  form_without_s: number;
  limits: {
    k_min: number; k_max: number; role_max: number; matchup_max: number;
    matchup_shrink: number; vegas_weight: number; close_call: number;
  };
  weather: {
    wind_strong: number; wind_severe: number; rain_heavy: number;
    effect: Record<string, [number, number, number]>;
  };
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
  /** What `replacement` and `top[].value` are in: "Proj-Punkte" (season) or
   *  "Pkt/Woche" (in-season forecast). */
  unit?: string;
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

export type LineupChange = {
  slot: string | null;
  in: Player;
  out: Player | null;
};

export type LineupIssue = {
  kind: "empty" | "bye" | "out" | "doubtful" | "questionable" | "bench";
  /** 3 scores nothing unless fixed, 2 likely costs points, 1 worth a look. */
  severity: number;
  slot: string | null;
  player: Player | null;
  gain?: number;
};

export type OverviewLeague = {
  league_id: string;
  name: string;
  teams: number;
  format: { best_ball: boolean; type: number | null };
  skipped: "best_ball" | "not_in_season" | "no_roster" | null;
  severity: number;
  issues?: LineupIssue[];
  changes?: LineupChange[];
  forecast_notes?: ForecastNote[];
  close_calls?: CloseCall[];
  current_total?: number;
  total?: number;
  gain?: number;
};

export type Overview = {
  username: string;
  sport: string;
  season: string;
  week: number | null;
  /** Unix seconds. */
  generated_at: number;
  lineup: { leagues: OverviewLeague[] };
};
