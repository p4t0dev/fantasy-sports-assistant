import io
import os
import sys
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import sleeper_api  # noqa: E402


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class MakeRequestTest(unittest.TestCase):

    @mock.patch("time.sleep", lambda s: None)
    def test_dropped_connection_is_retried(self):
        calls = [urllib.error.URLError("EOF"), _Response(b'{"ok": 1}')]
        with mock.patch("urllib.request.urlopen", side_effect=calls) as urlopen:
            self.assertEqual(sleeper_api._make_request("https://x"), {"ok": 1})
            self.assertEqual(urlopen.call_count, 2)

    @mock.patch("time.sleep", lambda s: None)
    def test_http_error_is_an_answer(self):
        err = urllib.error.HTTPError("https://x", 404, "Not Found", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=[err]) as urlopen:
            self.assertIsNone(sleeper_api._make_request("https://x"))
            self.assertEqual(urlopen.call_count, 1)

    @mock.patch("time.sleep", lambda s: None)
    def test_gives_up_after_the_last_attempt(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("x")) as urlopen:
            self.assertIsNone(sleeper_api._make_request("https://x", attempts=3))
            self.assertEqual(urlopen.call_count, 3)


if __name__ == "__main__":
    unittest.main()
