from firebase_functions import https_fn, scheduler_fn
from firebase_admin import initialize_app
import hmac
import json
import os
import sleeper_api
import api_core

initialize_app()

# Comma separated list of allowed origins, or "*". Set FSA_ALLOWED_ORIGINS to the
# Hosting domains once deployed so the API is not callable from any page.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("FSA_ALLOWED_ORIGINS", "*").split(",") if o.strip()]

# Shared secret for the manual refresh. Unset means the endpoint stays closed -
# the scheduled job calls the updater directly and is unaffected either way.
REFRESH_TOKEN_ENV = "FSA_REFRESH_TOKEN"

SEASON_FALLBACKS = ["2026", "2025", "2024"]


def _cors(req):
    origin = req.headers.get("Origin", "") if req else ""
    if "*" in ALLOWED_ORIGINS:
        allow = "*"
    elif origin in ALLOWED_ORIGINS:
        allow = origin
    else:
        allow = ALLOWED_ORIGINS[0]
    return {
        'Access-Control-Allow-Origin': allow,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Refresh-Token',
        'Vary': 'Origin',
    }


def _json(payload, status=200, req=None):
    return https_fn.Response(json.dumps(payload), status=status,
                             mimetype="application/json", headers=_cors(req))


def _preflight(req=None):
    return https_fn.Response('', status=204, headers=_cors(req))


def _error(message, status=400, req=None):
    return _json({"error": message}, status, req)


def _seasons(sport):
    """Recent seasons, derived from Sleeper's state instead of a hardcoded list."""
    state = sleeper_api.get_state(sport) or {}
    current = state.get("league_season") or state.get("season")
    if not current:
        return SEASON_FALLBACKS
    try:
        year = int(current)
    except (TypeError, ValueError):
        return SEASON_FALLBACKS
    return [str(year), str(year - 1), str(year - 2)]


def _current_season(sport):
    return _seasons(sport)[0]


@https_fn.on_request(memory=512)
def get_user_leagues(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    username = req.args.get("username")
    sport = req.args.get("sport", "nfl")
    season = req.args.get("season") or _current_season(sport)

    if not username:
        return _error("Missing username", 400, req)

    user = sleeper_api.get_user(username)
    if not user:
        return _error("User not found", 404, req)

    if season == "all":
        all_leagues = []
        seen_ids = set()
        for yr in _seasons(sport):
            for l in (sleeper_api.get_leagues(user.get("user_id"), sport, yr) or []):
                if l.get("league_id") not in seen_ids:
                    seen_ids.add(l.get("league_id"))
                    all_leagues.append(l)
        leagues = all_leagues
    else:
        leagues = sleeper_api.get_leagues(user.get("user_id"), sport, season) or []

    return _json(leagues, 200, req)


@https_fn.on_request(memory=512)
def get_league_rosters(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    league_id = req.args.get("league_id")
    if not league_id:
        return _error("Missing league_id", 400, req)

    return _json(sleeper_api.get_rosters(league_id) or [], 200, req)


@https_fn.on_request(memory=512)
def get_league_users(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    league_id = req.args.get("league_id")
    if not league_id:
        return _error("Missing league_id", 400, req)

    return _json(sleeper_api.get_users_in_league(league_id) or [], 200, req)


@https_fn.on_request(memory=512)
def get_single_league(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    league_id = req.args.get("league_id")
    if not league_id:
        return _error("Missing league_id", 400, req)

    league = sleeper_api.get_league(league_id)
    if not league:
        return _error("Liga mit dieser ID konnte nicht gefunden werden.", 404, req)

    return _json(league, 200, req)


@https_fn.on_request(memory=512)
def analyze_waivers(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    username = req.args.get("username")
    league_id = req.args.get("league_id")
    sport = req.args.get("sport", "nfl")

    if not username or not league_id:
        return _error("Missing username or league_id", 400, req)

    result = api_core.analyze_waivers_api(username, league_id, sport)
    if "error" in result:
        return _error(result["error"], 400, req)

    return _json(result, 200, req)


@https_fn.on_request(memory=512, timeout_sec=300, secrets=["FSA_REFRESH_TOKEN"])
def update_data(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    # Without a gate anyone who knows the URL can trigger a full Sleeper reload
    # plus dozens of ESPN requests, repeatedly, at the project's expense.
    # Secret files routinely carry a trailing newline; strip both sides so a
    # stray whitespace character cannot silently lock the endpoint.
    expected = (os.environ.get(REFRESH_TOKEN_ENV) or "").strip()
    if not expected:
        return _error("Manueller Refresh ist nicht konfiguriert. Der tägliche Job läuft weiter.", 503, req)
    provided = (req.headers.get("X-Refresh-Token") or "").strip()
    if not hmac.compare_digest(provided, expected):
        return _error("Nicht autorisiert.", 401, req)

    sport = req.args.get("sport", "nfl")
    result = api_core.update_sleeper_data_api(sport)
    return _json(result, 200 if result.get("status") == "success" else 500, req)


@https_fn.on_request(memory=512)
def get_user_drafts(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    username = req.args.get("username")
    sport = req.args.get("sport", "nfl")
    season = req.args.get("season") or _current_season(sport)

    if not username:
        return _error("Missing username", 400, req)

    result = api_core.get_user_drafts_api(username, sport, season, _seasons(sport))
    if isinstance(result, dict) and "error" in result:
        return _error(result["error"], 400, req)

    return _json(result, 200, req)


@https_fn.on_request(memory=512)
def analyze_draft(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    username = req.args.get("username")
    draft_id = req.args.get("draft_id")
    sport = req.args.get("sport", "nfl")

    if not username or not draft_id:
        return _error("Missing parameters", 400, req)

    result = api_core.analyze_draft_api(username, draft_id, sport)
    if isinstance(result, dict) and "error" in result:
        return _error(result["error"], 400, req)

    return _json(result, 200, req)


@scheduler_fn.on_schedule(schedule="0 6 * * *", timezone=scheduler_fn.Timezone("Europe/Berlin"),
                          memory=512, timeout_sec=540)
def refresh_data(event: scheduler_fn.ScheduledEvent) -> None:
    """Daily snapshot refresh.

    Injury designations and depth charts change every day, so a waiver
    recommendation is only as good as the freshness of the player data. The
    manual button remains for ad-hoc refreshes.
    """
    for sport in ("nfl", "nba"):
        result = api_core.update_sleeper_data_api(sport)
        print(f"[{sport}] {result.get('message')}")
