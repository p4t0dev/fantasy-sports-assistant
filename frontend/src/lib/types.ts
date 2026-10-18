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
  /** The horizon as a season: per week × `pace_weeks`. On the waiver board this is `pts`. */
  pts_pace?: number | null;
  /** Weeks in a season (NFL 17, NBA 25): `pts_pace` / this is per week. */
  pace_weeks?: number | null;
  /** Games in a season (NFL 17, NBA 82): `pts_season` / this is per game. */
  season_games?: number | null;
  /** NBA: games still to play this week. */
  games_week?: number | null;
  /** NBA Lock-In: the call on the game he just played. */
  lock?: LockAdvice | null;
  /** One sigma of his week around `pts_week`, where the sport sets it. */
  spread?: number | null;
  /** The season projection, where `pts` holds the pace instead (waivers). */
  pts_season?: number | null;
  /** The forecast week by week; opp null means bye. */
  horizon?: { week: number; opp: string | null; pts: number; games?: number }[] | null;
  /** This week's opponent; null on bye or off-season. */
  opp?: string | null;
  bye?: boolean;
  /** First bye week inside the horizon, if any. */
  bye_week?: number | null;
  /** His game this week is over: he can be neither started nor benched. */
  locked?: boolean;
  /** Parked outside the active roster: cannot start without a roster move. */
  stash?: "taxi" | "ir";
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
  /** Points each game's usage was worth on average (targets, carries, snaps). */
  xfp_by_week?: Record<string, number | null>;
};

/** NBA Lock-In: lock the game he just played, or play on for the rest. */
export type LockAdvice = {
  lock: boolean;
  score: number;
  /** What his remaining games are worth; null when none is left. */
  rest: number | null;
  /** No game left: the score stands whatever happens. */
  final: boolean;
  date?: string;
};

/** A lock-in call for a starter (lineup page and overview). */
export type LockCall = {
  slot: string;
  id: string;
  name: string;
  lock: boolean;
  score: number;
  rest: number;
  date?: string;
};

export type ForecastNote = {
  name: string;
  pos: string;
  starting: boolean;
  pts_week: number;
  pts_week_base: number;
  /** What `pts_week_base` is: Sleeper's number (NFL) or the week without injury risk (NBA). */
  base_label?: string;
  explain: string[];
};

export type CloseCall = {
  in: string;
  out: string;
  gap: number;
  /** One sigma of a week around each forecast. */
  spread_in?: number;
  spread_out?: number;
  /** Who to start given the matchup, or null when it stays a coin flip. */
  pick?: string | null;
  advice?: string | null;
};

/** Your best lineup against your opponent's, both through the same forecast. */
export type MatchupStance = {
  kind: "favorite" | "underdog" | "even" | "chopped";
  margin: number | null;
  opponent: string | null;
  my_total: number;
  opp_total: number | null;
};

export type ForecastParams = {
  k: number; cap: number; s_share: number; beta: number; alpha: number;
  /** Share of form that is actual points rather than usage-expected ones. */
  lam?: number;
};

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
      sigma?: number;
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
  /** The NBA week (functions/nba.py), fitted by tools/backtest_nba.py. */
  nba?: NbaModel;
};

export type NbaModel = {
  params: { a: number; b: number; b2b: number; sigma0: number; sigma1: number; dnp: number };
  backtest: {
    season: string;
    split_week: number;
    game: {
      games_test: number;
      rmse_sleeper: number;
      rmse_model: number;
      calibration: { a: number; b: number; rmse: number; kept: boolean };
      b2b: { factor: number; rmse: number; kept: boolean };
      form: { weight: number; rmse: number; gain: number; kept: boolean };
    };
    week: {
      by_games: Record<string, { weeks: number; value: number; locked: number; no_lock: number }>;
      pairwise: { value: number; sum: number; per_game: number };
      pairs: number;
    };
  } | null;
  season_weeks: number;
  next_game_dnp: Record<string, number>;
  out_later_dnp: number;
  thresholds: { bench: number; bench_urgent: number; favorite: number; close_call: number };
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

/** A taxi or IR player who would improve the lineup - at the price of a
 *  roster move, so never part of the swaps. */
export type ActivationOption = {
  player: Player;
  from: "taxi" | "ir";
  gain: number;
  slot: string | null;
  out: Player | null;
  /** Active roster is full: someone has to be dropped first. */
  needs_drop: boolean;
  /** Who to drop for it: the drop list's most expendable player. */
  drop?: Player | null;
  /** Past the taxi deadline: the taxi seat stays empty for the season. */
  permanent: boolean;
  caveats: string[];
};

export type LineupIssue = {
  kind: "empty" | "bye" | "out" | "doubtful" | "questionable" | "bench" | "lock" | "activation";
  /** 3 scores nothing unless fixed, 2 likely costs points, 1 worth a look. */
  severity: number;
  slot: string | null;
  player: Player | null;
  gain?: number;
  /** "lock": the score to lock, and what the rest of his week is worth. */
  score?: number;
  rest?: number;
  /** "activation": where he is parked, and whether a drop is needed. */
  from?: "taxi" | "ir";
  needs_drop?: boolean;
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
  lock_calls?: LockCall[];
  activations?: ActivationOption[];
  matchup?: MatchupStance | null;
  current_total?: number;
  total?: number;
  gain?: number;
};

export type WaiverMoveSide = {
  id: string;
  name: string;
  pos: string;
  team: string;
  /** Forecast points per week over the horizon; null off-season. */
  per_week: number | null;
  /** This week's forecast. */
  pts_week?: number | null;
  injury?: Injury | null;
};

export type WaiverMove = {
  /** "week": fills a hole in this week's lineup only (see `week_fixes`). */
  kind: "lineup" | "depth" | "week";
  add: WaiverMoveSide;
  /** Null for a week fix when an active roster spot is free. */
  drop: WaiverMoveSide | null;
  /** Week fix: the starter whose seat it fills, and that seat. */
  out?: WaiverMoveSide | null;
  slot?: string | null;
  reason: string;
  faab: Faab | null;
  lineup_gain?: number | null;
  edge_gain?: number | null;
  edge_unit?: string | null;
};

export type WaiverLeague = {
  league_id: string;
  name: string;
  profile: { key: string; label: string };
  schedule: { kind: "faab" | "priority"; day: string | null; daily: boolean; clear_days?: number | null };
  skipped: "not_in_season" | "no_roster" | "error" | null;
  /** Why the plan is missing when Sleeper did not answer. */
  error?: string | null;
  moves: WaiverMove[];
  /** Pickups for this week's lineup - alternatives, pick one. */
  week_fixes?: WaiverMove[];
  lineup_moves: number;
  moves_note?: string | null;
  faab?: { budget: number | null; left: number | null; waiver_type: number | null };
  needs?: { pos: string; severity: number; label?: string | null }[];
};

export type Overview = {
  username: string;
  sport: string;
  season: string;
  week: number | null;
  /** Unix seconds. */
  generated_at: number;
  lineup: { leagues: OverviewLeague[] };
  /** Missing in snapshots from before the waiver overview existed. */
  waivers?: { leagues: WaiverLeague[] };
};
