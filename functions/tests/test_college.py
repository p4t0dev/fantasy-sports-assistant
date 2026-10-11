import os
import sys
import unittest
from unittest import mock

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import api_core  # noqa: E402

SEARCH = {"results": [{"type": "player", "contents": [
    {"sport": "football", "link": {"web": "https://www.espn.com/nfl/player/_/id/4605951/x"}}]}]}
STATS = {"categories": [{"name": "receiving", "labels": ["YDS", "TD"], "totals": ["2,991", "24"]}]}


class _Res:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


class EspnTest(unittest.TestCase):

    def test_stats_are_parsed(self):
        with mock.patch.object(requests, "get", side_effect=[_Res(200, SEARCH), _Res(200, STATS)]):
            self.assertEqual(api_core.fetch_espn_college_stats("X"),
                             {"RECEIVING_YDS": 2991.0, "RECEIVING_TD": 24.0})

    def test_no_player_is_a_miss(self):
        with mock.patch.object(requests, "get", return_value=_Res(200, {"results": []})):
            self.assertIsNone(api_core.fetch_espn_college_stats("X"))
        with mock.patch.object(requests, "get", side_effect=[_Res(200, SEARCH), _Res(404)]):
            self.assertIsNone(api_core.fetch_espn_college_stats("X"))

    def test_network_and_server_errors_are_not_a_miss(self):
        with mock.patch.object(requests, "get", side_effect=requests.ConnectionError("down")):
            with self.assertRaises(api_core.EspnUnavailable):
                api_core.fetch_espn_college_stats("X")
        with mock.patch.object(requests, "get", return_value=_Res(503)):
            with self.assertRaises(api_core.EspnUnavailable):
                api_core.fetch_espn_college_stats("X")

    def test_which_entries_are_due(self):
        now = 1_800_000_000
        self.assertTrue(api_core._college_due(None, now))
        self.assertFalse(api_core._college_due({"RECEIVING_YDS": 100.0}, now))
        # Old misses carry no date - among them every stored network error.
        self.assertTrue(api_core._college_due({"_not_found": True}, now))
        self.assertFalse(api_core._college_due({"_not_found": True, "_checked": now - 86400}, now))
        self.assertTrue(api_core._college_due({"_not_found": True, "_checked": now - 40 * 86400}, now))


if __name__ == "__main__":
    unittest.main()
