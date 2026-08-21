"""Waiver signal layer.

Turns the player fields Sleeper already ships (injury designation, depth chart,
news timestamps) plus the live trending endpoints into the signals a waiver
decision actually hinges on. None of this data was read anywhere before.
"""

import time
import sleeper_api

# Sleeper puts the weekly designation in `injury_status`, NOT in `status`
# (`status` is the roster slot: Active / Inactive / Injured Reserve).
# Short-term designations should move redraft value hard and dynasty value
# barely; long-term ones move both.
INJURY_TIERS = {
    "questionable": {"severity": 1, "term": "short", "redraft": 0.80, "dynasty": 1.00},
    "dtd":          {"severity": 1, "term": "short", "redraft": 0.85, "dynasty": 1.00},
    "doubtful":     {"severity": 2, "term": "short", "redraft": 0.40, "dynasty": 0.99},
    "cov":          {"severity": 2, "term": "short", "redraft": 0.40, "dynasty": 0.99},
    "out":          {"severity": 3, "term": "short", "redraft": 0.10, "dynasty": 0.97},
    "sus":          {"severity": 3, "term": "long",  "redraft": 0.10, "dynasty": 0.90},
    "na":           {"severity": 3, "term": "long",  "redraft": 0.10, "dynasty": 0.92},
    "ir":           {"severity": 4, "term": "long",  "redraft": 0.05, "dynasty": 0.85},
    "pup":          {"severity": 4, "term": "long",  "redraft": 0.05, "dynasty": 0.85},
    "dnr":          {"severity": 4, "term": "long",  "redraft": 0.05, "dynasty": 0.80},
}

# A player ahead on the depth chart only counts as "cleared out of the way"
# from this severity upwards.
BLOCKING_CLEARED_AT = 3

TRENDING_LIMIT = 100  # Sleeper caps the endpoint at 100 regardless of `limit`.

# How recent a news update has to be before it is worth showing at all.
NEWS_FRESH_DAYS = 3


def _fmt_count(n):
    if n >= 1000000:
        return "%.1fm" % (n / 1000000.0)
    if n >= 1000:
        return "%dk" % round(n / 1000.0)
    return str(n)


def _days_since_ms(ms, now_ms):
    if not ms:
        return None
    return max(0, int((now_ms - ms) / 86400000))


def injury_signal(player, now_ms):
    """Reads injury_status/-body_part/-notes/-start_date and practice participation."""
    raw = player.get("injury_status")
    key = str(raw).strip().lower() if raw else ""
    tier = INJURY_TIERS.get(key)

    if not tier:
        # No weekly designation. The roster slot can still say IR/PUP.
        slot = str(player.get("status") or "").strip().lower()
        if slot in ("injured reserve", "physically unable to perform", "non football injury"):
            tier = INJURY_TIERS["ir"]
            raw = "IR"
        else:
            return {"status": None, "severity": 0, "term": None, "redraft_mult": 1.0,
                    "dynasty_mult": 1.0, "body_part": None, "notes": None,
                    "days": None, "label": None}

    body = player.get("injury_body_part")
    notes = player.get("injury_notes")
    days = _days_since_ms(player.get("injury_start_date"), now_ms)

    parts = [str(raw)]
    if days is not None and days > 0:
        parts.append("seit %d Tagen" % days)
    detail = " / ".join([p for p in [body, notes] if p])
    label = " ".join(parts) + (" — %s" % detail if detail else "")

    practice = player.get("practice_participation")
    if practice:
        label += " (Training: %s)" % practice

    return {
        "status": raw,
        "severity": tier["severity"],
        "term": tier["term"],
        "redraft_mult": tier["redraft"],
        "dynasty_mult": tier["dynasty"],
        "body_part": body,
        "notes": notes,
        "days": days,
        "label": label,
    }


def build_depth_index(players):
    """Groups players by (team, depth chart slot) so we can see who is ahead of whom."""
    index = {}
    for pid, p in players.items():
        team = p.get("team")
        if not team or team == "FA":
            continue
        slot = p.get("depth_chart_position") or p.get("position")
        if not slot:
            continue
        index.setdefault((team, slot), []).append(pid)
    return index


def opportunity_signal(pid, player, players, depth_index, injuries):
    """Is the path in front of this player blocked, or did it just clear up?

    This is the signal behind almost every real waiver pickup: a backup moves up
    because the man ahead of him landed on IR.
    """
    none_signal = {"score": 0, "depth": player.get("depth_chart_order"),
                   "cleared": [], "label": None}

    team = player.get("team")
    if not team or team == "FA":
        return none_signal

    order = player.get("depth_chart_order")
    slot = player.get("depth_chart_position") or player.get("position")
    if not slot:
        return none_signal

    group = depth_index.get((team, slot), [])
    # Treat "no depth chart entry" as sitting at the very bottom.
    my_order = order if order is not None else 99

    ahead_total = 0
    cleared = []
    for other_pid in group:
        if other_pid == pid:
            continue
        other = players.get(other_pid, {})
        o_order = other.get("depth_chart_order")
        if o_order is None or o_order >= my_order:
            continue
        ahead_total += 1
        if injuries.get(other_pid, {}).get("severity", 0) >= BLOCKING_CLEARED_AT:
            cleared.append(other.get("full_name") or other_pid)

    if not cleared:
        return {"score": 0, "depth": order, "cleared": [], "label": None}

    # Guard against snapshot noise: for a player with no market presence at all,
    # a depth chart entry that may be days old is not evidence of anything.
    if (player.get("search_rank") or 999999) > 3000:
        return {"score": 0, "depth": order, "cleared": [], "label": None}

    remaining = ahead_total - len(cleared)
    if remaining <= 0:
        score = 3
        label = "Rückt auf Platz 1 — %s ausgefallen" % ", ".join(cleared[:2])
    elif remaining == 1:
        score = 2
        label = "Rückt auf — %s ausgefallen" % ", ".join(cleared[:2])
    else:
        score = 1
        label = "%s ausgefallen, steht aber weiter hinten" % ", ".join(cleared[:2])

    return {"score": score, "depth": order, "cleared": cleared, "label": label}


def fetch_trending(sport="nfl", lookback_hours=24):
    """Live per request — small payload, and independent of the players snapshot age."""
    out = {}
    for kind in ("add", "drop"):
        rows = sleeper_api.get_trending_players(sport, kind, lookback_hours, TRENDING_LIMIT) or []
        top = rows[0]["count"] if rows else 0
        for i, row in enumerate(rows):
            pid = str(row.get("player_id"))
            entry = out.setdefault(pid, {"adds": 0, "drops": 0, "add_rank": None,
                                         "drop_rank": None, "intensity": 0.0})
            entry[kind + "s"] = row.get("count", 0)
            entry[kind + "_rank"] = i + 1
            if kind == "add" and top:
                # Log-scaled: the top add is often an order of magnitude ahead.
                entry["intensity"] = round(min(1.0, row.get("count", 0) / float(top)) ** 0.5, 3)
    for pid, e in out.items():
        e["net"] = e["adds"] - e["drops"]
        bits = []
        if e["adds"]:
            bits.append("+%s Adds" % _fmt_count(e["adds"]))
        if e["drops"]:
            bits.append("-%s Drops" % _fmt_count(e["drops"]))
        e["label"] = " / ".join(bits) + (" in %dh" % lookback_hours if bits else "")
    return out


def recency_signal(player, now_ms):
    return {
        "news_days": _days_since_ms(player.get("news_updated"), now_ms),
        "team_changed_days": _days_since_ms(player.get("team_changed_at"), now_ms),
    }


def build_signals(players, sport="nfl", lookback_hours=24, trending=None):
    """One signal bundle per player id."""
    now_ms = int(time.time() * 1000)

    injuries = {pid: injury_signal(p, now_ms) for pid, p in players.items()}
    depth_index = build_depth_index(players)
    if trending is None:
        trending = fetch_trending(sport, lookback_hours)

    signals = {}
    for pid, p in players.items():
        inj = injuries[pid]
        opp = opportunity_signal(pid, p, players, depth_index, injuries)
        trend = trending.get(pid, {"adds": 0, "drops": 0, "net": 0, "intensity": 0.0,
                                   "add_rank": None, "drop_rank": None, "label": None})
        rec = recency_signal(p, now_ms)

        labels = [l for l in (opp["label"], trend.get("label"), inj["label"]) if l]
        if rec["team_changed_days"] is not None and rec["team_changed_days"] <= 14:
            labels.append("Teamwechsel vor %d Tagen" % rec["team_changed_days"])
        # Sleeper's public API carries no news *text*, only the timestamp of the
        # last update. Recency is therefore the whole of the available news
        # signal - and it was being computed and then dropped on the floor.
        news_days = rec["news_days"]
        if news_days is not None and news_days <= NEWS_FRESH_DAYS:
            labels.append("News heute" if news_days == 0
                          else "News vor %d Tag%s" % (news_days, "" if news_days == 1 else "en"))

        signals[pid] = {
            "injury": inj,
            "opportunity": opp,
            "trend": trend,
            "recency": rec,
            "labels": labels,
        }
    return signals


def league_activity(league_id, week, players):
    """What was actually added/dropped in this league recently."""
    tx = sleeper_api.get_transactions(league_id, week) or []
    added, dropped = {}, {}
    for t in tx:
        if t.get("status") != "complete":
            continue
        for pid in (t.get("adds") or {}):
            added[str(pid)] = players.get(str(pid), {}).get("full_name") or str(pid)
        for pid in (t.get("drops") or {}):
            dropped[str(pid)] = players.get(str(pid), {}).get("full_name") or str(pid)
    return {"added": added, "dropped": dropped}
