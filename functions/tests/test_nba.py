import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import api_core  # noqa: E402
import nba  # noqa: E402


def game(week, date, home, away, status="pre_game"):
    return {"week": week, "date": date, "status": status,
            "home": {"team": home}, "away": {"team": away}}


# Opening week starts on a Tuesday, week 2 runs Monday to Sunday.
SCHEDULE = [
    game(1, "2026-10-20", "DET", "BOS"),
    game(1, "2026-10-22", "BOS", "NYK"),
    game(1, "2026-10-25", "MIA", "BOS"),
    game(2, "2026-10-26", "BOS", "DET"),
    game(2, "2026-10-27", "BOS", "MIA"),
    game(2, "2026-11-01", "NYK", "DET", status="postponed"),
]

FLAT = {"a": 0.0, "b": 1.0, "b2b": 1.0, "sigma0": 7.0, "sigma1": 0.1, "dnp": 0.0}


class WeekTest(unittest.TestCase):

    def test_week_is_the_one_whose_games_are_not_over(self):
        self.assertEqual(nba.week_of(SCHEDULE, "2026-10-21"), 1)
        self.assertEqual(nba.week_of(SCHEDULE, "2026-10-25"), 1)
        # Monday before the first game of the week already belongs to it.
        self.assertEqual(nba.week_of(SCHEDULE, "2026-10-26"), 2)
        self.assertIsNone(nba.week_of(SCHEDULE, "2026-11-02"))

    def test_preseason_shows_week_one_only_shortly_before_opening_night(self):
        self.assertEqual(nba.week_of(SCHEDULE, "2026-10-12"), 1)
        self.assertIsNone(nba.week_of(SCHEDULE, "2026-09-30"))

    def test_team_games_skip_postponed_games(self):
        games = nba.team_games(SCHEDULE, 2)
        self.assertEqual(games["BOS"], [("2026-10-26", "DET"), ("2026-10-27", "MIA")])
        self.assertNotIn("NYK", games)

    def test_back_to_back(self):
        dates = nba.team_dates(SCHEDULE)["BOS"]
        self.assertTrue(nba.is_back_to_back(dates, "2026-10-27"))
        self.assertFalse(nba.is_back_to_back(dates, "2026-10-22"))


class LockInTest(unittest.TestCase):

    def test_one_game_is_worth_its_mean(self):
        value, thresholds = nba.lockin_value([(30.0, 10.0, 0.0)])
        self.assertAlmostEqual(value, 30.0)
        self.assertEqual(thresholds, [None])

    def test_more_games_are_worth_more_but_far_from_linear(self):
        one = nba.lockin_value([(30.0, 10.0, 0.0)])[0]
        two = nba.lockin_value([(30.0, 10.0, 0.0)] * 2)[0]
        four = nba.lockin_value([(30.0, 10.0, 0.0)] * 4)[0]
        self.assertGreater(two, one)
        self.assertGreater(four, two)
        self.assertLess(four, 1.5 * one)

    def test_threshold_is_what_the_rest_is_worth(self):
        value, thresholds = nba.lockin_value([(30.0, 10.0, 0.0), (30.0, 10.0, 0.0)])
        self.assertAlmostEqual(thresholds[0], 30.0)
        self.assertGreater(value, 30.0)

    def test_a_missed_last_game_counts_zero(self):
        value, _ = nba.lockin_value([(30.0, 10.0, 1.0)])
        self.assertEqual(value, 0.0)

    def test_out_sits_the_next_game_and_long_term_the_whole_week(self):
        self.assertEqual(nba.dnp_chances(3, {"severity": 3, "term": "short"}, FLAT),
                         [1.0, nba.OUT_LATER_DNP, nba.OUT_LATER_DNP])
        self.assertEqual(nba.dnp_chances(2, {"severity": 3, "term": "long"}, FLAT), [1.0, 1.0])
        self.assertEqual(nba.dnp_chances(2, {"severity": 1}, FLAT),
                         [nba.NEXT_GAME_DNP[1], 0.0])

    def test_lock_advice(self):
        self.assertTrue(nba.lock_advice(41.0, 33.0)["lock"])
        self.assertFalse(nba.lock_advice(22.0, 33.0)["lock"])
        self.assertTrue(nba.lock_advice(22.0, None)["final"])


class WeekFieldsTest(unittest.TestCase):
    """The NBA path of `_week_fields`, on a hand-built week."""

    def setUp(self):
        self._params = nba.PARAMS
        nba.PARAMS = dict(FLAT)

    def tearDown(self):
        nba.PARAMS = self._params

    def weekly(self, today, played=None):
        return {
            "sport": "nba", "pace_weeks": nba.SEASON_WEEKS, "week": 2, "weeks": [2, 3],
            "games": {2: {"1": [("2026-10-26", "DET", 30.0), ("2026-10-27", "MIA", 30.0)]},
                      3: {"1": [("2026-11-02", "NYK", 30.0)]}},
            "schedule": {2: {"BOS": [("2026-10-26", "DET"), ("2026-10-27", "MIA")]},
                         3: {"BOS": [("2026-11-02", "NYK")]}},
            "dates": {"BOS": {"2026-10-26", "2026-10-27", "2026-11-02"}},
            "played": played or {}, "today": today, "scale": 1.0,
        }

    def test_week_value_before_the_first_game(self):
        f = api_core._nba_week_fields("1", {"team": "BOS"}, None, self.weekly("2026-10-26"))
        self.assertEqual(f["games_week"], 2)
        self.assertGreater(f["pts_week"], 30.0)
        self.assertEqual(f["horizon"][1]["pts"], 30.0)
        self.assertEqual(f["pts_pace"], round((f["pts_week"] + 30.0) / 2 * nba.SEASON_WEEKS, 1))
        self.assertIsNone(f["lock"])
        self.assertFalse(f["bye"])

    def test_a_big_game_is_worth_locking(self):
        f = api_core._nba_week_fields("1", {"team": "BOS"}, None,
                                      self.weekly("2026-10-27", {"1": [("2026-10-26", 45.0)]}), starting=True)
        self.assertTrue(f["lock"]["lock"])
        self.assertEqual(f["pts_week"], 45.0)
        self.assertIn("jetzt einlocken", " ".join(f["forecast"]["explain"]))

    def test_a_poor_game_is_played_on(self):
        f = api_core._nba_week_fields("1", {"team": "BOS"}, None,
                                      self.weekly("2026-10-27", {"1": [("2026-10-26", 12.0)]}), starting=True)
        self.assertFalse(f["lock"]["lock"])
        self.assertEqual(f["pts_week"], 30.0)

    def test_after_his_last_game_the_score_stands(self):
        f = api_core._nba_week_fields(
            "1", {"team": "BOS"}, None,
            self.weekly("2026-10-28", {"1": [("2026-10-26", 12.0), ("2026-10-27", 20.0)]}),
            starting=True)
        self.assertTrue(f["locked"])
        self.assertEqual(f["pts_week"], 20.0)
        self.assertTrue(f["lock"]["final"])

    def test_no_game_this_week_is_a_bye(self):
        f = api_core._nba_week_fields("2", {"team": "LAL"}, None, self.weekly("2026-10-26"))
        self.assertTrue(f["bye"])
        self.assertEqual(f["pts_week"], 0.0)

    def test_lock_call_becomes_an_issue_for_a_starter(self):
        f = api_core._nba_week_fields("1", {"team": "BOS"}, None,
                                      self.weekly("2026-10-27", {"1": [("2026-10-26", 45.0)]}), starting=True)
        player = {"id": "1", "name": "A", "elig": {"PG"}, **f}
        current = [{"slot": "PG", "player": player}]
        issues = api_core.lineup_issues(current, 0.0, api_core.LINEUP_THRESHOLDS["nba"])
        self.assertEqual([i["kind"] for i in issues], ["lock"])
        self.assertEqual(api_core.lock_calls(current)[0]["name"], "A")


    def test_a_bench_game_cannot_be_locked_and_does_not_count(self):
        # 45 points from the bench last night: moving him up buys his last
        # game of the week, not that night.
        played = {"1": [("2026-10-26", 45.0)]}
        bench = api_core._nba_week_fields("1", {"team": "BOS"}, None,
                                          self.weekly("2026-10-27", played))
        starter = api_core._nba_week_fields("1", {"team": "BOS"}, None,
                                            self.weekly("2026-10-27", played), starting=True)
        self.assertIsNone(bench["lock"])
        self.assertEqual(bench["pts_week"], 30.0)
        self.assertEqual(starter["pts_week"], 45.0)
        self.assertEqual(bench["horizon"], starter["horizon"])

    def test_a_bench_week_that_is_over_counts_nothing(self):
        f = api_core._nba_week_fields(
            "1", {"team": "BOS"}, None,
            self.weekly("2026-10-28", {"1": [("2026-10-26", 12.0), ("2026-10-27", 40.0)]}))
        self.assertTrue(f["locked"])
        self.assertEqual(f["pts_week"], 0.0)
        self.assertIsNone(f["lock"])
        self.assertIn("zählen nicht", " ".join(f["forecast"]["explain"]))

    def test_optimizer_does_not_start_a_bench_player_for_last_night(self):
        weekly = self.weekly("2026-10-27", {"1": [("2026-10-26", 45.0)],
                                            "2": [("2026-10-26", 10.0)]})
        weekly["games"][2]["2"] = [("2026-10-27", "MIA", 31.0)]
        roster = {"players": ["1", "2"], "starters": ["2"]}
        players = {"1": {"first_name": "Bench", "last_name": "Star", "position": "PG",
                         "fantasy_positions": ["PG"], "team": "BOS", "sport": "nba"},
                   "2": {"first_name": "Starter", "last_name": "Guy", "position": "PG",
                         "fantasy_positions": ["PG"], "team": "BOS", "sport": "nba"}}
        inputs = (players, {}, {}, {}, {}, weekly)
        result = api_core._lineup_analysis(roster, ["PG", "BN"], inputs)
        self.assertEqual(result["changes"], [])

class YouthTest(unittest.TestCase):

    def test_nba_prospect_is_held_by_age_where_his_rank_is_low(self):
        lopez = {"sport": "nba", "years_exp": 0, "search_rank": 380, "age": 19}
        knecht = {"sport": "nba", "years_exp": 1, "search_rank": 415, "age": 25}
        self.assertTrue(api_core._young_asset(lopez))
        self.assertFalse(api_core._young_asset(knecht))

    def test_nfl_rule_is_unchanged(self):
        self.assertTrue(api_core._young_asset({"years_exp": 1, "search_rank": 550, "age": 24}))
        self.assertFalse(api_core._young_asset({"years_exp": 1, "search_rank": 650, "age": 21}))


if __name__ == "__main__":
    unittest.main()
