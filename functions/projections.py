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
"""

import json
import urllib.request
import urllib.parse

BASE_URL = "https://api.sleeper.com/projections"

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
    gp = (p_stats or {}).get("gp") or 0
    if gp >= _AGGREGATE_GP:
        return 1.0
    return float(SEASON_GAMES.get(sport, 17))


def fetch_season_projections(sport="nfl", season="2026"):
    """Season projections keyed by player id. Returns {} on any failure —
    projections are an improvement to the model, never a requirement for it."""
    positions = POSITIONS.get(sport) or POSITIONS["nfl"]
    query = urllib.parse.urlencode(
        [("season_type", "regular")] + [("position[]", p) for p in positions]
    )
    url = f"{BASE_URL}/{sport}/{season}?{query}"

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as response:
            rows = json.loads(response.read().decode())
    except Exception as e:
        print(f"Projections fetch failed for {sport} {season}: {e}")
        return {}

    if not isinstance(rows, list):
        return {}

    out = {}
    for row in rows:
        pid = row.get("player_id")
        stats = row.get("stats")
        if pid is None or not stats:
            continue
        out[str(pid)] = stats
    return out
