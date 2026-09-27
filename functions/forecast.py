"""The weekly forecast: one number per player, and the reasons behind it.

    P = B × K × A          K = R × M × W, bounded to [K_MIN, K_MAX]

B, the base, is a weighted mean of three estimates of the same thing - what
this player scores in a game:

    S  Sleeper's projection for this week
    F  form: his mean over his last FORM_GAMES games
    Q  quality: points per game from his season projection and last season

Form earns weight with every game played, g_F = min(cap, n / (n + k)); the
rest is split between S and Q. Sleeper already folds part of form and quality
into S, so these weights are fitted on a backtest (functions/tests and
docs/FORECAST.md), not guessed.

K corrects B for what a projection prices in badly or not at all, each part
bounded on its own:

    R  role: usage trend and his rank in his team's position group
    M  matchup: points this opponent allows the position, and the Vegas total
    W  weather at the stadium, zero under a roof

A is availability: Out scores nothing, Doubtful is discounted.

Every factor is returned with the sentence that explains it, so the app can
show exactly how a number came about.
"""

import json
import os

FORM_GAMES = 4

# Starting values, replaced by the fit in data/forecast_params.json (written
# by tools/backtest_forecast.py). k: how many games form needs to earn half
# its maximum weight; cap: its maximum; s_share: S's part of what form
# leaves; beta / alpha: how much of the raw role and matchup signal survives -
# Sleeper prices in part of both.
PARAMS = {
    "QB":  {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 0.0, "alpha": 0.5},
    "RB":  {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 1.0, "alpha": 0.5},
    "WR":  {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 1.0, "alpha": 0.5},
    "TE":  {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 1.0, "alpha": 0.5},
    "K":   {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 0.0, "alpha": 0.5},
    "DEF": {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 0.0, "alpha": 0.5},
    "IDP": {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 0.0, "alpha": 0.5},
}

PARAMS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data",
                           "forecast_params.json")


def _load_backtest():
    try:
        with open(PARAMS_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# What the fit found, per position: its parameters, and how the model and
# Sleeper alone did on the weeks it was not fitted to. The app shows both.
BACKTEST = _load_backtest()
for _group, _result in ((BACKTEST or {}).get("results") or {}).items():
    if _group in PARAMS:
        PARAMS[_group] = dict(_result["params"])

K_MIN, K_MAX = 0.75, 1.25
ROLE_MAX = 0.15
MATCHUP_MAX = 0.10
# Games of an opponent it takes for his points allowed to count half.
MATCHUP_SHRINK = 6.0
# A Vegas total moves every factor it touches through the same α, but it was
# not in the backtest (historic lines cost money), so it gets less of it.
VEGAS_WEIGHT = 0.3
# Below this, two forecasts are a coin flip and the app says so.
CLOSE_CALL = 1.5

IDP_POSITIONS = {"DL", "LB", "DB", "DE", "DT", "CB", "S", "SS", "FS", "ILB", "OLB", "NT"}


def group_of(pos):
    if pos in IDP_POSITIONS:
        return "IDP"
    return pos if pos in PARAMS else None


def _clamp(value, low, high):
    return max(low, min(high, value))


def _fmt(value):
    return f"{value:.1f}"


# ---- B: the base ---------------------------------------------------------

def form(history):
    """(F, n) from a player's played games, newest last."""
    recent = [p for p in history[-FORM_GAMES:]]
    if not recent:
        return None, 0
    return round(sum(recent) / len(recent), 2), len(recent)


def quality(season_proj, prev_ppg=None, prev_games=0):
    """Points per game this player is, before this week says anything.

    The season projection per game, blended with last season's rate in
    proportion to how much of a season that rate rests on.
    """
    per_game = season_proj / 17.0 if season_proj else None
    if prev_ppg is None or not prev_games:
        return round(per_game, 2) if per_game is not None else None
    trust = min(prev_games, 17) / 17.0 * 0.5
    if per_game is None:
        return round(prev_ppg, 2)
    return round((1 - trust) * per_game + trust * prev_ppg, 2)


# Without Sleeper's number, form is the best evidence left and takes up to
# this much of the base; Q fills the rest.
FORM_WITHOUT_S = 0.7


def weights(n, params, have_s=True, have_q=True):
    """g_S, g_F, g_Q for a player with n played games."""
    g_f = min(params["cap"], n / (n + params["k"])) if n else 0.0
    if not have_s and n:
        g_f = min(FORM_WITHOUT_S, n / (n + 2.0)) if have_q else 1.0
    rest = 1.0 - g_f
    if have_s and have_q:
        g_s, g_q = rest * params["s_share"], rest * (1 - params["s_share"])
    elif have_s:
        g_s, g_q = rest, 0.0
    elif have_q:
        g_s, g_q = 0.0, rest
    else:
        g_s, g_q, g_f = 0.0, 0.0, 1.0 if n else 0.0
    if not n:
        total = g_s + g_q
        g_s, g_q = (g_s / total, g_q / total) if total else (0.0, 0.0)
    return round(g_s, 3), round(g_f, 3), round(g_q, 3)


def base(S, F, n, Q, params):
    """B and the weights it was built with."""
    g_s, g_f, g_q = weights(n, params, S is not None, Q is not None)
    value = g_s * (S or 0) + g_f * (F or 0) + g_q * (Q or 0)
    return round(value, 2), (g_s, g_f, g_q)


def points_allowed(games):
    """Points allowed per game, per defense and position group.

    `games` is [(week, opponent, group, points)], one row per player-game.
    Returns (per_game {(opp, group): pts}, league_avg {group: pts},
    games_played {opp: n}).
    """
    totals, weeks = {}, {}
    for week, opp, group, pts in games:
        if not opp or not group:
            continue
        totals[(opp, group)] = totals.get((opp, group), 0.0) + pts
        weeks.setdefault(opp, set()).add(week)
    per_game = {key: v / len(weeks[key[0]]) for key, v in totals.items()}
    by_group = {}
    for (_, group), v in per_game.items():
        by_group.setdefault(group, []).append(v)
    league_avg = {g: sum(v) / len(v) for g, v in by_group.items()}
    return per_game, league_avg, {opp: len(w) for opp, w in weeks.items()}


# ---- K: the corrections ----------------------------------------------------

def role_factor(usage_adj, params):
    """R from the usage layer's adjustment, scaled by what survived the backtest."""
    if usage_adj is None:
        return 1.0
    return round(_clamp(1 + params["beta"] * (usage_adj - 1), 1 - ROLE_MAX, 1 + ROLE_MAX), 3)


def matchup_factor(allowed, league_avg, games, params, vegas_ratio=None):
    """M from the points this opponent allows the position, and the Vegas total.

    `allowed` is his opponent's points allowed per game to this position,
    `league_avg` the same across the league. Early in a season a defense's
    number rests on two or three games, so it is pulled towards the average
    until it has earned its weight.
    """
    delta = 0.0
    if allowed is not None and league_avg:
        shrink = games / (games + MATCHUP_SHRINK)
        delta += params["alpha"] * shrink * (allowed / league_avg - 1)
    if vegas_ratio is not None:
        delta += VEGAS_WEIGHT * (vegas_ratio - 1)
    return round(_clamp(1 + delta, 1 - MATCHUP_MAX, 1 + MATCHUP_MAX), 3)


# Wind in km/h (Open-Meteo's unit), precipitation in mm/h.
WIND_STRONG, WIND_SEVERE = 24, 40      # 15 and 25 mph
RAIN_HEAVY = 2.5
WEATHER_EFFECT = {
    # position: (strong wind, severe wind, heavy rain or snow)
    "K":   (-0.10, -0.25, -0.08),
    "QB":  (-0.05, -0.12, -0.05),
    "WR":  (-0.05, -0.12, -0.05),
    "TE":  (-0.03, -0.08, -0.03),
    "RB":  (0.03, 0.05, 0.02),
    "DEF": (0.03, 0.06, 0.04),
}


def weather_factor(pos, wx):
    """W and the sentence behind it. `wx` is None under a roof or without a forecast."""
    if not wx or wx.get("dome"):
        return 1.0, ("Dach" if wx and wx.get("dome") else None)
    effect = WEATHER_EFFECT.get(pos)
    wind, rain, snow = wx.get("wind") or 0, wx.get("precip") or 0, wx.get("snow") or 0
    parts = []
    delta = 0.0
    if wind >= WIND_SEVERE:
        delta += effect[1] if effect else 0
        parts.append(f"Sturm {round(wind)} km/h")
    elif wind >= WIND_STRONG:
        delta += effect[0] if effect else 0
        parts.append(f"Wind {round(wind)} km/h")
    if rain >= RAIN_HEAVY or snow > 0.5:
        delta += effect[2] if effect else 0
        parts.append("Schnee" if snow > 0.5 else f"Starkregen {rain:.1f} mm/h")
    if not parts:
        return 1.0, f"ruhig ({round(wind)} km/h)"
    return round(1 + delta, 3), ", ".join(parts)


def availability(injury):
    """A and its reason. Questionable is flagged, not discounted: most play."""
    severity = (injury or {}).get("severity") or 0
    status = (injury or {}).get("status")
    if severity >= 3:
        return 0.0, f"{status}: spielt nicht"
    if severity == 2:
        return (injury or {}).get("redraft_mult", 0.4), f"{status}: spielt meist nicht"
    if severity == 1:
        return 1.0, f"{status}: vor Kickoff Inactives prüfen"
    return 1.0, None


# ---- P: putting it together ------------------------------------------------

def forecast(pos, S, history, Q, usage_adj=None, allowed=None, league_avg=None,
             opp_games=0, vegas_ratio=None, wx=None, injury=None, locked=False):
    """The forecast for one player and one week, with every part explained."""
    group = group_of(pos) or "WR"
    params = PARAMS[group]
    F, n = form(history)
    B, (g_s, g_f, g_q) = base(S, F, n, Q, params)

    R = role_factor(usage_adj, params)
    M = matchup_factor(allowed, league_avg, opp_games, params, vegas_ratio)
    W, weather_note = weather_factor(pos if group != "IDP" else "IDP", wx)
    K = round(_clamp(R * M * W, K_MIN, K_MAX), 3)
    A, availability_note = (1.0, None) if locked else availability(injury)

    P = round(B * K * A, 1)
    return {
        "P": P, "B": B, "K": K, "A": A,
        "S": S, "F": F, "n": n, "Q": Q,
        "weights": {"S": g_s, "F": g_f, "Q": g_q},
        "R": R, "M": M, "W": W,
        "notes": {"weather": weather_note, "availability": availability_note},
        "explain": explain(S, F, n, Q, g_s, g_f, g_q, B, R, M, W, K, A, P,
                           weather_note, availability_note, allowed, league_avg,
                           vegas_ratio),
    }


def explain(S, F, n, Q, g_s, g_f, g_q, B, R, M, W, K, A, P, weather_note,
            availability_note, allowed, league_avg, vegas_ratio):
    """The forecast as the lines the app prints under it."""
    parts = []
    if S is not None and g_s:
        parts.append(f"{round(g_s * 100)} % Sleeper {_fmt(S)}")
    if F is not None and g_f:
        parts.append(f"{round(g_f * 100)} % Form {_fmt(F)} ({n} Sp.)")
    if Q is not None and g_q:
        parts.append(f"{round(g_q * 100)} % Qualität {_fmt(Q)}")
    lines = [f"Basis {_fmt(B)} = " + " + ".join(parts)]

    corr = []
    if R != 1:
        corr.append(f"Rolle {_pct(R)}")
    if M != 1:
        bits = []
        if allowed is not None and league_avg:
            bits.append(f"Gegner erlaubt {_fmt(allowed)} statt Ø {_fmt(league_avg)}")
        if vegas_ratio is not None:
            bits.append(f"Vegas {_pct(vegas_ratio)}")
        corr.append(f"Matchup {_pct(M)}" + (f" ({', '.join(bits)})" if bits else ""))
    if W != 1:
        corr.append(f"Wetter {_pct(W)} ({weather_note})")
    if corr:
        capped = " (gedeckelt)" if round(R * M * W, 3) != K else ""
        lines.append("Korrektur " + ", ".join(corr) + f" → ×{K:.2f}{capped}")
    if A != 1:
        lines.append(f"Verfügbarkeit ×{A:.2f} ({availability_note})")
    elif availability_note:
        lines.append(availability_note)
    lines.append(f"Prognose {_fmt(P)}")
    return lines


def _pct(factor):
    delta = round((factor - 1) * 100)
    return f"{'+' if delta >= 0 else '−'}{abs(delta)} %"
