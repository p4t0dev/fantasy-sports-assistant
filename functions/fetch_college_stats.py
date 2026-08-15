import json
import os
import time
import urllib.request
import urllib.parse

DATA_DIR = os.path.dirname(__file__)

def load_players():
    players_file = os.path.join(DATA_DIR, "data", "players.json")
    if os.path.exists(players_file):
        with open(players_file, "r") as f:
            return json.load(f)
    return {}

def fetch_college_stats(name):
    query_name = urllib.parse.quote_plus(name)
    url = f"https://www.sports-reference.com/cfb/search/search.fcgi?search={query_name}"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'})
    
    try:
        with urllib.request.urlopen(req) as response:
            html = response.read().decode('utf-8')
            # If redirected to a player page, the URL changes, but we can just look for basic stats in the HTML
            # This is a very rudimentary parser just to prove the concept. 
            # In a real scenario, we'd use BeautifulSoup to extract passing/rushing/receiving yards.
            # We will look for "College Football at Sports-Reference.com" to ensure it's a valid page
            if "College Football at Sports-Reference.com" in html:
                # We'll assign a placeholder 'college_dominance' score for now based on if they have a page
                return {"has_college_page": True, "college_url": response.url}
            return None
    except Exception as e:
        print(f"Error fetching {name}: {e}")
        return None

def main():
    players = load_players()
    rookies = []
    
    print("Identifying rookies...")
    for pid, p in players.items():
        if p.get("years_exp") == 0 and p.get("position") in ["QB", "RB", "WR", "TE"]:
            if p.get("team") not in [None, "FA"]: # Only drafted/signed rookies
                rookies.append((pid, f"{p.get('first_name')} {p.get('last_name')}"))
    
    print(f"Found {len(rookies)} active rookies. Fetching college data for top 10 as an example...")
    
    college_data = {}
    
    # We only do 10 to avoid 429 Too Many Requests from Sports Reference during testing
    for pid, name in rookies[:10]:
        print(f"Fetching data for {name}...")
        stats = fetch_college_stats(name)
        if stats:
            college_data[pid] = stats
        time.sleep(2) # Be polite to the server
        
    out_file = os.path.join(DATA_DIR, "data", "college_stats.json")
    with open(out_file, "w") as f:
        json.dump(college_data, f, indent=2)
        
    print(f"Saved college data to {out_file}")

if __name__ == "__main__":
    main()
