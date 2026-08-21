import os
import json
import time
import requests
import urllib.request
import urllib.parse
import sleeper_api
import signals
import lineup
import projections

def fetch_espn_college_stats(player_name):
    """
    Fetches college stats from ESPN's open API for a given player name.
    Returns a dict with 'YDS', 'TD', 'REC', 'TACKLES', 'SACKS', 'INT', etc.
    """
    try:
        # Search for the player
        query = urllib.parse.quote(player_name)
        search_url = f"https://site.web.api.espn.com/apis/search/v2?region=us&lang=en&query={query}&limit=3&page=1&type=player"
        res = requests.get(search_url, timeout=5).json()
        
        if not res.get("results") or not res["results"]:
            return None
            
        # Find the first valid football player
        espn_id = None
        for result in res["results"]:
            if result.get("type") == "player" and result.get("contents"):
                for content in result["contents"]:
                    if content.get("sport") == "football":
                        # Could be "NFL" or "College Football" but ESPN stores college stats for both usually
                        # The ID is at the end of the web URL, e.g. https://www.espn.com/nfl/player/_/id/4605951/cj-daniels
                        web_url = content.get("link", {}).get("web", "")
                        if "/id/" in web_url:
                            parts = web_url.split("/id/")
                            espn_id = parts[1].split("/")[0]
                            break
                if espn_id:
                    break
                    
        if not espn_id:
            return None
            
        # Fetch their stats
        stats_url = f"https://site.web.api.espn.com/apis/common/v3/sports/football/college-football/athletes/{espn_id}/stats"
        stats_res = requests.get(stats_url, timeout=5)
        if stats_res.status_code != 200:
            return None
            
        stats_data = stats_res.json()
        categories = stats_data.get("categories", [])
        
        parsed_stats = {}
        for cat in categories:
            cat_name = cat.get("name")
            labels = cat.get("labels", [])
            totals = cat.get("totals", [])
            if len(labels) == len(totals):
                for label, total in zip(labels, totals):
                    # Clean commas from totals (e.g. "2,991" -> "2991")
                    val = total.replace(",", "")
                    try:
                        parsed_stats[f"{cat_name.upper()}_{label}"] = float(val)
                    except ValueError:
                        pass
        return parsed_stats if parsed_stats else None
    except Exception as e:
        print(f"Error fetching ESPN stats for {player_name}: {e}")
        return None

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Cloud Functions ship a read-only filesystem; only /tmp is writable. The old
# update endpoint wrote straight into DATA_DIR and could only ever fail in prod.
def _writable_dir():
    override = os.environ.get("FSA_DATA_DIR")
    if override:
        os.makedirs(override, exist_ok=True)
        return override
    if os.access(DATA_DIR, os.W_OK):
        return DATA_DIR
    tmp = "/tmp/fsa-data"
    os.makedirs(tmp, exist_ok=True)
    return tmp

CACHE_DIR = _writable_dir()

# Loaded JSON is held for the life of the container: players.json alone is 16 MB
# and was being re-read and re-parsed on every single request.
_JSON_CACHE = {}
_JSON_CACHE_TTL = 900
_BUCKET_TRIED = set()


def _bucket():
    try:
        from firebase_admin import storage
        return storage.bucket()
    except Exception:
        return None


def _pull_from_storage(filename):
    """Fetch a refreshed copy that the scheduled updater uploaded."""
    if filename in _BUCKET_TRIED:
        return None
    _BUCKET_TRIED.add(filename)
    bucket = _bucket()
    if not bucket:
        return None
    try:
        blob = bucket.blob(f"data/{filename}")
        if not blob.exists():
            return None
        target = os.path.join(CACHE_DIR, filename)
        blob.download_to_filename(target)
        return target
    except Exception as e:
        print(f"Storage download failed for {filename}: {e}")
        return None


def _resolve_data_path(filename):
    cached = os.path.join(CACHE_DIR, filename)
    if os.path.exists(cached):
        return cached
    pulled = _pull_from_storage(filename)
    if pulled:
        return pulled
    bundled = os.path.join(DATA_DIR, filename)
    return bundled if os.path.exists(bundled) else None


def _push_to_storage(filename, path):
    bucket = _bucket()
    if not bucket:
        return False
    try:
        bucket.blob(f"data/{filename}").upload_from_filename(path)
        return True
    except Exception as e:
        print(f"Storage upload failed for {filename}: {e}")
        return False


def _write_data(filename, payload):
    path = os.path.join(CACHE_DIR, filename)
    with open(path, "w") as f:
        json.dump(payload, f)
    _JSON_CACHE.pop(filename, None)
    _push_to_storage(filename, path)
    return path


def load_json(filename):
    entry = _JSON_CACHE.get(filename)
    now = time.time()
    if entry and now - entry[0] < _JSON_CACHE_TTL:
        return entry[1]

    path = _resolve_data_path(filename)
    data = {}
    if path:
        try:
            with open(path, "r") as f:
                data = json.load(f)
        except (ValueError, OSError) as e:
            print(f"Could not read {filename}: {e}")
            data = {}

    _JSON_CACHE[filename] = (now, data)
    return data


def players_file(sport):
    return "players.json" if sport == "nfl" else f"players_{sport}.json"


def stats_file(sport, year):
    return f"stats_{year}.json" if sport == "nfl" else f"stats_{sport}_{year}.json"


def projections_file(sport, year):
    return f"projections_{sport}_{year}.json"


def current_season(sport):
    state = sleeper_api.get_state(sport) or {}
    return str(state.get("league_season") or state.get("season") or "2026")


def load_projections(sport="nfl"):
    """Season projections, from the daily snapshot when it exists and live
    otherwise. A missing snapshot must not silently disable the forward-looking
    half of the model, so the first request in a cold container pays for a
    fetch and everything after it is served from the JSON cache."""
    filename = projections_file(sport, current_season(sport))
    data = load_json(filename)
    if data:
        return data
    data = projections.fetch_season_projections(sport, current_season(sport))
    if data:
        _JSON_CACHE[filename] = (time.time(), data)
    return data


def projected_points(sport, scoring_settings, players_db):
    """Projected season total per player, scored under this league's settings.

    Sleeper ships projections on the same stat schema as the stats files, so the
    league's own scoring runs over them unchanged - there is no second scoring
    model to keep in sync.
    """
    raw = load_projections(sport)
    out = {}
    for pid, p_stats in (raw or {}).items():
        player = (players_db or {}).get(str(pid))
        pos = player.get("position") if player else None
        points = calculate_custom_score(p_stats, pos, scoring_settings, sport)
        out[str(pid)] = round(points * projections.season_factor(p_stats, sport), 2)
    return out


def load_team_strength():
    """Relative team strength, kept in data/ so it can be updated per season
    instead of living as a hardcoded dict in the scoring code."""
    return (load_json("team_strength.json") or {}).get("tiers", {})


def load_players(sport="nfl"):
    return load_json(players_file(sport))


def load_college_stats():
    return load_json("college_stats.json")


# How much a season counts towards the long-term picture: most recent first.
RECENCY_WEIGHTS = [1.0, 0.6, 0.35]

# QBs out-score everyone in raw points, TEs score least; normalize before comparing.
POSITION_NORMALIZATION = {"QB": 0.5, "RB": 0.8, "WR": 0.8, "TE": 1.2}

IDP_POSITIONS = ["LB", "DB", "DL", "DE", "DT", "CB", "S"]
NBA_POSITIONS = ["PG", "SG", "SF", "PF", "C", "G", "F"]

# Sleeper stamps every player with its sport, so the scoring engine can branch
# on the player itself instead of threading the sport through every call.
def sport_of(player):
    return player.get("sport") or "nfl"


def offensive_positions(sport):
    return list(NBA_POSITIONS) if sport == "nba" else ["QB", "RB", "WR", "TE"]


ROSTERABLE_STATUSES = {
    "nfl": {"Active", "Injured Reserve", "PUP", None},
    "nba": {"ACT", "TWO-WAY", None},
}


def is_rosterable(player, sport):
    """Is this player on an actual pro roster? Status vocabularies differ per sport."""
    allowed = ROSTERABLE_STATUSES.get(sport, ROSTERABLE_STATUSES["nfl"])
    return player.get("status") in allowed

# (max_age, multiplier), first match wins. The tails have to keep falling —
# a 34-year-old RB is not worth what a 28-year-old RB is worth in dynasty.
AGE_CURVES = {
    "RB":  [(22, 1.35), (23, 1.30), (24, 1.20), (25, 1.05), (26, 0.85), (27, 0.65),
            (28, 0.50), (29, 0.38), (30, 0.28), (31, 0.20), (99, 0.12)],
    "WR":  [(22, 1.35), (23, 1.30), (24, 1.25), (25, 1.20), (26, 1.10), (27, 1.00),
            (28, 0.90), (29, 0.78), (30, 0.62), (31, 0.48), (32, 0.35), (99, 0.22)],
    "TE":  [(23, 1.25), (24, 1.20), (25, 1.15), (26, 1.10), (27, 1.05), (28, 0.95),
            (29, 0.85), (30, 0.72), (31, 0.58), (32, 0.45), (99, 0.30)],
    "QB":  [(24, 1.25), (25, 1.20), (27, 1.10), (29, 1.00), (31, 0.95), (33, 0.85),
            (35, 0.70), (36, 0.58), (37, 0.45), (99, 0.30)],
    "IDP": [(23, 1.25), (24, 1.20), (26, 1.10), (27, 1.00), (28, 0.88), (29, 0.75),
            (30, 0.60), (31, 0.45), (99, 0.30)],
    # NBA careers peak later and decline more gently than NFL ones.
    "NBA": [(21, 1.35), (22, 1.30), (23, 1.25), (24, 1.20), (26, 1.10), (28, 1.00),
            (30, 0.90), (31, 0.78), (32, 0.65), (33, 0.52), (34, 0.40), (99, 0.28)],
}
DEFAULT_AGE_CURVE = [(25, 1.1), (28, 1.0), (30, 0.8), (32, 0.6), (99, 0.4)]


def _score_nba(p_stats, scoring):
    """Sleeper NBA scoring. Defaults match Sleeper's own standard settings."""
    def val(key, default):
        return (p_stats.get(key, 0) or 0) * (scoring or {}).get(key, default)

    score = (
        val("pts", 1.0) + val("reb", 1.2) + val("ast", 1.5) + val("stl", 3.0) +
        val("blk", 3.0) + val("to", -1.0) + val("tpm", 0.5) + val("dd", 0.0) +
        val("td", 0.0) + val("tf", 0.0) + val("ff", 0.0) +
        val("bonus_pt_40p", 0.0) + val("bonus_pt_50p", 0.0)
    )
    return round(score, 2)


def _score_nfl_idp(p_stats, scoring):
    def val(key, default):
        return (p_stats.get(key, 0) or 0) * scoring.get(key, default)

    score = (
        val("idp_tkl_solo", 2.0) + val("idp_tkl_ast", 1.0) + val("idp_tkl_loss", 2.0) +
        val("idp_sack", 6.0) + val("idp_qb_hit", 1.0) + val("idp_ff", 3.0) +
        val("idp_fum_rec", 3.0) + val("idp_int", 6.0) + val("idp_pass_def", 3.0) +
        val("idp_safe", 3.0) + val("idp_def_td", 6.0) + val("idp_blk_kick", 3.0)
    )
    return round(score, 2)


def _score_nfl_offense(p_stats, pos, scoring):
    def val(key, default):
        return (p_stats.get(key, 0) or 0) * scoring.get(key, default)

    score = (
        val("pass_yd", 0.04) + val("pass_td", 4.0) + val("pass_int", -2.0) +
        val("rush_yd", 0.1) + val("rush_td", 6.0) +
        val("rec_yd", 0.1) + val("rec_td", 6.0) + val("fum_lost", -2.0) +
        val("pass_2pt", 2.0) + val("rush_2pt", 2.0) + val("rec_2pt", 2.0)
    )

    rec = p_stats.get("rec", 0) or 0
    rec_score = rec * scoring.get("rec", 1.0)
    if pos == "TE":
        rec_score += rec * scoring.get("bonus_rec_te", 0.0)
    elif pos == "RB":
        rec_score += rec * scoring.get("bonus_rec_rb", 0.0)
    elif pos == "WR":
        rec_score += rec * scoring.get("bonus_rec_wr", 0.0)

    return round(score + rec_score, 2)


def calculate_custom_score(p_stats, pos, scoring, sport="nfl"):
    """Scores a season under the league's own scoring settings."""
    if sport == "nba":
        return _score_nba(p_stats, scoring)

    if not scoring:
        return max(p_stats.get("pts_ppr", 0) or 0, p_stats.get("pts_idp", 0) or 0)

    if pos in IDP_POSITIONS:
        return _score_nfl_idp(p_stats, scoring)
    return _score_nfl_offense(p_stats, pos, scoring)


def recent_seasons(sport, count=4):
    """Candidate seasons, newest last. One more than we weight, because the
    current season is often still empty (preseason) and would otherwise push a
    season with real data out of the window."""
    state = sleeper_api.get_state(sport) or {}
    try:
        year = int(state.get("league_season") or state.get("season"))
    except (TypeError, ValueError):
        year = 2026
    return list(range(year - count + 1, year + 1))


def load_multi_year_stats(years=[2023, 2024, 2025], scoring_settings=None, players_db=None, sport="nfl"):
    """Aggregates per-season scoring. `pts_w` is recency weighted, `pts` stays the raw sum."""
    aggregated_stats = {}
    ordered = sorted(years, reverse=True)

    idx = 0
    for year in ordered:
        if idx >= len(RECENCY_WEIGHTS):
            break
        stats = load_json(stats_file(sport, year))
        # Sleeper ships a stats file for the current season during preseason, full
        # of zero-game entries. It is not empty, but it carries no signal - so
        # check for actual games played before it consumes a recency weight.
        if not any((s.get("gp") or 0) > 0 for s in stats.values()):
            continue
        weight = RECENCY_WEIGHTS[idx]
        idx += 1
        for pid, p_stats in stats.items():
            if pid not in aggregated_stats:
                aggregated_stats[pid] = {"pts": 0, "gp": 0, "tkl": 0, "rec": 0,
                                        "years_played": 0, "_wpts": 0.0, "_wsum": 0.0}
            gp = p_stats.get("gp", 0) or 0
            if gp > 0:
                pos = None
                if players_db and pid in players_db:
                    pos = players_db[pid].get("position")
                pts = calculate_custom_score(p_stats, pos, scoring_settings, sport)
                agg = aggregated_stats[pid]
                agg["pts"] += pts
                agg["gp"] += gp
                agg["tkl"] += (p_stats.get("idp_tkl", 0) or 0)
                agg["rec"] += (p_stats.get("rec", 0) or 0)
                agg["years_played"] += 1
                agg["_wpts"] += pts * weight
                agg["_wsum"] += weight

    for agg in aggregated_stats.values():
        agg["pts_w"] = round(agg["_wpts"] / agg["_wsum"], 2) if agg["_wsum"] else 0.0

    return aggregated_stats


def _pos_group(pos):
    if pos in IDP_POSITIONS:
        return "IDP"
    if pos in NBA_POSITIONS:
        return "NBA"
    return pos


def _age_multiplier(pos, age):
    curve = AGE_CURVES.get(_pos_group(pos), DEFAULT_AGE_CURVE)
    for max_age, mult in curve:
        if age <= max_age:
            return mult
    return curve[-1][1]


def _weighted_production(p_stats):
    if not p_stats:
        return 0.0
    if p_stats.get("pts_w") is not None:
        return p_stats["pts_w"]
    years = max(p_stats.get("years_played", 1), 1)
    return p_stats.get("pts", 0) / years


def _role_multiplier(player, signal=None, projected=False):
    """Depth chart role. A backup is worth less, but not 90% less — and a man
    who just moved up because the starter went down is not a backup any more.

    With a projection in hand this must not fire at full strength: the
    projection already prices the depth chart, so multiplying by it again
    charged every backup twice and pushed rookies to zero. What a projection
    cannot know is a job that opened up after it was published, so in that case
    the role signal is kept as an upgrade only.
    """
    if projected:
        opportunity = (signal or {}).get("opportunity", {}).get("score", 0)
        if opportunity >= 3:
            return 1.15
        if opportunity == 2:
            return 1.05
        return 1.0

    order = player.get("depth_chart_order")
    if sport_of(player) == "nba":
        # Sleeper only fills the NBA depth chart for a fraction of the league,
        # so an absent entry must not be read as a demotion.
        return 1.0
    if order is None:
        mult = 0.6  # no depth chart entry is missing data, not proof of irrelevance
    elif order == 1:
        mult = 1.0
    elif order == 2:
        mult = 0.7 if player.get("position") == "RB" else 0.55
    elif order == 3:
        mult = 0.35
    else:
        mult = 0.2

    opportunity = (signal or {}).get("opportunity", {}).get("score", 0)
    if opportunity >= 3:
        mult = max(mult, 0.80)
    elif opportunity == 2:
        mult = max(mult, 0.60)
    return mult


def _market_component(player):
    """Consensus market value. Sleeper parks irrelevant players at ~9999999."""
    rank = player.get("search_rank")
    if not rank or rank >= 100000:
        return 0
    if rank <= 25:  return 100
    if rank <= 50:  return 80
    if rank <= 100: return 60
    if rank <= 200: return 40
    if rank <= 300: return 25
    if rank <= 600: return 12
    if rank <= 1500: return 5
    return 0


def _prospect_component(player, college_data):
    """Rookie / second-year upside. Scaled by draft capital so that UDFA camp
    bodies (search_rank ~9999999) score zero instead of outranking contributors."""
    years_exp = player.get("years_exp") or 0
    if years_exp >= 2:
        return 0

    rank = player.get("search_rank") or 999999
    if rank <= 100:    base = 90
    elif rank <= 300:  base = 60
    elif rank <= 800:  base = 30
    elif rank <= 3000: base = 10
    else:              base = 0
    if years_exp == 1:
        base *= 0.5

    if base == 0:
        return 0

    pos = player.get("position")
    pid = str(player.get("player_id"))
    bonus = 0
    if college_data and pid in college_data:
        cstats = college_data[pid]
        if cstats and not cstats.get("_not_found"):
            if pos in ["WR", "TE"]:
                yds = cstats.get("RECEIVING_YDS", 0)
                tds = cstats.get("RECEIVING_TD", 0)
                if yds > 2000: bonus += 25
                elif yds > 1000: bonus += 15
                if tds > 20: bonus += 15
                elif tds > 10: bonus += 10
            elif pos == "RB":
                yds = cstats.get("RUSHING_YDS", 0)
                tds = cstats.get("RUSHING_TD", 0)
                if yds > 2500: bonus += 25
                elif yds > 1500: bonus += 15
                if tds > 25: bonus += 15
                elif tds > 15: bonus += 10
            elif pos == "QB":
                yds = cstats.get("PASSING_YDS", 0)
                tds = cstats.get("PASSING_TD", 0)
                if yds > 6000: bonus += 25
                elif yds > 3000: bonus += 15
                if tds > 50: bonus += 15
                elif tds > 25: bonus += 10
            elif pos in IDP_POSITIONS:
                tck = cstats.get("DEFENSIVE_TOT", 0)
                sck = cstats.get("DEFENSIVE_SACK", 0)
                if tck > 150: bonus += 20
                elif tck > 80: bonus += 10
                if sck > 15: bonus += 15
                elif sck > 5: bonus += 10
            bonus = bonus or 15
        else:
            bonus = 5

    return base + bonus


def expected_points(player, p_stats, signal=None, proj=None):
    """Points this player is expected to put on the board this season, in the
    league's own scoring.

    Deliberately *not* position normalised. RVS scales QBs down and TEs up so
    that assets are comparable across positions, which is right for ranking a
    trade board and wrong for filling a lineup: a FLEX slot compares real
    points. Building the lineup off RVS meant a TE projected for 150 beat an RB
    projected for 170, and a 333-point QB lost his SUPER_FLEX seat to a
    292-point RB. Availability still applies — a player who is out scores
    nothing whatever his talent says.
    """
    projected = proj is not None
    pts = proj if projected else _weighted_production(p_stats)
    pts *= _role_multiplier(player, signal, projected)
    if signal:
        pts *= signal["injury"]["redraft_mult"]
    return round(pts, 1)


def calculate_rvs(player, p_stats, signal=None, proj=None):
    """Redraft Value Score — what this player is worth for the current season.

    A projection is the answer to exactly this question, so when one exists it
    *is* the production term. History only stands in when no projection was
    published. Team strength and depth chart role are skipped in the projected
    case for the same reason: Sleeper already priced both, and applying them a
    second time was double counting.
    """
    projected = proj is not None
    rvs = proj if projected else _weighted_production(p_stats)
    rvs *= POSITION_NORMALIZATION.get(player.get("position"), 1.0)
    rvs *= _role_multiplier(player, signal, projected)

    if not projected:
        team = player.get("team")
        tiers = load_team_strength()
        if team in tiers:
            rvs *= tiers[team]

    # A designation published after the projection is the freshest thing we
    # have, so this one still applies either way.
    if signal:
        rvs *= signal["injury"]["redraft_mult"]

    return round(rvs, 1)


def calculate_dvs(player, p_stats, college_data, signal=None, proj=None):
    """Dynasty Value Score — long-term asset value.

    Built from independent components so that the additive market/prospect value
    is never scaled by a short-term setback. A temporary IR stint or a preseason
    depth chart entry must not erase a young player's dynasty value.
    """
    pos = player.get("position")
    age = player.get("age") or 25

    # Dynasty spans more than the coming season, so the multi-year record keeps
    # the larger share - but a rookie with no record at all is not worth zero,
    # which is what a purely historical term claimed.
    projected = proj is not None
    history = _weighted_production(p_stats)
    production = 0.55 * history + 0.45 * proj if projected else history
    production *= POSITION_NORMALIZATION.get(pos, 1.0)
    # Long-term value cares about role, but far less than the current season does.
    production *= 0.5 + 0.5 * _role_multiplier(player, signal, projected)

    dvs = production + _market_component(player) + _prospect_component(player, college_data)
    dvs *= _age_multiplier(pos, age)

    if signal:
        # Long-term designations bite; a weekly "Questionable" barely registers.
        dvs *= signal["injury"]["dynasty_mult"]

    return round(dvs, 1)


def canonical_pos(player):
    """The position a league's roster slots address him by.

    Sleeper's `position` is the real-life one (CB, SS, DE, NT); the slots use
    `fantasy_positions` (DB, DL, LB). Displaying and grouping by the raw value
    is why cornerbacks never matched DB slots.
    """
    fantasy = player.get("fantasy_positions") or []
    return fantasy[0] if fantasy else (player.get("position") or "UNK")


DIRECT_SLOTS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB',
                'PG', 'SG', 'SF', 'PF', 'C']

# How the demand of a flex slot spreads over the positions allowed to fill it.
FLEX_WEIGHTS = {
    "SUPER_FLEX": {"QB": 1.00},
    "FLEX":       {"RB": 0.40, "WR": 0.45, "TE": 0.15},
    "REC_FLEX":   {"WR": 0.70, "TE": 0.30},
    "WRRB_FLEX":  {"RB": 0.50, "WR": 0.50},
    "IDP_FLEX":   {"LB": 0.40, "DB": 0.35, "DL": 0.25},
    "G":          {"PG": 0.50, "SG": 0.50},
    "F":          {"SF": 0.50, "PF": 0.50},
    "UTIL":       {"PG": 0.20, "SG": 0.20, "SF": 0.20, "PF": 0.20, "C": 0.20},
}


def starter_requirements(roster_positions):
    """Effective starter demand per position, flex slots included.

    Used only to size replacement levels; the lineup itself is built by real
    slot matching in lineup.py.
    """
    req = {}
    for slot in roster_positions or []:
        if slot in DIRECT_SLOTS:
            req[slot] = req.get(slot, 0) + 1.0
        elif slot in FLEX_WEIGHTS:
            for pos, weight in FLEX_WEIGHTS[slot].items():
                req[pos] = req.get(pos, 0) + weight
    return req


def replacement_levels(rosters, players, stats, college_data, sigs, req, num_teams,
                       sport="nfl", fallback_pool=True, projs=None):
    """League-relative baseline per position: the value of the last player who
    would still be starting somewhere in this league.

    Players are counted at every position they are eligible for, and each metric
    is ranked independently - reading an RVS off a DVS-sorted list produced an
    arbitrary number.
    """
    by_pos = {}
    for roster in rosters or []:
        for pid in (roster.get("players") or []):
            player = players.get(str(pid))
            if not player:
                continue
            p_stats = stats.get(str(pid), {})
            sig = sigs.get(str(pid))
            proj = (projs or {}).get(str(pid))
            entry = (calculate_dvs(player, p_stats, college_data, sig, proj),
                     calculate_rvs(player, p_stats, sig, proj),
                     expected_points(player, p_stats, sig, proj))
            for pos in lineup.player_positions(player):
                by_pos.setdefault(pos, []).append(entry)

    # During a live startup draft Sleeper leaves the rosters empty, so there is
    # nothing to rank and every baseline would come out as zero - which silently
    # disables need detection. Fall back to the player pool: "the Nth best player
    # still obtainable at this position" is the same idea, and is arguably the
    # better reference mid-draft.
    if fallback_pool:
        needed = {pos: max(1, int(round(req.get(pos, 1) * max(1, num_teams))))
                  for pos in req}
        thin = [pos for pos, n in needed.items() if len(by_pos.get(pos, [])) < n]
        if thin:
            thin_set = set(thin)
            for pid, player in players.items():
                if not is_rosterable(player, sport):
                    continue
                positions = lineup.player_positions(player) & thin_set
                if not positions:
                    continue
                p_stats = stats.get(str(pid), {})
                sig = sigs.get(str(pid))
                proj = (projs or {}).get(str(pid))
                entry = (calculate_dvs(player, p_stats, college_data, sig, proj),
                         calculate_rvs(player, p_stats, sig, proj),
                         expected_points(player, p_stats, sig, proj))
                for pos in positions:
                    by_pos.setdefault(pos, []).append(entry)

    levels = {}
    for pos, values in by_pos.items():
        starters = max(1, int(round(req.get(pos, 1) * max(1, num_teams))))
        idx = min(len(values) - 1, starters - 1)
        levels[pos] = {
            "dvs": sorted(values, key=lambda v: -v[0])[idx][0],
            "rvs": sorted(values, key=lambda v: -v[1])[idx][1],
            "pts": sorted(values, key=lambda v: -v[2])[idx][2],
        }
    return levels


def replacement_points(levels):
    """Baseline in real league points — the bar a lineup decision is measured
    against."""
    return {pos: lv["pts"] for pos, lv in levels.items()}


def roster_needs(my_players, roster_positions, levels):
    """Needs come from the lineup and from real positional depth, not from a
    headcount of primary positions."""
    return lineup.positional_needs(
        my_players, roster_positions, replacement_points(levels), _start_value,
        starter_requirements(roster_positions))


def _start_value(player):
    """What a player is worth to *this week's* lineup.

    Real projected points, not RVS: startability is a points question, and the
    position normalisation baked into RVS distorts every cross-position slot.
    """
    return player.get("pts", 0) or 0


def waiver_score(dvs, pts, sig, need_severity, replacement_pts=0):
    """Waiver ranking is not dynasty ranking: usable value this season plus the
    news that just changed it. A rank-999 backup who inherits a starting job
    outranks a well-known name whose situation did not move.

    Anchored on projected points *above the position's replacement level*, since
    that is the only number that says whether a pickup can do anything for a
    lineup. The market terms are modifiers on that value, not a substitute for
    it: a flat +160 for trending used to exceed the entire base score of a
    fringe player, so the board filled with whoever was hot regardless of
    whether they projected for anything at all.
    """
    opportunity = sig["opportunity"]["score"]
    intensity = sig["trend"].get("intensity") or 0
    net = sig["trend"].get("net") or 0

    surplus = pts - (replacement_pts or 0)
    base = max(0.0, surplus) + 0.35 * pts + 0.25 * dvs

    score = base * (1 + 0.25 * opportunity) * (1 + 0.35 * intensity)
    score += 40 * intensity    # live market heat: sharp, fires for a handful
    score += 15 * opportunity  # depth chart move: noisier, rests on the snapshot
    score += 20 * need_severity
    if net < 0:
        score *= 0.85  # the market is moving away from him
    return round(score, 1)


def faab_recommendation(sig, need_severity, budget_left, is_upgrade):
    """Bid as a share of remaining budget. Both checked leagues run waiver_type 2."""
    if not budget_left or budget_left <= 0:
        return None
    opportunity = sig["opportunity"]["score"]
    intensity = sig["trend"].get("intensity") or 0

    if opportunity >= 3 or intensity >= 0.65:
        lo, hi, tier = 0.18, 0.35, "aggressiv"
    elif opportunity == 2 or intensity >= 0.30:
        lo, hi, tier = 0.07, 0.16, "solide"
    elif is_upgrade:
        lo, hi, tier = 0.03, 0.07, "moderat"
    else:
        lo, hi, tier = 0.01, 0.03, "spekulativ"

    boost = 1 + 0.12 * need_severity
    return {
        "min": max(1, int(round(budget_left * lo * boost))),
        "max": max(1, int(round(budget_left * hi * boost))),
        "tier": tier,
        "budget_left": budget_left,
    }


def drop_protection(player, dvs, pts, sig, levels):
    """Reasons never to recommend dropping someone.

    Guards the case that made the old engine suggest dropping Ricky Pearsall -
    a 25 year old first round WR - because a temporary IR stint and a preseason
    depth chart entry had wiped out 90% of his score.

    Levels are keyed by fantasy position (DB, DL, LB), so they have to be looked
    up that way. Keying by the real-life position meant every cornerback and
    edge rusher missed the table, read a threshold of zero, and came back
    "liefert noch Startwert" - which protected the entire IDP half of a roster
    from ever being offered as a drop.
    """
    years_exp = player.get("years_exp") or 0
    rank = player.get("search_rank") or 999999
    level = levels.get(canonical_pos(player), {})
    threshold = level.get("dvs", 0)

    if years_exp <= 2 and rank <= 600:
        return "Junges Asset mit Draft-Kapital — halten"
    # An ageing star has little dynasty value left but can still be a weekly
    # starter. Dropping him for a younger bench piece loses points right now.
    if pts >= (level.get("pts") or 0):
        return "Liefert aktuell noch Startwert — halten"
    if sig["injury"]["term"] == "long" and dvs >= threshold * 0.6:
        return "Nur verletzt, nicht wertlos — stashen statt droppen"
    if sig["opportunity"]["score"] >= 2:
        return "Rückt in der Depth Chart auf — halten"
    return None


# One position should not soak up the whole waiver budget, not even through
# balance-neutral upgrades.
def _lineup_value(players, roster_positions):
    return lineup.lineup_value(
        lineup.build_lineup(players, roster_positions, _start_value), _start_value)


def plan_moves(my_players, available, roster_positions, levels, needs=None,
               max_moves=5, target_pool=40):
    """Plans a sequence of add/drop moves by simulating the actual lineup.

    A move is only worth making if the resulting starting lineup is better than
    the current one. That single rule replaces the old per-position counters and
    caps: once a position is covered, another player there adds nothing, so the
    engine stops on its own instead of recommending three DBs for one DB slot
    and paying for them by gutting LB.

    Cost is kept down by scoring each add and each drop against the lineup once
    per round (O(n+m) matchings) and only verifying the best pairing exactly.
    """
    roster = list(my_players)
    used_targets, used_drops = set(), set()
    moves = []
    # Positions with an uncovered starting slot: never pay for an add by
    # thinning one of these, unless the add lands at the same position.
    critical = {n["pos"] for n in (needs or []) if n["severity"] >= 3}

    # Best few per position is plenty; scanning every waiver player would cost
    # a matching each without changing the answer.
    pool = []
    per_pos = {}
    for t in available:
        key = t["pos"]
        if per_pos.get(key, 0) >= 6:
            continue
        per_pos[key] = per_pos.get(key, 0) + 1
        pool.append(t)
        if len(pool) >= target_pool:
            break

    while len(moves) < max_moves:
        base = _lineup_value(roster, roster_positions)

        gains = []
        for t in pool:
            if t["id"] in used_targets:
                continue
            gain = _lineup_value(roster + [t], roster_positions) - base
            if gain > 0:
                gains.append((gain, t))
        if not gains:
            break
        gains.sort(key=lambda g: -g[0])

        losses = []
        for d in roster:
            if d["id"] in used_drops or d.get("protected"):
                continue
            remaining = [p for p in roster if p["id"] != d["id"]]
            losses.append((base - _lineup_value(remaining, roster_positions), d))
        if not losses:
            break
        losses.sort(key=lambda l: l[0])

        # Ignore rounding-level improvements; a waiver claim costs FAAB and a
        # roster spot. The lineup is measured in projected season points now, so
        # the bar is one too: roughly a point and a half per week.
        min_gain = max(10.0, 0.01 * base)

        best = None
        for gain, target in gains[:8]:
            for loss, drop in losses[:8]:
                if gain - loss <= min_gain:
                    continue
                if drop["pos"] in critical and drop["pos"] != target["pos"]:
                    continue
                candidate = [p for p in roster if p["id"] != drop["id"]] + [target]
                delta = _lineup_value(candidate, roster_positions) - base
                if delta > min_gain and (best is None or delta > best[0]):
                    best = (delta, target, drop)
        if not best:
            break

        delta, target, drop = best
        roster = [p for p in roster if p["id"] != drop["id"]] + [target]
        used_targets.add(target["id"])
        used_drops.add(drop["id"])

        why = [f"Verbessert deine Startaufstellung um {round(delta, 1)} Punkte "
               f"({target['pos']} rein, {drop['pos']} raus)."]
        why.extend(target.get("signals", [])[:2])

        after = lineup.build_lineup(roster, roster_positions, _start_value)
        moves.append({
            "kind": "lineup",
            "drop": drop,
            "add": target,
            "reason": " ".join(why),
            "faab": target.get("faab"),
            "balance": {
                "pos_in": target["pos"],
                "pos_out": drop["pos"],
                "lineup_gain": round(delta, 1),
                "starts": target["id"] in {p["id"] for _, p in after if p is not None},
                "empty_slots": [s for s, p in after if p is None],
            },
        })

    if len(moves) < max_moves:
        moves.extend(_depth_moves(roster, pool, roster_positions, used_targets,
                                  used_drops, max_moves - len(moves), levels))
    return moves


# A deep roster in a deep league will not find a free agent who beats a starter,
# and the honest answer to "which claim improves my lineup" is then "none". That
# is correct and useless: the actual question at that point is which end-of-bench
# body is worth less than what is sitting on waivers.
DEPTH_MOVE_MARGIN = 1.25


def _depth_moves(roster, pool, roster_positions, used_targets, used_drops, limit,
                 levels=None):
    """Bench upgrades: swap the least valuable droppable player for a clearly
    better asset, when no move improves the starting lineup at all.

    Two constraints keep this from turning into vandalism:

    - a player who still projects above his position's replacement level is off
      limits, however flat the dynasty age curve has made him. Without this the
      engine offered Alvin Kamara for a rookie edge rusher, purely on DVS.
    - a player added by an earlier move in the same sequence cannot be the drop
      in a later one, which it happily did - adding a man and dropping him two
      moves later.
    """
    moves = []
    # Frozen once, deliberately. Recomputing it per move let each accepted add
    # push a real starter onto the bench and make him droppable on the next
    # pass: two tight ends in, and the engine offered up a starting running back.
    protected_starters = {p["id"] for _, p in
                          lineup.build_lineup(roster, roster_positions, _start_value)
                          if p is not None}

    while len(moves) < limit:
        droppable = []
        for p in roster:
            if p["id"] in protected_starters or p["id"] in used_drops:
                continue
            if p["id"] in used_targets or p.get("protected"):
                continue
            replacement = (levels or {}).get(p["pos"], {}).get("pts", 0)
            if (p.get("pts") or 0) >= replacement:
                continue
            droppable.append(p)
        if not droppable:
            break
        drop = min(droppable, key=lambda p: p["dvs"])

        # A stash still has to be a player. Sleeper projects nothing at all for
        # someone who is on no depth chart, and no dynasty upside justifies
        # spending a roster spot on a zero.
        candidates = [t for t in pool
                      if t["id"] not in used_targets
                      and (t.get("pts") or 0) > 0
                      and t["dvs"] > drop["dvs"] * DEPTH_MOVE_MARGIN]
        if not candidates:
            break
        target = max(candidates, key=lambda t: t["dvs"])

        roster = [p for p in roster if p["id"] != drop["id"]] + [target]
        used_targets.add(target["id"])
        used_drops.add(drop["id"])

        why = [f"Kein Zugang verbessert aktuell deine Startelf. Kadertiefe: "
               f"{target['name']} hat den deutlich höheren Dynasty-Wert "
               f"({target['dvs']} statt {drop['dvs']})."]
        why.extend(target.get("signals", [])[:2])

        moves.append({
            "kind": "depth",
            "drop": drop,
            "add": target,
            "reason": " ".join(why),
            "faab": target.get("faab"),
            "balance": {
                "pos_in": target["pos"],
                "pos_out": drop["pos"],
                "lineup_gain": 0.0,
                "dvs_gain": round(target["dvs"] - drop["dvs"], 1),
                "starts": False,
                "empty_slots": [],
            },
        })
    return moves


def _player_entry(pid, player, stats, college_data, sig, levels, extra=None, projs=None):
    """One enriched player record, keyed by the positions the league's slots use."""
    p_stats = stats.get(str(pid), {})
    proj = (projs or {}).get(str(pid))
    rvs = calculate_rvs(player, p_stats, sig, proj)
    dvs = calculate_dvs(player, p_stats, college_data, sig, proj)
    pts = expected_points(player, p_stats, sig, proj)
    entry = {
        "id": str(pid),
        "name": f"{player.get('first_name')} {player.get('last_name')}",
        "pos": canonical_pos(player),
        "elig": lineup.player_positions(player),
        "real_pos": player.get("position"),
        "team": player.get("team") or "FA",
        "age": player.get("age", "N/A"),
        "exp": player.get("years_exp", 0),
        "status": player.get("status", "Active"),
        "rvs": rvs,
        "dvs": dvs,
        "pts": pts,
        "proj": proj,
        "signals": sig["labels"] if sig else [],
        "injury": sig["injury"] if sig else None,
        # Carried for every player, not just waiver targets: the same badges
        # that explain an add explain a drop, and a roster view without them
        # says nothing about why a player is where he is.
        "trend": sig["trend"] if sig else None,
        "opportunity": sig["opportunity"] if sig else None,
        "news_days": sig["recency"]["news_days"] if sig else None,
    }
    if extra:
        entry.update(extra)
    return entry


def _model_inputs(sport, scoring_settings):
    """Everything the scoring model reads, loaded once per request.

    All three analysis endpoints need exactly this bundle; keeping it in one
    place is what stops the projection layer from being wired into two of them
    and forgotten in the third.
    """
    players = load_players(sport)
    college_data = load_college_stats()
    stats = load_multi_year_stats(recent_seasons(sport), scoring_settings, players, sport)
    signals_by_pid = signals.build_signals(players, sport)
    projs = projected_points(sport, scoring_settings, players)
    return players, college_data, stats, signals_by_pid, projs


def analyze_waivers_api(username, league_id, sport="nfl"):
    user = sleeper_api.get_user(username)
    if not user:
        return {"error": "User not found"}
    user_id = user["user_id"]

    league_info = sleeper_api.get_league(league_id) or {}
    roster_positions = league_info.get("roster_positions") or []
    scoring_settings = league_info.get("scoring_settings") or {}
    league_settings = league_info.get("settings") or {}
    num_teams = league_info.get("total_rosters") or 12
    waiver_budget = (league_settings.get("waiver_budget")
                     if league_settings.get("waiver_type") == 2 else None)

    rosters = sleeper_api.get_rosters(league_id)
    if not rosters:
        return {"error": "Keine Roster für diese Liga gefunden."}
    my_roster = next((r for r in rosters if r.get("owner_id") == user_id), None)
    if not my_roster:
        return {"error": "Roster not found"}
    my_player_ids = my_roster.get("players") or []
    if not my_player_ids:
        return {"error": "Dein Roster in dieser Liga ist leer."}

    budget_left = None
    if waiver_budget:
        budget_left = waiver_budget - (my_roster.get("settings") or {}).get("waiver_budget_used", 0)

    players, college_data, stats, signals_by_pid, projs = _model_inputs(sport, scoring_settings)

    rostered_ids = {str(pid) for r in rosters for pid in (r.get("players") or [])}

    req = starter_requirements(roster_positions)
    levels = replacement_levels(rosters, players, stats, college_data,
                                signals_by_pid, req, num_teams, sport, projs=projs)

    # ---- My roster -------------------------------------------------------
    my_players_stats = []
    for pid in my_player_ids:
        p = players.get(str(pid))
        if not p:
            continue
        sig = signals_by_pid.get(str(pid))
        entry = _player_entry(pid, p, stats, college_data, sig, levels, projs=projs)
        entry["protected"] = drop_protection(p, entry["dvs"], entry["pts"], sig, levels) if sig else None
        entry["is_liability"] = (entry["pts"] < levels.get(entry["pos"], {}).get("pts", 0)
                                 and not entry["protected"])
        my_players_stats.append(entry)

    needs = roster_needs(my_players_stats, roster_positions, levels)
    need_by_pos = {n["pos"]: n for n in needs}

    my_players_stats.sort(key=lambda p: (p["protected"] is not None, p["pts"]))

    # ---- Available players ----------------------------------------------
    # Anyone whose eligibility touches a slot this league actually starts.
    league_positions = set(lineup.positions_in_use(roster_positions))

    available = []
    for pid, p in players.items():
        if pid in rostered_ids or not is_rosterable(p, sport):
            continue
        if not (lineup.player_positions(p) & league_positions):
            continue

        sig = signals_by_pid.get(pid)
        intensity = sig["trend"].get("intensity") or 0

        # Not on a pro roster: a camp body unless the market says otherwise. The
        # old filter kept teamless rookies and dropped exactly the veterans who
        # had just been released and were being added everywhere.
        if p.get("team") in (None, "FA") and intensity < 0.05:
            continue
        if sig["injury"]["severity"] >= 4 and intensity < 0.05:
            continue

        entry = _player_entry(pid, p, stats, college_data, sig, levels, projs=projs)
        pos = entry["pos"]
        severity = need_by_pos.get(pos, {}).get("severity", 0)
        replacement_pts = levels.get(pos, {}).get("pts", 0)
        entry["is_upgrade"] = entry["pts"] >= replacement_pts
        entry["score"] = waiver_score(entry["dvs"], entry["pts"], sig, severity,
                                      replacement_pts)
        entry["faab"] = faab_recommendation(sig, severity, budget_left, entry["is_upgrade"])
        available.append(entry)

    available.sort(key=lambda p: -p["score"])

    # Keep the board representative: the best of every position the league
    # starts, so an IDP-heavy score distribution cannot crowd out every RB.
    per_pos_cap = max(6, 40 // max(1, len(league_positions)))
    board, seen = [], {}
    for p in available:
        if seen.get(p["pos"], 0) >= per_pos_cap:
            continue
        seen[p["pos"]] = seen.get(p["pos"], 0) + 1
        board.append(p)

    recommendations = plan_moves(my_players_stats, available, roster_positions, levels, needs)

    state = sleeper_api.get_state(sport) or {}
    activity = signals.league_activity(league_id, state.get("week") or 1, players)

    lineup_now = lineup.lineup_report(my_players_stats, roster_positions, _start_value)

    return {
        "drop_candidates": _strip(my_players_stats[:15]),
        "waiver_targets": _strip(sorted(board, key=lambda p: -p["score"])),
        "smart_recommendations": [
            {**rec, "drop": _strip_one(rec["drop"]), "add": _strip_one(rec["add"])}
            for rec in recommendations
        ],
        "roster_needs": needs,
        "lineup": {
            "slots": [{"slot": s["slot"], "player": _strip_one(s["player"])}
                      for s in lineup_now["slots"]],
            "bench": _strip(lineup_now["bench"][:12]),
            "total": lineup_now["total"],
            "empty": lineup_now["empty"],
        },
        "positions": sorted(league_positions),
        "faab": {"budget": waiver_budget, "left": budget_left,
                 "waiver_type": league_settings.get("waiver_type")},
        "league_activity": activity,
    }


def _strip_one(player):
    """`elig` is a set and not JSON serialisable; export it as a sorted list."""
    if player is None:
        return None
    out = dict(player)
    out["elig"] = sorted(out.get("elig") or [])
    return out


def current_lineup(my_roster, roster_positions, squad):
    """The lineup as it actually stands in Sleeper right now.

    `starters` is positional: it lines up index for index with the non-bench
    entries of `roster_positions`, and an unfilled slot is the string "0".
    Without this the optimizer could only ever show its own answer, never the
    thing the answer is supposed to be compared against.
    """
    slots = lineup.starting_slots(roster_positions)
    starters = (my_roster or {}).get("starters") or []
    by_id = {p["id"]: p for p in squad}

    out = []
    for i, slot in enumerate(slots):
        pid = str(starters[i]) if i < len(starters) else "0"
        out.append({"slot": slot, "player": by_id.get(pid)})
    return out


def lineup_changes(current, optimal):
    """Who should be starting who is not, and who should sit for them.

    Compared per player rather than per slot. Two players swapping between two
    identical DL slots changes nothing a manager needs to do, but slot-wise
    comparison reports it twice - once in each direction, with equal and
    opposite "gains" - and that noise buried the two or three moves that
    actually matter.

    The best available addition is paired against the weakest player it
    displaces, which is the form the instruction is acted on in: start Y
    instead of X. No per-pair gain is reported: the pairing crosses positions,
    so the difference between an incoming linebacker and an outgoing receiver
    is not a number that means anything. The gain lives on the report as a
    whole, where it reconciles exactly.
    """
    now_ids = {s["player"]["id"] for s in current if s.get("player")}
    best_ids = {s["player"]["id"] for s in optimal if s.get("player")}

    slot_of = {}
    for s in optimal:
        player = s.get("player")
        if player:
            slot_of[player["id"]] = s["slot"]

    sit = sorted((s["player"] for s in current
                  if s.get("player") and s["player"]["id"] not in best_ids),
                 key=_start_value)
    start = sorted((s["player"] for s in optimal
                    if s.get("player") and s["player"]["id"] not in now_ids),
                   key=_start_value, reverse=True)

    changes = []
    for i, player in enumerate(start):
        out = sit[i] if i < len(sit) else None
        changes.append({
            "slot": slot_of.get(player["id"]),
            "in": _strip_one(player),
            "out": _strip_one(out),
        })
    return changes


def _strip(players):
    return [_strip_one(p) for p in players]


def optimize_lineup_api(username, league_id, sport="nfl"):
    """Best legal starting lineup for this roster, plus what sits behind it."""
    user = sleeper_api.get_user(username)
    if not user:
        return {"error": "User not found"}
    user_id = user["user_id"]

    league_info = sleeper_api.get_league(league_id) or {}
    roster_positions = league_info.get("roster_positions") or []
    if not roster_positions:
        return {"error": "Liga nicht gefunden oder ohne Roster-Konfiguration."}
    scoring_settings = league_info.get("scoring_settings") or {}
    num_teams = league_info.get("total_rosters") or 12

    rosters = sleeper_api.get_rosters(league_id)
    if not rosters:
        return {"error": "Keine Roster für diese Liga gefunden."}
    my_roster = next((r for r in rosters if r.get("owner_id") == user_id), None)
    if not my_roster:
        return {"error": "Roster not found"}
    my_player_ids = my_roster.get("players") or []
    if not my_player_ids:
        return {"error": "Dein Roster in dieser Liga ist leer."}

    players, college_data, stats, signals_by_pid, projs = _model_inputs(sport, scoring_settings)

    req = starter_requirements(roster_positions)
    levels = replacement_levels(rosters, players, stats, college_data,
                                signals_by_pid, req, num_teams, sport, projs=projs)

    squad = []
    for pid in my_player_ids:
        p = players.get(str(pid))
        if not p:
            continue
        squad.append(_player_entry(pid, p, stats, college_data,
                                   signals_by_pid.get(str(pid)), levels, projs=projs))

    report = lineup.lineup_report(squad, roster_positions, _start_value)
    starters = {s["player"]["id"] for s in report["slots"] if s["player"]}

    slots = []
    for entry in report["slots"]:
        slot, player = entry["slot"], entry["player"]
        accepts = lineup.slot_accepts(slot)
        # Who else could take this slot if the starter is out?
        alternatives = sorted(
            (p for p in squad
             if p["elig"] & accepts and p["id"] not in starters),
            key=lambda p: -_start_value(p),
        )[:3]
        slots.append({
            "slot": slot,
            "accepts": sorted(accepts),
            "player": _strip_one(player),
            "alternatives": _strip(alternatives),
        })

    # A starter who is hurt is the thing you actually need to see here.
    warnings = []
    for entry in report["slots"]:
        player = entry["player"]
        if player and (player.get("injury") or {}).get("severity", 0) >= 1:
            warnings.append({
                "slot": entry["slot"],
                "player": player["name"],
                "injury": player["injury"],
            })

    current = current_lineup(my_roster, roster_positions, squad)
    changes = lineup_changes(current, report["slots"])
    current_total = round(
        sum(_start_value(s["player"]) for s in current if s["player"]), 1)

    return {
        "league": {"name": league_info.get("name"), "teams": num_teams},
        "slots": slots,
        "current": [{"slot": s["slot"], "player": _strip_one(s["player"])}
                    for s in current],
        "current_total": current_total,
        "gain": round(report["total"] - current_total, 1),
        "changes": changes,
        "bench": _strip(report["bench"]),
        "total": report["total"],
        "empty": report["empty"],
        "warnings": warnings,
        "positions": sorted(lineup.positions_in_use(roster_positions)),
    }


def update_sleeper_data_api(sport="nfl", college_batch=25):
    """Refreshes the local player/stats snapshot.

    Writes through `_write_data`, which lands in a writable directory and
    mirrors to Cloud Storage. The previous version wrote directly into the
    function's own package directory, which is read-only on Cloud Run, so this
    endpoint could only ever return a 500 in production.
    """
    updated = []
    errors = []

    players = sleeper_api.get_all_players(sport)
    if players:
        _write_data(players_file(sport), players)
        updated.append(f"{len(players)} Spieler")
    else:
        errors.append("Spielerdaten konnten nicht geladen werden")

    state = sleeper_api.get_state(sport) or {}
    try:
        current_year = int(state.get("league_season") or state.get("season"))
    except (TypeError, ValueError):
        current_year = 2026

    for year in [current_year - 2, current_year - 1, current_year]:
        stats = sleeper_api.get_stats(sport, year)
        if stats:
            _write_data(stats_file(sport, year), stats)
            updated.append(f"Stats {year}")
        else:
            errors.append(f"Stats {year}")

    # Projections carry the entire forward-looking half of the model, and they
    # move as depth charts and injuries move — so they are refreshed on the same
    # daily cadence as the rest, not fetched once and left to rot.
    season_projections = projections.fetch_season_projections(sport, str(current_year))
    if season_projections:
        _write_data(projections_file(sport, str(current_year)), season_projections)
        updated.append(f"{len(season_projections)} Projections")
    else:
        errors.append("Projections")

    # College profiles are only relevant for the NFL rookie model, and each one
    # costs an ESPN round trip - so they are topped up in batches.
    fetched = 0
    if sport == "nfl" and players:
        college_data = load_college_stats() or {}
        pending = []
        for pid, p in players.items():
            if str(pid) in college_data:
                continue
            if p.get("years_exp") == 0 and p.get("status") == "Active":
                pos = p.get("position")
                rank = p.get("search_rank") or 99999
                if (pos in ['QB', 'RB', 'WR', 'TE'] and rank <= 800) or pos in IDP_POSITIONS:
                    pending.append((pid, p))

        for pid, p in pending[:college_batch]:
            name = f"{p.get('first_name')} {p.get('last_name')}"
            c_stats = fetch_espn_college_stats(name)
            # Remember misses too, so we stop retrying them every run.
            college_data[str(pid)] = c_stats or {"_not_found": True}
            fetched += 1

        if fetched:
            _write_data("college_stats.json", college_data)
            updated.append(f"{fetched} College-Profile")

    if errors and not updated:
        return {"status": "error", "message": "Update fehlgeschlagen: " + ", ".join(errors)}

    message = "Aktualisiert: " + ", ".join(updated)
    if errors:
        message += " — fehlgeschlagen: " + ", ".join(errors)
    return {"status": "success", "message": message, "storage": _bucket() is not None}


def get_user_drafts_api(username, sport="nfl", season="2026", seasons=None):
    user = sleeper_api.get_user(username)
    if not user:
        return {"error": "User not found"}
    user_id = user["user_id"]
    
    if season == "all":
        all_drafts = []
        seen_dids = set()
        for yr in (seasons or ["2026", "2025", "2024"]):
            res = sleeper_api.get_drafts_for_user(user_id, sport, yr) or []
            for d in res:
                if d.get("draft_id") not in seen_dids:
                    seen_dids.add(d.get("draft_id"))
                    all_drafts.append(d)
        drafts = all_drafts
    else:
        drafts = sleeper_api.get_drafts_for_user(user_id, sport, season) or []
        
    if not drafts: return []
    
    result = []
    for d in drafts:
        result.append({
            "draft_id": d["draft_id"],
            "name": d.get("metadata", {}).get("name", "Unnamed Draft"),
            "status": d.get("status"),
            "league_id": d.get("league_id")
        })
    return result

def analyze_draft_api(username, draft_id, sport="nfl"):
    user = sleeper_api.get_user(username)
    if not user:
        return {"error": "User not found"}
    user_id = user["user_id"]

    draft = sleeper_api.get_draft(draft_id)
    if not draft:
        return {"error": "Draft not found"}

    settings = draft.get("settings") or {}
    metadata = draft.get("metadata") or {}
    draft_order = draft.get("draft_order") or {}
    league_id = draft.get("league_id")

    user_slot = draft_order.get(user_id)
    # Sleeper player_type: 0 = everyone, 1 = rookies only, 2 = veterans only.
    # Only the rookie case was handled before, so veteran drafts offered rookies
    # and all-player drafts offered the entire league's rosters.
    player_type = settings.get("player_type") or 0
    is_rookie_draft = player_type == 1

    picks = sleeper_api.get_draft_picks(draft_id)
    picked_player_ids = set()
    last_pick = None
    if picks:
        last_pick = picks[-1]
        for p in picks:
            pid = p.get("player_id")
            if pid is not None:
                picked_player_ids.add(str(pid))

    roster_positions = []
    scoring_settings = {}
    is_idp = False
    my_roster = None
    rosters = []
    num_teams = settings.get("teams") or 12
    rostered_ids = set()

    if league_id:
        league_info = sleeper_api.get_league(league_id) or {}
        roster_positions = league_info.get("roster_positions") or []
        scoring_settings = league_info.get("scoring_settings") or {}
        num_teams = league_info.get("total_rosters") or num_teams
        is_idp = any(pos in roster_positions for pos in ['LB', 'DB', 'DL', 'IDP_FLEX'])

        rosters = sleeper_api.get_rosters(league_id) or []
        my_roster = next((r for r in rosters if r.get("owner_id") == user_id), None)
        # Players already on a roster in this league are not available, no matter
        # what the draft's own pick list says.
        for r in rosters:
            for pid in (r.get("players") or []):
                rostered_ids.add(str(pid))

    players, college_data, stats, signals_by_pid, projs = _model_inputs(sport, scoring_settings)

    req = starter_requirements(roster_positions)
    levels = replacement_levels(rosters, players, stats, college_data,
                                signals_by_pid, req, num_teams, sport, projs=projs)

    # During a startup draft Sleeper leaves the rosters empty until it finishes,
    # so the picks made so far are the only picture of the team. Combine both:
    # in a rookie draft the user has an existing roster *and* fresh picks.
    my_player_ids = list((my_roster or {}).get("players") or [])
    for p in (picks or []):
        if p.get("picked_by") == user_id and p.get("player_id"):
            pid = str(p["player_id"])
            if pid not in my_player_ids:
                my_player_ids.append(pid)

    needs = []
    my_squad = []
    if my_player_ids:
        for pid in my_player_ids:
            p = players.get(str(pid))
            if not p:
                continue
            my_squad.append(_player_entry(pid, p, stats, college_data,
                                          signals_by_pid.get(str(pid)), levels, projs=projs))
        needs = roster_needs(my_squad, roster_positions, levels)

    is_superflex = roster_positions.count('SUPER_FLEX') > 0
    # A mock draft, or a league that no longer exists, gives us no roster config.
    # Fall back to the sport's standard positions instead of an empty board.
    league_positions = set(lineup.positions_in_use(roster_positions))
    if not league_positions:
        league_positions = set(offensive_positions(sport))
        if sport == "nfl":
            league_positions |= {"DL", "LB", "DB"}

    available = []
    for pid, p in players.items():
        if pid in picked_player_ids or pid in rostered_ids:
            continue
        if not is_rosterable(p, sport):
            continue

        years_exp = p.get("years_exp") or 0
        if is_rookie_draft and years_exp > 0:
            continue
        if player_type == 2 and years_exp == 0:
            continue

        # Eligible for a slot this league actually starts (fantasy_positions,
        # so a cornerback matches a DB slot).
        if not (lineup.player_positions(p) & league_positions):
            continue

        p_stats = stats.get(str(pid), {})
        sig = signals_by_pid.get(str(pid))
        proj = projs.get(str(pid))
        rvs = calculate_rvs(p, p_stats, sig, proj)
        dvs = calculate_dvs(p, p_stats, college_data, sig, proj)
        pts = expected_points(p, p_stats, sig, proj)
        pos = canonical_pos(p)

        trade_value = dvs
        try:
            age = int(p.get("age") or 25)
        except (ValueError, TypeError):
            age = 25

        if is_superflex and pos == "QB":
            trade_value *= 1.5   # Superflex makes QBs the scarcest asset there is
        if pos == "WR" and age <= 23:
            trade_value *= 1.2
        if pos == "RB" and age >= 27:
            trade_value *= 0.7

        available.append({
            "id": pid,
            "name": f"{p.get('first_name')} {p.get('last_name')}",
            "pos": pos,
            "team": p.get("team") or "FA",
            "age": age,
            "status": p.get("status") or "Active",
            "rvs": rvs,
            "dvs": dvs,
            "pts": pts,
            "proj": proj,
            "trade_value": round(trade_value, 1),
            "is_rookie": years_exp == 0,
            "signals": sig["labels"] if sig else [],
            "injury": sig["injury"] if sig else None,
        })

    available.sort(key=lambda x: x["dvs"], reverse=True)

    top_recs = []
    if available:
        bpa = available[0]
        top_recs.append({
            "type": "bpa",
            "title": "Best Player Available",
            "player": bpa,
            "reason": f"{bpa['name']} ist der talentierteste Spieler am Board (DVS: {bpa['dvs']}). Reiner Value-Pick."
        })

        if needs:
            top_need_pos = needs[0]["pos"]
            fit = next((p for p in available if p["pos"] == top_need_pos), None)
            if fit:
                top_recs.append({
                    "type": "fit",
                    "title": "Best Team Fit",
                    "player": fit,
                    "reason": f"Passt auf deine größte Lücke ({needs[0]['reason']}) — {fit['name']} ist der beste verfügbare {top_need_pos}."
                })

        rec_ids = [r["player"]["id"] for r in top_recs]
        trade_sorted = sorted(available, key=lambda x: x["trade_value"], reverse=True)
        trade_asset = next((p for p in trade_sorted if p["id"] not in rec_ids), None)
        if trade_asset:
            top_recs.append({
                "type": "trade",
                "title": "Best Trade Asset",
                "player": trade_asset,
                "reason": f"Hohe Marktnachfrage: {trade_asset['name']} hat einen Trade Value von {trade_asset['trade_value']} und lässt sich später weiterreichen."
            })

    return {
        "metadata": {
            "name": metadata.get("name", "Unnamed Draft"),
            "status": draft.get("status"),
            "user_slot": user_slot,
            "is_rookie_draft": is_rookie_draft,
            "player_type": player_type,
            "teams": settings.get("teams"),
            "rounds": settings.get("rounds"),
        },
        "last_pick": last_pick,
        "roster_needs": needs,
        "top_recommendations": top_recs,
        "best_available": available[:30],
        "positions": sorted(league_positions),
    }
