import os
import json
import requests
import urllib.request
import urllib.parse
import sleeper_api

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

TEAM_STRENGTH_TIERS = {
    "KC": 1.2, "PHI": 1.2, "BUF": 1.15, "SF": 1.15, "BAL": 1.15, "CIN": 1.1, "DET": 1.1, "MIA": 1.1, "DAL": 1.1,
    "HOU": 1.1, "GB": 1.05, "LAR": 1.05,
    "ATL": 1.0, "CHI": 1.0, "CLE": 1.0, "IND": 1.0, "JAX": 1.0, "TB": 1.0, "SEA": 1.0,
    "MIN": 0.95, "NO": 0.95, "PIT": 0.95, "LAC": 0.95,
    "ARI": 0.9, "WAS": 0.9, "TEN": 0.9, "LV": 0.9, "NYJ": 0.9,
    "NYG": 0.85, "CAR": 0.85, "NE": 0.8, "DEN": 0.8
}

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

def load_json(filename):
    filepath = os.path.join(DATA_DIR, filename)
    if os.path.exists(filepath):
        with open(filepath, "r") as f:
            return json.load(f)
    return {}

def load_players():
    return load_json("players.json")

def load_college_stats():
    return load_json("college_stats.json")

def load_multi_year_stats(years=[2023, 2024, 2025], scoring_settings=None, players_db=None):
    from assistant_core import calculate_custom_score
    aggregated_stats = {}
    for year in years:
        stats = load_json(f"stats_{year}.json")
        for pid, p_stats in stats.items():
            if pid not in aggregated_stats:
                aggregated_stats[pid] = {"pts": 0, "gp": 0, "tkl": 0, "rec": 0, "years_played": 0}
            gp = p_stats.get("gp", 0) or 0
            if gp > 0:
                pos = None
                if players_db and pid in players_db:
                    pos = players_db[pid].get("position")
                pts = calculate_custom_score(p_stats, pos, scoring_settings)
                aggregated_stats[pid]["pts"] += pts
                aggregated_stats[pid]["gp"] += gp
                aggregated_stats[pid]["tkl"] += (p_stats.get("idp_tkl", 0) or 0)
                aggregated_stats[pid]["rec"] += (p_stats.get("rec", 0) or 0)
                aggregated_stats[pid]["years_played"] += 1
    return aggregated_stats

def calculate_rvs(player, p_stats):
    years = max(p_stats.get("years_played", 1), 1)
    base_pts = round(p_stats.get("pts", 0) / years, 1)
    rvs = base_pts
    
    pos = player.get("position")
    
    # Cross-positional normalization (QBs score way more than TEs inherently)
    if pos == "QB": rvs *= 0.5
    elif pos in ["RB", "WR"]: rvs *= 0.8
    elif pos == "TE": rvs *= 1.2
    
    depth_chart = player.get("depth_chart_order")
    if depth_chart == 1:
        rvs *= 1.0
    elif depth_chart == 2:
        if pos == "RB": rvs *= 0.7
        else: rvs *= 0.5
    elif depth_chart is not None and depth_chart >= 3:
        rvs *= 0.1
        
    team = player.get("team")
    if team in TEAM_STRENGTH_TIERS:
        rvs *= TEAM_STRENGTH_TIERS[team]
        
    status = player.get("status")
    if status == "Questionable": rvs *= 0.85
    elif status in ["Out", "Injured Reserve", "PUP"]: rvs *= 0.2
    
    return round(rvs, 1)

def calculate_dvs(player, rvs, college_data):
    dvs = rvs
    pos = player.get("position")
    age = player.get("age") or 25
    years_exp = player.get("years_exp") or 0
    
    # 1. Base Score for Rookies
    if years_exp == 0 and rvs == 0:
        dvs = 20 # Base DVS for any drafted rookie without stats
        
    # 2. Age Curves
    if pos == "RB":
        if age <= 23: dvs *= 1.3
        elif age == 24: dvs *= 1.2
        elif age == 25: dvs *= 1.0
        elif age == 26: dvs *= 0.8
        elif age == 27: dvs *= 0.6
        elif age >= 28: dvs *= 0.4
    elif pos == "WR":
        if age <= 23: dvs *= 1.3
        elif age <= 25: dvs *= 1.2
        elif age <= 27: dvs *= 1.0
        elif age <= 29: dvs *= 0.9
        elif age == 30: dvs *= 0.7
        elif age >= 31: dvs *= 0.5
    elif pos == "TE":
        if age <= 24: dvs *= 1.2
        elif age <= 27: dvs *= 1.1
        elif age <= 29: dvs *= 0.9
        elif age == 30: dvs *= 0.8
        elif age >= 31: dvs *= 0.6
    elif pos == "QB":
        if age <= 25: dvs *= 1.2
        elif age <= 29: dvs *= 1.0
        elif age <= 33: dvs *= 0.9
        elif age <= 36: dvs *= 0.7
        elif age >= 37: dvs *= 0.5
    elif pos in ["LB", "DB", "CB", "S", "DL", "DE", "DT"]:
        if age <= 24: dvs *= 1.2
        elif age <= 27: dvs *= 1.0
        elif age <= 29: dvs *= 0.8
        elif age >= 30: dvs *= 0.5
        
    # 3. Market Consensus (Search Rank) - Applies to everyone!
    rank = player.get("search_rank")
    if rank:
        if rank <= 50: dvs += 80
        elif rank <= 100: dvs += 60
        elif rank <= 200: dvs += 40
        elif rank <= 300: dvs += 20
        
    # 4. Rookie & College Capital (Extra boost for young guys)
    if years_exp < 2:
        pid = str(player.get("player_id"))
        if college_data and pid in college_data:
            cstats = college_data[pid]
            if cstats and not cstats.get("_not_found"):
                # Calculate bonus from stats
                bonus = 0
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
                elif pos in ["LB", "DB", "CB", "S", "DL", "DE", "DT"]:
                    tck = cstats.get("DEFENSIVE_TOT", 0)
                    sck = cstats.get("DEFENSIVE_SACK", 0)
                    if tck > 150: bonus += 20
                    elif tck > 80: bonus += 10
                    if sck > 15: bonus += 15
                    elif sck > 5: bonus += 10
                
                dvs += (bonus or 15) # Default 15 if no significant stats but profile exists
            else:
                dvs += 5 # Minimal bonus if they just have a generic profile but no stats found
        
        if rank:
            if rank <= 150: dvs += 20
            elif rank <= 300: dvs += 10
            elif rank <= 500: dvs += 5
            
    # 5. Long Term Injury Resilience
    status = player.get("status")
    if status in ["Out", "Injured Reserve", "PUP"] and rvs > 0:
        dvs = (dvs / 0.2) * 0.8 
        
    return round(dvs, 1)

def analyze_waivers_api(username, league_id):
    user = sleeper_api.get_user(username)
    if not user:
        return {"error": "User not found"}
    user_id = user["user_id"]

    league_url = f"https://api.sleeper.app/v1/league/{league_id}"
    req = urllib.request.Request(league_url, headers={'User-Agent': 'Mozilla'})
    scoring_settings = {}
    try:
        with urllib.request.urlopen(req) as response:
            league_info = json.loads(response.read().decode())
            roster_positions = league_info.get('roster_positions', [])
            scoring_settings = league_info.get('scoring_settings', {})
    except Exception:
        roster_positions = []
        
    is_idp = any(pos in roster_positions for pos in ['LB', 'DB', 'DL', 'IDP_FLEX'])

    rosters = sleeper_api.get_rosters(league_id)
    my_roster = next((r for r in rosters if r["owner_id"] == user_id), None)
    if not my_roster:
        return {"error": "Roster not found"}

    players = load_players()
    college_data = load_college_stats()
    stats = load_multi_year_stats(scoring_settings=scoring_settings, players_db=players)
    
    rostered_ids = set()
    for r in rosters:
        if r.get("players"):
            rostered_ids.update(str(pid) for pid in r["players"])
            
    # Drop Candidates
    my_players_stats = []
    for pid in my_roster["players"]:
        p = players.get(str(pid), {})
        p_stats = stats.get(str(pid), {})
        
        rvs = calculate_rvs(p, p_stats)
        dvs = calculate_dvs(p, rvs, college_data)
            
        my_players_stats.append({
            "id": pid,
            "name": f"{p.get('first_name')} {p.get('last_name')}",
            "pos": p.get("position", "UNK"),
            "team": p.get("team") or "FA",
            "age": p.get("age", 0),
            "exp": p.get("years_exp", 0),
            "status": p.get("status", "Active"),
            "rvs": rvs,
            "dvs": dvs,
            "is_liability": dvs < 80 # Updated liability threshold for new scale
        })
        
    # Sort drops by lowest DVS (since this is Dynasty focused)
    my_players_stats.sort(key=lambda x: x["dvs"])

    # Targets
    available = []
    for pid, p in players.items():
        if pid in rostered_ids: continue
        if p.get("status") not in ["Active", "Injured Reserve", "PUP", None]: continue
        
        pos = p.get("position")
        valid_positions = ['QB', 'RB', 'WR', 'TE']
        if is_idp:
            valid_positions.extend(['LB', 'DB', 'DL', 'DE', 'DT', 'CB', 'S'])
        if pos not in valid_positions: continue
        
        years_exp = p.get("years_exp") or 0
        if p.get("team") in [None, "FA"] and years_exp > 2: continue
        
        p_stats = stats.get(str(pid), {})
        
        rvs = calculate_rvs(p, p_stats)
        dvs = calculate_dvs(p, rvs, college_data)
            
        available.append({
            "id": pid,
            "name": f"{p.get('first_name')} {p.get('last_name')}",
            "pos": pos,
            "team": p.get("team", "FA"),
            "age": p.get("age", "N/A"),
            "status": p.get("status", "Active"),
            "rvs": rvs,
            "dvs": dvs
        })
        
    # Sort targets by highest DVS
    available.sort(key=lambda x: x["dvs"], reverse=True)
    
    # -----------------------------------------------------
    # Smart Recommendation Engine
    # -----------------------------------------------------
    req_counts = {}
    for pos in roster_positions:
        if pos in ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'CB', 'S', 'DE', 'DT']:
            req_counts[pos] = req_counts.get(pos, 0) + 1
            
    my_counts = {}
    pos_dvs = {}
    for p in my_players_stats:
        pos = p["pos"]
        my_counts[pos] = my_counts.get(pos, 0) + 1
        pos_dvs.setdefault(pos, []).append(p["dvs"])
        
    needs = []
    for pos, req in req_counts.items():
        current = my_counts.get(pos, 0)
        # Identify need if there is 0 depth (current <= req) or weak depth (current == req + 1)
        if current <= req:
            needs.append({"pos": pos, "severity": 2, "reason": f"Depth Critical: You have {current} {pos}s but start {req}."})
        elif current == req + 1:
            needs.append({"pos": pos, "severity": 1, "reason": f"Depth Low: You only have 1 backup {pos}."})
            
    # Also find positional quality weaknesses
    for pos, dvs_list in pos_dvs.items():
        if pos in req_counts:
            avg_dvs = sum(dvs_list) / len(dvs_list)
            # If a primary position is very weak overall
            if avg_dvs < 30 and pos in ['RB', 'WR', 'TE', 'QB']:
                needs.append({"pos": pos, "severity": 3, "reason": f"Quality Low: Your {pos}s have a poor average Dynasty Value ({round(avg_dvs,1)})."})

    # Sort needs by severity descending
    needs.sort(key=lambda x: x["severity"], reverse=True)
    
    smart_recommendations = []
    used_targets = set()
    used_drops = set()
    
    # Worst players on roster
    worst_drops = sorted(my_players_stats, key=lambda x: x["dvs"])
    
    for need in needs:
        if len(smart_recommendations) >= 3: break
        
        target_pos = need["pos"]
        
        # Find best available player for this position
        best_target = None
        for p in available:
            if p["pos"] == target_pos and p["id"] not in used_targets:
                best_target = p
                break
                
        if not best_target: continue
        
        # Find worst player on roster to drop (who is not the same position we are adding, if possible)
        best_drop = None
        for d in worst_drops:
            if d["id"] not in used_drops and d["pos"] != target_pos:
                best_drop = d
                break
                
        if not best_drop: 
            # Fallback to any drop
            for d in worst_drops:
                if d["id"] not in used_drops:
                    best_drop = d
                    break
                    
        if best_drop and best_target:
            smart_recommendations.append({
                "drop": best_drop,
                "add": best_target,
                "reason": need["reason"]
            })
            used_targets.add(best_target["id"])
            used_drops.add(best_drop["id"])
    
    return {
        "drop_candidates": my_players_stats[:15],
        "waiver_targets": available[:15],
        "smart_recommendations": smart_recommendations
    }

def update_sleeper_data_api():
    """Fetches the latest players and stats from Sleeper API and saves them to the data directory."""
    import urllib.request
    
    # 1. Update Players
    print("Fetching latest players data...")
    players = sleeper_api.get_all_players("nfl")
    if players:
        players_file = os.path.join(DATA_DIR, "players.json")
        with open(players_file, "w") as f:
            json.dump(players, f)
            
    # 2. Update Stats (Last 3 years)
    years = [2023, 2024, 2025]
    for year in years:
        print(f"Fetching stats for {year}...")
        stats_file = os.path.join(DATA_DIR, f"stats_{year}.json")
        req = urllib.request.Request(f"https://api.sleeper.app/v1/stats/nfl/regular/{year}", headers={'User-Agent': 'Mozilla/5.0'})
        try:
            with urllib.request.urlopen(req) as response:
                stats = json.loads(response.read().decode())
                with open(stats_file, "w") as f:
                    json.dump(stats, f)
        except Exception as e:
            print(f"Error fetching stats for {year}: {e}")
            
    # 3. Update College Stats for Top Rookies
    print("Fetching College Stats for rookies via ESPN...")
    college_file = os.path.join(DATA_DIR, "college_stats.json")
    college_data = load_college_stats() or {}
    
    # We don't want to fetch 5000 rookies every time, only the relevant ones.
    # We will fetch for rookies (0 years exp) with a search_rank <= 1000 or no rank if IDP.
    rookies_to_fetch = []
    for pid, p in players.items():
        if str(pid) in college_data:
            continue
            
        if p.get("years_exp") == 0 and p.get("status") == "Active":
            pos = p.get("position")
            rank = p.get("search_rank") or 99999
            
            # Fetch for top 800 offensive players and all active IDP rookies
            if (pos in ['QB', 'RB', 'WR', 'TE'] and rank <= 800) or pos in ['LB', 'DB', 'DL', 'DE', 'DT', 'CB', 'S']:
                rookies_to_fetch.append((pid, p))
                
    # To avoid API rate limits/timeouts during update, limit to 15 fetches per update click
    # This incrementally builds the database over time without causing HTTP timeouts
    fetch_limit = min(15, len(rookies_to_fetch))
    for i in range(fetch_limit):
        pid, p = rookies_to_fetch[i]
        name = f"{p.get('first_name')} {p.get('last_name')}"
        print(f"Fetching college stats for {name} ({i+1}/{fetch_limit})...")
        c_stats = fetch_espn_college_stats(name)
        if c_stats:
            college_data[str(pid)] = c_stats
        else:
            # Mark as empty so we don't keep trying and failing
            college_data[str(pid)] = {"_not_found": True}
            
    if fetch_limit > 0:
        with open(college_file, "w") as f:
            json.dump(college_data, f)
            
    return {"status": "success", "message": f"Data successfully updated. Fetched {fetch_limit} new college profiles."}

def get_user_drafts_api(username, sport="nfl", season="2026"):
    user = sleeper_api.get_user(username)
    if not user:
        return {"error": "User not found"}
    user_id = user["user_id"]
    
    if season == "all":
        all_drafts = []
        seen_dids = set()
        for yr in ["2026", "2025", "2024"]:
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

def analyze_draft_api(username, draft_id):
    user = sleeper_api.get_user(username)
    if not user: return {"error": "User not found"}
    user_id = user["user_id"]

    draft = sleeper_api.get_draft(draft_id)
    if not draft: return {"error": "Draft not found"}
    
    settings = draft.get("settings", {})
    metadata = draft.get("metadata", {})
    draft_order = draft.get("draft_order", {})
    league_id = draft.get("league_id")
    
    user_slot = draft_order.get(user_id)
    is_rookie_draft = settings.get('player_type') == 1
    
    picks = sleeper_api.get_draft_picks(draft_id)
    picked_player_ids = set()
    last_pick = None
    if picks:
        last_pick = picks[-1]
        for p in picks:
            picked_player_ids.add(str(p.get("player_id")))
            
    # Try to load league context for smart recommendations
    roster_positions = []
    scoring_settings = {}
    is_idp = False
    my_roster = None
    if league_id:
        league_url = f"https://api.sleeper.app/v1/league/{league_id}"
        req = urllib.request.Request(league_url, headers={'User-Agent': 'Mozilla'})
        try:
            with urllib.request.urlopen(req) as response:
                league_info = json.loads(response.read().decode())
                roster_positions = league_info.get('roster_positions', [])
                scoring_settings = league_info.get('scoring_settings', {})
                is_idp = any(pos in roster_positions for pos in ['LB', 'DB', 'DL', 'IDP_FLEX'])
        except Exception:
            pass
            
        rosters = sleeper_api.get_rosters(league_id)
        if rosters:
            my_roster = next((r for r in rosters if r["owner_id"] == user_id), None)
            
    players = load_players()
    college_data = load_college_stats()
    stats = load_multi_year_stats(scoring_settings=scoring_settings, players_db=players)
    
    # Calculate Roster Needs (Depth and Quality)
    needs = []
    if my_roster and my_roster.get("players"):
        req_counts = {}
        for pos in roster_positions:
            if pos in ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'CB', 'S', 'DE', 'DT']:
                req_counts[pos] = req_counts.get(pos, 0) + 1
                
        my_counts = {}
        pos_dvs = {}
        for pid in my_roster["players"]:
            p = players.get(str(pid), {})
            pos = p.get("position", "UNK")
            my_counts[pos] = my_counts.get(pos, 0) + 1
            
            p_stats = stats.get(str(pid), {})
            rvs = calculate_rvs(p, p_stats)
            dvs = calculate_dvs(p, rvs, college_data)
            pos_dvs.setdefault(pos, []).append(dvs)
            
        for pos, req in req_counts.items():
            current = my_counts.get(pos, 0)
            if current <= req:
                needs.append({"pos": pos, "severity": 2, "reason": f"Depth Critical: You have {current} {pos}s but start {req}."})
            elif current == req + 1:
                needs.append({"pos": pos, "severity": 1, "reason": f"Depth Low: Only 1 backup {pos}."})
                
        for pos, dvs_list in pos_dvs.items():
            if pos in req_counts:
                avg_dvs = sum(dvs_list) / len(dvs_list)
                if avg_dvs < 30 and pos in ['RB', 'WR', 'TE', 'QB', 'LB', 'DB', 'DL', 'CB', 'S', 'DE', 'DT']:
                    needs.append({"pos": pos, "severity": 3, "reason": f"Quality Low: Your {pos}s have a poor average Dynasty Value ({round(avg_dvs,1)})."})
                    
        needs.sort(key=lambda x: x["severity"], reverse=True)

    is_superflex = roster_positions.count('SUPER_FLEX') > 0

    # Get Available Players & Calculate Trade Value
    available = []
    for pid, p in players.items():
        if pid in picked_player_ids: continue
        if p.get("status") not in ["Active", "Injured Reserve", "PUP", None]: continue
        
        years_exp = p.get("years_exp", 0) or 0
        if is_rookie_draft and years_exp > 0: continue
        
        pos = p.get("position")
        valid_positions = ['QB', 'RB', 'WR', 'TE']
        if is_idp: valid_positions.extend(['LB', 'DB', 'DL', 'DE', 'DT', 'CB', 'S'])
        if pos not in valid_positions: continue
        
        p_stats = stats.get(str(pid), {})
        rvs = calculate_rvs(p, p_stats)
        dvs = calculate_dvs(p, rvs, college_data)
        # Trade Value Calculation
        trade_value = dvs
        try:
            age = int(p.get("age") or 25)
        except (ValueError, TypeError):
            age = 25
            
        if is_superflex and pos == "QB":
            trade_value *= 1.5 # Massive boost for QBs in Superflex
        if pos == "WR" and age <= 23:
            trade_value *= 1.2 # Young elite WRs hold insane trade value
        if pos == "RB" and age >= 27:
            trade_value *= 0.7 # Aging RBs have little trade value even if productive
            
        available.append({
            "id": pid,
            "name": f"{p.get('first_name')} {p.get('last_name')}",
            "pos": pos,
            "team": p.get("team", "FA"),
            "age": age,
            "rvs": rvs,
            "dvs": dvs,
            "trade_value": round(trade_value, 1),
            "is_rookie": years_exp == 0
        })
        
    available.sort(key=lambda x: x["dvs"], reverse=True)
    
    # Generate Top Recommendations
    top_recs = []
    if available:
        # 1. Best Player Available (Highest DVS)
        bpa = available[0]
        top_recs.append({
            "type": "bpa",
            "title": "Best Player Available",
            "player": bpa,
            "reason": f"{bpa['name']} is simply the most talented player left on the board (DVS: {bpa['dvs']}). Pure value pick."
        })
        
        # 2. Best Team Fit (Highest DVS matching highest severity need)
        if needs:
            top_need_pos = needs[0]["pos"]
            fit = next((p for p in available if p["pos"] == top_need_pos), None)
            if fit:
                top_recs.append({
                    "type": "fit",
                    "title": "Best Team Fit",
                    "player": fit,
                    "reason": f"Matches your biggest roster gap ({needs[0]['reason']}). {fit['name']} is the best {top_need_pos} available."
                })
                
        # 3. Best Trade Asset (Highest Trade Value not already recommended)
        rec_ids = [r["player"]["id"] for r in top_recs]
        trade_sorted = sorted(available, key=lambda x: x["trade_value"], reverse=True)
        trade_asset = next((p for p in trade_sorted if p["id"] not in rec_ids), None)
        if trade_asset:
            top_recs.append({
                "type": "trade",
                "title": "Best Trade Asset",
                "player": trade_asset,
                "reason": f"High market demand. {trade_asset['name']} holds a massive Trade Value ({trade_asset['trade_value']}) and can be flipped later."
            })
    
    return {
        "metadata": {
            "name": metadata.get("name", "Unnamed Draft"),
            "status": draft.get("status"),
            "user_slot": user_slot,
            "is_rookie_draft": is_rookie_draft,
            "teams": settings.get("teams"),
            "rounds": settings.get("rounds")
        },
        "last_pick": last_pick,
        "roster_needs": needs,
        "top_recommendations": top_recs,
        "best_available": available[:30]
    }
