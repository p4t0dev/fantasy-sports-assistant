import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import forecast  # noqa: E402

PARAMS = {"k": 4.0, "cap": 0.5, "s_share": 0.75, "beta": 1.0, "alpha": 1.0}
SLEEPER_ONLY = {"k": 4.0, "cap": 0.0, "s_share": 1.0, "beta": 0.0, "alpha": 0.0}


class ForecastTest(unittest.TestCase):

    def setUp(self):
        self._saved = dict(forecast.PARAMS)
        forecast.PARAMS["WR"] = dict(PARAMS)
        forecast.PARAMS["QB"] = dict(SLEEPER_ONLY)

    def tearDown(self):
        forecast.PARAMS.clear()
        forecast.PARAMS.update(self._saved)

    def test_weights_sum_to_one_and_form_grows_with_games(self):
        previous = -1
        for n in range(0, 10):
            g_s, g_f, g_q = forecast.weights(n, PARAMS)
            self.assertAlmostEqual(g_s + g_f + g_q, 1.0, places=2)
            self.assertGreaterEqual(g_f, previous)
            self.assertLessEqual(g_f, PARAMS["cap"])
            previous = g_f

    def test_sleeper_only_is_sleeper(self):
        fc = forecast.forecast("QB", 20.0, [30.0, 35.0], 25.0)
        self.assertEqual(fc["P"], 20.0)
        self.assertEqual(fc["explain"][0], "Basis 20.0 = 100 % Sleeper 20.0")

    def test_base_blends_the_three_estimates(self):
        fc = forecast.forecast("WR", 10.0, [20.0, 20.0], 12.0)
        g = fc["weights"]
        self.assertAlmostEqual(fc["B"], g["S"] * 10 + g["F"] * 20 + g["Q"] * 12, places=1)
        self.assertGreater(fc["P"], 10.0)

    def test_missing_projection_rests_on_form_and_quality(self):
        fc = forecast.forecast("WR", None, [4.0, 13.0], 9.8)
        self.assertEqual(fc["weights"]["S"], 0.0)
        self.assertGreater(fc["P"], 0)
        self.assertNotIn("Sleeper", fc["explain"][0])

    def test_corrections_are_capped(self):
        fc = forecast.forecast("WR", 10.0, [], None, usage_adj=1.5, allowed=40.0,
                               league_avg=10.0, opp_games=20,
                               wx={"wind": 50, "precip": 5})
        self.assertLessEqual(fc["R"], 1 + forecast.ROLE_MAX)
        self.assertLessEqual(fc["M"], 1 + forecast.MATCHUP_MAX)
        self.assertGreaterEqual(fc["K"], forecast.K_MIN)
        self.assertLessEqual(fc["K"], forecast.K_MAX)

    def test_early_season_matchup_is_pulled_to_the_average(self):
        early = forecast.matchup_factor(11.0, 10.0, 1, PARAMS)
        late = forecast.matchup_factor(11.0, 10.0, 12, PARAMS)
        self.assertLess(early, late)

    def test_dome_means_no_weather(self):
        self.assertEqual(forecast.weather_factor("K", {"dome": True})[0], 1.0)
        self.assertLess(forecast.weather_factor("K", {"wind": 45})[0], 1.0)
        self.assertGreater(forecast.weather_factor("RB", {"wind": 45})[0], 1.0)

    def test_out_scores_nothing_and_says_why(self):
        fc = forecast.forecast("WR", 12.0, [10.0], 11.0,
                               injury={"severity": 3, "status": "Out"})
        self.assertEqual(fc["P"], 0.0)
        self.assertTrue(any("Out" in line for line in fc["explain"]))

    def test_questionable_is_flagged_not_discounted(self):
        fc = forecast.forecast("QB", 20.0, [], None,
                               injury={"severity": 1, "status": "Questionable"})
        self.assertEqual(fc["P"], 20.0)
        self.assertTrue(any("Inactives" in line for line in fc["explain"]))

    def test_points_allowed(self):
        per_game, avg, games = forecast.points_allowed([
            (1, "AAA", "WR", 30.0), (1, "AAA", "WR", 10.0), (2, "AAA", "WR", 20.0),
            (1, "BBB", "WR", 20.0),
        ])
        self.assertEqual(per_game[("AAA", "WR")], 30.0)
        self.assertEqual(games["AAA"], 2)
        self.assertEqual(avg["WR"], 25.0)


if __name__ == "__main__":
    unittest.main()
