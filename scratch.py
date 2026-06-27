import json
import urllib.request
import sys

def _request(url: str):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

league_id = "1361771019446018048"

# Get user id
user = _request("https://api.sleeper.app/v1/user/p4t0b4ll3rs")
user_id = user["user_id"]

# Get rosters
rosters = _request(f"https://api.sleeper.app/v1/league/{league_id}/rosters")
my_roster = next((r for r in rosters if r["owner_id"] == user_id), None)

# Load players
with open("/Users/patrickschmidt/.gemini/config/skills/sleeper-fantasy-assistant/resources/players_nba.json", "r") as f:
    players = json.load(f)

print("Your NBA Roster:")
pos_counts = {}
if my_roster and "players" in my_roster:
    for pid in my_roster["players"]:
        p = players.get(str(pid), {})
        pos = p.get("position", "UNK")
        name = f"{p.get('first_name')} {p.get('last_name')}"
        pos_counts[pos] = pos_counts.get(pos, 0) + 1
        print(f"- {name} ({pos} - {p.get('team')})")
        
print("\nPos Counts:", pos_counts)

# Check highest draft picks. The draft was June 2026. Let's see who is drafted in real life.
# Let's just find the roster for now.
