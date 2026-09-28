import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import api_core  # noqa: E402
import forecast  # noqa: E402


class XfpTest(unittest.TestCase):

    def test_fit_recovers_a_linear_scoring(self):
        rows = []
        for i in range(60):
            stats = {"rec_tgt": i % 12, "rec_rz_tgt": i % 3, "off_snp": 20 + i % 40}
            pts = 1.5 * stats["rec_tgt"] + 2.0 * stats["rec_rz_tgt"] + 1.0
            rows.append(("WR", stats, pts))
        model = forecast.fit_xfp(rows)
        self.assertAlmostEqual(forecast.xfp({"rec_tgt": 8, "rec_rz_tgt": 1, "off_snp": 40},
                                            "WR", model), 15.0, delta=0.2)

    def test_too_few_rows_no_model(self):
        self.assertEqual(forecast.fit_xfp([("WR", {"rec_tgt": 5, "off_snp": 30}, 10.0)]), {})
        self.assertIsNone(forecast.xfp({"rec_tgt": 5}, "WR", {}))

    def test_form_blends_actual_and_expected(self):
        f, n = forecast.form([30.0, 2.0], [12.0, 10.0], lam=0.5)
        self.assertEqual(n, 2)
        self.assertAlmostEqual(f, (21.0 + 6.0) / 2)
        # Without xFP for every game, actual points only.
        self.assertEqual(forecast.form([30.0, 2.0], [12.0, None], lam=0.0)[0], 16.0)


class SpreadTest(unittest.TestCase):

    def test_spread_starts_at_the_position_and_learns(self):
        base = forecast.SIGMA["WR"]
        self.assertEqual(forecast.spread("WR", [10.0]), round(base, 1))
        steady = forecast.spread("WR", [10, 10, 10, 10, 10, 10, 10, 10])
        wild = forecast.spread("WR", [0, 25, 2, 30, 1, 28, 3, 27])
        self.assertLess(steady, base)
        self.assertGreater(wild, base)

    def _change(self, a_pts, b_pts, a_weeks, b_weeks):
        mk = lambda name, pts, weeks: {"name": name, "pos": "WR", "real_pos": "WR", "pts_week": pts,
                                       "usage": {"pts_by_week": dict(enumerate(weeks))}}
        return [{"in": mk("Steady", a_pts, a_weeks), "out": mk("Boom", b_pts, b_weeks)}]

    def test_favorite_takes_the_floor_underdog_the_ceiling(self):
        changes = self._change(10.4, 10.0, [10] * 8, [0, 25, 2, 30, 1, 28, 3, 27])
        fav = api_core.close_calls(changes, {"kind": "favorite", "margin": 14.0})[0]
        dog = api_core.close_calls(changes, {"kind": "underdog", "margin": -12.0})[0]
        even = api_core.close_calls(changes, {"kind": "even", "margin": 3.0})[0]
        chop = api_core.close_calls(changes, {"kind": "chopped", "margin": None})[0]
        self.assertEqual(fav["pick"], "Steady")
        self.assertEqual(dog["pick"], "Boom")
        self.assertIsNone(even["pick"])
        self.assertEqual(chop["pick"], "Steady")

    def test_clear_gap_is_no_close_call(self):
        self.assertEqual(api_core.close_calls(self._change(14.0, 10.0, [10], [10]),
                                              {"kind": "favorite", "margin": 20}), [])


if __name__ == "__main__":
    unittest.main()
