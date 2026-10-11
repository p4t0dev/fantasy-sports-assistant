#!/usr/bin/env python3
"""Backtest of the NBA week (functions/nba.py) on a past season.

Sleeper NBA leagues score one game per starter and week (Lock-In mode), so
two questions are tested:

  1. One game: how close is Sleeper's per-game projection, and does a
     calibration (a + b * S), a back-to-back discount or recent form beat it?
     Fitted on the first half of the season, reported on the second. Only
     what beats Sleeper there is kept; the rest stays at Sleeper's number.
  2. One week: does the lock-in value of a week (optimal stopping over his
     games) match what the optimal rule actually locked, and does it rank two
     players better than "games × points per game" or points per game alone?

Writes the kept parameters to functions/data/forecast_params_nba.json.

    python3 tools/backtest_nba.py --season 2025 [--cache /tmp/nba2025.json] [--write]
"""

import argparse
import collections
import json
import os
import statistics
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "functions"))

import api_core  # noqa: E402
import nba  # noqa: E402
import projections  # noqa: E402
import sleeper_api  # noqa: E402

WEEKS = range(1, 26)
SPLIT = 13          # weeks before this are fitted, the rest is reported
MIN_S = 5.0         # below this nobody starts him
FORM_GAMES = 5
# Form needs the box scores of every game so far at request time. Below this
# gain in RMSE on the test half it is not worth that, and stays out.
MIN_FORM_GAIN = 0.1
POSITIONS = projections.POSITIONS["nba"]


def score(stats):
    return api_core.calculate_custom_score(stats or {}, "PG", {}, "nba")


def fetch_season(season, path):
    """Every projected game of the season with what actually happened."""
    if path and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    games = []
    for week in WEEKS:
        proj = projections._fetch_rows("nba", f"{season}/{week}", positions=POSITIONS) or []
        stats = projections._fetch_rows("nba", f"{season}/{week}", base=projections.STATS_URL,
                                        positions=POSITIONS) or []
        actual = {(r["player_id"], r.get("game_id")): r.get("stats") or {} for r in stats}
        for row in proj:
            s = row.get("stats") or {}
            if not s.get("pts"):
                continue
            a = actual.get((row["player_id"], row.get("game_id")))
            played = bool(a and (a.get("gp") or a.get("sp")))
            games.append({"week": week, "date": row["date"], "pid": row["player_id"],
                          "team": row.get("team"), "S": score(s),
                          "A": score(a) if played else None})
        print(f"  week {week}: {len(proj)} projections", file=sys.stderr)
    data = {"games": games, "schedule": sleeper_api.get_schedule("nba", season) or []}
    if path:
        with open(path, "w") as f:
            json.dump(data, f)
    return data


def annotate(data):
    """Back-to-back flag and form (mean of his last games) for every game."""
    dates = nba.team_dates(data["schedule"])
    history = collections.defaultdict(list)
    rows = sorted(data["games"], key=lambda g: g["date"])
    for g in rows:
        g["b2b"] = nba.is_back_to_back(dates.get(g["team"]), g["date"])
        played = [a for a in history[g["pid"]] if a is not None]
        g["F"] = statistics.mean(played[-FORM_GAMES:]) if len(played) >= 3 else None
        history[g["pid"]].append(g["A"])
    return rows


def rmse(rows, predict):
    errors = [(g["A"] - predict(g)) ** 2 for g in rows]
    return (sum(errors) / len(errors)) ** 0.5 if errors else None


def fit_line(rows):
    """Least squares A = a + b * S."""
    xs, ys = [g["S"] for g in rows], [g["A"] for g in rows]
    mx, my = statistics.mean(xs), statistics.mean(ys)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return my - b * mx, b


def fit_game(rows):
    played = [g for g in rows if g["A"] is not None and g["S"] >= MIN_S]
    train = [g for g in played if g["week"] < SPLIT]
    test = [g for g in played if g["week"] >= SPLIT]
    sleeper = rmse(test, lambda g: g["S"])
    report = {"games_train": len(train), "games_test": len(test),
              "rmse_sleeper": round(sleeper, 2)}
    params = {"a": 0.0, "b": 1.0, "b2b": 1.0}

    a, b = fit_line(train)
    calibrated = rmse(test, lambda g: a + b * g["S"])
    report["calibration"] = {"a": round(a, 2), "b": round(b, 3), "rmse": round(calibrated, 2),
                             "kept": calibrated < sleeper}
    if calibrated < sleeper:
        params.update(a=round(a, 3), b=round(b, 4))
    base = rmse(test, lambda g: nba.game_mean(g["S"], params=params))

    # Back-to-back: the factor that best explains the second nights in training.
    second = [g for g in train if g["b2b"]]
    mus = [nba.game_mean(g["S"], params=params) for g in second]
    factor = sum(g["A"] * m for g, m in zip(second, mus)) / sum(m * m for m in mus)
    trial = {**params, "b2b": factor}
    with_b2b = rmse(test, lambda g: nba.game_mean(g["S"], g["b2b"], trial))
    report["b2b"] = {"factor": round(factor, 3), "rmse": round(with_b2b, 2),
                     "games_train": len(second), "kept": with_b2b < base}
    if with_b2b < base:
        params["b2b"] = round(factor, 3)
        base = with_b2b

    # Form: blend in his last games' mean. Reported; the app does not use it
    # unless it beats the calibrated projection by MIN_FORM_GAIN.
    best = None
    for w in [i / 20 for i in range(0, 11)]:
        def blended(g, w=w):
            mu = nba.game_mean(g["S"], g["b2b"], params)
            return mu if g["F"] is None else (1 - w) * mu + w * g["F"]
        err = rmse([g for g in train if g["F"] is not None], blended)
        if best is None or err < best[0]:
            best = (err, w)
    w = best[1]
    form_test = rmse(test, lambda g: nba.game_mean(g["S"], g["b2b"], params) if g["F"] is None
                     else (1 - w) * nba.game_mean(g["S"], g["b2b"], params) + w * g["F"])
    report["form"] = {"weight": w, "rmse": round(form_test, 2),
                      "gain": round(base - form_test, 3),
                      "kept": base - form_test >= MIN_FORM_GAIN}

    # Spread: sigma = sigma0 + sigma1 * mu, fitted on the residuals by mu band.
    bands = collections.defaultdict(list)
    for g in played:
        mu = nba.game_mean(g["S"], g["b2b"], params)
        bands[int(mu // 5) * 5].append(g["A"] - mu)
    points = [(k + 2.5, statistics.pstdev(v), len(v)) for k, v in bands.items() if len(v) >= 100]
    wsum = sum(n for _, _, n in points)
    mx = sum(x * n for x, _, n in points) / wsum
    my = sum(y * n for _, y, n in points) / wsum
    s1 = (sum(n * (x - mx) * (y - my) for x, y, n in points)
          / sum(n * (x - mx) ** 2 for x, _, n in points))
    params["sigma0"], params["sigma1"] = round(my - s1 * mx, 2), round(s1, 3)

    projected = [g for g in rows if g["S"] >= MIN_S]
    params["dnp"] = round(sum(g["A"] is None for g in projected) / len(projected), 4)
    report["rmse_model"] = round(base, 2)
    return params, report


def week_check(rows, params):
    """Lock-in value against what the optimal rule actually locked."""
    weeks = collections.defaultdict(list)
    for g in rows:
        if g["week"] >= SPLIT:
            weeks[(g["week"], g["pid"])].append(g)
    by_n = collections.defaultdict(lambda: {"value": [], "locked": [], "last": []})
    players = collections.defaultdict(list)
    for (week, _), games in weeks.items():
        games.sort(key=lambda g: g["date"])
        if statistics.mean(g["S"] for g in games) < 15:
            continue
        spec = []
        for g in games:
            mu = nba.game_mean(g["S"], g["b2b"], params)
            spec.append((mu, nba.sigma(mu, params=params), params["dnp"]))
        value, thresholds = nba.lockin_value(spec)
        locked = None
        for g, t in zip(games, thresholds):
            a = g["A"] or 0.0
            if t is None or (g["A"] is not None and a >= t):
                locked = a
                break
        n = min(len(games), 4)
        by_n[n]["value"].append(value)
        by_n[n]["locked"].append(locked)
        by_n[n]["last"].append(games[-1]["A"] or 0.0)
        players[week].append({"value": value, "sum": sum(g["S"] for g in games),
                              "per_game": statistics.mean(g["S"] for g in games),
                              "locked": locked})
    table = {str(n): {"weeks": len(v["value"]),
                      "value": round(statistics.mean(v["value"]), 1),
                      "locked": round(statistics.mean(v["locked"]), 1),
                      "no_lock": round(statistics.mean(v["last"]), 1)}
             for n, v in sorted(by_n.items())}

    # Pairs of players in the same week whose values are close: who locks more?
    hits = collections.Counter()
    pairs = 0
    for week_players in players.values():
        week_players.sort(key=lambda p: p["value"])
        for i, p in enumerate(week_players):
            for q in week_players[i + 1:i + 6]:
                if q["value"] - p["value"] > 8 or p["locked"] == q["locked"]:
                    continue
                pairs += 1
                better = q if q["locked"] > p["locked"] else p
                for key in ("value", "sum", "per_game"):
                    worse = p if better is q else q
                    hits[key] += better[key] > worse[key]
    pairwise = {k: round(hits[k] / pairs, 3) for k in ("value", "sum", "per_game")} if pairs else {}
    return {"by_games": table, "pairwise": pairwise, "pairs": pairs}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", default="2025")
    parser.add_argument("--cache")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()

    rows = annotate(fetch_season(args.season, args.cache))
    params, report = fit_game(rows)
    weekly = week_check(rows, params)
    result = {"season": args.season, "split_week": SPLIT, "params": params,
              "game": report, "week": weekly}
    print(json.dumps(result, indent=2))
    if args.write:
        with open(nba.PARAMS_FILE, "w") as f:
            json.dump(result, f, indent=2)
            f.write("\n")
        print(f"written to {nba.PARAMS_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
