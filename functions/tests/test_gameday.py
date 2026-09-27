import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import gameday  # noqa: E402

# The shape of The Odds API v4 /sports/americanfootball_nfl/odds.
EVENT = {
    "id": "x", "commence_time": "2026-09-27T17:00:00Z",
    "home_team": "Buffalo Bills", "away_team": "Los Angeles Chargers",
    "bookmakers": [
        {"markets": [
            {"key": "spreads", "outcomes": [{"name": "Buffalo Bills", "point": -3.5},
                                            {"name": "Los Angeles Chargers", "point": 3.5}]},
            {"key": "totals", "outcomes": [{"name": "Over", "point": 47.5},
                                           {"name": "Under", "point": 47.5}]},
        ]},
        {"markets": [
            {"key": "spreads", "outcomes": [{"name": "Buffalo Bills", "point": -2.5},
                                            {"name": "Los Angeles Chargers", "point": 2.5}]},
            {"key": "totals", "outcomes": [{"name": "Over", "point": 46.5}]},
        ]},
    ],
}


class GamedayTest(unittest.TestCase):

    def test_implied_totals_from_the_consensus_line(self):
        with mock.patch.object(gameday, "_get_json", return_value=[EVENT]):
            odds = gameday.fetch_odds("key")
        # Median total 47.0, median home spread -3.0.
        self.assertEqual(odds["BUF"]["implied"], 25.0)
        self.assertEqual(odds["LAC"]["implied"], 22.0)
        self.assertEqual(odds["LAC"]["opp"], "BUF")
        self.assertEqual(odds["BUF"]["kickoff"], "2026-09-27T17:00:00Z")

    def test_no_key_no_request(self):
        with mock.patch.object(gameday, "_get_json") as get:
            self.assertEqual(gameday.fetch_odds(""), {})
            get.assert_not_called()

    def test_vegas_ratio(self):
        odds = {"BUF": {"implied": 25.0}, "LAC": {"implied": 22.0}, "KC": {"implied": 23.5}}
        self.assertAlmostEqual(gameday.vegas_ratio(odds, "BUF"), 25 / 23.5, places=3)
        self.assertIsNone(gameday.vegas_ratio(odds, "NYJ"))
        self.assertIsNone(gameday.vegas_ratio({}, "BUF"))

    def test_game_window_uses_kickoff_when_known(self):
        game = {"home": "BUF", "away": "LAC", "date": "2026-09-27"}
        window, exact = gameday._window(game, {"BUF": "2026-09-27T17:00:00Z"})
        self.assertTrue(exact)
        self.assertEqual(window, ["2026-09-27T17:00", "2026-09-27T18:00", "2026-09-27T19:00"])
        window, exact = gameday._window(game, None)
        self.assertFalse(exact)
        self.assertEqual(window[0], "2026-09-27T17:00")
        self.assertEqual(window[-1], "2026-09-28T00:00")

    def test_roofs_get_no_weather(self):
        with mock.patch.object(gameday, "_get_json") as get:
            wx = gameday.fetch_weather([{"home": "DET", "away": "GB", "date": "2026-09-27"}])
            get.assert_not_called()
        self.assertTrue(wx["GB"]["dome"])


if __name__ == "__main__":
    unittest.main()
