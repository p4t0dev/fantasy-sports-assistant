import urllib.request
import json
import os

BASE_URL = "https://api.sleeper.app/v1"

def _make_request(url, attempts=3):
    """GET a Sleeper endpoint, or None.

    A dropped connection is retried: one lost TLS handshake used to make a
    whole league read as "no roster" in the overview. An HTTP error (404 for
    a league that is gone) is an answer, not a glitch, and is not retried.
    """
    import time
    import urllib.error
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as e:
            print(f"Error fetching {url}: {e}")
            return None
        except Exception as e:  # noqa: BLE001 - network: retry, then give up
            if attempt == attempts - 1:
                print(f"Error fetching {url}: {e}")
                return None
            time.sleep(0.5 * (attempt + 1))

def get_user(username):
    url = f"{BASE_URL}/user/{username}"
    return _make_request(url)

# Season and week change once a week; every model helper asks for them. One
# overview asked Sleeper 67 times in a row for the same answer.
_STATE_TTL = 300
_state_cache = {}


def get_state(sport):
    import time
    hit = _state_cache.get(sport)
    if hit and time.time() - hit[0] < _STATE_TTL:
        return hit[1]
    url = f"{BASE_URL}/state/{sport}"
    state = _make_request(url)
    if state:
        _state_cache[sport] = (time.time(), state)
    return state

def get_leagues(user_id, sport, season):
    url = f"{BASE_URL}/user/{user_id}/leagues/{sport}/{season}"
    return _make_request(url)

def get_league(league_id):
    url = f"{BASE_URL}/league/{league_id}"
    return _make_request(url)

def get_rosters(league_id):
    url = f"{BASE_URL}/league/{league_id}/rosters"
    return _make_request(url)

def get_users_in_league(league_id):
    url = f"{BASE_URL}/league/{league_id}/users"
    return _make_request(url)

def get_drafts_for_user(user_id, sport, season):
    url = f"{BASE_URL}/user/{user_id}/drafts/{sport}/{season}"
    return _make_request(url)

def get_draft(draft_id):
    url = f"{BASE_URL}/draft/{draft_id}"
    return _make_request(url)

def get_draft_picks(draft_id):
    url = f"{BASE_URL}/draft/{draft_id}/picks"
    return _make_request(url)

def get_stats(sport, year, season_type="regular"):
    url = f"{BASE_URL}/stats/{sport}/{season_type}/{year}"
    return _make_request(url)

def get_trending_players(sport, type="add", lookback_hours=24, limit=25):
    url = f"{BASE_URL}/players/{sport}/trending/{type}?lookback_hours={lookback_hours}&limit={limit}"
    return _make_request(url)

def get_all_players(sport):
    """Note: This returns a large ~5MB payload. Use with caution."""
    url = f"{BASE_URL}/players/{sport}"
    return _make_request(url)

def get_transactions(league_id, round_num):
    url = f"{BASE_URL}/league/{league_id}/transactions/{round_num}"
    return _make_request(url)


def get_schedule(sport, season, season_type="regular"):
    """Every game of a season with home and away team: the one place a
    stadium - and so its weather - can be read off."""
    url = f"https://api.sleeper.com/schedule/{sport}/{season_type}/{season}"
    return _make_request(url)


def get_matchups(league_id, week):
    """Who plays whom this week: one row per roster, paired by matchup_id."""
    url = f"{BASE_URL}/league/{league_id}/matchups/{week}"
    return _make_request(url)
