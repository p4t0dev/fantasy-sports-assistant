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

# Sleeper usernames whose cross-league overview the scheduled job rebuilds.
# Opt-in by configuration rather than on first request: one overview runs every
# league a user has through the full model, and a public endpoint that did that
# for any name it was given would be an open cost lever.
SNAPSHOT_USERS = [u.strip() for u in os.environ.get("FSA_SNAPSHOT_USERS", "").split(",") if u.strip()]

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
        leagues = _drop_superseded(all_leagues)
    else:
        leagues = sleeper_api.get_leagues(user.get("user_id"), sport, season) or []

    current = _current_season(sport)
    for l in leagues:
        # A league from a finished season is history, not a place to set a
        # lineup. Flagged rather than removed so the archive stays reachable.
        l["archived"] = (str(l.get("season")) != current
                         or l.get("status") == "complete")
    leagues.sort(key=lambda l: (l.get("archived", False),
                                -int(l.get("season") or 0),
                                l.get("name") or ""))

    return _json(leagues, 200, req)


def _drop_superseded(leagues):
    """Remove the earlier incarnations of a dynasty league.

    A dynasty league is a fresh league_id every season, chained backwards
    through `previous_league_id`. Merging three seasons of listings therefore
    returned the same league three times over - and every league the user had
    since left came back too, because it was still there in an old season. Any
    league that another league in the list points back to is a past season of
    that league and is dropped.
    """
    superseded = {l.get("previous_league_id") for l in leagues
                  if l.get("previous_league_id")}
    return [l for l in leagues if l.get("league_id") not in superseded]


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
    if result.get("status") == "success" and sport == "nfl":
        # The button is how a manager asks for fresh numbers now; the overview
        # should not keep showing the old ones until the next scheduled run.
        notes = [api_core.build_overview_snapshot(u, sport)["message"] for u in SNAPSHOT_USERS]
        if notes:
            result["message"] += " · " + " · ".join(notes)
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
def optimize_lineup(req: https_fn.Request) -> https_fn.Response:
    if req.method == 'OPTIONS':
        return _preflight(req)

    username = req.args.get("username")
    league_id = req.args.get("league_id")
    sport = req.args.get("sport", "nfl")

    if not username or not league_id:
        return _error("Missing username or league_id", 400, req)

    result = api_core.optimize_lineup_api(username, league_id, sport)
    if "error" in result:
        return _error(result["error"], 400, req)

    return _json(result, 200, req)


@https_fn.on_request(memory=512)
def get_overview(req: https_fn.Request) -> https_fn.Response:
    """The stored cross-league overview. Never computed on request."""
    if req.method == 'OPTIONS':
        return _preflight(req)

    username = req.args.get("username")
    sport = req.args.get("sport", "nfl")
    if not username:
        return _error("Missing username", 400, req)

    snapshot = api_core.load_overview_snapshot(username, sport)
    if not snapshot:
        return _error(
            "Für diesen Username gibt es noch keine Wochenübersicht. Sie wird nur für "
            "Usernames berechnet, die in FSA_SNAPSHOT_USERS eingetragen sind.", 404, req)
    return _json(snapshot, 200, req)


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


# Morning, noon and evening, Berlin time. Injury designations move all day long
# - practice reports land in the afternoon, inactives on game day - and the
# overview is only worth reading if it has seen them.
@scheduler_fn.on_schedule(schedule="0 6,12,18 * * *", timezone=scheduler_fn.Timezone("Europe/Berlin"),
                          memory=512, timeout_sec=540)
def refresh_data(event: scheduler_fn.ScheduledEvent) -> None:
    """Snapshot refresh, three times a day.

    NFL data and every configured user's overview on each run. The NBA has no
    overview and no weekly model, so once a day in the morning is enough.
    """
    result = api_core.update_sleeper_data_api("nfl")
    print(f"[nfl] {result.get('message')}")
    for username in SNAPSHOT_USERS:
        print(f"[overview] {api_core.build_overview_snapshot(username, 'nfl')['message']}")

    if _berlin_hour(event) < 9:
        result = api_core.update_sleeper_data_api("nba")
        print(f"[nba] {result.get('message')}")


def _berlin_hour(event):
    try:
        from zoneinfo import ZoneInfo
        from datetime import datetime
        when = getattr(event, "schedule_time", None) or datetime.now(ZoneInfo("UTC"))
        return when.astimezone(ZoneInfo("Europe/Berlin")).hour
    except Exception:
        return 6  # when in doubt, refresh
