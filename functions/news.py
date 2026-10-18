"""Player news text from ESPN.

Sleeper's public API ships no news text, only the timestamp of a player's last
update - "News vor 2 Tagen" was all the app could say. ESPN's public feeds tag
every article with the athletes in it, by the same id Sleeper keeps as
`espn_id`, so a headline lands on the right player without matching names.

Two sources, because they answer different questions:

- the league news feed: the latest ~50 articles (about two days in season),
  for "what just happened to this player";
- the fantasy news per player: short notes written for fantasy managers
  ("The Eagles placed Hurts (calf) on injured reserve Saturday"), fetched only
  for the few players whose absence explains someone else's numbers.

Every call is best effort with a short timeout. Without ESPN the signals are
what they were before: nothing here may fail a request.
"""

import time
from datetime import datetime, timezone

import requests

SITE = "https://site.api.espn.com/apis/site/v2/sports/{path}/news?limit=50"
FANTASY = "https://site.api.espn.com/apis/fantasy/v2/games/{game}/news/players?limit=10&playerId={pid}"
PATHS = {"nfl": "football/nfl", "nba": "basketball/nba"}
GAMES = {"nfl": "ffl", "nba": "fba"}

TIMEOUT = 6
# Older than this, a headline describes a situation that has moved on.
MAX_DAYS = 7
# An article tagging more players than this is a roundup, not news about them.
ROUNDUP_ATHLETES = 3
# Fantasy notes per player are held this long; the league feed is fetched
# once per signal build.
PLAYER_TTL = 1800

_player_cache = {}


def _get(url):
    try:
        response = requests.get(url, timeout=TIMEOUT)
        if response.status_code != 200:
            return None
        return response.json()
    except (requests.RequestException, ValueError) as e:
        print(f"ESPN news failed ({url}): {e}")
        return None


def _days_ago(iso, now):
    try:
        published = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return max(0, int((now - published).total_seconds() // 86400))


def league_news(sport="nfl", now=None):
    """{espn athlete id: [{headline, days}, ...]}, newest first."""
    path = PATHS.get(sport)
    data = _get(SITE.format(path=path)) if path else None
    now = now or datetime.now(timezone.utc)
    out = {}
    for article in (data or {}).get("articles") or []:
        days = _days_ago(article.get("published"), now)
        if days is None or days > MAX_DAYS or not article.get("headline"):
            continue
        athletes = [str(c["athleteId"]) for c in article.get("categories") or []
                    if c.get("type") == "athlete" and c.get("athleteId")]
        # A roundup ("Week 6 inactives: ...") tags everyone it mentions and
        # says little about any one of them.
        if len(athletes) > ROUNDUP_ATHLETES:
            continue
        item = {"headline": article["headline"], "days": days}
        for athlete in athletes:
            out.setdefault(athlete, []).append(item)
    for items in out.values():
        items.sort(key=lambda i: i["days"])
    return out


def player_note(sport, espn_id, now=None):
    """The latest fantasy note on one player: {headline, days} or None."""
    game = GAMES.get(sport)
    if not (game and espn_id):
        return None
    key = (sport, str(espn_id))
    cached = _player_cache.get(key)
    if cached and time.time() - cached[0] < PLAYER_TTL:
        return cached[1]
    data = _get(FANTASY.format(game=game, pid=espn_id))
    now = now or datetime.now(timezone.utc)
    note = None
    for item in (data or {}).get("feed") or []:
        # The player's own notes; the feed mixes in general columns that
        # merely mention him ("Week 6 inactives: ...").
        if item.get("type") != "Rotowire":
            continue
        days = _days_ago(item.get("published"), now)
        if days is not None and days <= MAX_DAYS and item.get("headline"):
            note = {"headline": item["headline"], "days": days}
            break
    _player_cache[key] = (time.time(), note)
    return note
