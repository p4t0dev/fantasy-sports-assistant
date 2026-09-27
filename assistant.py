#!/usr/bin/env python3
"""Command line front end for the fantasy assistant.

This used to be a byte-identical copy of functions/assistant_core.py with its
own, older scoring logic, so CLI and API drifted apart. It now calls the same
engine the Cloud Functions use - there is only one implementation to maintain.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "functions"))

import api_core  # noqa: E402


def _fmt_signals(labels, indent="        "):
    return "".join(f"\n{indent}· {label}" for label in labels or [])


def show_waivers(username, league_id, sport):
    result = api_core.analyze_waivers_api(username, league_id, sport)
    if "error" in result:
        print(f"Fehler: {result['error']}")
        return 1

    faab = result["faab"]
    if faab.get("left") is not None:
        print(f"FAAB: {faab['left']} von {faab['budget']} übrig")

    print("\n--- TEAMBEDARF ---")
    for need in result["roster_needs"] or []:
        print(f"  [{need['severity']}] {need['reason']}")
    if not result["roster_needs"]:
        print("  Kein akuter Bedarf erkannt.")

    print("\n--- EMPFOHLENE MOVES ---")
    # True for the whole section, so it is printed once rather than opening
    # every recommendation.
    if result.get("moves_note"):
        print(f"  {result['moves_note']}\n")
    for rec in result["smart_recommendations"]:
        bid = rec["faab"]
        bid_str = f"  ({bid['min']}-{bid['max']} FAAB, {bid['tier']})" if bid else ""
        print(f"  ADD  {rec['add']['name']} ({rec['add']['pos']} - {rec['add']['team']}){bid_str}")
        print(f"  DROP {rec['drop']['name']} ({rec['drop']['pos']} - {rec['drop']['team']})")
        print(f"       {rec['reason']}\n")
    if not result["smart_recommendations"]:
        print("  Keine sinnvollen Moves gefunden.\n")

    print("--- TOP TARGETS ---")
    for p in result["waiver_targets"][:15]:
        print(f"  {p['score']:>8}  {p['name']:<24} {p['pos']:<3} {p['team']:<4}"
              f"  DVS {p['dvs']:<8} RVS {p['rvs']}{_fmt_signals(p['signals'])}")

    print("\n--- DROP-KANDIDATEN ---")
    for p in result["drop_candidates"][:10]:
        tag = f"  [HALTEN: {p['protected']}]" if p["protected"] else ""
        print(f"  DVS {p['dvs']:<8} {p['name']:<24} {p['pos']:<3} {p['team']:<4}{tag}")
    return 0


ISSUE_TEXT = {
    "empty": "Slot {slot} ist leer",
    "bye": "{name} ({slot}) hat Bye",
    "out": "{name} ({slot}) ist {status}",
    "doubtful": "{name} ({slot}) ist Doubtful",
    "questionable": "{name} ({slot}) ist Questionable",
    "bench": "Bank projiziert +{gain} Punkte mehr",
}


def show_overview(username, sport):
    """Computes the overview live - the CLI is where the snapshot comes from
    when there is no scheduled job, and waiting eight seconds is fine here."""
    result = api_core.lineup_overview_api(username, sport)
    if "error" in result:
        print(f"Fehler: {result['error']}")
        return 1

    print(f"--- AUFSTELLUNGS-CHECK, WOCHE {result['week']} ---")
    for league in result["leagues"]:
        if league["skipped"]:
            reason = {"best_ball": "Best Ball, stellt sich selbst auf",
                      "not_in_season": "nicht in der Saison",
                      "no_roster": "kein Kader"}.get(league["skipped"], league["skipped"])
            print(f"\n  {league['name']}: übersprungen ({reason})")
            continue
        print(f"\n  [{league['severity']}] {league['name']}  "
              f"{league['current_total']} -> {league['total']} (+{league['gain']})")
        for issue in league["issues"]:
            player = issue.get("player") or {}
            injury = player.get("injury") or {}
            print("      " + ISSUE_TEXT[issue["kind"]].format(
                slot=issue.get("slot"), name=player.get("name"),
                status=injury.get("status"), gain=issue.get("gain")))
        for change in league["changes"]:
            out = change["out"]
            print(f"      REIN {change['in']['name']} ({change['in']['pts_week']})"
                  + (f"  RAUS {out['name']} ({out['pts_week']})" if out else ""))
            for player in (change["in"], out):
                label = ((player or {}).get("usage") or {}).get("label")
                if label:
                    print(f"           {player['name']}: {label}")
        notes = league.get("usage_notes") or []
        if notes:
            print("      Nutzung/Rolle (Prognose angepasst):")
        for note in notes:
            where = "Starter" if note["starting"] else "Bank"
            print(f"        {note['name']} ({note['pos']}, {where}) "
                  f"{note['pts_week_base']} -> {note['pts_week']}  {note['label']}")
    return 0


def show_draft(username, draft_id, sport, position=None):
    result = api_core.analyze_draft_api(username, draft_id, sport)
    if "error" in result:
        print(f"Fehler: {result['error']}")
        return 1

    meta = result["metadata"]
    print(f"--- {meta['name']} ---")
    print(f"Status: {meta['status']} | Slot: {meta['user_slot']} | "
          f"Teams: {meta['teams']} | Runden: {meta['rounds']}")
    kind = {0: "alle Spieler", 1: "nur Rookies", 2: "nur Veteranen"}.get(meta["player_type"], "?")
    print(f"Draft-Typ: {kind}")

    if result["roster_needs"]:
        print("\n--- TEAMBEDARF ---")
        for need in result["roster_needs"]:
            print(f"  [{need['severity']}] {need['reason']}")

    print("\n--- EMPFEHLUNGEN ---")
    for rec in result["top_recommendations"]:
        print(f"  {rec['title']}: {rec['player']['name']} ({rec['player']['pos']})")
        print(f"    {rec['reason']}")

    print("\n--- BEST AVAILABLE ---")
    board = result["best_available"]
    if position:
        # By eligibility, not by primary position: Sleeper lists SG first for
        # almost nobody, so `--position SG` used to hide every SG-eligible wing.
        wanted = position.upper()
        board = [p for p in board if wanted in (p.get("elig") or [p["pos"]])]
        if not board:
            print(f"  Keine verfügbaren Spieler auf Position {wanted}.")
    for p in board:
        rookie = " [ROOKIE]" if p["is_rookie"] else ""
        elig = "/".join(p.get("elig") or [p["pos"]])
        print(f"  Edge {p['edge']:<8} DVS {p['dvs']:<8} {p['name']:<24} {elig:<10} "
              f"{p['team']:<4} Age {p['age']}{rookie}{_fmt_signals(p['signals'])}")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Fantasy Sports Assistant (Sleeper)",
        epilog="Beispiele:\n"
               "  python assistant.py --username DEIN_NAME --waivers --league_id 1314778868896264192\n"
               "  python assistant.py --username DEIN_NAME --draft_id 1312142320203730944\n"
               "  python assistant.py --username DEIN_NAME --waivers --league_id ... --sport nba\n"
               "  python assistant.py --username DEIN_NAME --overview\n"
               "  python assistant.py --update --sport nba",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--username", help="Dein Sleeper-Username")
    parser.add_argument("--league_id", help="Liga-ID")
    parser.add_argument("--draft_id", help="Draft-ID")
    parser.add_argument("--sport", default="nfl", choices=["nfl", "nba"], help="Sportart")
    parser.add_argument("--position", help="Board auf eine Position filtern (z. B. TE)")
    parser.add_argument("--waivers", action="store_true", help="Waiver-Assistent")
    parser.add_argument("--overview", action="store_true",
                        help="Aufstellungs-Check über alle Ligen der laufenden Saison")
    parser.add_argument("--update", action="store_true", help="Spieler- und Statsdaten aktualisieren")

    args = parser.parse_args()

    if args.update:
        print(api_core.update_sleeper_data_api(args.sport)["message"])
        return 0

    if not args.username:
        parser.error("--username wird benötigt (außer bei --update)")

    if args.waivers:
        if not args.league_id:
            parser.error("--waivers benötigt --league_id")
        return show_waivers(args.username, args.league_id, args.sport)

    if args.overview:
        return show_overview(args.username, args.sport)

    if args.draft_id:
        return show_draft(args.username, args.draft_id, args.sport, args.position)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
