import urllib.request
import json
import os

BASE_URL = "https://api.sleeper.app/v1"

def _make_request(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def get_user(username):
    url = f"{BASE_URL}/user/{username}"
    return _make_request(url)

def get_state(sport):
    url = f"{BASE_URL}/state/{sport}"
    return _make_request(url)

def get_leagues(user_id, sport, season):
    url = f"{BASE_URL}/user/{user_id}/leagues/{sport}/{season}"
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
