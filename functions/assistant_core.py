import sys
import json
import os
import argparse
from sleeper_api import get_user, get_leagues, get_rosters, get_users_in_league, get_drafts_for_user, get_state, get_trending_players, get_draft, get_draft_picks, get_all_players

def load_players():
    players_file = "players.json"
    if not os.path.exists(players_file):
        print("Downloading players data (this takes a moment)...")
        players = get_all_players("nfl")
        with open(players_file, "w") as f:
            json.dump(players, f)
    else:
        with open(players_file, "r") as f:
            players = json.load(f)
    return players

def calculate_custom_score(p_stats, pos, scoring):
    if not scoring:
        return max(p_stats.get("pts_ppr", 0) or 0, p_stats.get("pts_idp", 0) or 0)
    
    is_def = pos in ['LB', 'DB', 'DL', 'DE', 'DT', 'CB', 'S']
    
    if is_def:
        tkl_solo = p_stats.get("idp_tkl_solo", 0) or 0
        tkl_ast = p_stats.get("idp_tkl_ast", 0) or 0
        tkl_loss = p_stats.get("idp_tkl_loss", 0) or 0
        sack = p_stats.get("idp_sack", 0) or 0
        qb_hit = p_stats.get("idp_qb_hit", 0) or 0
        ff = p_stats.get("idp_ff", 0) or 0
        fum_rec = p_stats.get("idp_fum_rec", 0) or 0
        interception = p_stats.get("idp_int", 0) or 0
        pass_def = p_stats.get("idp_pass_def", 0) or 0
        safe = p_stats.get("idp_safe", 0) or 0
        def_td = p_stats.get("idp_def_td", 0) or 0
        blk_kick = p_stats.get("idp_blk_kick", 0) or 0
        
        score = (
            tkl_solo * scoring.get("idp_tkl_solo", 2.0) +
            tkl_ast * scoring.get("idp_tkl_ast", 1.0) +
            tkl_loss * scoring.get("idp_tkl_loss", 2.0) +
            sack * scoring.get("idp_sack", 6.0) +
            qb_hit * scoring.get("idp_qb_hit", 1.0) +
            ff * scoring.get("idp_ff", 3.0) +
            fum_rec * scoring.get("idp_fum_rec", 3.0) +
            interception * scoring.get("idp_int", 6.0) +
            pass_def * scoring.get("idp_pass_def", 3.0) +
            safe * scoring.get("idp_safe", 3.0) +
            def_td * scoring.get("idp_def_td", 6.0) +
            blk_kick * scoring.get("idp_blk_kick", 3.0)
        )
        return round(score, 2)
    else:
        pass_yd = p_stats.get("pass_yd", 0) or 0
        pass_td = p_stats.get("pass_td", 0) or 0
        pass_int = p_stats.get("pass_int", 0) or 0
        rush_yd = p_stats.get("rush_yd", 0) or 0
        rush_td = p_stats.get("rush_td", 0) or 0
        rec = p_stats.get("rec", 0) or 0
        rec_yd = p_stats.get("rec_yd", 0) or 0
        rec_td = p_stats.get("rec_td", 0) or 0
        fum_lost = p_stats.get("fum_lost", 0) or 0
        pass_2pt = p_stats.get("pass_2pt", 0) or 0
        rush_2pt = p_stats.get("rush_2pt", 0) or 0
        rec_2pt = p_stats.get("rec_2pt", 0) or 0
        
        score = (
            pass_yd * scoring.get("pass_yd", 0.04) +
            pass_td * scoring.get("pass_td", 4.0) +
            pass_int * scoring.get("pass_int", -2.0) +
            rush_yd * scoring.get("rush_yd", 0.1) +
            rush_td * scoring.get("rush_td", 6.0) +
            rec_yd * scoring.get("rec_yd", 0.1) +
            rec_td * scoring.get("rec_td", 6.0) +
            fum_lost * scoring.get("fum_lost", -2.0) +
            pass_2pt * scoring.get("pass_2pt", 2.0) +
            rush_2pt * scoring.get("rush_2pt", 2.0) +
            rec_2pt * scoring.get("rec_2pt", 2.0)
        )
        
        rec_score = rec * scoring.get("rec", 1.0)
        if pos == "TE":
            rec_score += rec * scoring.get("bonus_rec_te", 0.0)
        elif pos == "RB":
            rec_score += rec * scoring.get("bonus_rec_rb", 0.0)
        elif pos == "WR":
            rec_score += rec * scoring.get("bonus_rec_wr", 0.0)
            
        score += rec_score
        return round(score, 2)

def load_multi_year_stats(years=[2023, 2024, 2025], scoring_settings=None, players_db=None):
    if scoring_settings and not players_db:
        players_db = load_players()
        
    aggregated_stats = {}
    for year in years:
        stats_file = f"stats_{year}.json"
        if not os.path.exists(stats_file):
            print(f"Downloading {year} stats data...")
            import urllib.request
            req = urllib.request.Request(f"https://api.sleeper.app/v1/stats/nfl/regular/{year}", headers={'User-Agent': 'Mozilla/5.0'})
            try:
                with urllib.request.urlopen(req) as response:
                    stats = json.loads(response.read().decode())
                    with open(stats_file, "w") as f:
                        json.dump(stats, f)
            except Exception:
                stats = {}
        else:
            with open(stats_file, "r") as f:
                stats = json.load(f)
                
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

def load_draft_grades():
    grades_file = "draft_grades.json"
    if os.path.exists(grades_file):
        with open(grades_file, "r") as f:
            return json.load(f)
    return {}

def analyze_draft(username, draft_id, league_id=None, position_filter=None):
    user = get_user(username)
    if not user:
        print("User not found.")
        return
    user_id = user["user_id"]

    draft = get_draft(draft_id)
    if not draft:
        print("Draft not found.")
        return
    
    settings = draft.get("settings", {})
    metadata = draft.get("metadata", {})
    draft_order = draft.get("draft_order", {})
    
    print(f"--- DRAFT OVERVIEW ---")
    print(f"Name: {metadata.get('name', 'Unnamed Draft')}")
    print(f"Status: {draft.get('status')}")
    print(f"Teams: {settings.get('teams')}, Rounds: {settings.get('rounds')}")
    
    user_slot = draft_order.get(user_id)
    print(f"Your Draft Slot: {user_slot}")
    
    is_rookie_draft = settings.get('player_type') == 1
    if is_rookie_draft:
        print("Note: This is a ROOKIE ONLY draft. Ranks will be adjusted accordingly.")
    print("Strategy Reminder: For SF QBs, target paths behind bridge veterans. For blocked elite WRs, use the Taxi Squad.")
    
    picks = get_draft_picks(draft_id)
    picked_player_ids = set()
    if picks:
        last_pick = picks[-1]
        print(f"Last pick made: Round {last_pick.get('round')}, Pick {last_pick.get('draft_slot')} (Overall {last_pick.get('pick_no')})")
        for p in picks:
            picked_player_ids.add(str(p.get("player_id")))
    else:
        print("No picks made yet.")
        
    players = load_players()
    
    if league_id:
        print("\n--- LEAGUE & ROSTER ---")
        import urllib.request
        league_url = f"https://api.sleeper.app/v1/league/{league_id}"
        req = urllib.request.Request(league_url, headers={'User-Agent': 'Mozilla'})
        scoring = {}
        try:
            with urllib.request.urlopen(req) as response:
                league_info = json.loads(response.read().decode())
                roster_positions = league_info.get('roster_positions', [])
                req_qb = roster_positions.count('QB')
                req_rb = roster_positions.count('RB')
                req_wr = roster_positions.count('WR')
                req_te = roster_positions.count('TE')
                req_flex = roster_positions.count('FLEX')
                req_sflex = roster_positions.count('SUPER_FLEX')
                
                print(f"Starter Requirements: QB={req_qb}, RB={req_rb}, WR={req_wr}, TE={req_te}, FLEX={req_flex}, SUPER_FLEX={req_sflex}")
                
                scoring = league_info.get("scoring_settings", {})
                print(f"Scoring: PPR={scoring.get('rec', 0)}, TE Premium={scoring.get('bonus_rec_te', 0)}, Pass TD={scoring.get('pass_td', 0)}")
        except Exception:
            pass

        rosters = get_rosters(league_id)
        stats = load_multi_year_stats(scoring_settings=scoring, players_db=players)
        rostered_player_ids = set()
        if rosters:
            for r in rosters:
                if r.get("players"):
                    rostered_player_ids.update(str(pid) for pid in r["players"])
            my_roster = next((r for r in rosters if r["owner_id"] == user_id), None)
            if my_roster:
                my_players = my_roster.get("players", [])
                pos_counts = {}
                quality_metrics = {"LB": [], "RB": [], "WR": [], "TE": []}
                for pid in my_players:
                    player = players.get(str(pid), {})
                    pos = player.get("position", "UNK")
                    pos_counts[pos] = pos_counts.get(pos, 0) + 1
                    
                    # Calculate multi-year average quality
                    p_stats = stats.get(str(pid), {})
                    years = p_stats.get("years_played", 1)
                    if years == 0: years = 1
                    
                    pts_avg = round(p_stats.get("pts", 0) / years, 1)
                    gp_avg = round(p_stats.get("gp", 0) / years, 1)
                    tkl_avg = round(p_stats.get("tkl", 0) / years, 1)
                    rec_avg = round(p_stats.get("rec", 0) / years, 1)
                    age = player.get("age", "N/A")
                    
                    if pos in quality_metrics:
                        quality_metrics[pos].append({
                            "name": f"{player.get('first_name')} {player.get('last_name')}",
                            "pts_avg": pts_avg, "gp_avg": gp_avg, "tkl_avg": tkl_avg, "rec_avg": rec_avg, "age": age
                        })

                print(f"Your Roster Breakdown ({len(my_players)} players):")
                for pos, count in sorted(pos_counts.items()):
                    print(f"  {pos}: {count}")
                    
                print("\n--- ROSTER QUALITY ANALYSIS (3-Year Avg: 2023-2025) ---")
                for pos in ["LB", "RB", "TE", "WR"]:
                    if pos in quality_metrics and quality_metrics[pos]:
                        print(f"Top {pos}s by 3-Year Avg Production:")
                        sorted_pos = sorted(quality_metrics[pos], key=lambda x: x["pts_avg"], reverse=True)
                        for p in sorted_pos[:3]:
                            extra_stat = f"Avg Tackles: {p['tkl_avg']}" if pos in ["LB", "DB", "DL"] else f"Avg Receptions: {p['rec_avg']}"
                            print(f"  {p['name']} (Age {p['age']}): {p['pts_avg']} pts/yr ({p['gp_avg']} GP/yr). {extra_stat}")

    print("\n--- AVAILABLE TOP PLAYERS ---")
    if position_filter:
        print(f"Filtering for position: {position_filter}")
    # A simple ranking heuristic for available players
    available = []
    grades = load_draft_grades()
    
    for pid, p in players.items():
        if pid in picked_player_ids:
            continue
        if league_id and 'rostered_player_ids' in locals() and pid in rostered_player_ids:
            continue
            
        # Apply rookie filtering if it's a rookie draft
        years = p.get("years_exp")
        years = years if years is not None else 0
        if is_rookie_draft and years > 0:
            continue
            
        if p.get("status") in ["Active", "Injured Reserve", "PUP", None]:
            # Filter out obvious retired players/old free agents if not rookie
            if not is_rookie_draft and p.get("team") in [None, "FA"] and years > 2:
                continue
                
            # Use search_rank as a proxy if available, else 999999
            rank = p.get("search_rank", 999999)
            if rank is None: rank = 999999
            available.append((rank, p))
            
    available.sort(key=lambda x: x[0])
    
    # Filter by position AFTER sorting to maintain true overall rank
    filtered_available = []
    for idx, (raw_rank, p) in enumerate(available):
        display_rank = f"Rookie Rank {idx + 1}" if is_rookie_draft else f"Rank {raw_rank}"
        if position_filter and p.get("position") != position_filter:
            continue
        filtered_available.append((display_rank, p))
        
    for display_rank, p in filtered_available[:30]:
        name = f"{p.get('first_name')} {p.get('last_name')}"
        pos = p.get("position")
        team = p.get("team", "FA")
        age = p.get("age", "N/A")
        print(f"{display_rank}: {name} ({pos} - {team}) - Age: {age} - ID: {p.get('player_id')}")
        
        # Display Draft Grades if available
        if name in grades:
            g = grades[name]
            print(f"      NFL Draft: {g.get('nfl_draft_pick')}")
            print(f"      NFL.com: {g.get('nfl_com_grade')}")
            print(f"      CBS: {g.get('cbs_grade')}")
            
        # Add Sports Reference CFB Lookup Link for rookies
        years = p.get("years_exp")
        if years is None or years == 0:
            import urllib.parse
            query_name = urllib.parse.quote_plus(name)
            cfb_url = f"https://www.sports-reference.com/cfb/search/search.fcgi?search={query_name}"
            print(f"      College Stats Lookup: {cfb_url}")
            
        # Display Depth Chart Info if available
        dc_pos = p.get('depth_chart_position')
        dc_order = p.get('depth_chart_order')
        if dc_pos or dc_order:
            print(f"      Depth Chart: {dc_pos or 'UNK'} - String: {dc_order or 'UNK'}")
            if team and team != "FA" and pos:
                dc_list = []
                for op in players.values():
                    if op.get('team') == team and op.get('position') == pos:
                        op_name = f"{op.get('first_name')} {op.get('last_name')}"
                        op_order = op.get('depth_chart_order')
                        dc_list.append((op_order if op_order is not None else 99, op_name))
                dc_list.sort()
                dc_str = " | ".join([f"{o if o != 99 else 'UNK'}: {n}" for o, n in dc_list])
                print(f"      Full {team} {pos} Depth Chart: {dc_str}")

def analyze_waivers(username, league_id):
    user = get_user(username)
    if not user:
        print("User not found.")
        return
    user_id = user["user_id"]

    import urllib.request
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

    rosters = get_rosters(league_id)
    my_roster = next((r for r in rosters if r["owner_id"] == user_id), None)
    if not my_roster:
        print("Roster not found.")
        return

    players = load_players()
    stats = load_multi_year_stats(scoring_settings=scoring_settings, players_db=players)
    
    rostered_ids = set()
    for r in rosters:
        if r.get("players"):
            rostered_ids.update(str(pid) for pid in r["players"])
            
    print("\n--- DYNASTY DROP CANDIDATES ---")
    my_players_stats = []
    for pid in my_roster["players"]:
        p = players.get(str(pid), {})
        p_stats = stats.get(str(pid), {})
        years = max(p_stats.get("years_played", 1), 1)
        pts_avg = round(p_stats.get("pts", 0) / years, 1)
        
        name = f"{p.get('first_name')} {p.get('last_name')}"
        pos = p.get("position", "UNK")
        age = p.get("age") or 0
        years_exp = p.get("years_exp")
        years_exp = years_exp if years_exp is not None else 0
        rank = p.get("search_rank")
        depth = p.get("depth_chart_order")
        team = p.get("team")
        
        # Advanced Dynasty Drop Score (ADDS) Algorithm
        adds = pts_avg
        
        # 1. Consensus Market Value (Search Rank)
        if rank is not None:
            if rank <= 50:
                adds += 150
            elif rank <= 150:
                adds += 100
            elif rank <= 300:
                adds += 50
            elif rank >= 999:
                adds -= 30
        else:
            adds -= 40
            
        # 2. Position Scarcity
        if pos == "QB":
            adds += 100
        elif pos == "TE":
            adds += 30
            
        # 3. Depth Chart Role
        if depth is not None:
            if depth == 1:
                adds += 50
            elif depth == 2:
                adds += 10
            elif depth >= 3:
                adds -= 20
        else:
            if years_exp > 0:
                adds -= 30
                
        # 4. Youth Protection & Age Penalties
        if years_exp == 0:
            adds += 120
        elif years_exp == 1 or age < 24:
            adds += 80
        elif years_exp == 2 or age == 24:
            adds += 50
            
        if pos in ["RB", "WR"]:
            if age >= 29:
                adds -= 30
            if age >= 31:
                adds -= 70
        elif pos in ["QB", "TE"]:
            if age >= 32:
                adds -= 30
            if age >= 34:
                adds -= 70
        elif pos in ["LB", "DB", "DL", "DE", "DT", "CB", "S"]:
            if age >= 29:
                adds -= 25
            if age >= 31:
                adds -= 60
                
        # 5. NFL Free Agent Penalty
        if team in [None, "FA"]:
            adds -= 120
            
        my_players_stats.append({
            "name": name,
            "pos": pos,
            "team": team or "FA",
            "pts": pts_avg,
            "age": age,
            "exp": years_exp,
            "rank": rank or "N/A",
            "depth": depth or "N/A",
            "adds": round(adds, 1)
        })
        
    my_players_stats.sort(key=lambda x: x["adds"])
    for p in my_players_stats[:8]:
        status = " [LIABILITY]" if p['adds'] < 130 else ""
        print(f"DROP Candidate:{status} {p['name']} ({p['pos']} - {p['team']}) - Age {p['age']} | 3-Yr Avg Pts: {p['pts']} | Consensus Rank: {p['rank']} | ADDS: {p['adds']}")

    print("\n--- TOP WAIVER TARGETS ---")
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
        years_played = max(p_stats.get("years_played", 1), 1)
        pts_avg = round(p_stats.get("pts", 0) / years_played, 1)
        
        # Boost rookies (UDFA) who made a team
        waiver_score = pts_avg
        if years_exp == 0 and p.get("team") not in [None, "FA"]:
            waiver_score += 150 # Massive UDFA upside bump for dynasty
            
        available.append((waiver_score, pts_avg, p))
        
    available.sort(key=lambda x: x[0], reverse=True)
    for score, pts, p in available[:10]:
        print(f"ADD: {p.get('first_name')} {p.get('last_name')} ({p.get('position')} - {p.get('team')}) - Age {p.get('age')} | 3-Yr Pts: {pts}")

def main():
    parser = argparse.ArgumentParser(description="Fantasy Sports Assistant - Sleeper Agent Skill")
    parser.add_argument("--username", required=True, help="Your Sleeper username")
    parser.add_argument("--league_id", help="League ID")
    parser.add_argument("--draft_id", help="Analyze a specific draft ID")
    parser.add_argument("--position", help="Filter available players by position (e.g. TE)")
    parser.add_argument("--waivers", action="store_true", help="Run the Waiver Assistant")
    
    args = parser.parse_args()

    if args.waivers and args.league_id:
        analyze_waivers(args.username, args.league_id)
    elif args.draft_id:
        analyze_draft(args.username, args.draft_id, args.league_id, args.position)
    else:
        print("Please provide --waivers --league_id OR --draft_id. E.g. python assistant.py --username X --waivers --league_id Y")

if __name__ == "__main__":
    main()
