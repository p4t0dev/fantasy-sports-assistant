"""Usage and role layer: what a player's team has actually been doing with him.

The weekly projection is Sleeper's number, and the model had nothing of its
own to hold against it. A back who took over the backfield in week 2, or a
receiver who went from 40 % of the snaps to 85 %, looked exactly like he did
before the season: the depth chart only moved when the man ahead of him was
hurt, and the points he scored never reached the lineup at all.

Two games in, points are noise - one long touchdown is half a player's
season. Usage is not: snap share and who gets the touches inside a position
group describe the role directly, and they move before the depth chart does.
So the adjustment rests on usage and stays small, and points are reported,
never weighted.
"""

# Positions whose role a snap and touch count describes, and which get an
# adjustment. A quarterback plays every snap or none; his role changes are
# benchings, and the projection moves with those the same day.
ADJUSTED_POSITIONS = ("RB", "WR", "TE")
USAGE_POSITIONS = ("QB", "RB", "WR", "TE")

# Per percentage point of snap share gained against his earlier games.
SNAP_WEIGHT = 0.004
# Per place moved up or down inside his team's position group.
ROLE_WEIGHT = 0.05
# Sleeper already prices part of this in. Two games are two games.
MAX_ADJ = 0.10
# Below this the adjustment is not worth a label, or a lineup change.
NOTABLE_ADJ = 0.03


def _usage_key(pos, stats):
    """What ranks a player inside his position group for one game.

    A back's role is the touches he gets; a receiver's is the routes he runs,
    and snaps are the closest thing to routes in a box score.
    """
    snaps = stats.get("off_snp") or 0
    targets = stats.get("rec_tgt") or 0
    if pos == "RB":
        return ((stats.get("rush_att") or 0) + targets, snaps)
    if pos == "QB":
        return (snaps, stats.get("pass_att") or 0)
    return (snaps, targets)


def week_games(week_rows, players, score):
    """One played week as {pid: game}, each ranked inside his team's position group.

    `week_rows` is {pid: {"team", "stats"}}, `score(pid, stats)` scores a box
    score under the league's settings.
    """
    groups = {}
    games = {}
    for pid, row in (week_rows or {}).items():
        player = players.get(str(pid)) or {}
        pos = player.get("position")
        stats = row.get("stats") or {}
        team = row.get("team") or player.get("team")
        if pos not in USAGE_POSITIONS or not team or not stats.get("off_snp"):
            continue
        team_snaps = stats.get("tm_off_snp") or 0
        games[str(pid)] = {
            "pos": pos,
            "team": team,
            "snap_pct": round(stats["off_snp"] / team_snaps, 3) if team_snaps else None,
            "targets": int(stats.get("rec_tgt") or 0),
            "touches": int((stats.get("rush_att") or 0) + (stats.get("rec") or 0)),
            "pts": round(score(str(pid), stats), 1),
            "_key": _usage_key(pos, stats),
        }
        groups.setdefault((team, pos), []).append(str(pid))

    for members in groups.values():
        members.sort(key=lambda pid: games[pid]["_key"], reverse=True)
        for i, pid in enumerate(members):
            games[pid]["rank"] = i + 1
            # Who was ahead of him, and who played at all - to tell a
            # promotion from a fill-in.
            games[pid]["ahead"] = members[:i]
            games[pid]["group"] = members
    for game in games.values():
        del game["_key"]
    return games


def _clamp(value, low, high):
    return max(low, min(high, value))


def usage_signal(pid, player, history, latest_week, is_out):
    """The role signal for one player, or None when there is nothing to read.

    `history` is [(week, game)] for the weeks he played, oldest first.
    `latest_week` is the last week that was played at all: a player whose last
    game is older than that missed a game, and his old usage says nothing
    about the role he comes back to. `is_out(pid)` says whether a player is
    out this week.
    """
    if not history:
        return None
    pos = player.get("position")
    last_week, last = history[-1]
    earlier = [g for _, g in history[:-1]]
    avg_pts = round(sum(g["pts"] for _, g in history) / len(history), 1)

    snap_delta = None
    snaps_before = [g["snap_pct"] for g in earlier if g["snap_pct"] is not None]
    if last["snap_pct"] is not None and snaps_before:
        snap_delta = round(last["snap_pct"] - sum(snaps_before) / len(snaps_before), 3)

    rank_prev = earlier[-1]["rank"] if earlier else None
    shift = 0
    filled_in_for = []
    if rank_prev is not None:
        shift = int(_clamp(rank_prev - last["rank"], -1, 1))
        if shift > 0:
            # Moved up because the man ahead of him sat? Then the job is only
            # his while that man stays out. Back and healthy, it is his again.
            prev_ahead = earlier[-1].get("ahead") or []
            missing = [a for a in prev_ahead if a not in last.get("group", [])]
            filled_in_for = [a for a in missing if not is_out(a)]
            if filled_in_for:
                shift = 0

    current = last_week == latest_week
    adj = 1.0
    # A fill-in's snaps and touches came with the stand-in job, and go with it.
    if current and pos in ADJUSTED_POSITIONS and earlier and not filled_in_for:
        adj = 1.0 + ROLE_WEIGHT * shift
        if snap_delta is not None:
            adj += SNAP_WEIGHT * snap_delta * 100
        adj = round(_clamp(adj, 1 - MAX_ADJ, 1 + MAX_ADJ), 3)

    return {
        "weeks": [w for w, _ in history],
        "last_week": last_week,
        "current": current,
        "snap_pct": last["snap_pct"],
        "snap_delta": snap_delta,
        "targets": last["targets"],
        "touches": last["touches"],
        "rank": last["rank"],
        "rank_prev": rank_prev,
        "depth": player.get("depth_chart_order"),
        "role_shift": shift,
        "filled_in_for": filled_in_for,
        "avg_pts": avg_pts,
        "last_pts": last["pts"],
        "adj": adj,
    }


def _pct(value):
    return f"{round(value * 100)} %"


def usage_label(sig, pos, names=None):
    """One line a manager can check against what he saw on Sunday."""
    if not sig:
        return None
    names = names or {}
    parts = []
    if sig["rank_prev"] is not None and sig["rank_prev"] != sig["rank"]:
        parts.append(f"{pos}{sig['rank_prev']} → {pos}{sig['rank']}")
    elif sig["depth"] and sig["depth"] != sig["rank"] and pos in ("RB", "TE"):
        # Receivers share depth order 1 across three spots, so only here does
        # the depth chart have a number to disagree with.
        parts.append(f"Depth Chart {pos}{sig['depth']}, Nutzung {pos}{sig['rank']}")
    if sig["snap_pct"] is not None:
        snaps = f"Snaps {_pct(sig['snap_pct'])}"
        if sig["snap_delta"] is not None and abs(sig["snap_delta"]) >= 0.05:
            snaps += f" ({'+' if sig['snap_delta'] > 0 else '−'}{round(abs(sig['snap_delta']) * 100)})"
        parts.append(snaps)
    if pos == "RB":
        parts.append(f"{sig['touches']} Touches")
    elif pos in ("WR", "TE"):
        parts.append(f"{sig['targets']} Targets")
    parts.append(f"Ø {sig['avg_pts']} Pkt in {len(sig['weeks'])} Sp.")
    if sig["filled_in_for"]:
        who = ", ".join(names.get(p, p) for p in sig["filled_in_for"][:2])
        parts.append(f"nur Vertretung für {who}")
    if not sig["current"]:
        parts.append(f"letztes Spiel W{sig['last_week']}")
    label = f"W{sig['last_week']}: " + ", ".join(parts)
    if abs(sig["adj"] - 1) >= NOTABLE_ADJ:
        label += f" → Prognose {'+' if sig['adj'] > 1 else '−'}{round(abs(sig['adj'] - 1) * 100)} %"
    return label


def build_usage(week_stats, players, score, is_out):
    """Role signal for every player with a played game, keyed by player id.

    `week_stats` is {week: {pid: {"team", "stats"}}} for the weeks already
    played.
    """
    weeks = sorted(int(w) for w in (week_stats or {}))
    if not weeks:
        return {}
    per_week = {w: week_games(week_stats.get(w) or week_stats.get(str(w)), players, score)
                for w in weeks}

    history = {}
    for w in weeks:
        for pid, game in per_week[w].items():
            history.setdefault(pid, []).append((w, game))

    names = {pid: (players.get(pid) or {}).get("full_name") or pid for pid in history}
    out = {}
    for pid, games in history.items():
        player = players.get(pid) or {}
        # His team's latest played week: a team on bye last week did not
        # leave its players' usage stale.
        team = games[-1][1]["team"]
        latest = max((w for w in weeks
                      if any(g["team"] == team for g in per_week[w].values())),
                     default=weeks[-1])
        sig = usage_signal(pid, player, games, latest, is_out)
        if sig:
            sig["label"] = usage_label(sig, player.get("position"), names)
            out[pid] = sig
    return out
