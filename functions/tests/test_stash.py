import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import api_core  # noqa: E402


def player(pid, pos, pts, **extra):
    return {"id": pid, "name": pid, "pos": pos, "elig": {pos}, "pts_week": pts, **extra}


POSITIONS = ["QB", "WR", "SUPER_FLEX", "BN"]
ROSTER = {"players": ["qb", "hurts", "wr", "bn", "rookie", "hurt"],
          "starters": ["qb", "wr", "hurts"],
          "taxi": ["rookie"], "reserve": ["hurt"]}


def league(deadline):
    return {"settings": {"taxi_deadline": deadline}}


class StashTest(unittest.TestCase):
    """The Year 3 Dynasty case: the SUPERFLEX starter is out, and the only
    player who could replace him sits on the taxi squad of a full roster."""

    def setUp(self):
        self.squad = [player("qb", "QB", 18.0), player("hurts", "QB", 0.0),
                      player("wr", "WR", 12.0), player("bn", "QB", 0.0)]
        self.stashed = [player("rookie", "WR", 9.6, stash="taxi"),
                        player("hurt", "WR", 7.0, stash="ir")]
        self.current = api_core.current_lineup(ROSTER, POSITIONS, self.squad)
        self.report = api_core.best_lineup_now(self.squad, POSITIONS, self.current)

    def test_taxi_and_ir_are_split_off(self):
        self.assertEqual(api_core.roster_stash(ROSTER), {"rookie": "taxi", "hurt": "ir"})

    def test_rules_read_a_full_roster_and_a_passed_deadline(self):
        rules = api_core.activation_rules(league(4), ROSTER, POSITIONS, 6)
        self.assertTrue(rules["roster_full"])
        self.assertTrue(rules["taxi_closed"])
        self.assertFalse(api_core.activation_rules(league(0), ROSTER, POSITIONS, 6)["taxi_closed"])
        self.assertFalse(api_core.activation_rules(league(4), ROSTER, POSITIONS, 3)["taxi_closed"])

    def test_taxi_player_is_an_option_not_a_swap(self):
        changes = api_core.lineup_changes(self.current, self.report["slots"], api_core._week_value)
        self.assertEqual(changes, [])
        rules = api_core.activation_rules(league(4), ROSTER, POSITIONS, 6)
        options = api_core.activation_options(self.stashed, self.squad, POSITIONS,
                                              self.current, self.report, rules)
        self.assertEqual([o["player"]["id"] for o in options], ["rookie", "hurt"])
        rookie = options[0]
        self.assertEqual(rookie["gain"], 9.6)
        self.assertEqual(rookie["out"]["id"], "hurts")
        self.assertTrue(rookie["needs_drop"])
        self.assertTrue(rookie["permanent"])
        self.assertFalse(options[1]["permanent"])

    def test_activation_is_never_more_than_worth_a_look(self):
        rules = api_core.activation_rules(league(4), ROSTER, POSITIONS, 6)
        options = api_core.activation_options(self.stashed, self.squad, POSITIONS,
                                              self.current, self.report, rules)
        issues = api_core.lineup_issues(self.current, 0.0, activations=options)
        kinds = [(i["kind"], i["severity"]) for i in issues]
        self.assertIn(("activation", 1), kinds)
        self.assertNotIn("bench", [k for k, _ in kinds])


class ActivationDropTest(unittest.TestCase):
    """Wheely Fun League: Cameron comes up from the taxi squad on a full
    roster. The drop is the drop list's first name - a teamless free agent -
    not the starter he pushes out of the lineup."""

    def test_the_most_expendable_unprotected_player_goes(self):
        active = [
            fa("cox", "LB", 3.7, pace=60, dvs=90),
            fa("hemby", "RB", 0.0, pace=0, dvs=110),
            fa("hankerson", "RB", 0.0, pace=0, dvs=20, team="FA"),
            fa("rookie", "WR", 0.0, pace=0, dvs=5, protected="Junges Asset mit Draft-Kapital — halten"),
        ]
        self.assertEqual(api_core.activation_drop(active, starting={"cox"})["id"], "hankerson")

    def test_never_someone_who_starts_after_the_activation(self):
        active = [fa("hankerson", "RB", 0.0, pace=0, dvs=20), fa("cox", "LB", 3.7, pace=60, dvs=90)]
        self.assertEqual(api_core.activation_drop(active, starting={"hankerson"})["id"], "cox")

    def test_none_when_everyone_is_protected(self):
        active = [fa("rookie", "WR", 0.0, pace=0, dvs=5, protected="halten")]
        self.assertIsNone(api_core.activation_drop(active, starting=set()))


class RecentRoleTest(unittest.TestCase):
    """Darius Cooper: 19.1 and 15.6 on 86 % of the snaps, forecast 4.9 a week."""

    LEVELS = {"WR": {"pts": 170}}  # 10 a week over 17

    def entry(self, weeks, snaps):
        return {"pos": "WR", "pace_weeks": 17,
                "usage": {"pts_by_week": weeks, "snap_pct": snaps}}

    def test_a_breakout_is_held(self):
        e = self.entry({"1": 0.0, "2": 11.1, "3": 0.0, "4": 19.1, "5": 15.6}, 0.855)
        self.assertIn("Zuletzt starke Rolle", api_core.recent_role(e, self.LEVELS))

    def test_snaps_without_points_are_not_a_role(self):
        self.assertIsNone(api_core.recent_role(self.entry({"4": 1.0, "5": 2.0}, 0.9), self.LEVELS))

    def test_a_quiet_bench_player_is_not_held(self):
        self.assertIsNone(api_core.recent_role(self.entry({"4": 3.0, "5": 2.0}, 0.3), self.LEVELS))


class LineupTieTest(unittest.TestCase):
    """Hurts is out (0), Reed on bye (0): nothing to gain, so no change."""

    def lineup(self, reed_pts):
        squad = [player("reed", "WR", reed_pts), player("hurts", "QB", 0.0),
                 player("maye", "QB", 19.4)]
        roster = {"starters": ["maye", "hurts"]}
        current = api_core.current_lineup(roster, ["QB", "SUPER_FLEX"], squad)
        report = api_core.best_lineup_now(squad, ["QB", "SUPER_FLEX"], current)
        return api_core.lineup_changes(current, report["slots"], api_core._week_value)

    def test_a_tie_keeps_the_starter(self):
        self.assertEqual(self.lineup(0.0), [])

    def test_a_real_gain_still_swaps(self):
        changes = self.lineup(8.0)
        self.assertEqual([(c["in"]["id"], c["out"]["id"]) for c in changes], [("reed", "hurts")])


def fa(pid, pos, week, pace, dvs, **extra):
    """A waiver-board entry: `pts` is the season-scale pace, `pts_week` this week."""
    return {**player(pid, pos, week), "pts": pace, "dvs": dvs, **extra}


class WeekFixTest(unittest.TestCase):
    """Hurts is out and nobody on the bench can play QB: a free agent fills
    the week, paid for with a drop that costs nothing beyond it."""

    POSITIONS = ["QB", "SUPER_FLEX", "WR", "BN", "BN"]
    LEVELS = {"QB": {"pts": 100, "dvs": 150}, "WR": {"pts": 100, "dvs": 150}}

    def roster(self, junk_dvs=40):
        return [
            fa("maye", "QB", 19.4, pace=300, dvs=400),
            fa("hurts", "QB", 0.0, pace=250, dvs=350, protected="Fällt nur kurz aus — halten"),
            fa("wr1", "WR", 12.0, pace=200, dvs=300),
            fa("rookie", "WR", 0.0, pace=10, dvs=120, protected="Junges Asset mit Draft-Kapital — halten"),
            fa("junk", "WR", 0.0, pace=8, dvs=junk_dvs),
        ]

    def fixes(self, roster=None, available=None, held=frozenset(), open_spot=False):
        roster = roster or self.roster()
        current = api_core.current_lineup({"starters": ["maye", "hurts", "wr1"]},
                                          self.POSITIONS, roster)
        available = available if available is not None else [
            fa("huntley", "QB", 13.0, pace=60, dvs=50),
            fa("played", "QB", 20.0, pace=60, dvs=50, locked=True),
            fa("held", "QB", 18.0, pace=60, dvs=50),
            # On the wire, not playing this week: what "junk" can be replaced by.
            fa("spare_wr", "WR", 0.0, pace=10, dvs=60),
        ]
        return api_core.week_fix_moves(roster, available, self.POSITIONS, current, self.LEVELS,
                                       profile=api_core.DYNASTY, held=held, open_spot=open_spot)

    def test_a_free_agent_fills_the_hole_for_the_cheapest_drop(self):
        fixes = self.fixes(held={"held"})
        self.assertEqual([(f["add"]["id"], f["drop"]["id"]) for f in fixes], [("huntley", "junk")])
        self.assertEqual(fixes[0]["gain"], 13.0)
        self.assertEqual((fixes[0]["out"]["id"], fixes[0]["slot"]), ("hurts", "SUPER_FLEX"))

    def test_players_who_cannot_be_added_now_are_skipped(self):
        added = {f["add"]["id"] for f in self.fixes(held={"held"})}
        self.assertNotIn("played", added)
        self.assertNotIn("held", added)

    def test_no_drop_with_value_above_replacement(self):
        self.assertEqual(self.fixes(roster=self.roster(junk_dvs=200), held={"held"}), [])

    def test_a_thin_wire_protects_the_bench(self):
        # Deep league: nothing at WR to be had, so even "junk" is worth keeping.
        thin = [fa("huntley", "QB", 13.0, pace=60, dvs=50)]
        self.assertEqual(self.fixes(available=thin), [])

    def test_an_open_spot_needs_no_drop(self):
        fixes = self.fixes(held={"held"}, open_spot=True)
        self.assertIsNone(fixes[0]["drop"])

    def test_a_small_gain_is_no_reason_to_move(self):
        self.assertEqual(self.fixes(available=[fa("backup", "QB", 3.0, pace=20, dvs=10)]), [])


class OnWaiversTest(unittest.TestCase):

    def test_recent_drops_are_held_older_ones_are_free(self):
        day = 86_400_000
        now = 100 * day
        txs = {6: [{"status": "complete", "drops": {"recent": 1}, "status_updated": now - day}],
               5: [{"status": "complete", "drops": {"old": 2}, "status_updated": now - 3 * day},
                   {"status": "failed", "drops": {"failed": 3}, "status_updated": now - day}]}
        league = {"league_id": "L", "settings": {"waiver_clear_days": 2}}
        with mock.patch.object(api_core.sleeper_api, "get_transactions",
                               side_effect=lambda _, rnd: txs.get(rnd, [])):
            self.assertEqual(api_core.on_waivers(league, 6, now_ms=now), {"recent"})


class CloseCallTest(unittest.TestCase):

    def test_a_player_on_bye_is_no_close_call(self):
        walker = player("walker", "WR", 0.9, spread=5.1)
        chase = player("chase", "WR", 0.0, spread=9.7, bye=True)
        calls = api_core.close_calls([{"in": walker, "out": chase}],
                                     {"kind": "underdog", "margin": -46.2})
        self.assertEqual(calls, [])


def db_player(pos, rank, **extra):
    return {"position": pos, "fantasy_positions": [pos], "team": "PHI", "age": 26,
            "years_exp": 4, "search_rank": rank, "status": "Active", "full_name": pos + str(rank),
            **extra}


class WaiverStashTest(unittest.TestCase):
    """Taxi and IR players are owned but not active: no slot, no depth, and
    dropping one frees no active spot for a claim."""

    PLAYERS = {"qb": db_player("QB", 10), "wr1": db_player("WR", 20), "wr2": db_player("WR", 30),
               "bn": db_player("WR", 400), "taxi": db_player("WR", 500, years_exp=0),
               "ir": db_player("WR", 600, injury_status="IR")}
    LEAGUE = {"league_id": "L", "roster_positions": ["QB", "WR", "WR", "BN"],
              "scoring_settings": {}, "settings": {"taxi_deadline": 4}, "total_rosters": 1}
    ROSTER = {"owner_id": "u", "roster_id": 1, "players": list(PLAYERS),
              "starters": ["qb", "wr1", "wr2"], "taxi": ["taxi"], "reserve": ["ir"]}

    def analyze(self):
        inputs = (self.PLAYERS, {}, {}, {}, {}, None)
        with mock.patch.object(api_core.sleeper_api, "get_rosters", return_value=[self.ROSTER]), \
             mock.patch.object(api_core.sleeper_api, "get_state", return_value={"week": 6}), \
             mock.patch.object(api_core.signals, "league_activity", return_value=None):
            return api_core.analyze_waivers_api("me", "L", "nfl", user={"user_id": "u"},
                                                league_info=self.LEAGUE, inputs=inputs)

    def test_taxi_and_ir_are_neither_drops_nor_lineup(self):
        result = self.analyze()
        drops = {p["id"] for p in result["drop_candidates"]}
        self.assertEqual(drops, {"qb", "wr1", "wr2", "bn"})
        self.assertEqual({p["id"] for p in result["stashed"]}, {"taxi", "ir"})
        seated = {s["player"]["id"] for s in result["lineup"]["slots"] if s["player"]}
        benched = {p["id"] for p in result["lineup"]["bench"]}
        self.assertFalse({"taxi", "ir"} & (seated | benched))

    def test_depth_counts_active_players_only(self):
        wr = next(d for d in self.analyze()["roster_depth"] if d["pos"] == "WR")
        self.assertEqual(wr["count"], 3)


if __name__ == "__main__":
    unittest.main()
