"""Game-day context: weather at the stadium and the Vegas lines.

Both are fetched once per refresh and stored with the week they belong to.
Weather comes from Open-Meteo (free, no key), the lines from The Odds API,
which needs a key (`ODDS_API_KEY`) and allows 500 requests a month on the
free tier - one per refresh is ~90. Without a key, there are no lines, and
the matchup factor rests on points allowed alone.
"""

import json
import os
import urllib.parse
import urllib.request

# Home stadium per team: latitude, longitude, roof. A retractable roof counts
# as a roof: it is closed exactly on the days the weather would matter.
STADIUMS = {
    "ARI": (33.5276, -112.2626, True),  "ATL": (33.7554, -84.4008, True),
    "BAL": (39.2780, -76.6227, False),  "BUF": (42.7738, -78.7870, False),
    "CAR": (35.2258, -80.8528, False),  "CHI": (41.8623, -87.6167, False),
    "CIN": (39.0955, -84.5161, False),  "CLE": (41.5061, -81.6995, False),
    "DAL": (32.7473, -97.0945, True),   "DEN": (39.7439, -105.0201, False),
    "DET": (42.3400, -83.0456, True),   "GB":  (44.5013, -88.0622, False),
    "HOU": (29.6847, -95.4107, True),   "IND": (39.7601, -86.1639, True),
    "JAX": (30.3239, -81.6373, False),  "KC":  (39.0489, -94.4839, False),
    "LV":  (36.0909, -115.1833, True),  "LAC": (33.9535, -118.3392, True),
    "LAR": (33.9535, -118.3392, True),  "MIA": (25.9580, -80.2389, False),
    "MIN": (44.9737, -93.2577, True),   "NE":  (42.0909, -71.2643, False),
    "NO":  (29.9511, -90.0812, True),   "NYG": (40.8135, -74.0745, False),
    "NYJ": (40.8135, -74.0745, False),  "PHI": (39.9008, -75.1675, False),
    "PIT": (40.4468, -80.0158, False),  "SF":  (37.4032, -121.9698, False),
    "SEA": (47.5952, -122.3316, False), "TB":  (27.9759, -82.5033, False),
    "TEN": (36.1665, -86.7713, False),  "WAS": (38.9076, -76.8645, False),
}

# The Odds API names teams in full.
TEAM_NAMES = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC", "Las Vegas Raiders": "LV", "Los Angeles Chargers": "LAC",
    "Los Angeles Rams": "LAR", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
    "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "San Francisco 49ers": "SF", "Seattle Seahawks": "SEA", "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}

# Kickoffs are not in Sleeper's schedule, only dates (US Eastern). Without
# the kickoff from the odds feed, the window is 17:00-01:00 UTC - 1 pm to
# 9 pm Eastern, every Sunday slot. With it, the game's own three hours.
DEFAULT_WINDOW_UTC = (17, 25)
GAME_LENGTH_H = 3


def _get_json(url, timeout=20, attempts=3):
    """GET with a retry: a dropped handshake should not cost a week's weather."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return json.loads(response.read().decode())
        except OSError:
            if attempt == attempts - 1:
                raise


def week_games(schedule, week):
    """This week's games from Sleeper's schedule: [{home, away, date}]."""
    return [{"home": g["home"], "away": g["away"], "date": g.get("date")}
            for g in schedule or [] if int(g.get("week") or 0) == int(week)]


def _window(game, kickoffs):
    """UTC timestamps ("YYYY-MM-DDTHH:00") the game is played in."""
    from datetime import datetime, timedelta
    kickoff = (kickoffs or {}).get(game["home"])
    if kickoff:
        start = datetime.strptime(kickoff[:13], "%Y-%m-%dT%H")
        hours = GAME_LENGTH_H
        exact = True
    else:
        start = datetime.strptime(game["date"], "%Y-%m-%d") + timedelta(hours=DEFAULT_WINDOW_UTC[0])
        hours = DEFAULT_WINDOW_UTC[1] - DEFAULT_WINDOW_UTC[0]
        exact = False
    return [(start + timedelta(hours=h)).strftime("%Y-%m-%dT%H:00") for h in range(hours)], exact


def fetch_weather(games, kickoffs=None):
    """{team: {wind, gusts, precip, snow, dome, venue, exact}} for both teams of every game.

    One request for all outdoor stadiums at once. Wind is the mean over the
    game window - a sustained wind is what moves a kick, a single gusty hour
    in an eleven-hour window is not. Rain and snow are the worst hour: one
    downpour is enough to matter. `exact` says whether the window came from
    a real kickoff time or from the date alone.
    """
    out = {}
    outdoor = []
    for game in games:
        home = game["home"]
        stadium = STADIUMS.get(home)
        if not stadium or not game.get("date"):
            continue
        if stadium[2]:
            for team in (home, game["away"]):
                out[team] = {"dome": True, "venue": home}
            continue
        outdoor.append((game, stadium))
    if not outdoor:
        return out

    from datetime import datetime, timedelta
    dates = sorted(g["date"] for g, _ in outdoor)
    end = (datetime.strptime(dates[-1], "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    query = urllib.parse.urlencode({
        "latitude": ",".join(str(s[0]) for _, s in outdoor),
        "longitude": ",".join(str(s[1]) for _, s in outdoor),
        "hourly": "wind_speed_10m,wind_gusts_10m,precipitation,snowfall",
        "timezone": "GMT",
        "start_date": dates[0],
        "end_date": end,
    })
    try:
        data = _get_json(f"https://api.open-meteo.com/v1/forecast?{query}")
    except Exception as e:  # noqa: BLE001 - no weather is a missing factor, not an error
        print(f"Weather fetch failed: {e}")
        return out
    if isinstance(data, dict):
        data = [data]

    for (game, _), loc in zip(outdoor, data):
        hourly = (loc or {}).get("hourly") or {}
        times = hourly.get("time") or []
        window, exact = _window(game, kickoffs)
        rows = [i for i, t in enumerate(times) if t in window]
        if not rows:
            continue

        def values(key):
            series = hourly.get(key) or []
            return [series[i] for i in rows if i < len(series) and series[i] is not None]

        def mean(key):
            v = values(key)
            return round(sum(v) / len(v), 1) if v else 0

        def worst(key):
            v = values(key)
            return max(v) if v else 0

        wx = {"dome": False, "venue": game["home"], "wind": mean("wind_speed_10m"),
              "gusts": worst("wind_gusts_10m"), "precip": worst("precipitation"),
              "snow": worst("snowfall"), "exact": exact}
        for team in (game["home"], game["away"]):
            out[team] = wx
    return out


def fetch_odds(api_key):
    """{team: {implied, spread, total, opp}} from the consensus of all books.

    The implied team total is what the market expects a team to score:
    half the game total, moved by half the spread. It carries opponent
    strength, weather and game script in one number the market has already
    calibrated.
    """
    if not api_key:
        return {}
    query = urllib.parse.urlencode({"apiKey": api_key, "regions": "us",
                                    "markets": "spreads,totals", "oddsFormat": "american"})
    try:
        events = _get_json(f"https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?{query}")
    except Exception as e:  # noqa: BLE001
        print(f"Odds fetch failed: {e}")
        return {}

    out = {}
    for event in events or []:
        home, away = TEAM_NAMES.get(event.get("home_team")), TEAM_NAMES.get(event.get("away_team"))
        if not home or not away:
            continue
        spreads, totals = {home: [], away: []}, []
        for book in event.get("bookmakers") or []:
            for market in book.get("markets") or []:
                for outcome in market.get("outcomes") or []:
                    point = outcome.get("point")
                    if point is None:
                        continue
                    if market.get("key") == "spreads":
                        team = TEAM_NAMES.get(outcome.get("name"))
                        if team in spreads:
                            spreads[team].append(point)
                    elif market.get("key") == "totals" and outcome.get("name") == "Over":
                        totals.append(point)
        if not totals or not spreads[home]:
            continue
        total = _median(totals)
        home_spread = _median(spreads[home])
        for team, opp, spread in ((home, away, home_spread), (away, home, -home_spread)):
            out[team] = {"implied": round(total / 2 - spread / 2, 1), "spread": spread,
                         "total": total, "opp": opp, "kickoff": event.get("commence_time")}
    return out


def _median(values):
    values = sorted(values)
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def fetch_context(schedule, week):
    """Weather and lines for one week, as stored by the refresh."""
    games = week_games(schedule, week)
    odds = fetch_odds(os.environ.get("ODDS_API_KEY", "").strip())
    kickoffs = {team: v["kickoff"] for team, v in odds.items() if v.get("kickoff")}
    return {"week": int(week), "games": games, "weather": fetch_weather(games, kickoffs),
            "odds": odds}


def vegas_ratio(odds, team):
    """His team's implied total against this week's average, or None without lines."""
    if not odds or team not in odds:
        return None
    totals = [v["implied"] for v in odds.values()]
    avg = sum(totals) / len(totals)
    return round(odds[team]["implied"] / avg, 3) if avg else None
