"""Forward-looking season projections.

The scoring model was built entirely on what a player *did* — recency weighted
totals from the last three seasons. In preseason that is the only thing there
is, and it is wrong in both directions at once:

- a rookie has no history, so he scores zero and reads as unrosterable
- a veteran who just lost his job still carries last season's production

Both errors land on the same roster, which is why a perfectly normal dynasty
team came out with every position "kritisch".

Sleeper publishes season projections on the same stat schema as the stats files
(`pass_yd`, `rec`, `idp_tkl_solo`, ...), so they can be scored through the
league's own scoring settings by `calculate_custom_score` — no second scoring
model, no hardcoded points.

Two shapes come back from the endpoint and have to be told apart:

- NFL returns season totals (`gp: 18`, `pts_ppr: 361.5`)
- NBA returns per-game averages (`gp: 1`, `pts: 31.8`)

`season_factor` normalises both to a season total.

Weekly projections (`fetch_week_projections`) answer a different question -
who starts *this* week - and carry the schedule with them: opponents, game
dates and bye weeks, none of which a season total can express.
"""

import json
import urllib.request
import urllib.parse

BASE_URL = "https://api.sleeper.com/projections"
# Actual box scores, on the same row schema as the projections.
STATS_URL = "https://api.sleeper.com/stats"

# Positions worth asking for. The endpoint takes repeated position[] params and
# silently returns nothing for a sport/position combination it does not know.
POSITIONS = {
    "nfl": ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"],
    "nba": ["PG", "SG", "SF", "PF", "C"],
}

# Used to scale a per-game projection up to a season.
SEASON_GAMES = {"nfl": 17, "nba": 82}

# Above this many games the payload is already a season aggregate.
_AGGREGATE_GP = 5


def season_factor(p_stats, sport="nfl"):
    """Multiplier that turns one projection row into a season total."""
    if sport == "nfl":
        # Always season totals - team defenses included, which ship `gp: 1`
        # next to 45 sacks. Read as a per-game row, every defense's season
        # came out seventeen times too large.
        return 1.0
    gp = (p_stats or {}).get("gp") or 0
    if gp >= _AGGREGATE_GP:
        return 1.0
    return float(SEASON_GAMES.get(sport, 17))


def _fetch_rows(sport, path, base=BASE_URL, positions=None):
    """Raw projection rows for one endpoint path, or None on any failure."""
    positions = positions or POSITIONS.get(sport) or POSITIONS["nfl"]
    query = urllib.parse.urlencode(
        [("season_type", "regular")] + [("position[]", p) for p in positions]
    )
    url = f"{base}/{sport}/{path}?{query}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as response:
            rows = json.loads(response.read().decode())
    except Exception as e:
        print(f"Projections fetch failed for {sport} {path}: {e}")
        return None

    return rows if isinstance(rows, list) else None


def fetch_season_projections(sport="nfl", season="2026"):
    """Season projections keyed by player id. Returns {} on any failure —
    projections are an improvement to the model, never a requirement for it."""
    out = {}
    for row in _fetch_rows(sport, season) or []:
        pid = row.get("player_id")
        stats = row.get("stats")
        if pid is None or not stats:
            continue
        out[str(pid)] = stats
    return out


# Draft-market fields ride along on every row and make up most of its bytes.
# Nothing in the weekly model reads them.
_DROP_PREFIXES = ("adp_", "pos_adp_")


def fetch_week_projections(sport, season, week):
    """One week of projections: player stats, and the schedule behind them.

    The schedule is the part a season projection cannot give. A team's week is
    read off the `opponent` and `date` fields of its rows: a team with no row
    carrying an opponent is on bye. Every team still ships rows in its bye week
    - backups with empty stats - so "no rows" never happens and cannot be the
    test.

    Returns {"stats": {pid: stats}, "opp": {team: opponent}, "date": {team:
    "YYYY-MM-DD"}}, or None when the fetch failed. A row Sleeper did not
    project is left out, not stored as zero. An empty week (preseason,
    or past the end of the schedule) comes back as empty dicts, not None.
    """
    rows = _fetch_rows(sport, f"{season}/{week}")
    if rows is None:
        return None

    stats, opp, date = {}, {}, {}
    for row in rows:
        team = row.get("team")
        if team and row.get("opponent"):
            opp[team] = row["opponent"]
            if row.get("date"):
                date[team] = row["date"]
        pid = row.get("player_id")
        p_stats = row.get("stats")
        if pid is None or not p_stats:
            continue
        kept = {k: v for k, v in p_stats.items() if not k.startswith(_DROP_PREFIXES)}
        # An unprojected row carries only the draft market fields. Kept as
        # an empty dict it scored 0.0 and passed for "projected, and zero".
        if kept:
            stats[str(pid)] = kept
    return {"stats": stats, "opp": opp, "date": date}


def fetch_week_stats(sport, season, week):
    """What actually happened in one played week: {pid: {team, stats}}.

    Every position, IDP, kickers and defenses included: what a player actually
    scored is the first thing to check against a projection, whatever his
    position. Stats rows carry the full box score, so they are scored through
    the league's own settings just like the projections. Returns None when the fetch failed.
    """
    rows = _fetch_rows(sport, f"{season}/{week}", base=STATS_URL)
    if rows is None:
        return None
    out = {}
    for row in rows:
        pid = row.get("player_id")
        p_stats = row.get("stats")
        if pid is None or not p_stats or not p_stats.get("gp"):
            continue  # did not play: nothing to score, nothing to read a role off
        out[str(pid)] = {
            "team": row.get("team"),
            "opp": row.get("opponent"),
            "stats": {k: v for k, v in p_stats.items()
                      if not k.startswith(_DROP_PREFIXES) and not k.startswith("pts_")
                      and "rank" not in k and v},
        }
    return out
