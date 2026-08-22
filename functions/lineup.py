"""Lineup construction and positional need analysis.

Sleeper reports two position fields. `position` is the real-life position
(CB, SS, DE, NT, PG ...), while `fantasy_positions` is what a league's roster
slots actually accept: cornerbacks and safeties are `DB`, ends and tackles are
`DL`, and an NBA player carries every slot he qualifies for.

Everything in here keys off `fantasy_positions`. Counting by `position` is what
reported "1 startable SG" for a roster holding seven SG-eligible players, and
what kept cornerbacks out of DB slots.

Needs are derived from a lineup, not from a headcount: we build the best legal
starting lineup, then ask how much a league-average starter at each position
would improve it. A position that cannot improve the lineup is not a need, no
matter how few players you own there - and flex slots and multi-position
eligibility fall out of the model for free.
"""

BENCH_SLOTS = {"BN", "IR", "TAXI"}

# Which player positions a flex slot accepts.
FLEX_SLOTS = {
    "FLEX":       {"RB", "WR", "TE"},
    "REC_FLEX":   {"WR", "TE"},
    "WRRB_FLEX":  {"RB", "WR"},
    "SUPER_FLEX": {"QB", "RB", "WR", "TE"},
    "IDP_FLEX":   {"DL", "LB", "DB"},
    "G":          {"PG", "SG"},
    "F":          {"SF", "PF"},
    "UTIL":       {"PG", "SG", "SF", "PF", "C"},
}

# gain / replacement-value ratio -> how badly the position needs help
SEVERITY_THRESHOLDS = ((0.85, 3), (0.45, 2), (0.18, 1))


def slot_accepts(slot):
    return FLEX_SLOTS.get(slot, {slot})


def player_positions(player):
    """Every position this player may be slotted at."""
    positions = set(player.get("fantasy_positions") or [])
    if not positions and player.get("position"):
        positions.add(player["position"])
    return positions


def starting_slots(roster_positions):
    return [s for s in (roster_positions or []) if s not in BENCH_SLOTS]


def positions_in_use(roster_positions):
    used = set()
    for slot in starting_slots(roster_positions):
        used |= slot_accepts(slot)
    return sorted(used)


def build_lineup(players, roster_positions, value_of):
    """Best legal starting lineup.

    Players are offered to slots in descending value and placed via augmenting
    paths. The assignable subsets of a bipartite graph form a transversal
    matroid, so taking them greedily by value maximises the total - this is the
    optimal lineup, not an approximation.
    """
    slots = starting_slots(roster_positions)
    assigned = [None] * len(slots)
    slot_sets = [slot_accepts(s) for s in slots]

    def place(player, visited):
        for i, accepts in enumerate(slot_sets):
            if i in visited or not (player["elig"] & accepts):
                continue
            visited.add(i)
            if assigned[i] is None or place(assigned[i], visited):
                assigned[i] = player
                return True
        return False

    for player in sorted(players, key=lambda p: -value_of(p)):
        place(player, set())

    return list(zip(slots, assigned))


def lineup_value(lineup, value_of):
    return sum(value_of(p) for _, p in lineup if p is not None)


def direct_slots(roster_positions):
    """Slots that name a position outright, ignoring flex."""
    counts = {}
    for slot in starting_slots(roster_positions):
        if slot not in FLEX_SLOTS:
            counts[slot] = counts.get(slot, 0) + 1
    return counts




def position_demand(roster_positions, slots_per_pos=None):
    """How many bodies a position has to be able to field.

    `slots_per_pos` is flex-weighted demand, so "3 WR + 2 FLEX" arrives as 3.9.
    Treating that as four dedicated WR slots is what demanded six
    above-replacement WRs before a roster counted as healthy. Own slots are the
    hard requirement; flex demand is the cushion on top.
    """
    fixed = direct_slots(roster_positions)
    slots_per_pos = slots_per_pos or {}
    return {pos: max(fixed.get(pos, 0), int(round(slots_per_pos.get(pos, 1))))
            for pos in positions_in_use(roster_positions)}


def positional_depth(players, roster_positions, replacement, value_of,
                     slots_per_pos=None):
    """Supply against demand at every position the league starts.

    Split out of `positional_needs` because the waiver engine needs it for
    positions that are *not* flagged: "may I drop this man" is a question about
    what stays behind at his position, and a position only healthy enough to
    stay off the needs list still has a floor.
    """
    fixed = direct_slots(roster_positions)
    demand = position_demand(roster_positions, slots_per_pos)

    out = {}
    for pos, need in demand.items():
        baseline = replacement.get(pos, 0) or 0
        eligible = [p for p in players if pos in p["elig"]]
        startable = [p for p in eligible if value_of(p) >= baseline]
        out[pos] = {
            "fixed": fixed.get(pos, 0),
            "demand": need,
            "eligible": len(eligible),
            "startable": len(startable),
            # How much room the position has before a drop starts to hurt.
            "surplus": len(startable) - need,
            "spare": len(eligible) - need,
            "replacement": baseline,
        }
    return out


# What kind of hole this is, independent of how loud it is. Two positions can
# both land on severity 1 for completely different reasons - one covered by a
# single starter with nobody behind him, one carrying seven bodies of which
# none reaches league level - and calling both of them "dünn" was hiding the
# only part a manager can act on.
NEED_KINDS = {
    "empty":       "Slot leer",
    "below_level": "Unter Liga-Niveau",
    "flex_gap":    "FLEX offen",
    "no_depth":    "Kein Ersatz im Kader",
    "no_backup":   "Ersatz unter Niveau",
    "upgrade":     "Ausbaufähig",
}


def _need_kind(empty, startable, own, demand, spare):
    if empty:
        return "empty", 3
    if startable < own:
        return "below_level", 3   # a start this position owns cannot be covered
    if startable < demand:
        return "flex_gap", 2      # own slots covered, nothing left for flex
    if startable > demand:
        return "upgrade", 0
    # Covered exactly. Whether that is a shrug or a problem depends on what is
    # behind it: bench bodies below league level still fill the slot when a
    # starter goes down, no body at all leaves it empty. Six defensive linemen
    # for two slots and one quarterback for one are not the same position.
    if spare <= 0:
        return "no_depth", 2
    return "no_backup", 1


def positional_needs(players, roster_positions, replacement, value_of, slots_per_pos=None):
    """Where does this roster actually need help?

    Two independent signals, because they answer different questions:

    - *gain*: how much a league-average starter at this position would add to the
      optimal lineup. Handles flex slots and multi-position eligibility, but in a
      UTIL-heavy lineup every position scores about the same.
    - *depth*: how many eligible players clear the league's starting bar, against
      how many slots the position has to cover. This is the "am I thin here?"
      question, and it is the one a manager actually asks.

    The reported severity is the worse of the two, with one override: *gain* is
    the only one of the two that measures the lineup directly, so a position it
    scores at zero can never be reported as critical. Without that override a
    deep league's high replacement bar made a normal roster look uniformly
    broken - every position red, on a lineup with no hole in it.

    The override caps the *severity* and nothing else. `kind` keeps saying which
    of the situations above this position is actually in, so four positions that
    all come back at severity 1 no longer read as the same problem.
    """
    base_lineup = build_lineup(players, roster_positions, value_of)
    base = lineup_value(base_lineup, value_of)
    depth = positional_depth(players, roster_positions, replacement, value_of,
                             slots_per_pos)

    needs = []
    for pos, stat in depth.items():
        baseline = stat["replacement"]
        if baseline <= 0:
            continue

        phantom = {"elig": {pos}, "pos": pos, "_value": baseline, "_phantom": True}
        phantom_value = lambda p: p.get("_value", 0) if p.get("_phantom") else value_of(p)
        gain = lineup_value(
            build_lineup(players + [phantom], roster_positions, phantom_value),
            phantom_value,
        ) - base

        ratio = gain / baseline if baseline else 0
        gain_severity = next((s for t, s in SEVERITY_THRESHOLDS if ratio >= t), 0)

        empty = sum(1 for slot, p in base_lineup
                    if p is None and pos in slot_accepts(slot))

        kind, depth_severity = _need_kind(empty, stat["startable"], stat["fixed"],
                                          stat["demand"], stat["spare"])
        severity = max(gain_severity, depth_severity)

        # The decisive check, and the one that was missing: `gain` is the direct
        # measurement of whether this position can still be improved. When a
        # league-average starter would add nothing and no slot is empty, the
        # lineup is covered here — whatever a headcount of the bench says. That
        # combination was reporting "kritisch" on positions with gain 0.0, which
        # is why every position on a normal roster came back red.
        if not empty and gain_severity == 0:
            severity = min(severity, 1)

        if not severity:
            continue

        needs.append({
            "pos": pos,
            "severity": severity,
            "kind": kind,
            "label": NEED_KINDS[kind],
            "empty_slots": empty,
            "gain": round(gain, 1),
            "ratio": round(ratio, 2),
            "slots": stat["demand"],
            "depth": stat["eligible"],
            "startable": stat["startable"],
            "surplus": stat["surplus"],
            "spare": stat["spare"],
            "fixed_slots": stat["fixed"],
            "reason": _reason(pos, kind, stat, empty, gain_severity),
        })

    needs.sort(key=lambda n: (-n["severity"], -n["gain"]))
    return needs


def _slot_text(fixed, demand):
    # Say what the league actually starts. "2 Startplätze" for a league with one
    # RB slot plus two FLEX is technically the flex-weighted demand, but reads
    # as a factual error to anyone looking at their lineup.
    if fixed and demand > fixed:
        return (f"{fixed} fester Startplatz + FLEX" if fixed == 1
                else f"{fixed} feste Startplätze + FLEX")
    if fixed:
        return f"{fixed} Startplatz" if fixed == 1 else f"{fixed} Startplätze"
    return "nur FLEX-Plätze"


def _reason(pos, kind, stat, empty=0, gain_severity=0):
    """One sentence naming the situation, then the headcount behind it.

    The conclusion leads, the headcount follows: "0 von 5 über Startniveau" in
    front of "Aufstellung gedeckt" reads as a contradiction even when both
    halves are true, and that phrasing is a large part of why the whole view
    felt alarmist.
    """
    startable, eligible = stat["startable"], stat["eligible"]
    detail = (f"{startable} von {eligible} {pos}-fähigen Spielern über "
              f"Liga-Startniveau, {_slot_text(stat['fixed'], stat['demand'])}")

    if kind == "empty":
        # An unfilled slot and a slot filled below league level are different
        # problems; saying "ungedeckt" for a filled slot reads as a false claim.
        return f"{detail} — {empty} Startplatz ohne zulässigen Spieler."
    if kind == "below_level":
        # Whether this is an emergency depends on the lineup, not the headcount:
        # a position can be under the league bar everywhere and still be the
        # best a manager can field, in which case a claim changes nothing.
        if gain_severity == 0:
            return (f"Startplatz besetzt, aber unter Liga-Niveau — ein "
                    f"Liga-Durchschnitts-{pos} wäre trotzdem keine Verbesserung "
                    f"deiner Startelf. ({detail})")
        return f"{detail} — fester Startplatz nur unter Liga-Niveau besetzt."
    if kind == "flex_gap":
        if gain_severity == 0:
            return (f"Feste Plätze gedeckt, für den FLEX reicht die Qualität "
                    f"nicht — ein Liga-Durchschnitts-{pos} würde die Startelf "
                    f"aber nicht verbessern. ({detail})")
        return f"{detail} — feste Plätze gedeckt, für FLEX reicht es nicht."
    if kind == "no_depth":
        return (f"Genau gedeckt und ohne Ersatzspieler: fällt einer aus, ist "
                f"der Startplatz leer. ({detail})")
    if kind == "no_backup":
        return (f"Genau gedeckt. Dahinter {stat['spare']} Ersatzspieler, aber "
                f"unter Liga-Startniveau — ein Ausfall kostet dich sofort "
                f"Punkte. ({detail})")
    return (f"Aufstellung gedeckt — ein Liga-Durchschnitts-{pos} würde sie "
            f"nicht verbessern. ({detail})")


def lineup_report(players, roster_positions, value_of):
    """Structured lineup for the optimizer view."""
    lineup = build_lineup(players, roster_positions, value_of)
    used = {id(p) for _, p in lineup if p is not None}
    bench = sorted((p for p in players if id(p) not in used),
                   key=lambda p: -value_of(p))
    return {
        "slots": [{"slot": slot, "player": p} for slot, p in lineup],
        "bench": bench,
        "total": round(lineup_value(lineup, value_of), 1),
        "empty": [slot for slot, p in lineup if p is None],
    }
