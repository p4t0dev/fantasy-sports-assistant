import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import api_core  # noqa: E402
import projections  # noqa: E402

ROWS = [
    {"player_id": "1", "team": "PHI", "opponent": "CHI", "date": "2026-09-28",
     "stats": {"adp_dd_ppr": 40, "idp_tkl": 5.0}},
    # Not projected: only the draft market fields, no opponent.
    {"player_id": "2", "team": "PHI", "opponent": None, "stats": {"adp_dd_ppr": 300}},
]


class WaiverHorizonTest(unittest.TestCase):

    def test_unprojected_rows_are_left_out_not_stored_as_zero(self):
        with mock.patch.object(projections, "_fetch_rows", return_value=ROWS):
            week = projections.fetch_week_projections("nfl", "2026", 3)
        self.assertEqual(week["stats"], {"1": {"idp_tkl": 5.0}})
        self.assertEqual(week["opp"], {"PHI": "CHI"})

    def test_overlooked_needs_real_snaps_in_the_latest_game(self):
        active = {"status": "Active"}
        starter = {"current": True, "snap_pct": 0.79}
        self.assertTrue(api_core._overlooked(active, starter, {}))
        self.assertFalse(api_core._overlooked(active, {"current": True, "snap_pct": 0.3}, {}))
        self.assertFalse(api_core._overlooked(active, {"current": False, "snap_pct": 0.9}, {}))
        self.assertFalse(api_core._overlooked(active, None, {}))
        self.assertFalse(api_core._overlooked({"status": "Inactive"}, starter, {}))
        self.assertFalse(api_core._overlooked(active, starter, {"severity": 3}))

    def test_short_injury_protects_a_valuable_player(self):
        sig = {"injury": {"term": "short", "severity": 3},
               "opportunity": {"score": 0}}
        player = {"years_exp": 8, "search_rank": 9999, "position": "DL",
                  "fantasy_positions": ["DL"]}
        levels = {"DL": {"dvs": 150, "pts": 200}}
        self.assertEqual(api_core.drop_protection(player, 135, 110, sig, levels),
                         "Fällt nur kurz aus — halten")
        self.assertIsNone(api_core.drop_protection(player, 50, 110, sig, levels))


if __name__ == "__main__":
    unittest.main()
