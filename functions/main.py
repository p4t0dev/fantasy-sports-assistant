from firebase_functions import https_fn
from firebase_admin import initialize_app
import json
import sleeper_api
import api_core

initialize_app()

def _cors_headers(req):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    }
    return headers

@https_fn.on_request()
def get_user_leagues(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return https_fn.Response('', status=204, headers=_cors_headers(req))
        
    username = req.args.get("username")
    sport = req.args.get("sport", "nfl")
    season = req.args.get("season", "2026")
    
    if not username:
        return https_fn.Response("Missing username", status=400, headers=_cors_headers(req))
        
    user = sleeper_api.get_user(username)
    if not user:
        return https_fn.Response("User not found", status=404, headers=_cors_headers(req))
        
    if season == "all":
        all_leagues = []
        seen_ids = set()
        for yr in ["2026", "2025", "2024"]:
            res = sleeper_api.get_leagues(user.get("user_id"), sport, yr) or []
            for l in res:
                if l.get("league_id") not in seen_ids:
                    seen_ids.add(l.get("league_id"))
                    all_leagues.append(l)
        leagues = all_leagues
    else:
        leagues = sleeper_api.get_leagues(user.get("user_id"), sport, season)
    
    return https_fn.Response(json.dumps(leagues), content_type="application/json", headers=_cors_headers(req))

@https_fn.on_request()
def get_league_rosters(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return https_fn.Response('', status=204, headers=_cors_headers(req))
        
    league_id = req.args.get("league_id")
    
    if not league_id:
        return https_fn.Response("Missing league_id", status=400, headers=_cors_headers(req))
        
    rosters = sleeper_api.get_rosters(league_id)
    return https_fn.Response(json.dumps(rosters), content_type="application/json", headers=_cors_headers(req))

@https_fn.on_request()
def get_league_users(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return https_fn.Response('', status=204, headers=_cors_headers(req))
        
    league_id = req.args.get("league_id")
    
    if not league_id:
        return https_fn.Response("Missing league_id", status=400, headers=_cors_headers(req))
        
    users = sleeper_api.get_users_in_league(league_id)
    return https_fn.Response(json.dumps(users), content_type="application/json", headers=_cors_headers(req))

@https_fn.on_request()
def get_single_league(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return https_fn.Response('', status=204, headers=_cors_headers(req))
        
    league_id = req.args.get("league_id")
    if not league_id:
        return https_fn.Response(json.dumps({"error": "Missing league_id"}), status=400, headers=_cors_headers(req))
        
    url = f"https://api.sleeper.app/v1/league/{league_id}"
    try:
        import urllib.request
        r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla'})
        with urllib.request.urlopen(r) as resp:
            data = json.loads(resp.read().decode())
            return https_fn.Response(json.dumps(data), content_type="application/json", headers=_cors_headers(req))
    except Exception as e:
        return https_fn.Response(json.dumps({"error": str(e)}), status=404, headers=_cors_headers(req))

@https_fn.on_request()
def analyze_waivers(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return https_fn.Response('', status=204, headers=_cors_headers(req))
        
    username = req.args.get("username")
    league_id = req.args.get("league_id")
    
    if not username or not league_id:
        return https_fn.Response("Missing username or league_id", status=400, headers=_cors_headers(req))
        
    result = api_core.analyze_waivers_api(username, league_id)
    if "error" in result:
        return https_fn.Response(result["error"], status=400, headers=_cors_headers(req))
        
    return https_fn.Response(json.dumps(result), content_type="application/json", headers=_cors_headers(req))

@https_fn.on_request()
def update_data(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return https_fn.Response('', status=204, headers=_cors_headers(req))
        
    result = api_core.update_sleeper_data_api()
    return https_fn.Response(json.dumps(result), content_type="application/json", headers=_cors_headers(req))

@https_fn.on_request()
def get_user_drafts(req: https_fn.Request) -> https_fn.Response:
    username = req.args.get("username")
    sport = req.args.get("sport", "nfl")
    season = req.args.get("season", "2026")
    
    if not username:
        return https_fn.Response(json.dumps({"error": "Missing username"}), mimetype="application/json", status=400, headers=_cors_headers(req))
    
    result = api_core.get_user_drafts_api(username, sport, season)
    if isinstance(result, dict) and "error" in result:
        return https_fn.Response(json.dumps(result), mimetype="application/json", status=400, headers=_cors_headers(req))
        
    return https_fn.Response(json.dumps(result), mimetype="application/json", headers=_cors_headers(req))

@https_fn.on_request()
def analyze_draft(req: https_fn.Request) -> https_fn.Response:
    username = req.args.get("username")
    draft_id = req.args.get("draft_id")
    
    if not username or not draft_id:
        return https_fn.Response(json.dumps({"error": "Missing parameters"}), mimetype="application/json", status=400, headers=_cors_headers(req))
    
    result = api_core.analyze_draft_api(username, draft_id)
    if isinstance(result, dict) and "error" in result:
        return https_fn.Response(json.dumps(result), mimetype="application/json", status=400, headers=_cors_headers(req))
        
    return https_fn.Response(json.dumps(result), mimetype="application/json", headers=_cors_headers(req))
