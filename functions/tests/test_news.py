import os
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import api_core  # noqa: E402
import news  # noqa: E402
import signals  # noqa: E402

NOW = datetime(2026, 10, 18, 12, tzinfo=timezone.utc)


def athlete(aid):
    return {"type": "athlete", "athleteId": aid}


class _Res:
    def __init__(self, body):
        self.status_code, self._body = 200, body

    def json(self):
        return self._body


class LeagueNewsTest(unittest.TestCase):

    def test_headlines_land_by_espn_id_roundups_and_old_news_do_not(self):
        feed = {"articles": [
            {"headline": "Eagles QB Jalen Hurts on IR", "published": "2026-10-17T20:00:00Z",
             "categories": [athlete(4040715)]},
            {"headline": "Week 6 inactives", "published": "2026-10-18T11:00:00Z",
             "categories": [athlete(4040715), athlete(1), athlete(2), athlete(3)]},
            {"headline": "Old news", "published": "2026-09-01T00:00:00Z",
             "categories": [athlete(4040715)]},
        ]}
        with mock.patch.object(news.requests, "get", return_value=_Res(feed)):
            out = news.league_news("nfl", now=NOW)
        self.assertEqual(out, {"4040715": [{"headline": "Eagles QB Jalen Hurts on IR", "days": 0}]})

    def test_a_failing_feed_is_no_news(self):
        with mock.patch.object(news.requests, "get", side_effect=news.requests.ConnectionError("down")):
            self.assertEqual(news.league_news("nfl", now=NOW), {})


class PlayerNoteTest(unittest.TestCase):

    def test_the_players_own_note_not_a_column_that_mentions_him(self):
        feed = {"feed": [
            {"type": "Story", "headline": "Week 6 inactives", "published": "2026-10-18T11:00:00Z"},
            {"type": "Rotowire", "headline": "The Eagles placed Hurts (calf) on injured reserve",
             "published": "2026-10-17T20:00:00Z"},
        ]}
        news._player_cache.clear()
        with mock.patch.object(news.requests, "get", return_value=_Res(feed)):
            note = news.player_note("nfl", 4040715, now=NOW)
        self.assertEqual(note["headline"], "The Eagles placed Hurts (calf) on injured reserve")


def qb(name, rank, team="PHI", injury=None):
    return {"position": "QB", "fantasy_positions": ["QB"], "team": team, "search_rank": rank,
            "full_name": name, "injury_status": injury, "espn_id": rank, "active": True}


class TeamContextTest(unittest.TestCase):
    PLAYERS = {
        "hurts": qb("Jalen Hurts", 30, injury="IR"),
        "backup": qb("Tanner McKee", 400),
        "cooper": {"position": "WR", "fantasy_positions": ["WR"], "team": "PHI",
                   "full_name": "Darius Cooper", "search_rank": 658},
        "allen": qb("Josh Allen", 1, team="BUF"),
    }

    def build(self):
        note = lambda sport, espn_id: {"headline": "Hurts on IR", "days": 0}
        injuries = {pid: signals.injury_signal(p, 0) for pid, p in self.PLAYERS.items()}
        return signals.team_context(self.PLAYERS, injuries, "nfl", note=note)

    def test_the_best_ranked_qb_out_sets_the_teams_context(self):
        ctx = self.build()
        self.assertEqual(list(ctx), ["PHI"])
        self.assertEqual((ctx["PHI"]["name"], ctx["PHI"]["status"]), ("Jalen Hurts", "IR"))

    def test_receivers_carry_it_the_quarterbacks_do_not(self):
        with mock.patch.object(signals, "fetch_trending", return_value={}):
            sigs = signals.build_signals(self.PLAYERS, "nfl", headlines={}, contexts=self.build())
        self.assertEqual(sigs["cooper"]["context"]["name"], "Jalen Hurts")
        self.assertIn("QB fällt aus: Jalen Hurts (IR)", sigs["cooper"]["labels"])
        self.assertIsNone(sigs["hurts"]["context"])
        self.assertIsNone(sigs["backup"]["context"])

    def test_no_context_outside_the_nfl(self):
        self.assertEqual(signals.team_context(self.PLAYERS, {}, "nba"), {})


class ContextHoldTest(unittest.TestCase):
    """Cooper averaged 9.2 before Hurts went down; a starter's bar is 10 a week."""

    LEVELS = {"WR": {"pts": 170}}
    SIG = {"context": {"kind": "qb_out", "name": "Jalen Hurts", "status": "IR"}}

    def entry(self, avg):
        return {"pos": "WR", "pace_weeks": 17, "usage": {"avg_pts": avg}}

    def test_dynasty_holds_a_receiver_his_quarterback_left_behind(self):
        hold = api_core.context_hold(self.entry(9.2), self.SIG, self.LEVELS, api_core.DYNASTY)
        self.assertIn("Jalen Hurts", hold)

    def test_redraft_takes_the_forecast_as_it_stands(self):
        redraft = {"key": "redraft", **api_core.LEAGUE_PROFILES["redraft"]}
        self.assertIsNone(api_core.context_hold(self.entry(9.2), self.SIG, self.LEVELS, redraft))

    def test_a_player_who_was_not_producing_before_is_not_held(self):
        self.assertIsNone(api_core.context_hold(self.entry(2.0), self.SIG, self.LEVELS, api_core.DYNASTY))


if __name__ == "__main__":
    unittest.main()
