import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import usage  # noqa: E402


def row(team, snaps, team_snaps=60, rush=0, tgt=0, rec=0, pts=0.0):
    return {"team": team, "stats": {"off_snp": snaps, "tm_off_snp": team_snaps,
                                    "rush_att": rush, "rec_tgt": tgt, "rec": rec,
                                    "_pts": pts}}


PLAYERS = {
    "rb1": {"position": "RB", "full_name": "Starter Back", "depth_chart_order": 1},
    "rb2": {"position": "RB", "full_name": "Backup Back", "depth_chart_order": 2},
    "wr1": {"position": "WR", "full_name": "Alpha Receiver", "depth_chart_order": 1},
    "wr2": {"position": "WR", "full_name": "Slot Receiver", "depth_chart_order": 1},
    "wr3": {"position": "WR", "full_name": "Rising Receiver", "depth_chart_order": 1},
    "qb1": {"position": "QB", "full_name": "Quarterback", "depth_chart_order": 1},
}


def score(pid, stats):
    return stats.get("_pts", 0.0)


def never_out(pid):
    return False


class UsageTest(unittest.TestCase):

    def test_backup_who_took_over_is_promoted(self):
        weeks = {
            "1": {"rb1": row("AAA", 45, rush=18, tgt=4), "rb2": row("AAA", 15, rush=5, tgt=1)},
            "2": {"rb1": row("AAA", 20, rush=6, tgt=1), "rb2": row("AAA", 42, rush=19, tgt=5)},
        }
        out = usage.build_usage(weeks, PLAYERS, score, never_out)
        self.assertEqual(out["rb2"]["rank_prev"], 2)
        self.assertEqual(out["rb2"]["rank"], 1)
        self.assertEqual(out["rb2"]["role_shift"], 1)
        self.assertGreater(out["rb2"]["adj"], 1.0)
        self.assertLessEqual(out["rb2"]["adj"], 1 + usage.MAX_ADJ)
        self.assertLess(out["rb1"]["adj"], 1.0)
        self.assertGreaterEqual(out["rb1"]["adj"], 1 - usage.MAX_ADJ)
        self.assertIn("RB2 → RB1", out["rb2"]["label"])

    def test_fill_in_for_a_starter_who_is_back_is_not_a_promotion(self):
        # rb1 sat week 2; rb2 led the backfield. rb1 is healthy again.
        weeks = {
            "1": {"rb1": row("AAA", 45, rush=18), "rb2": row("AAA", 30, rush=6)},
            "2": {"rb2": row("AAA", 30, rush=20)},
        }
        out = usage.build_usage(weeks, PLAYERS, score, never_out)
        self.assertEqual(out["rb2"]["role_shift"], 0)
        self.assertEqual(out["rb2"]["filled_in_for"], ["rb1"])
        self.assertIn("Vertretung für Starter Back", out["rb2"]["label"])
        # Nor do the snaps and touches that came with the stand-in job count.
        self.assertEqual(out["rb2"]["adj"], 1.0)
        # rb1 missed the latest game: his old usage says nothing about now.
        self.assertFalse(out["rb1"]["current"])
        self.assertEqual(out["rb1"]["adj"], 1.0)

    def test_fill_in_keeps_the_job_while_the_starter_stays_out(self):
        weeks = {
            "1": {"rb1": row("AAA", 45, rush=18), "rb2": row("AAA", 30, rush=6)},
            "2": {"rb2": row("AAA", 30, rush=20)},
        }
        out = usage.build_usage(weeks, PLAYERS, score, lambda pid: pid == "rb1")
        self.assertEqual(out["rb2"]["role_shift"], 1)
        self.assertGreater(out["rb2"]["adj"], 1.0)

    def test_receiver_snap_share_growth(self):
        weeks = {
            "1": {"wr1": row("BBB", 58, tgt=9), "wr2": row("BBB", 45, tgt=6),
                  "wr3": row("BBB", 20, tgt=2)},
            "2": {"wr1": row("BBB", 58, tgt=10), "wr2": row("BBB", 30, tgt=3),
                  "wr3": row("BBB", 52, tgt=7)},
        }
        out = usage.build_usage(weeks, PLAYERS, score, never_out)
        self.assertEqual((out["wr3"]["rank_prev"], out["wr3"]["rank"]), (3, 2))
        self.assertEqual(out["wr3"]["adj"], 1 + usage.MAX_ADJ)  # capped
        self.assertLess(out["wr2"]["adj"], 1.0)
        self.assertEqual(out["wr1"]["adj"], 1.0)
        self.assertIn("WR3 → WR2", out["wr3"]["label"])

    def test_one_game_is_reported_but_not_adjusted(self):
        weeks = {"1": {"rb2": row("AAA", 40, rush=15, pts=21.5)}}
        out = usage.build_usage(weeks, PLAYERS, score, never_out)
        self.assertEqual(out["rb2"]["adj"], 1.0)
        self.assertEqual(out["rb2"]["avg_pts"], 21.5)

    def test_quarterbacks_are_never_adjusted(self):
        weeks = {"1": {"qb1": row("AAA", 30)}, "2": {"qb1": row("AAA", 60)}}
        out = usage.build_usage(weeks, PLAYERS, score, never_out)
        self.assertEqual(out["qb1"]["adj"], 1.0)

    def test_team_on_bye_last_week_keeps_its_usage_current(self):
        weeks = {
            "1": {"rb1": row("AAA", 45, rush=18), "rb2": row("AAA", 15, rush=5)},
            "2": {"rb1": row("AAA", 50, rush=20), "rb2": row("AAA", 10, rush=3)},
            "3": {"wr1": row("BBB", 58, tgt=9)},  # AAA on bye in week 3
        }
        out = usage.build_usage(weeks, PLAYERS, score, never_out)
        self.assertTrue(out["rb1"]["current"])

    def test_no_played_weeks(self):
        self.assertEqual(usage.build_usage({}, PLAYERS, score, never_out), {})
        self.assertEqual(usage.build_usage(None, PLAYERS, score, never_out), {})


if __name__ == "__main__":
    unittest.main()
