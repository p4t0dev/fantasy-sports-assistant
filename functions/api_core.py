import os
import json
import time
import requests
import urllib.request
import urllib.parse
import sleeper_api
import signals

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
        if not stats:
            continue  # season not played yet, or file missing - do not burn a weight slot
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


def _role_multiplier(player, signal=None):
    """Depth chart role. A backup is worth less, but not 90% less — and a man
    who just moved up because the starter went down is not a backup any more."""
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


def calculate_rvs(player, p_stats, signal=None):
    """Redraft Value Score — what this player is worth for the current season.
    Short-term availability and depth chart role dominate here."""
    rvs = _weighted_production(p_stats)
    rvs *= POSITION_NORMALIZATION.get(player.get("position"), 1.0)
    rvs *= _role_multiplier(player, signal)

    team = player.get("team")
    tiers = load_team_strength()
    if team in tiers:
        rvs *= tiers[team]

    if signal:
        rvs *= signal["injury"]["redraft_mult"]

    return round(rvs, 1)


def calculate_dvs(player, p_stats, college_data, signal=None):
    """Dynasty Value Score — long-term asset value.

    Built from independent components so that the additive market/prospect value
    is never scaled by a short-term setback. A temporary IR stint or a preseason
    depth chart entry must not erase a young player's dynasty value.
    """
    pos = player.get("position")
    age = player.get("age") or 25

    production = _weighted_production(p_stats) * POSITION_NORMALIZATION.get(pos, 1.0)
    # Long-term value cares about role, but far less than the current season does.
    production *= 0.5 + 0.5 * _role_multiplier(player, signal)

    dvs = production + _market_component(player) + _prospect_component(player, college_data)
    dvs *= _age_multiplier(pos, age)

    if signal:
        # Long-term designations bite; a weekly "Questionable" barely registers.
        dvs *= signal["injury"]["dynasty_mult"]

    return round(dvs, 1)


DIRECT_SLOTS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'CB', 'S', 'DE', 'DT',
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

    The old code counted only literal position slots, so QB/RB/RB/WR/WR/TE plus
    FLEX/FLEX/SUPER_FLEX read as 6 starters instead of 9, and IDP_FLEX heavy
    leagues were off by a dozen slots.
    """
    req = {}
    for slot in roster_positions or []:
        if slot in DIRECT_SLOTS:
            req[slot] = req.get(slot, 0) + 1.0
        elif slot in FLEX_WEIGHTS:
            for pos, weight in FLEX_WEIGHTS[slot].items():
                req[pos] = req.get(pos, 0) + weight
    return req


def replacement_levels(rosters, players, stats, college_data, sigs, req, num_teams):
    """League-relative baseline: the value of the last player at a position who
    would still be starting somewhere in this league. Replaces the hardcoded
    thresholds (dvs < 30 / dvs < 80) that never matched the actual scale."""
    by_pos = {}
    for roster in rosters or []:
        for pid in (roster.get("players") or []):
            player = players.get(str(pid))
            if not player:
                continue
            pos = player.get("position")
            if not pos:
                continue
            p_stats = stats.get(str(pid), {})
            sig = sigs.get(str(pid))
            by_pos.setdefault(pos, []).append((
                calculate_dvs(player, p_stats, college_data, sig),
                calculate_rvs(player, p_stats, sig),
            ))

    levels = {}
    for pos, values in by_pos.items():
        values.sort(key=lambda v: -v[0])
        starters = max(1, int(round(req.get(pos, 1) * max(1, num_teams))))
        idx = min(len(values) - 1, starters - 1)
        levels[pos] = {"dvs": values[idx][0], "rvs": values[idx][1]}
    return levels


def _slots_word(n, dative=False):
    if n == 1:
        return "Startplatz"
    return "Startplätzen" if dative else "Startplätze"


def is_startable(player, levels):
    return player["dvs"] >= levels.get(player["pos"], {}).get("dvs", 0)


def startable_counts(my_players, levels):
    counts = {}
    for p in my_players:
        if is_startable(p, levels):
            counts[p["pos"]] = counts.get(p["pos"], 0) + 1
    return counts


def roster_needs(my_players, req, levels):
    """Counts startable depth (players above replacement level), not raw bodies.

    The old version compared the whole roster against starter slots, so a normal
    25-man roster could never register a need.
    """
    return needs_from_counts(startable_counts(my_players, levels), req)


def needs_from_counts(startable, req):
    needs = []
    for pos, demand in req.items():
        if demand < 0.5 or pos in ("K", "DEF"):
            continue
        slots = int(round(demand))
        have = startable.get(pos, 0)
        if have < slots:
            needs.append({"pos": pos, "severity": 3,
                          "reason": f"Startplatz ungedeckt: nur {have} startbare {pos} bei {slots} {_slots_word(slots, dative=True)}."})
        elif have == slots:
            needs.append({"pos": pos, "severity": 2,
                          "reason": f"Keine Absicherung: genau {have} startbare {pos} für {slots} {_slots_word(slots)}."})
        elif have == slots + 1:
            needs.append({"pos": pos, "severity": 1,
                          "reason": f"Dünne Bank: nur 1 startbarer Backup auf {pos}."})
    needs.sort(key=lambda n: -n["severity"])
    return needs


def waiver_score(dvs, rvs, sig, need_severity):
    """Waiver ranking is not dynasty ranking: usable value this season plus the
    news that just changed it. A rank-999 backup who inherits a starting job
    outranks a well-known name whose situation did not move."""
    base = 0.6 * rvs + 0.4 * dvs
    opportunity = sig["opportunity"]["score"]
    intensity = sig["trend"].get("intensity") or 0
    net = sig["trend"].get("net") or 0

    score = base * (1 + 0.20 * opportunity) * (1 + 0.40 * intensity)
    score += 160 * intensity   # live market heat: sharp, fires for a handful of players
    score += 20 * opportunity  # depth chart move: noisier, rests on the snapshot
    score += 25 * need_severity
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


def drop_protection(player, dvs, rvs, sig, levels):
    """Reasons never to recommend dropping someone.

    Guards the case that made the old engine suggest dropping Ricky Pearsall -
    a 25 year old first round WR - because a temporary IR stint and a preseason
    depth chart entry had wiped out 90% of his score.
    """
    years_exp = player.get("years_exp") or 0
    rank = player.get("search_rank") or 999999
    threshold = levels.get(player.get("position"), {}).get("dvs", 0)

    if years_exp <= 2 and rank <= 600:
        return "Junges Asset mit Draft-Kapital — halten"
    # An ageing star has little dynasty value left but can still be a weekly
    # starter. Dropping him for a younger bench piece loses points right now.
    if rvs >= (levels.get(player.get("position"), {}).get("rvs") or 0):
        return "Liefert aktuell noch Startwert — halten"
    if sig["injury"]["term"] == "long" and dvs >= threshold * 0.6:
        return "Nur verletzt, nicht wertlos — stashen statt droppen"
    if sig["opportunity"]["score"] >= 2:
        return "Rückt in der Depth Chart auf — halten"
    return None


# One position should not soak up the whole waiver budget, not even through
# balance-neutral upgrades.
MAX_ADDS_PER_POS = 2


def plan_moves(my_players, available, req, levels, max_moves=5):
    """Plans a *sequence* of add/drop moves, not a list of independent ideas.

    Every accepted move updates the simulated roster before the next one is
    chosen. Without that the engine served one DB need three times over and paid
    for it by dropping three LBs, ending with a surplus at one position and empty
    starting slots at another.

    Two further rules follow from the same idea:
      - Targets are chosen by *current* need severity, so a critical RB/QB gap
        outranks a well-scored DB whose need is already covered.
      - A drop is refused if it would leave that position below its starter slots.
    """
    def vor(player):
        # Value over replacement: the only way to compare a DB with a WR.
        return round(player["dvs"] - levels.get(player["pos"], {}).get("dvs", 0), 1)

    counts = startable_counts(my_players, levels)
    droppable = sorted((p for p in my_players if not p["protected"]), key=vor)
    by_value = sorted(available, key=lambda t: -vor(t))

    used_targets, used_drops = set(), set()
    adds_per_pos = {}
    moves = []

    while len(moves) < max_moves:
        needs = needs_from_counts(counts, req)

        target, need = None, None
        for candidate_need in needs:
            # Severity 1 means "one startable backup" - that is depth, not a hole.
            # Spending a roster move on it is how DB went from 2 to 5 while RB and
            # QB sat at zero.
            if candidate_need["severity"] < 2:
                continue
            if adds_per_pos.get(candidate_need["pos"], 0) >= MAX_ADDS_PER_POS:
                continue
            for t in by_value:
                # Deliberately no "must beat league replacement" test here: in a
                # deep league nothing on waivers ever does, and the real question
                # is whether he beats the player we would drop - which _pick_drop
                # enforces.
                if t["id"] in used_targets:
                    continue
                if t["pos"] == candidate_need["pos"]:
                    target, need = t, candidate_need
                    break
            if target:
                break

        # No open need left that we can actually fill: offer a same-position
        # upgrade instead. Swapping like for like keeps the balance intact -
        # but only if the drop really is the player we compared against.
        forced_drop = None
        if not target:
            for t in by_value:
                if t["id"] in used_targets:
                    continue
                if adds_per_pos.get(t["pos"], 0) >= MAX_ADDS_PER_POS:
                    continue
                weakest = next((d for d in droppable
                                if d["pos"] == t["pos"] and d["id"] not in used_drops), None)
                if weakest and vor(t) > vor(weakest) + 5:
                    target, need, forced_drop = t, None, weakest
                    break

        if not target:
            break

        # A same-position upgrade is neutral by construction: +1 and -1 at the
        # same position. Any other drop would turn it into a positional swap.
        if forced_drop is not None:
            drop, drop_was_startable = forced_drop, is_startable(forced_drop, levels)
        else:
            drop, drop_was_startable = _pick_drop(
                droppable, used_drops, target, counts, req, levels, vor, needs)

        if not drop:
            break

        # Only a genuinely startable add closes a gap; a stopgap leaves the need
        # open. adds_per_pos still counts it, so one position cannot loop forever.
        if is_startable(target, levels):
            counts[target["pos"]] = counts.get(target["pos"], 0) + 1
        adds_per_pos[target["pos"]] = adds_per_pos.get(target["pos"], 0) + 1
        if drop_was_startable:
            counts[drop["pos"]] = counts.get(drop["pos"], 0) - 1

        why = []
        if need:
            why.append(need["reason"])
        else:
            why.append(f"Upgrade auf {target['pos']}: {vor(target)} über Replacement "
                       f"gegen {vor(drop)} bei {drop['name']}.")
        why.extend(target["signals"][:2])

        moves.append({
            "drop": drop,
            "add": target,
            "reason": " ".join(why),
            "faab": target["faab"],
            "balance": {
                "pos_in": target["pos"],
                "pos_out": drop["pos"] if drop_was_startable else None,
                # A stopgap below replacement level does not close the gap; saying
                # so beats reporting a startable count that did not move.
                "add_startable": is_startable(target, levels),
                "after": {p: c for p, c in sorted(counts.items()) if c},
            },
        })
        used_targets.add(target["id"])
        used_drops.add(drop["id"])

    return moves


def _pick_drop(droppable, used_drops, target, counts, req, levels, vor, needs):
    """The cheapest player we can spare without weakening a position we need.

    Tried in two passes so the roster keeps its shape: first players whose
    position can genuinely spare a body, only then anyone else.
    """
    strained = {n["pos"] for n in needs if n["severity"] >= 2}

    def eligible(d, allow_strained=False):
        if d["id"] in used_drops or d["id"] == target["id"]:
            return None
        if vor(d) >= vor(target):
            return None
        was_startable = is_startable(d, levels)
        # Never rob a starter from a position that is itself short: that is how
        # "drop 3 LBs to add 3 DBs" happened. A bench body there is fair game
        # once nothing else is left, since he fills no starting slot anyway.
        if d["pos"] in strained and d["pos"] != target["pos"]:
            if not allow_strained or was_startable:
                return None
        if was_startable:
            slots = int(round(req.get(d["pos"], 0)))
            if counts.get(d["pos"], 0) - 1 < slots:
                return None  # would open a starting slot we cannot fill
        return was_startable

    def has_surplus(pos):
        return counts.get(pos, 0) > int(round(req.get(pos, 0)))

    # Pass 1: same position as the add (shape neutral), or a position with depth.
    for d in droppable:
        was_startable = eligible(d)
        if was_startable is None:
            continue
        if d["pos"] == target["pos"] or has_surplus(d["pos"]):
            return d, was_startable

    # Pass 2: anything left that is not strained.
    for d in droppable:
        was_startable = eligible(d)
        if was_startable is not None:
            return d, was_startable

    # Pass 3: last resort - a bench body at a short position. Costs no slot.
    for d in droppable:
        was_startable = eligible(d, allow_strained=True)
        if was_startable is not None:
            return d, was_startable
    return None, False


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
    waiver_budget = league_settings.get("waiver_budget") if league_settings.get("waiver_type") == 2 else None

    is_idp = any(pos in roster_positions for pos in ['LB', 'DB', 'DL', 'IDP_FLEX'])

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

    players = load_players(sport)
    college_data = load_college_stats()
    stats = load_multi_year_stats(recent_seasons(sport), scoring_settings, players, sport)
    signals_by_pid = signals.build_signals(players, sport)

    rostered_ids = set()
    for r in rosters:
        for pid in (r.get("players") or []):
            rostered_ids.add(str(pid))

    req = starter_requirements(roster_positions)
    levels = replacement_levels(rosters, players, stats, college_data, signals_by_pid, req, num_teams)

    # ---- My roster -------------------------------------------------------
    my_players_stats = []
    for pid in my_player_ids:
        p = players.get(str(pid), {})
        p_stats = stats.get(str(pid), {})
        sig = signals_by_pid.get(str(pid))
        rvs = calculate_rvs(p, p_stats, sig)
        dvs = calculate_dvs(p, p_stats, college_data, sig)
        pos = p.get("position", "UNK")
        protection = drop_protection(p, dvs, rvs, sig, levels) if sig else None
        threshold = levels.get(pos, {}).get("dvs", 0)

        my_players_stats.append({
            "id": str(pid),
            "name": f"{p.get('first_name')} {p.get('last_name')}",
            "pos": pos,
            "team": p.get("team") or "FA",
            "age": p.get("age", 0),
            "exp": p.get("years_exp", 0),
            "status": p.get("status", "Active"),
            "rvs": rvs,
            "dvs": dvs,
            "signals": sig["labels"] if sig else [],
            "injury": sig["injury"] if sig else None,
            "protected": protection,
            "is_liability": dvs < threshold and not protection,
        })

    needs = roster_needs(my_players_stats, req, levels)
    need_by_pos = {n["pos"]: n for n in needs}

    # Droppable first: protected players sort to the back regardless of score.
    my_players_stats.sort(key=lambda p: (p["protected"] is not None, p["dvs"]))

    # ---- Available players ----------------------------------------------
    valid_positions = offensive_positions(sport)
    if is_idp:
        valid_positions.extend(IDP_POSITIONS)

    available = []
    for pid, p in players.items():
        if pid in rostered_ids:
            continue
        pos = p.get("position")
        if pos not in valid_positions:
            continue

        if not is_rosterable(p, sport):
            continue

        sig = signals_by_pid.get(pid)
        intensity = sig["trend"].get("intensity") or 0

        # Not on an NFL roster: a camp body unless the market says otherwise.
        # The old filter kept teamless rookies and threw out exactly the veterans
        # who had just been released and were being added everywhere.
        if p.get("team") in (None, "FA") and intensity < 0.05:
            continue
        if sig["injury"]["severity"] >= 4 and intensity < 0.05:
            continue

        p_stats = stats.get(str(pid), {})
        rvs = calculate_rvs(p, p_stats, sig)
        dvs = calculate_dvs(p, p_stats, college_data, sig)
        threshold = levels.get(pos, {}).get("dvs", 0)
        is_upgrade = dvs >= threshold
        severity = need_by_pos.get(pos, {}).get("severity", 0)
        score = waiver_score(dvs, rvs, sig, severity)

        available.append({
            "id": pid,
            "name": f"{p.get('first_name')} {p.get('last_name')}",
            "pos": pos,
            "team": p.get("team") or "FA",
            "age": p.get("age", "N/A"),
            "status": p.get("status", "Active"),
            "rvs": rvs,
            "dvs": dvs,
            "score": score,
            "signals": sig["labels"],
            "injury": sig["injury"],
            "opportunity": sig["opportunity"],
            "trend": sig["trend"],
            "is_upgrade": is_upgrade,
            "faab": faab_recommendation(sig, severity, budget_left, is_upgrade),
        })

    available.sort(key=lambda p: -p["score"])

    # ---- Recommendations -------------------------------------------------
    recommendations = plan_moves(my_players_stats, available, req, levels)

    state = sleeper_api.get_state(sport) or {}
    activity = signals.league_activity(league_id, state.get("week") or 1, players)

    return {
        "drop_candidates": my_players_stats[:15],
        "waiver_targets": available[:25],
        "smart_recommendations": recommendations,
        "roster_needs": needs,
        "faab": {"budget": waiver_budget, "left": budget_left,
                 "waiver_type": league_settings.get("waiver_type")},
        "league_activity": activity,
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

    players = load_players(sport)
    college_data = load_college_stats()
    stats = load_multi_year_stats(recent_seasons(sport), scoring_settings, players, sport)
    signals_by_pid = signals.build_signals(players, sport)

    req = starter_requirements(roster_positions)
    levels = replacement_levels(rosters, players, stats, college_data,
                                signals_by_pid, req, num_teams)

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
    if my_player_ids:
        my_players = []
        for pid in my_player_ids:
            p = players.get(str(pid), {})
            p_stats = stats.get(str(pid), {})
            sig = signals_by_pid.get(str(pid))
            my_players.append({
                "pos": p.get("position", "UNK"),
                "dvs": calculate_dvs(p, p_stats, college_data, sig),
            })
        needs = roster_needs(my_players, req, levels)

    is_superflex = roster_positions.count('SUPER_FLEX') > 0

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

        pos = p.get("position")
        valid_positions = offensive_positions(sport)
        if is_idp:
            valid_positions.extend(IDP_POSITIONS)
        if pos not in valid_positions:
            continue

        p_stats = stats.get(str(pid), {})
        sig = signals_by_pid.get(str(pid))
        rvs = calculate_rvs(p, p_stats, sig)
        dvs = calculate_dvs(p, p_stats, college_data, sig)

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
    }
