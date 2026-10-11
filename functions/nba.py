"""The NBA week: Sleeper's Lock-In scoring, and what a player is worth in it.

Sleeper NBA leagues run in Lock-In mode (`settings.game_mode == 1`): a week
runs Monday to Sunday, and each starter counts for exactly one of his games
in it. After a game the manager may lock that score in; it has to happen
before the player's next game starts, and a starter never locked counts with
his last game of the week - zero if he sits it out.

So a week is not "games × points per game". Four games are four chances to
lock a good one, worth more than two, but nowhere near twice as much: on the
2025 season a starter projected for 28 a game locked 23 with one game, 30
with two, 33 with three and 34 with four (tools/backtest_nba.py).

What a week is worth is the value of the optimal stopping rule over his
remaining games, one game at a time from the back:

    V_last = (1 - q) * mu_last                    the last game counts as it comes
    V_i    = (1 - q) * E[max(X_i, V_i+1)] + q * V_i+1

X_i ~ N(mu_i, sigma_i) is one game, q the chance he does not play it. V_i+1 is
also the threshold for game i: a score at or above it is worth locking.

mu is Sleeper's projection for that game, calibrated on last season. A
discount for the second night of a back-to-back is built in but fitted out:
on the 2025 season it did not beat Sleeper's own number (b2b = 1.0, see
data/forecast_params_nba.json), and neither did recent form.
"""

import datetime
import json
import math
import os

# Starting values, replaced by the fit in data/forecast_params_nba.json
# (tools/backtest_nba.py). mu = a + b * S, times b2b on the second night of a
# back-to-back; sigma = sigma0 * scale + sigma1 * mu, with `scale` the
# league's scoring relative to Sleeper's default; dnp the chance a projected
# player without an injury designation sits anyway.
PARAMS = {"a": 0.0, "b": 1.0, "b2b": 1.0, "sigma0": 6.8, "sigma1": 0.13, "dnp": 0.01}

PARAMS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data",
                           "forecast_params_nba.json")


def _load_backtest():
    try:
        with open(PARAMS_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


BACKTEST = _load_backtest()
if BACKTEST and BACKTEST.get("params"):
    PARAMS = {**PARAMS, **BACKTEST["params"]}

# Weeks in the NBA fantasy regular season. A per-week number times this lives
# on a season scale, as the NFL's per week times 17 does.
SEASON_WEEKS = 25

# How long before opening night the first week is already the one lineups are
# set for. Sleeper publishes week 1 projections well ahead.
PRESEASON_DAYS = 10

# A rough average starter's box score, to tell how a league's scoring scales
# against Sleeper's default (on which sigma0 was measured).
REFERENCE_LINE = {"pts": 18.0, "reb": 6.0, "ast": 4.0, "stl": 1.0, "blk": 0.6,
                  "to": 2.0, "tpm": 2.0, "dd": 0.2, "td": 0.01, "fgm": 6.5,
                  "fga": 14.0, "ftm": 3.0, "fta": 3.8, "oreb": 1.2, "dreb": 4.8}

# Chance a player with this designation sits his next game. Only his next
# game: a day-to-day designation says nothing about Saturday on a Monday.
# Long-term absences (IR, suspension) sit every game of the week.
NEXT_GAME_DNP = {1: 0.35, 2: 0.75, 3: 1.0}
# An "Out" usually covers more than one game; the games after the next one
# are a coin flip rather than certain.
OUT_LATER_DNP = 0.5


# ---- the week ---------------------------------------------------------------

def week_ranges(schedule):
    """{week: (first date, last date)} of the regular season's schedule."""
    out = {}
    for game in schedule or []:
        week, date = game.get("week"), game.get("date")
        if week is None or not date:
            continue
        lo, hi = out.get(week, (date, date))
        out[week] = (min(lo, date), max(hi, date))
    return out


def week_of(schedule, today):
    """The week lineups are being set for on `today` (US date), or None.

    The week whose games are not all over yet. Monday of a new week belongs
    to it even before its first game; the All-Star break belongs to the week
    after it. Before opening night it is week 1 from PRESEASON_DAYS out, and
    after the last game there is none.
    """
    ranges = week_ranges(schedule)
    if not ranges:
        return None
    for week in sorted(ranges):
        first, last = ranges[week]
        if last < today:
            continue
        if week == min(ranges):
            start = datetime.date.fromisoformat(first)
            if datetime.date.fromisoformat(today) < start - datetime.timedelta(days=PRESEASON_DAYS):
                return None
        return week
    return None


def team_games(schedule, week):
    """{team: [(date, opponent), ...]} for one week, in date order."""
    out = {}
    for game in schedule or []:
        if game.get("week") != week or game.get("status") in ("postponed", "canceled"):
            continue
        home = (game.get("home") or {}).get("team")
        away = (game.get("away") or {}).get("team")
        if not home or not away:
            continue
        out.setdefault(home, []).append((game["date"], away))
        out.setdefault(away, []).append((game["date"], home))
    for games in out.values():
        games.sort()
    return out


def team_dates(schedule):
    """{team: set of game dates} over the whole season, for back-to-backs."""
    out = {}
    for game in schedule or []:
        if game.get("status") in ("postponed", "canceled"):
            continue
        for side in ("home", "away"):
            team = (game.get(side) or {}).get("team")
            if team and game.get("date"):
                out.setdefault(team, set()).add(game["date"])
    return out


def is_back_to_back(dates, date):
    """Whether `date` is the second night of a back-to-back for this team."""
    day_before = (datetime.date.fromisoformat(date) - datetime.timedelta(days=1)).isoformat()
    return day_before in (dates or ())


# ---- one game ---------------------------------------------------------------

def game_mean(S, b2b=False, params=None):
    """What he scores in one game, from Sleeper's projection for it."""
    p = params or PARAMS
    mu = p["a"] + p["b"] * S
    if b2b:
        mu *= p["b2b"]
    return max(0.0, mu)


def sigma(mu, scale=1.0, params=None):
    """How far one game lands from its mean (one sigma)."""
    p = params or PARAMS
    return p["sigma0"] * scale + p["sigma1"] * mu


def _phi(z):
    return math.exp(-z * z / 2) / math.sqrt(2 * math.pi)


def _Phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def expected_max(mu, sd, c):
    """E[max(X, c)] for X ~ N(mu, sd)."""
    if sd <= 0:
        return max(mu, c)
    d = (mu - c) / sd
    return mu * _Phi(d) + sd * _phi(d) + c * _Phi(-d)


def lockin_value(games):
    """Value of a week of games under the optimal lock-in rule.

    `games` is [(mu, sigma, q)] in date order. Returns (value, thresholds):
    thresholds[i] is the score at or above which game i is worth locking -
    what the games after it are still worth. The last game has none: it
    counts whatever it is.
    """
    if not games:
        return 0.0, []
    mu, _, q = games[-1]
    value = (1 - q) * mu
    thresholds = [None] * len(games)
    for i in range(len(games) - 2, -1, -1):
        thresholds[i] = value
        mu, sd, q = games[i]
        value = (1 - q) * expected_max(mu, sd, value) + q * value
    return value, thresholds


def dnp_chances(n, injury, params=None):
    """Chance he sits each of his next `n` games, from his designation."""
    p = params or PARAMS
    base = p["dnp"]
    injury = injury or {}
    severity = injury.get("severity") or 0
    if injury.get("term") == "long" and severity >= 2:
        return [1.0] * n
    out = [base] * n
    if n and severity in NEXT_GAME_DNP:
        out[0] = max(base, NEXT_GAME_DNP[severity])
        if severity >= 3:
            out[1:] = [max(base, OUT_LATER_DNP)] * (n - 1)
    return out


# ---- the lock-in decision ---------------------------------------------------

def lock_advice(last_score, threshold):
    """Lock the game he just played, or play on?

    `threshold` is what his remaining games are worth. None means there is
    no game left, and the score stands anyway.
    """
    if last_score is None:
        return None
    if threshold is None:
        return {"lock": True, "score": last_score, "rest": None, "final": True}
    return {"lock": last_score >= threshold, "score": round(last_score, 1),
            "rest": round(threshold, 1), "final": False}
