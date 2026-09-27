#!/usr/bin/env python3
"""Backtest of the weekly forecast (functions/forecast.py) on a past season.

For every week, every factor is computed only from what was known before
that week's games: Sleeper's projection for the week, the games before it,
the season projection and the season before. The forecast is then held
against what actually happened, in two measures:

  MAE        mean absolute error in points
  Paarweise  of two players at the same position in the same week whom
             Sleeper projects within 5 points of each other - a lineup
             decision - how often the forecast has the better one ahead

Weights are fitted on pairwise accuracy over the first half of the season
and reported on the second, so a factor only survives if it helps on weeks
it was not fitted to. A position where the fitted model does not beat
Sleeper's projection on those weeks gets Sleeper's projection alone.

    python3 tools/backtest_forecast.py --season 2025 --league_id <ID> [--fit]
"""

import argparse
import itertools
import json
import os
import random
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "functions"))

import api_core  # noqa: E402
import forecast  # noqa: E402
import projections  # noqa: E402
import sleeper_api  # noqa: E402
import usage  # noqa: E402

MIN_S = 3.0          # below this nobody starts him; not a lineup decision
CLOSE = 5.0          # forecasts this close make a pair a real decision
MAX_PAIRS = 30000    # sampled per position, so the grid stays minutes, not hours
GRID = {
    "k": [2.0, 4.0, 8.0, 16.0, 32.0],
    "cap": [0.15, 0.3, 0.5],
    "s_share": [0.5, 0.75, 1.0],
    "beta": [0.0, 0.5, 1.0],
    "alpha": [0.0, 0.5, 1.0],
}
SLEEPER_ONLY = {"k": 4.0, "cap": 0.0, "s_share": 1.0, "beta": 0.0, "alpha": 0.0}


def fetch_season(season, path):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    data = {"proj": {}, "stats": {}}
    for w in range(1, 19):
        data["proj"][str(w)] = projections.fetch_week_projections("nfl", season, w)
        data["stats"][str(w)] = projections.fetch_week_stats("nfl", season, w)
        print(f"W{w} geladen", flush=True)
    data["season_proj"] = projections.fetch_season_projections("nfl", season)
    data["stats_prev"] = sleeper_api.get_stats("nfl", int(season) - 1)
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def build_samples(data, players, scoring):
    """One row per player and week, with every raw input the forecast takes."""
    def pos_of(pid):
        return (players.get(pid) or {}).get("position")

    def score(pid, stats):
        return api_core.calculate_custom_score(stats, pos_of(pid), scoring, "nfl")

    proj = {int(w): v for w, v in data["proj"].items() if v}
    stats = {int(w): v for w, v in data["stats"].items() if v}
    weeks = sorted(stats)

    season_q = {}
    for pid, s in (data.get("season_proj") or {}).items():
        season_q[pid] = score(pid, s) * projections.season_factor(s, "nfl")
    prev = {}
    for pid, s in (data.get("stats_prev") or data.get("stats_2024") or {}).items():
        gp = s.get("gp") or 0
        if gp:
            prev[pid] = (score(pid, s) / gp, gp)

    actual = {w: {pid: round(score(pid, row["stats"]), 2) for pid, row in stats[w].items()}
              for w in weeks}

    samples = []
    for w in weeks:
        if w < 3 or w not in proj:
            continue
        before = {str(x): stats[x] for x in weeks if x < w}
        use = usage.build_usage(before, players, score, lambda pid: False)

        # Points allowed per game, per defense and position group.
        allowed, games = {}, {}
        for x in weeks:
            if x >= w:
                continue
            opp_of = proj.get(x, {}).get("opp", {})
            for pid, row in stats[x].items():
                group = forecast.group_of(pos_of(pid))
                opp = opp_of.get(row.get("team"))
                if not group or not opp:
                    continue
                allowed[(opp, group)] = allowed.get((opp, group), 0) + actual[x][pid]
                games.setdefault(opp, set()).add(x)
        per_game = {key: v / len(games[key[0]]) for key, v in allowed.items()}
        league_avg = {}
        for (opp, group), v in per_game.items():
            league_avg.setdefault(group, []).append(v)
        league_avg = {g: sum(v) / len(v) for g, v in league_avg.items()}

        for pid, p_stats in proj[w]["stats"].items():
            if pid not in actual[w]:
                continue  # did not play: availability, not the forecast
            group = forecast.group_of(pos_of(pid))
            if not group:
                continue
            S = score(pid, p_stats)
            if S < MIN_S:
                continue
            team = stats[w][pid].get("team")
            opp = proj[w]["opp"].get(team)
            history = [actual[x][pid] for x in weeks if x < w and pid in actual[x]]
            q = forecast.quality(season_q.get(pid), *(prev.get(pid) or (None, 0)))
            samples.append({
                "week": w, "pid": pid, "group": group, "pos": pos_of(pid),
                "S": S, "history": history, "Q": q,
                "usage_adj": (use.get(pid) or {}).get("adj"),
                "allowed": per_game.get((opp, group)),
                "league_avg": league_avg.get(group),
                "opp_games": len(games.get(opp, ())),
                "actual": actual[w][pid],
            })
    return samples


def predict(sample, params):
    saved = forecast.PARAMS[sample["group"]]
    forecast.PARAMS[sample["group"]] = params
    try:
        return forecast.forecast(sample["pos"], sample["S"], sample["history"], sample["Q"],
                                 usage_adj=sample["usage_adj"], allowed=sample["allowed"],
                                 league_avg=sample["league_avg"],
                                 opp_games=sample["opp_games"])["P"]
    finally:
        forecast.PARAMS[sample["group"]] = saved


def decision_pairs(samples):
    """Index pairs Sleeper calls close: same week, same position group."""
    by_week = {}
    for i, s in enumerate(samples):
        by_week.setdefault(s["week"], []).append(i)
    pairs = [(i, j) for rows in by_week.values() for i, j in itertools.combinations(rows, 2)
             if abs(samples[i]["S"] - samples[j]["S"]) <= CLOSE
             and samples[i]["actual"] != samples[j]["actual"]]
    random.Random(7).shuffle(pairs)
    return pairs[:MAX_PAIRS]


def evaluate(samples, pred, pairs):
    """MAE and pairwise accuracy of `pred` (list parallel to samples)."""
    if not samples:
        return None, None
    mae = sum(abs(p - s["actual"]) for p, s in zip(pred, samples)) / len(samples)
    right = sum((pred[i] > pred[j]) == (samples[i]["actual"] > samples[j]["actual"])
                for i, j in pairs)
    return round(mae, 3), round(right / len(pairs), 4) if pairs else None


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--season", default="2025")
    parser.add_argument("--league_id", required=True, help="Liga, deren Scoring gilt")
    parser.add_argument("--data", help="Cache-Datei für die Saisondaten")
    parser.add_argument("--fit", action="store_true", help="Gewichte neu fitten")
    parser.add_argument("--out", help="Ergebnis als JSON speichern (functions/data/forecast_params.json)")
    args = parser.parse_args()

    league = sleeper_api.get_league(args.league_id) or {}
    scoring = league.get("scoring_settings") or {}
    players = api_core.load_players("nfl")
    data = fetch_season(args.season, args.data or f"/tmp/backtest_{args.season}.json")
    samples = build_samples(data, players, scoring)
    fit_part = [s for s in samples if s["week"] <= 10]
    test_part = [s for s in samples if s["week"] > 10]

    print(f"{len(samples)} Spieler-Wochen, Scoring von {league.get('name')}\n")
    print(f"{'Pos':<4} {'n':>5}  {'MAE Sleeper':>11} {'MAE Modell':>10}  "
          f"{'Paar Sleeper':>12} {'Paar Modell':>11}  {'Ergebnis':<12} Parameter")
    results = {}
    for group in forecast.PARAMS:
        fit = [s for s in fit_part if s["group"] == group]
        test = [s for s in test_part if s["group"] == group]
        if not fit or not test:
            continue
        params = dict(forecast.PARAMS[group])
        fit_pairs, test_pairs = decision_pairs(fit), decision_pairs(test)
        if args.fit:
            best = None
            for combo in itertools.product(*GRID.values()):
                cand = dict(zip(GRID.keys(), combo))
                mae, pair = evaluate(fit, [predict(s, cand) for s in fit], fit_pairs)
                if best is None or (pair, -mae) > best[0]:
                    best = ((pair, -mae), cand)
            params = best[1]
        base_mae, base_pair = evaluate(test, [s["S"] for s in test], test_pairs)
        mae, pair = evaluate(test, [predict(s, params) for s in test], test_pairs)
        verdict = "Modell"
        if args.fit and (pair or 0) <= (base_pair or 0):
            params, mae, pair, verdict = dict(SLEEPER_ONLY), base_mae, base_pair, "nur Sleeper"
        results[group] = {"params": params, "n": len(test), "pairs": len(test_pairs),
                          "sleeper": {"mae": base_mae, "pairs": base_pair},
                          "model": {"mae": mae, "pairs": pair}, "verdict": verdict}
        print(f"{group:<4} {len(test):>5}  {base_mae:>11} {mae:>10}  "
              f"{base_pair:>12} {pair:>11}  {verdict:<12} {json.dumps(params)}")
    print("\nPaarweise: Anteil richtig sortierter Paare, die Sleeper ≤ "
          f"{CLOSE} Punkte auseinander sieht, Wochen 11-18 (gefittet auf 3-10).")
    if args.out:
        with open(args.out, "w") as f:
            json.dump({"season": args.season, "league": league.get("name"),
                       "results": results}, f, indent=2)
        print(f"Ergebnis gespeichert: {args.out}")


if __name__ == "__main__":
    main()
